import { createClient } from '@supabase/supabase-js';
import { notifyPaymentApproved } from '../lib/send-notification.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const MP_BASE = 'https://api.mercadopago.com';

// Preço decidido no servidor — nunca confiar em valor vindo do cliente
const OFFER_PRICES = { upsell: 49.90, downsell: 39.90 };

function buildPayer(order) {
  return {
    email: order.customer_email,
    first_name: order.customer_name.split(' ')[0],
    last_name: order.customer_name.split(' ').slice(1).join(' '),
    identification: {
      type: 'CPF',
      number: order.customer_cpf?.replace(/\D/g, ''),
    },
  };
}

// Linha extra em "orders" para a venda adicional. O marcador "upsell" em
// customer_address permite que webhook/sincronizações não repitam e-mails
// e WhatsApp de pós-compra do pedido principal.
function buildUpsellOrder(order, orderId, offer, amount, mpResult, extra = {}) {
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
    mp_payment_id: String(mpResult.id),
    status: mpResult.status === 'approved' ? 'approved' : 'pending',
    shipping_method: order.shipping_method,
    shipping_price: 0,
    ...extra,
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const { orderId, offer, cvv } = req.body || {};
    if (!orderId) return res.status(400).json({ error: 'Missing orderId' });

    const upsellAmount = OFFER_PRICES[offer] ?? OFFER_PRICES.upsell;
    const offerName = offer === 'downsell' ? 'downsell' : 'upsell';
    const offerLabel = offerName === 'downsell' ? 'Downsell' : 'Upsell';

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

    const mpAuthHeaders = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.MP_ACCESS_TOKEN}`,
    };

    // ── Pix: gera um novo Pix só do valor da oferta ─────────────────
    if (order.payment_method === 'pix') {
      const paymentData = {
        transaction_amount: upsellAmount,
        description: `${offerLabel} — Kit 2 Luminárias Solar Solare`,
        payment_method_id: 'pix',
        date_of_expiration: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
        payer: buildPayer(order),
        notification_url: `${process.env.SITE_URL}/api/mp-webhook`,
        external_reference: `upsell-${orderId}-${Date.now()}`,
      };

      const pixResponse = await fetch(`${MP_BASE}/v1/payments`, {
        method: 'POST',
        headers: {
          ...mpAuthHeaders,
          'X-Idempotency-Key': `upsell-pix-${orderId}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        },
        body: JSON.stringify(paymentData),
      });
      const pixResult = await pixResponse.json();

      if (!pixResponse.ok) {
        console.error('MP Upsell Pix Error:', pixResult);
        return res.status(400).json({ error: 'Upsell payment failed', details: pixResult });
      }

      const txData = pixResult.point_of_interaction?.transaction_data;
      const qrCode = txData?.qr_code ?? null;
      const qrCodeBase64 = txData?.qr_code_base64 ?? null;

      const { error: insertError } = await supabase
        .from('orders')
        .insert(buildUpsellOrder(order, orderId, offerName, upsellAmount, pixResult, {
          pix_qr_code: qrCode,
          pix_qr_code_base64: qrCodeBase64,
        }));
      if (insertError) console.error('Supabase Error (upsell pix):', insertError);

      return res.status(200).json({
        success: true,
        status: 'pending',
        id: pixResult.id,
        qr_code: qrCode,
        qr_code_base64: qrCodeBase64,
      });
    }

    // ── Cartão: cobra o cartão salvo na compra original ─────────────
    if (!order.mp_customer_id || !order.mp_card_id) {
      return res.status(400).json({ error: 'No saved card found for this order' });
    }

    // O pagamento exige o id da bandeira (visa, master...), não "credit_card"
    const savedCardRes = await fetch(
      `${MP_BASE}/v1/customers/${order.mp_customer_id}/cards/${order.mp_card_id}`,
      { headers: mpAuthHeaders }
    );
    const savedCard = await savedCardRes.json();
    if (!savedCardRes.ok) {
      console.error('MP Upsell saved card error:', savedCard);
      return res.status(400).json({ error: 'Upsell payment failed', details: savedCard });
    }

    // Gera um token novo a partir do cartão salvo — o pagamento exige um
    // "token" (o card_id sozinho não é aceito pelo endpoint de pagamentos).
    // Se o Mercado Pago exigir o CVV, a página pede só esses dígitos e reenvia.
    const tokenBody = { card_id: order.mp_card_id };
    const cvvDigits = String(cvv || '').replace(/\D/g, '');
    if (/^\d{3,4}$/.test(cvvDigits)) tokenBody.security_code = cvvDigits;

    const cardTokenRes = await fetch(`${MP_BASE}/v1/card_tokens`, {
      method: 'POST',
      headers: mpAuthHeaders,
      body: JSON.stringify(tokenBody),
    });
    const cardTokenData = await cardTokenRes.json();
    if (!cardTokenRes.ok) {
      console.error('MP Upsell card_token error:', cardTokenData);
      if (!tokenBody.security_code) {
        return res.status(400).json({ error: 'CVV_REQUIRED', needs_cvv: true });
      }
      return res.status(400).json({ error: 'Upsell payment failed', details: cardTokenData });
    }

    const paymentData = {
      transaction_amount: upsellAmount,
      description: `${offerLabel} — Kit 2 Luminárias Solar Solare`,
      payment_method_id: savedCard.payment_method?.id || order.payment_method,
      installments: 1,
      token: cardTokenData.id,
      payer: buildPayer(order),
      notification_url: `${process.env.SITE_URL}/api/mp-webhook`,
      external_reference: `upsell-${orderId}-${Date.now()}`,
    };

    const mpResponse = await fetch(`${MP_BASE}/v1/payments`, {
      method: 'POST',
      headers: {
        ...mpAuthHeaders,
        'X-Idempotency-Key': `upsell-${orderId}-${Date.now()}`,
      },
      body: JSON.stringify(paymentData),
    });

    const mpResult = await mpResponse.json();

    if (!mpResponse.ok || mpResult.status === 'rejected') {
      console.error('MP Upsell Error:', mpResult);
      return res.status(400).json({ error: 'Upsell payment failed', details: mpResult });
    }

    const { data: savedUpsell } = await supabase
      .from('orders')
      .insert(buildUpsellOrder(order, orderId, offerName, upsellAmount, mpResult))
      .select()
      .single();

    // Send notification for upsell approval
    if (mpResult.status === 'approved') {
      await notifyPaymentApproved({
        customerName: order.customer_name,
        customerEmail: order.customer_email,
        customerPhone: order.customer_phone,
        totalPrice: upsellAmount,
        shippingMethod: order.shipping_method,
        orderId: savedUpsell?.id || `MP-${mpResult.id}`,
      });
    }

    return res.status(200).json({
      success: true,
      status: mpResult.status,
    });

  } catch (err) {
    console.error('Upsell error:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
