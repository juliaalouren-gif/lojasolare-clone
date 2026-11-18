/**
 * Recebe os eventos de rastreio da SuperFrete (postado / entregue /
 * cancelado) e envia o e-mail de atualização correspondente pro cliente.
 *
 * A SuperFrete assina o corpo com HMAC-SHA256 (header X-ME-Signature),
 * por isso o body precisa ser lido cru, antes de qualquer parse.
 */
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { sendShippingPostedEmail, sendDeliveredEmail, sendTrackingEmail } from '../lib/send-notification.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Mesmo helper do api/superfrete-generate-label.js — soma as unidades do
// adicional "luminaria" só pra exibição no e-mail, sem mexer em product_quantity.
function bumpUnits(order) {
  const bumps = order.customer_address?.orderBumps;
  if (!bumps || !bumps.luminaria) return 0;
  return order.customer_address?.productType === 'led' ? 3 : 2;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  try {
    // IMPORTANTE: nunca acessar req.body antes daqui — é um getter que
    // consome o stream ao ser lido, e a assinatura precisa dos bytes crus.
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const rawBody = Buffer.concat(chunks);

    const secret = process.env.SUPERFRETE_WEBHOOK_SECRET;
    const signature = req.headers['x-me-signature'];

    if (secret) {
      const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
      const valid = typeof signature === 'string'
        && signature.length === expected.length
        && crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
      if (!valid) {
        console.warn('[SuperFrete Webhook] Assinatura inválida — ignorando');
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }

    const body = JSON.parse(rawBody.toString('utf8') || '{}');
    const { event, data } = body;
    if (!event || !data?.id) return res.status(200).json({ message: 'Ignored' });

    const { data: order } = await supabase
      .from('orders')
      .select('*')
      .eq('customer_address->>superfreteOrderId', data.id)
      .single();

    if (!order) return res.status(200).json({ message: 'Order not found, ignored' });

    const newStatus = (data.status || event.replace('order.', '')).toString();

    // O rastreio às vezes só vem num evento posterior ao pagamento (não
    // necessariamente na geração) — se ainda não tínhamos salvo, completa
    // agora e manda o e-mail de rastreio que não pôde sair na hora.
    const incomingTracking = data.tracking || null;
    const justGotTracking = Boolean(incomingTracking) && !order.tracking_code;

    const updates = { customer_address: { ...order.customer_address, superfreteStatus: newStatus } };
    if (justGotTracking) updates.tracking_code = incomingTracking;

    await supabase.from('orders').update(updates).eq('id', order.id);

    if (justGotTracking) {
      await sendTrackingEmail({
        to: order.customer_email,
        customerName: order.customer_name,
        trackingCode: incomingTracking,
        totalPrice: order.total_price,
        quantity: order.product_quantity + bumpUnits(order),
      }).catch(e => console.error('[SuperFrete Webhook] sendTrackingEmail (atraso) failed:', e));
    }

    if (event === 'order.posted') {
      await sendShippingPostedEmail({
        customerName: order.customer_name,
        customerEmail: order.customer_email,
        trackingCode: data.tracking || order.tracking_code,
      }).catch(e => console.error('[SuperFrete Webhook] sendShippingPostedEmail failed:', e));
    } else if (event === 'order.delivered') {
      await sendDeliveredEmail({
        customerName: order.customer_name,
        customerEmail: order.customer_email,
        trackingCode: data.tracking || order.tracking_code,
      }).catch(e => console.error('[SuperFrete Webhook] sendDeliveredEmail failed:', e));
    }

    return res.status(200).json({ updated: true });
  } catch (err) {
    console.error('[SuperFrete Webhook] Unhandled error:', err);
    return res.status(200).json({ status: 'internal_error' });
  }
}
