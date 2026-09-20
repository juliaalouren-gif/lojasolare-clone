import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';
import { notifyPaymentApproved, schedulePostPurchaseEmails } from '../lib/send-notification.js';
import { sendMetaEvent } from '../lib/meta-capi.js';
import { sendWhatsApp } from '../lib/whatsapp.js';
import { expectedOrderTotal } from '../lib/order-pricing.js';

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
      saveCardToken,
      cardPaymentMethodId,
      installments,
      shippingMethod,
      shippingPrice,
      orderBumps,
      deviceId,
      productName,
      productType,
    } = req.body;

    // Server-side bump price map — luminaria price varies by product
    const luminariaPrice = productType === 'led' ? 59.90 : 49.90;
    const BUMP_PRICES_SERVER = { luminaria: luminariaPrice, envio: 9.90, garantia: 5.90 };
    const serverBumpTotal = (bumps) => {
      if (!bumps || typeof bumps !== 'object') return 0;
      return Object.entries(BUMP_PRICES_SERVER)
        .filter(([k]) => bumps[k] === true)
        .reduce((sum, [, v]) => sum + v, 0);
    };
    const bumpTotal = serverBumpTotal(orderBumps);

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
    // O valor vem do navegador, então é conferido contra a tabela de preços do servidor
    const expectedTotal = expectedOrderTotal({
      productType:   productType || 'solar',
      quantity:      parsedQty,
      shippingPrice: shippingPrice,
      bumpTotal,
      isPix:         paymentMethodId === 'pix',
    });
    if (expectedTotal === null || Math.abs(parsedTotal - expectedTotal) > 0.01) {
      console.warn('[Preço] Pedido recusado por divergência', {
        productType, quantity: parsedQty, shippingPrice, paymentMethodId, orderBumps, enviado: parsedTotal, esperado: expectedTotal,
      });
      return res.status(400).json({ error: 'Valor do pedido inválido. Atualize a página e tente novamente.' });
    }
    if (!customerAddress?.cep || String(customerAddress.cep).replace(/\D/g, '').length !== 8)
      return res.status(400).json({ error: 'CEP inválido.' });
    if (!['pix', 'credit_card'].includes(String(paymentMethodId)))
      return res.status(400).json({ error: 'Método de pagamento inválido.' });

    const isPix = paymentMethodId === 'pix';
    const nameParts = customerName.trim().split(/\s+/);
    const firstName  = nameParts[0];
    const lastName   = nameParts.slice(1).join(' ') || firstName;
    const internalOrderId = randomUUID();

    // ── Montar pagamento Mercado Pago ──────────────────────
    const paymentBody = {
      transaction_amount: parsedTotal,
      description: `${productName || 'Luminária Solar Solare'} — Kit ${quantity} unidades`,
      notification_url: `${process.env.SITE_URL}/api/mp-webhook`,
      external_reference: internalOrderId,
      statement_descriptor: 'Solare Luminarias',
      additional_info: {
        items: [{
          id: 'solare-luminaria',
          title: `Luminária Solar LED Solare — Kit ${parsedQty} unidades`,
          description: 'Luminária solar LED recarregável, resistente à água, sem fio. Acende automaticamente à noite.',
          category_id: 'home',
          quantity: 1,
          unit_price: parsedTotal,
        }],
        payer: {
          first_name: firstName,
          last_name:  lastName,
          address: {
            zip_code:      String(customerAddress?.cep || '').replace(/\D/g, ''),
            street_name:   customerAddress?.street || customerAddress?.logradouro || '',
            street_number: String(customerAddress?.number || customerAddress?.numero || ''),
          },
        },
        shipments: {
          receiver_address: {
            zip_code:    String(customerAddress?.cep || '').replace(/\D/g, ''),
            state_name:  customerAddress?.state || '',
            city_name:   customerAddress?.city  || '',
            street_name: customerAddress?.street || customerAddress?.logradouro || '',
            street_number: String(customerAddress?.number || customerAddress?.numero || ''),
          },
        },
      },
      payer: {
        email:      customerEmail.trim().toLowerCase(),
        first_name: firstName,
        last_name:  lastName,
        identification: {
          type:   'CPF',
          number: cpfDigits,
        },
        address: {
          zip_code:      String(customerAddress?.cep || '').replace(/\D/g, ''),
          street_name:   customerAddress?.street || customerAddress?.logradouro || '',
          street_number: String(customerAddress?.number || customerAddress?.numero || ''),
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
    const mpHeaders = {
      'Authorization':    `Bearer ${MP_ACCESS_TOKEN}`,
      'Content-Type':     'application/json',
      'X-Idempotency-Key': `solare-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    };
    if (deviceId && typeof deviceId === 'string' && deviceId.length > 0) {
      mpHeaders['X-Meli-Session-Id'] = deviceId;
    }
    const mpResponse = await fetch(`${MP_BASE}/v1/payments`, {
      method:  'POST',
      headers: mpHeaders,
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
      id:                  internalOrderId,
      customer_name:       customerName,
      customer_email:      customerEmail,
      customer_cpf:        customerCpf,
      customer_phone:      customerPhone,
      customer_address:    { ...customerAddress, orderBumps: orderBumps || {} },
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

    // ── Salvar cartão no Mercado Pago (habilita o upsell 1-click) ──
    // Só depois da venda aprovada e com um token separado: nada aqui pode
    // afetar a cobrança principal, então qualquer falha é apenas registrada.
    if (!isPix && paymentStatus === 'approved' && productType === 'solar' && saveCardToken && order?.id) {
      try {
        const mpAuthHeaders = {
          'Authorization': `Bearer ${MP_ACCESS_TOKEN}`,
          'Content-Type':  'application/json',
        };
        const normalizedEmail = customerEmail.trim().toLowerCase();

        const searchRes = await fetch(`${MP_BASE}/v1/customers/search?email=${encodeURIComponent(normalizedEmail)}`, {
          headers: mpAuthHeaders,
        });
        const searchData = await searchRes.json();
        let customerId = searchData?.results?.[0]?.id;

        if (!customerId) {
          const createCustomerRes = await fetch(`${MP_BASE}/v1/customers`, {
            method:  'POST',
            headers: mpAuthHeaders,
            body: JSON.stringify({ email: normalizedEmail, first_name: firstName, last_name: lastName }),
          });
          const createCustomerData = await createCustomerRes.json();
          if (!createCustomerRes.ok) throw new Error(createCustomerData?.message || 'Falha ao criar customer');
          customerId = createCustomerData.id;
        }

        const cardRes = await fetch(`${MP_BASE}/v1/customers/${customerId}/cards`, {
          method:  'POST',
          headers: mpAuthHeaders,
          body: JSON.stringify({ token: saveCardToken }),
        });
        const cardData = await cardRes.json();
        if (!cardRes.ok) throw new Error(cardData?.message || 'Falha ao salvar cartão');

        await supabase
          .from('orders')
          .update({ mp_customer_id: customerId, mp_card_id: cardData.id })
          .eq('id', order.id);
      } catch (saveCardErr) {
        console.error('Salvar cartão para upsell falhou (não fatal):', saveCardErr);
      }
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

    // Mark lead converted immediately on card approval so abandonment cron never fires
    if (!isPix && paymentStatus === 'approved' && customerPhone) {
      supabase.from('leads')
        .update({ converted: true })
        .eq('phone', String(customerPhone).replace(/\D/g, ''));
    }

    // ── Emails pós-compra: apenas cartão aprovado
    if (!isPix && paymentStatus === 'approved') {
      const firstName = nameParts[0];
      await sendWhatsApp(customerPhone,
        `Olá ${firstName}, seu pedido foi confirmado e logo sairá para entrega, lembrando que nosso prazo de entrega é de 8 dias`
      ).catch(() => {});

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
    });

  } catch (err) {
    console.error('Server error:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
