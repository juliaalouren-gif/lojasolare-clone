import { createClient } from '@supabase/supabase-js';
import { notifyPaymentApproved } from '../lib/send-notification.js';
import { PAGARME_BASE, pagarmeAuthHeader, mapChargeStatus, buildPagarmeCustomer } from '../lib/pagarme.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Preço decidido no servidor — nunca confiar em valor vindo do cliente
const OFFER_PRICES = { upsell: 49.90, downsell: 39.90 };

// Linha extra em "orders" para a venda adicional. O marcador "upsell" em
// customer_address permite que webhook/sincronizações não repitam e-mails
// e WhatsApp de pós-compra do pedido principal.
function buildUpsellOrder(order, orderId, offer, amount, chargeId, status, extra = {}) {
  return {
    customer_name: order.customer_name,
    customer_email: order.customer_email,
    customer_cpf: order.customer_cpf,
    customer_phone: order.customer_phone,
    customer_address: { ...order.customer_address, upsell: true, upsell_of: orderId, offer },
    product_quantity: 2,
    product_light_color: order.product_light_color,
    total_price: amount,
    payment_method: order.payment_method,
    mp_payment_id: String(chargeId),
    status,
    shipping_method: order.shipping_method,
    shipping_price: 0,
    ...extra,
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const { orderId, offer } = req.body || {};
    if (!orderId) return res.status(400).json({ error: 'Missing orderId' });

    const upsellAmount = OFFER_PRICES[offer] ?? OFFER_PRICES.upsell;
    const offerName = offer === 'downsell' ? 'downsell' : 'upsell';
    const offerLabel = offerName === 'downsell' ? 'Downsell' : 'Upsell';
    const amountCents = Math.round(upsellAmount * 100);

    // Fetch original order from Supabase
    const { data: order, error: fetchError } = await supabase
      .from('orders')
      .select('*')
      .eq('id', orderId)
      .single();

    if (fetchError || !order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    // Só permite oferta adicional em pedidos já pagos (cartão aprovado ou Pix confirmado)
    if (order.status !== 'approved') {
      return res.status(403).json({ error: 'Upsell not allowed for this order' });
    }

    // Não oferece upsell em cima de um pedido que já é um upsell
    if (order.customer_address?.upsell === true) {
      return res.status(403).json({ error: 'Upsell not allowed for this order' });
    }

    const pagarmeHeaders = { ...pagarmeAuthHeader(), 'Content-Type': 'application/json' };

    // ── Pix: gera um novo Pix só do valor da oferta ─────────────────
    if (order.payment_method === 'pix') {
      const orderBody = {
        items: [{ amount: amountCents, description: `${offerLabel} — Kit 2 Luminárias Solar Solare`, quantity: 1, code: 'solare-upsell' }],
        customer: buildPagarmeCustomer({
          name: order.customer_name, email: order.customer_email,
          cpf: order.customer_cpf, phone: order.customer_phone, address: order.customer_address,
        }),
        metadata: { upsell_of: orderId, offer: offerName },
        payments: [{ payment_method: 'pix', pix: { expires_in: 900 } }],
      };

      const pixResponse = await fetch(`${PAGARME_BASE}/orders`, {
        method: 'POST',
        headers: { ...pagarmeHeaders, 'Idempotency-Key': `upsell-pix-${orderId}-${Date.now()}` },
        body: JSON.stringify(orderBody),
      });
      const pixResult = await pixResponse.json();

      if (!pixResponse.ok) {
        console.error('Pagar.me Upsell Pix Error:', pixResult);
        return res.status(400).json({ error: 'Upsell payment failed', details: pixResult });
      }

      const charge = pixResult.charges?.[0];
      const txData = charge?.last_transaction;
      const qrCode = txData?.qr_code ?? null;
      const qrCodeUrl = txData?.qr_code_url ?? null;

      const { error: insertError } = await supabase
        .from('orders')
        .insert(buildUpsellOrder(order, orderId, offerName, upsellAmount, charge?.id || pixResult.id, 'pending', {
          pix_qr_code: qrCode,
          pix_qr_code_base64: qrCodeUrl,
        }));
      if (insertError) console.error('Supabase Error (upsell pix):', insertError);

      return res.status(200).json({
        success: true,
        status: 'pending',
        id: charge?.id || pixResult.id,
        qr_code: qrCode,
        qr_code_url: qrCodeUrl,
      });
    }

    // ── Cartão: cobra o cartão salvo na compra original ─────────────
    if (!order.mp_customer_id || !order.mp_card_id) {
      return res.status(400).json({ error: 'No saved card found for this order' });
    }

    const orderBody = {
      items: [{ amount: amountCents, description: `${offerLabel} — Kit 2 Luminárias Solar Solare`, quantity: 1, code: 'solare-upsell' }],
      customer: { id: order.mp_customer_id },
      metadata: { upsell_of: orderId, offer: offerName },
      payments: [{
        payment_method: 'credit_card',
        credit_card: { installments: 1, statement_descriptor: 'SOLARE', card_id: order.mp_card_id },
      }],
    };

    const chargeResponse = await fetch(`${PAGARME_BASE}/orders`, {
      method: 'POST',
      headers: { ...pagarmeHeaders, 'Idempotency-Key': `upsell-${orderId}-${Date.now()}` },
      body: JSON.stringify(orderBody),
    });
    const chargeResult = await chargeResponse.json();

    if (!chargeResponse.ok) {
      console.error('Pagar.me Upsell Error:', chargeResult);
      return res.status(400).json({ error: 'Upsell payment failed', details: chargeResult });
    }

    const charge = chargeResult.charges?.[0];
    const status = mapChargeStatus(charge?.status);

    if (status === 'rejected') {
      return res.status(400).json({ error: 'Upsell payment failed', details: chargeResult });
    }

    const { data: savedUpsell } = await supabase
      .from('orders')
      .insert(buildUpsellOrder(order, orderId, offerName, upsellAmount, charge?.id || chargeResult.id, status))
      .select()
      .single();

    // Send notification for upsell approval
    if (status === 'approved') {
      await notifyPaymentApproved({
        customerName: order.customer_name,
        customerEmail: order.customer_email,
        customerPhone: order.customer_phone,
        totalPrice: upsellAmount,
        shippingMethod: order.shipping_method,
        orderId: savedUpsell?.id || `PM-${charge?.id}`,
      });
    }

    return res.status(200).json({
      success: true,
      status,
    });

  } catch (err) {
    console.error('Upsell error:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
