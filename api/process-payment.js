import { createClient } from '@supabase/supabase-js';
import { notifyPaymentApproved, schedulePixReminder, schedulePixReminder2h, schedulePixReminder4h, schedulePostPurchaseEmails } from './send-notification.js';
import { sendMetaEvent } from './meta-capi.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
const MP_BASE = 'https://api.mercadopago.com';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      customerName,
      customerEmail,
      customerCpf,
      customerPhone,
      customerAddress,
      quantity,
      lightColor,
      totalPrice,
      paymentMethodId,
      cardToken,
      cardPaymentMethodId,
      installments,
      shippingMethod,
      shippingPrice,
    } = req.body;

    // ── Validação ──────────────────────────────────────────
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const cpfDigits  = String(customerCpf || '').replace(/\D/g, '');
    const parsedTotal = Math.round(parseFloat(totalPrice) * 100) / 100;
    const parsedQty   = parseInt(quantity);

    if (!customerName || String(customerName).trim().split(/\s+/).length < 2)
      return res.status(400).json({ error: 'Nome completo obrigatório.' });
    if (!emailRegex.test(String(customerEmail || '')))
      return res.status(400).json({ error: 'E-mail inválido.' });
    if (cpfDigits.length !== 11)
      return res.status(400).json({ error: 'CPF inválido.' });
    if (isNaN(parsedTotal) || parsedTotal <= 0 || parsedTotal > 50000)
      return res.status(400).json({ error: 'Valor inválido.' });
    if (isNaN(parsedQty) || parsedQty < 1 || parsedQty > 100)
      return res.status(400).json({ error: 'Quantidade inválida.' });
    // Valor mínimo = Kit 1 (78,90) com desconto Pix de 5% = 74,95
    const PRECO_MINIMO = 74.95;
    if (parsedTotal < PRECO_MINIMO)
      return res.status(400).json({ error: 'Valor do pedido inválido. Atualize a página e tente novamente.' });
    if (!customerAddress?.cep || String(customerAddress.cep).replace(/\D/g, '').length !== 8)
      return res.status(400).json({ error: 'CEP inválido.' });
    if (!['pix', 'credit_card'].includes(String(paymentMethodId)))
      return res.status(400).json({ error: 'Método de pagamento inválido.' });

    const isPix = paymentMethodId === 'pix';
    const nameParts = customerName.trim().split(/\s+/);
    const firstName  = nameParts[0];
    const lastName   = nameParts.slice(1).join(' ') || firstName;

    // ── Montar pagamento Mercado Pago ──────────────────────
    const paymentBody = {
      transaction_amount: parsedTotal,
      description: `Luminária Solar Solare — Kit ${quantity} unidades`,
      payer: {
        email:      customerEmail.trim().toLowerCase(),
        first_name: firstName,
        last_name:  lastName,
        identification: {
          type:   'CPF',
          number: cpfDigits,
        },
      },
    };

    if (isPix) {
      paymentBody.payment_method_id = 'pix';
      paymentBody.date_of_expiration = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    } else {
      paymentBody.token              = cardToken;
      paymentBody.payment_method_id  = cardPaymentMethodId || 'visa';
      paymentBody.installments       = parseInt(installments) || 1;
      paymentBody.capture            = true;
    }

    // ── Chamar API Mercado Pago ────────────────────────────
    const mpResponse = await fetch(`${MP_BASE}/v1/payments`, {
      method:  'POST',
      headers: {
        'Authorization':    `Bearer ${MP_ACCESS_TOKEN}`,
        'Content-Type':     'application/json',
        'X-Idempotency-Key': `solare-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      },
      body: JSON.stringify(paymentBody),
    });

    const mpResult = await mpResponse.json();

    if (!mpResponse.ok) {
      console.error('[MP Error]', JSON.stringify(mpResult));
      const rawMsg = mpResult?.message || mpResult?.cause?.[0]?.description || 'Erro no processamento.';
      const errMsg = String(rawMsg).replace(/null$/i, '').trim();
      return res.status(400).json({ error: errMsg, details: mpResult });
    }

    // ── Determinar status ──────────────────────────────────
    const statusMap = {
      approved:   'approved',
      rejected:   'rejected',
      pending:    'pending',
      in_process: 'pending',
      cancelled:  'cancelled',
    };
    const paymentStatus = statusMap[mpResult.status] || 'pending';

    // ── Salvar no Supabase ────────────────────────────────
    const orderData = {
      customer_name:       customerName,
      customer_email:      customerEmail,
      customer_cpf:        customerCpf,
      customer_phone:      customerPhone,
      customer_address:    customerAddress,
      product_quantity:    quantity,
      product_light_color: lightColor,
      total_price:         totalPrice,
      payment_method:      paymentMethodId,
      mp_payment_id:       String(mpResult.id),
      status:              paymentStatus,
      shipping_method:     shippingMethod,
      shipping_price:      shippingPrice,
    };

    if (isPix) {
      const txData = mpResult.point_of_interaction?.transaction_data;
      orderData.pix_qr_code        = txData?.qr_code        ?? null;
      orderData.pix_qr_code_base64 = txData?.qr_code_base64 ?? null;
    }

    const { data: order, error: dbError } = await supabase
      .from('orders')
      .insert(orderData)
      .select()
      .single();

    if (dbError) console.error('Supabase Error:', dbError);

    // ── Reminders Pix (canceláveis se a pessoa pagar) ────
    let pixReminderId = null;
    let pixReminder2hId = null;
    let pixReminder4hId = null;
    if (isPix) {
      const pixCode = mpResult.point_of_interaction?.transaction_data?.qr_code;
      [pixReminderId, pixReminder2hId, pixReminder4hId] = await Promise.all([
        pixCode ? schedulePixReminder({ customerName, customerEmail, pixCode }).catch(() => null) : null,
        schedulePixReminder2h({ customerName, customerEmail }).catch(() => null),
        schedulePixReminder4h({ customerName, customerEmail }).catch(() => null),
      ]);
    }

    // ── Meta CAPI: Pix → dispara na geração; Cartão → dispara na aprovação ──
    if (isPix || paymentStatus === 'approved') {
      sendMetaEvent({
        eventName:      'Purchase',
        eventSourceUrl: `${process.env.SITE_URL}/obrigado.html`,
        userData: {
          email:     customerEmail,
          phone:     customerPhone,
          firstName, lastName,
          cpf:   customerCpf,
          city:  customerAddress?.city,
          state: customerAddress?.state,
          zip:   customerAddress?.cep,
        },
        customData: {
          value:        parsedTotal,
          currency:     'BRL',
          content_ids:  ['solare-luminaria'],
          content_type: 'product',
          num_items:    quantity,
        },
        eventId: `purchase-${mpResult.id}`,
      }).catch(e => console.error('Meta CAPI failed (non-fatal):', e));
    }

    // ── Emails pós-compra: apenas cartão aprovado
    // Pix: email de confirmação e emails pós-compra são enviados em check-payment-status
    // quando o pagamento for de fato detectado como aprovado
    if (!isPix && paymentStatus === 'approved') {
      await notifyPaymentApproved({
        customerName, customerEmail, customerPhone,
        totalPrice, shippingMethod,
        orderId: order?.id || mpResult.id,
      });
      schedulePostPurchaseEmails({
        customerName, customerEmail,
        orderId: order?.id || mpResult.id,
      }).catch(e => console.error('Post-purchase emails failed (non-fatal):', e));
    }

    return res.status(200).json({
      success:         true,
      status:          paymentStatus,
      id:              mpResult.id,
      orderId:         order?.id || null,
      qr_code:         isPix ? (mpResult.point_of_interaction?.transaction_data?.qr_code        ?? null) : null,
      qr_code_base64:  isPix ? (mpResult.point_of_interaction?.transaction_data?.qr_code_base64 ?? null) : null,
      pix_reminder_id:    pixReminderId    || null,
      pix_reminder_2h_id: pixReminder2hId  || null,
      pix_reminder_4h_id: pixReminder4hId  || null,
    });

  } catch (err) {
    console.error('Server error:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
