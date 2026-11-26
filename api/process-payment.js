import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';
import { notifyPaymentApproved, schedulePostPurchaseEmails, scheduleUpsellOfferEmail } from '../lib/send-notification.js';
import { sendMetaEvent } from '../lib/meta-capi.js';
import { sendWhatsApp } from '../lib/whatsapp.js';
import { isValidOrderTotal } from '../lib/order-pricing.js';
import { MP_BASE, mpAuthHeader, mapPaymentStatus, buildMpPayer, getMpProductInfo, buildMpAdditionalInfo, getClientIp } from '../lib/mercadopago.js';
import { upsertBrevoContact, BREVO_LISTS } from '../lib/brevo.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // TEMP: cronometragem pra diagnosticar delay relatado no Pix — remover
  // depois de confirmado onde está o gargalo.
  const __t0 = Date.now();
  const __lap = (label) => console.log(`[TIMING] ${label}: ${Date.now() - __t0}ms`);

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
      productName,
      productType,
    } = req.body;

    // Server-side bump price map — luminaria price varies by product.
    // "cart2" é a oferta separada do carrinho (cart-drawer.js, +2/R$49,90),
    // independente do order bump "luminaria" do checkout — os dois podem
    // ser somados na mesma compra.
    const luminariaPrice = productType === 'led' ? 59.90 : 29.90;
    const BUMP_PRICES_SERVER = { luminaria: luminariaPrice, cart2: 49.90, envio: 9.90, garantia: 5.90 };
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

    // ── Montar pagamento Mercado Pago ──────────────────────
    // Item, descrição e foto reais do produto comprado (não um texto
    // genérico) + dados completos do comprador (telefone, endereço de
    // entrega, IP) — tudo isso ajuda a análise de risco do Mercado Pago a
    // aprovar a compra com mais confiança.
    const productInfo = getMpProductInfo(productType);
    const paymentBody = {
      transaction_amount: parsedTotal,
      description: `${productName || productInfo.title} — Kit ${quantity} unidades`,
      notification_url: `${process.env.SITE_URL}/api/mp-webhook`,
      external_reference: internalOrderId,
      statement_descriptor: 'SOLARE',
      additional_info: {
        items: [{
          id: productInfo.id,
          title: `${productName || productInfo.title} — Kit ${parsedQty} unidades`,
          description: productInfo.description,
          category_id: 'home',
          picture_url: `${process.env.SITE_URL}/${productInfo.picture}`,
          quantity: 1,
          unit_price: parsedTotal,
        }],
        ...buildMpAdditionalInfo({
          firstName, lastName,
          phone: customerPhone,
          address: customerAddress,
          ipAddress: getClientIp(req),
        }),
      },
      payer: buildMpPayer({
        email: customerEmail, cpf: cpfDigits,
        firstName, lastName, address: customerAddress,
      }),
    };

    if (isPix) {
      paymentBody.payment_method_id = 'pix';
      paymentBody.date_of_expiration = new Date(Date.now() + 30 * 60 * 1000).toISOString(); // 30 minutos, igual ao fluxo anterior
    } else {
      paymentBody.token             = cardToken;
      paymentBody.payment_method_id = cardPaymentMethodId || 'visa';
      paymentBody.installments      = parseInt(installments) || 1;
      paymentBody.capture           = true;
    }

    // ── Chamar API Mercado Pago ────────────────────────────
    const mpHeaders = {
      ...mpAuthHeader(),
      'Content-Type': 'application/json',
      'X-Idempotency-Key': `solare-${internalOrderId}`,
    };
    __lap('antes do fetch Mercado Pago');
    const mpResponse = await fetch(`${MP_BASE}/v1/payments`, {
      method:  'POST',
      headers: mpHeaders,
      body: JSON.stringify(paymentBody),
    });
    __lap('depois do fetch Mercado Pago (response recebida)');

    const mpResult = await mpResponse.json();
    __lap('depois do .json() do Mercado Pago');

    if (!mpResponse.ok) {
      console.error('[Mercado Pago Error]', JSON.stringify(mpResult));
      const rawMsg = mpResult?.message || mpResult?.cause?.[0]?.description || 'Erro no processamento.';
      return res.status(400).json({ error: String(rawMsg).replace(/null$/i, '').trim(), details: mpResult });
    }

    const paymentStatus = mapPaymentStatus(mpResult.status);

    // Mesmo com HTTP 200, a cobrança em si pode ter sido recusada (cartão
    // negado, chave Pix ausente/errada na conta, etc.). O motivo técnico
    // sempre vai pro log do servidor; pro cliente só expomos o motivo cru em
    // cartão (ele já espera ver "cartão recusado" e pode tentar outro) — no
    // Pix, que o cliente não controla, mostramos uma mensagem genérica.
    let rejectionReason = null;
    if (paymentStatus === 'rejected') {
      const technicalReason = mpResult.status_detail || 'Pagamento recusado.';
      console.warn('[Mercado Pago] Cobrança recusada', { paymentId: mpResult.id, status: mpResult.status, technicalReason });
      rejectionReason = isPix
        ? 'Não foi possível gerar o Pix no momento. Tente novamente em instantes ou use o cartão.'
        : technicalReason;
    }

    // ── Salvar no Supabase ────────────────────────────────
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
      mp_payment_id:       String(mpResult.id),
      status:              paymentStatus,
      shipping_method:     shippingMethod,
      shipping_price:      shippingPrice,
    };

    let qrCode = null;
    let qrCodeBase64 = null;
    if (isPix) {
      const txData = mpResult.point_of_interaction?.transaction_data;
      qrCode       = txData?.qr_code        ?? null;
      qrCodeBase64 = txData?.qr_code_base64 ?? null;
      orderData.pix_qr_code = qrCode;
      orderData.pix_qr_code_base64 = qrCodeBase64;
    }

    const { data: order, error: dbError } = await supabase
      .from('orders')
      .insert(orderData)
      .select()
      .single();
    __lap('depois do insert no Supabase');

    if (dbError) console.error('Supabase Error:', dbError);

    // Lembretes de Pix não pago agora são tratados pelo cron
    // api/send-pix-reminders.js, que confere o status direto no Mercado Pago
    // antes de enviar — evita mandar lembrete pra quem já pagou.

    // ── Salvar cartão no Mercado Pago (habilita o upsell 1-click) ──
    // Só depois da venda aprovada e com um token separado: nada aqui pode
    // afetar a cobrança principal, então qualquer falha é apenas registrada.
    if (!isPix && paymentStatus === 'approved' && productType === 'solar' && saveCardToken && order?.id) {
      try {
        const normalizedEmail = customerEmail.trim().toLowerCase();
        const searchRes = await fetch(`${MP_BASE}/v1/customers/search?email=${encodeURIComponent(normalizedEmail)}`, {
          headers: mpAuthHeader(),
        });
        const searchData = await searchRes.json();
        let customerId = searchData?.results?.[0]?.id;

        if (!customerId) {
          const createCustomerRes = await fetch(`${MP_BASE}/v1/customers`, {
            method:  'POST',
            headers: { ...mpAuthHeader(), 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: normalizedEmail, first_name: firstName, last_name: lastName }),
          });
          const createCustomerData = await createCustomerRes.json();
          if (!createCustomerRes.ok) throw new Error(createCustomerData?.message || 'Falha ao criar customer');
          customerId = createCustomerData.id;
        }

        const cardRes = await fetch(`${MP_BASE}/v1/customers/${customerId}/cards`, {
          method:  'POST',
          headers: { ...mpAuthHeader(), 'Content-Type': 'application/json' },
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

    // ── Brevo: sincroniza contato pra automação de e-mail marketing ──
    const brevoAttrs = {
      VALOR_PEDIDO: parsedTotal,
      QUANTIDADE: parsedQty,
      PRODUTO: productName || 'Luminária Solar Solare',
      STATUS_PEDIDO: paymentStatus,
      METODO_PAGAMENTO: isPix ? 'Pix' : 'Cartão',
    };
    const brevoListId = paymentStatus === 'approved'
      ? BREVO_LISTS.CLIENTES_APROVADOS
      : (isPix ? BREVO_LISTS.PIX_PENDENTE : null); // cartão recusado: só atualiza dados, sem entrar em lista
    // Não bloqueia a resposta do pagamento — o pedido já foi criado no
    // Mercado Pago e salvo no Supabase antes daqui, isso é só CRM de e-mail
    // marketing rodando em paralelo (sincroniza de novo, com status
    // "approved", quando o pagamento confirma — ver mp-webhook.js).
    upsertBrevoContact({
      email: customerEmail,
      name: customerName,
      phone: customerPhone,
      attributes: brevoAttrs,
      listIds: brevoListId ? [brevoListId] : [],
    }).catch(e => console.error('[Brevo] process-payment sync failed:', e));

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
        orderId: order?.id || mpResult.id,
      });
      schedulePostPurchaseEmails({
        customerName, customerEmail,
        orderId: order?.id || mpResult.id,
      }).catch(e => console.error('Post-purchase emails failed (non-fatal):', e));

      // Upsell é exclusivo do produto da home (Luminária Solar) — mesma regra do redirect em tempo real
      if ((productType || 'solar') === 'solar' && order?.id) {
        await scheduleUpsellOfferEmail({
          customerName,
          customerEmail,
          offerUrl: `${process.env.SITE_URL}/upsell-v2.html?orderId=${order.id}`,
          delayMs: 30 * 1000,
        }).catch(e => console.error('[Email] scheduleUpsellOfferEmail failed:', e));
      }
    }

    __lap('TOTAL antes de responder');
    return res.status(200).json({
      success:         true,
      status:          paymentStatus,
      error:           rejectionReason,
      id:              mpResult.id,
      orderId:         order?.id || null,
      qr_code:         isPix ? qrCode : null,
      qr_code_base64:  isPix ? qrCodeBase64 : null,
    });

  } catch (err) {
    console.error('Server error:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
