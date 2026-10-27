import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';
import { notifyPaymentApproved, schedulePostPurchaseEmails } from '../lib/send-notification.js';
import { sendMetaEvent } from '../lib/meta-capi.js';
import { sendWhatsApp } from '../lib/whatsapp.js';
import { isValidOrderTotal } from '../lib/order-pricing.js';
import { PAGARME_BASE, pagarmeAuthHeader, mapChargeStatus, buildPagarmeCustomer } from '../lib/pagarme.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

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
      installments,
      shippingMethod,
      shippingPrice,
      orderBumps,
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
    // (o cliente pode comprar o mesmo kit várias vezes via "Quantos kits?")
    const validTotal = isValidOrderTotal({
      productType:   productType || 'solar',
      quantity:      parsedQty,
      shippingPrice: shippingPrice,
      bumpTotal,
      isPix:         paymentMethodId === 'pix',
      totalPrice:    parsedTotal,
    });
    if (!validTotal) {
      console.warn('[Preço] Pedido recusado por divergência', {
        productType, quantity: parsedQty, shippingPrice, paymentMethodId, orderBumps, enviado: parsedTotal,
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
    const amountCents = Math.round(parsedTotal * 100);

    // ── Montar pedido Pagar.me/Stone ───────────────────────
    const orderBody = {
      items: [{
        amount: amountCents,
        description: `${productName || 'Luminária Solar Solare'} — Kit ${quantity} unidades`,
        quantity: 1,
        code: 'solare-luminaria',
      }],
      customer: buildPagarmeCustomer({
        name: customerName, email: customerEmail, cpf: cpfDigits,
        phone: customerPhone, address: customerAddress,
      }),
      metadata: { internal_order_id: internalOrderId },
    };

    if (isPix) {
      orderBody.payments = [{
        payment_method: 'pix',
        pix: { expires_in: 1800 }, // 30 minutos, igual ao fluxo anterior
      }];
    } else {
      orderBody.payments = [{
        payment_method: 'credit_card',
        credit_card: {
          installments: parseInt(installments) || 1,
          statement_descriptor: 'SOLARE',
          card_token: cardToken,
        },
      }];
    }

    // ── Chamar API Pagar.me ────────────────────────────────
    const pagarmeHeaders = {
      ...pagarmeAuthHeader(),
      'Content-Type': 'application/json',
      'Idempotency-Key': `solare-${internalOrderId}`,
    };
    const pagarmeResponse = await fetch(`${PAGARME_BASE}/orders`, {
      method:  'POST',
      headers: pagarmeHeaders,
      body: JSON.stringify(orderBody),
    });

    const pagarmeResult = await pagarmeResponse.json();

    if (!pagarmeResponse.ok) {
      console.error('[Pagar.me Error]', JSON.stringify(pagarmeResult));
      const rawMsg = pagarmeResult?.message
        || pagarmeResult?.errors?.[Object.keys(pagarmeResult?.errors || {})[0]]?.[0]
        || 'Erro no processamento.';
      return res.status(400).json({ error: String(rawMsg), details: pagarmeResult });
    }

    const charge = pagarmeResult.charges?.[0];
    const paymentStatus = mapChargeStatus(charge?.status);

    // ── Salvar no Supabase ────────────────────────────────
    // Reaproveita as colunas mp_* (antes do Mercado Pago) para os IDs da Pagar.me.
    const orderData = {
      id:                  internalOrderId,
      customer_name:       customerName,
      customer_email:      customerEmail,
      customer_cpf:        customerCpf,
      customer_phone:      customerPhone,
      customer_address:    { ...customerAddress, orderBumps: orderBumps || {}, productType: productType || 'solar' },
      product_quantity:    quantity,
      product_light_color: lightColor,
      total_price:         totalPrice,
      payment_method:      paymentMethodId,
      mp_payment_id:       String(charge?.id || pagarmeResult.id),
      status:              paymentStatus,
      shipping_method:     shippingMethod,
      shipping_price:      shippingPrice,
    };

    let qrCode = null;
    let qrCodeUrl = null;
    if (isPix) {
      const txData = charge?.last_transaction;
      qrCode    = txData?.qr_code     ?? null;
      qrCodeUrl = txData?.qr_code_url ?? null;
      orderData.pix_qr_code = qrCode;
      // Guarda a URL do QR (não é base64) na mesma coluna usada antes pela imagem.
      orderData.pix_qr_code_base64 = qrCodeUrl;
    }

    const { data: order, error: dbError } = await supabase
      .from('orders')
      .insert(orderData)
      .select()
      .single();

    if (dbError) console.error('Supabase Error:', dbError);

    // ── Salvar cartão na Pagar.me (habilita o upsell 1-click) ──
    // Só depois da venda aprovada e com um token separado: nada aqui pode
    // afetar a cobrança principal, então qualquer falha é apenas registrada.
    if (!isPix && paymentStatus === 'approved' && productType === 'solar' && saveCardToken && order?.id) {
      try {
        const customerId = pagarmeResult.customer?.id;
        if (!customerId) throw new Error('Pedido aprovado sem customer_id retornado');

        const cardRes = await fetch(`${PAGARME_BASE}/customers/${customerId}/cards`, {
          method:  'POST',
          headers: { ...pagarmeAuthHeader(), 'Content-Type': 'application/json' },
          body: JSON.stringify({ card_token: saveCardToken }),
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
        eventId: `purchase-${charge?.id || pagarmeResult.id}`,
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
      await sendWhatsApp(customerPhone,
        `Olá ${firstName}, seu pedido foi confirmado e logo sairá para entrega, lembrando que nosso prazo de entrega é de 8 dias`
      ).catch(() => {});

      await notifyPaymentApproved({
        customerName, customerEmail, customerPhone,
        totalPrice, shippingMethod,
        orderId: order?.id || pagarmeResult.id,
      });
      schedulePostPurchaseEmails({
        customerName, customerEmail,
        orderId: order?.id || pagarmeResult.id,
      }).catch(e => console.error('Post-purchase emails failed (non-fatal):', e));
    }

    return res.status(200).json({
      success:         true,
      status:          paymentStatus,
      id:              charge?.id || pagarmeResult.id,
      orderId:         order?.id || null,
      qr_code:         isPix ? qrCode : null,
      qr_code_url:     isPix ? qrCodeUrl : null,
    });

  } catch (err) {
    console.error('Server error:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
