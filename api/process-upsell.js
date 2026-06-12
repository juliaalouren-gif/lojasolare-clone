import { createClient } from '@supabase/supabase-js';
import { notifyPaymentApproved } from '../lib/send-notification.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const { orderId } = req.body;
    if (!orderId) return res.status(400).json({ error: 'Missing orderId' });

    // Fetch original order from Supabase
    const { data: order, error: fetchError } = await supabase
      .from('orders')
      .select('*')
      .eq('id', orderId)
      .single();

    if (fetchError || !order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    // Só permite upsell em pedidos aprovados via cartão
    if (order.status !== 'approved' || order.payment_method === 'pix') {
      return res.status(403).json({ error: 'Upsell not allowed for this order' });
    }

    if (!order.mp_customer_id || !order.mp_card_id) {
      return res.status(400).json({ error: 'No saved card found for this order' });
    }

    // Charge the saved card for the upsell (no token needed — uses saved customer card)
    const upsellAmount = 49.90;
    const paymentData = {
      transaction_amount: upsellAmount,
      description: 'Upsell — Kit 2 Luminárias Solar Solare',
      payment_method_id: order.payment_method,
      installments: 1,
      payer: {
        email: order.customer_email,
        first_name: order.customer_name.split(' ')[0],
        last_name: order.customer_name.split(' ').slice(1).join(' '),
        identification: {
          type: 'CPF',
          number: order.customer_cpf?.replace(/\D/g, ''),
        },
      },
      customer_id: order.mp_customer_id,
      card_id: order.mp_card_id,
      notification_url: `${process.env.SITE_URL}/api/mp-webhook`,
      external_reference: `upsell-${orderId}-${Date.now()}`,
    };

    const mpResponse = await fetch('https://api.mercadopago.com/v1/payments', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.MP_ACCESS_TOKEN}`,
        'X-Idempotency-Key': `upsell-${orderId}-${Date.now()}`,
      },
      body: JSON.stringify(paymentData),
    });

    const mpResult = await mpResponse.json();

    if (!mpResponse.ok || mpResult.status === 'rejected') {
      console.error('MP Upsell Error:', mpResult);
      return res.status(400).json({ error: 'Upsell payment failed', details: mpResult });
    }

    // Save upsell order to Supabase
    const upsellOrder = {
      customer_name: order.customer_name,
      customer_email: order.customer_email,
      customer_cpf: order.customer_cpf,
      customer_phone: order.customer_phone,
      customer_address: order.customer_address,
      product_quantity: 2,
      product_light_color: order.product_light_color,
      total_price: upsellAmount,
      payment_method: order.payment_method,
      mp_payment_id: String(mpResult.id),
      status: mpResult.status === 'approved' ? 'approved' : 'pending',
      shipping_method: order.shipping_method,
      shipping_price: 0,
    };

    const { data: savedUpsell } = await supabase
      .from('orders')
      .insert(upsellOrder)
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
