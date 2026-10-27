import { createClient } from '@supabase/supabase-js';
import { notifyPaymentApproved, notifyPixExpired, schedulePostPurchaseEmails } from '../lib/send-notification.js';
import { sendMetaEvent } from '../lib/meta-capi.js';
import { sendWhatsApp } from '../lib/whatsapp.js';
import { mapChargeStatus } from '../lib/pagarme.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    // A Pagar.me não documenta assinatura HMAC de webhook (diferente do
    // Mercado Pago), então a URL configurada no painel carrega um segredo
    // próprio: .../api/pagarme-webhook?secret=XXXX
    const expectedSecret = process.env.PAGARME_WEBHOOK_SECRET;
    if (expectedSecret && req.query?.secret !== expectedSecret) {
      console.warn('[Webhook] Segredo inválido na URL — ignorando');
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { type, data } = req.body || {};
    if (!type || !data) return res.status(200).json({ message: 'Ignored' });

    // Só processamos eventos de charge (cobrança) — é o que guardamos como
    // mp_payment_id. Eventos de order.* são ignorados para não duplicar.
    if (!type.startsWith('charge.')) {
      return res.status(200).json({ message: 'Ignored', type });
    }

    const paymentId = data.id;
    if (!paymentId) return res.status(400).end();

    const newStatus = mapChargeStatus(data.status);

    // Fetch the order from Supabase to get customer info for notifications
    const { data: order } = await supabase
      .from('orders')
      .select('*')
      .eq('mp_payment_id', String(paymentId))
      .single();

    const previousStatus = order?.status;

    // Never downgrade a paid order — if already approved, ignore cancelled/rejected webhooks
    if (previousStatus === 'approved' && newStatus !== 'approved') {
      console.log(`[Webhook] Ignoring status downgrade approved → ${newStatus} for charge ${paymentId}`);
      return res.status(200).json({ updated: false, reason: 'already_approved' });
    }

    const { error: updateError } = await supabase
      .from('orders')
      .update({ status: newStatus })
      .eq('mp_payment_id', String(paymentId));

    if (updateError) {
      console.error('[Webhook] DB update error:', updateError);
      return res.status(200).json({ status: 'db_error' });
    }

    // Mark lead as converted so abandonment message is not sent
    if (order?.customer_phone) {
      supabase.from('leads')
        .update({ converted: true })
        .eq('phone', String(order.customer_phone).replace(/\D/g, ''));
    }

    // Send notifications based on status
    if (order) {
      // Venda adicional (upsell/downsell): o cliente já recebeu o WhatsApp e os
      // e-mails de pós-compra do pedido principal, então não repete.
      const isUpsellOrder = order.customer_address?.upsell === true;
      if (newStatus === 'approved') {
        const firstName = (order.customer_name || '').trim().split(' ')[0];
        // For card payments already approved synchronously, avoid double WhatsApp
        if (previousStatus !== 'approved' && !isUpsellOrder) await sendWhatsApp(order.customer_phone,
          `Olá ${firstName}, seu pedido foi confirmado e logo sairá para entrega, lembrando que nosso prazo de entrega é de 8 dias`
        ).catch(() => {});

        await notifyPaymentApproved({
          customerName: order.customer_name,
          customerEmail: order.customer_email,
          customerPhone: order.customer_phone,
          totalPrice: order.total_price,
          shippingMethod: order.shipping_method,
          orderId: order.id,
        });

        if (!isUpsellOrder) schedulePostPurchaseEmails({
          customerName:  order.customer_name,
          customerEmail: order.customer_email,
          orderId:       order.id,
        }).catch(e => console.error('Post-purchase emails (webhook) failed:', e));

        // Meta CAPI Purchase (especially important for Pix — browser pixel may not fire)
        const nameParts = (order.customer_name || '').trim().split(/\s+/);
        const addr = order.customer_address || {};
        sendMetaEvent({
          eventName: 'Purchase',
          eventSourceUrl: `${process.env.SITE_URL}/obrigado.html`,
          userData: {
            email: order.customer_email,
            phone: order.customer_phone,
            firstName: nameParts[0],
            lastName: nameParts.slice(1).join(' ') || nameParts[0],
            cpf: order.customer_cpf,
            city: addr.city,
            state: addr.state,
            zip: addr.cep,
          },
          customData: {
            value: parseFloat(order.total_price) || 0,
            currency: 'BRL',
            content_ids: ['solare-luminaria'],
            content_type: 'product',
            num_items: order.product_quantity || 1,
          },
          eventId: `purchase-${paymentId}`,
        }).catch(e => console.error('Meta CAPI Purchase (webhook) failed:', e));
      } else if (newStatus === 'cancelled' && !isUpsellOrder) {
        await notifyPixExpired({
          customerName: order.customer_name,
          customerEmail: order.customer_email,
        });
      }
    }

    return res.status(200).json({ updated: true });

  } catch (err) {
    console.error('[Webhook] Unhandled error:', err);
    return res.status(200).json({ status: 'internal_error' });
  }
}
