/**
 * Gera e paga a etiqueta de envio (Jadlog ou Loggi, a mais barata) pra um
 * pedido já aprovado, usando os dados que já estão salvos no pedido — sem
 * precisar preencher nada de novo. Chamado pela aba "Etiquetas" do painel.
 */
import { createClient } from '@supabase/supabase-js';
import { packageForQuantity, quoteCheapest, createCartItem, checkoutOrders, getOrderInfo } from '../lib/superfrete.js';
import { sendTrackingEmail } from '../lib/send-notification.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 3 chamadas sequenciais pra SuperFrete (cotação + carrinho + checkout) às
// vezes passam do limite padrão da Vercel antes de responder — o pedido
// chegava a ser pago e gerado do lado da SuperFrete, mas a função era
// encerrada antes de salvar o rastreio e mandar o e-mail pro cliente.
export const config = { maxDuration: 60 };

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD || 'solare@2024';

// Unidades extras do adicional "luminaria" marcado no checkout — não mexe em
// order.product_quantity (que é a base já validada no pagamento), só soma pra
// saber quantas unidades de verdade vão na caixa/etiqueta.
function bumpUnits(order) {
  const bumps = order.customer_address?.orderBumps;
  if (!bumps || !bumps.luminaria) return 0;
  return order.customer_address?.productType === 'led' ? 3 : 4;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { password, orderId } = req.body || {};
  if (password !== DASHBOARD_PASSWORD) return res.status(401).json({ error: 'Senha incorreta.' });
  if (!orderId) return res.status(400).json({ error: 'orderId obrigatório.' });

  try {
    const { data: order, error: fetchErr } = await supabase
      .from('orders')
      .select('*')
      .eq('id', orderId)
      .single();

    if (fetchErr || !order) return res.status(404).json({ error: 'Pedido não encontrado.' });
    if (order.status !== 'approved') return res.status(400).json({ error: 'Só é possível gerar etiqueta para pedidos pagos.' });
    // Confere pelo ID da SuperFrete, não só pelo tracking_code — o rastreio
    // pode demorar a ser atribuído mesmo já com a etiqueta paga/gerada, e
    // gerar de novo nesse meio tempo cobraria em dobro.
    if (order.tracking_code || order.customer_address?.superfreteOrderId) {
      return res.status(400).json({ error: 'Este pedido já tem etiqueta gerada na SuperFrete.' });
    }

    const totalQty = order.product_quantity + bumpUnits(order);
    const pkg = packageForQuantity(totalQty);
    if (!pkg) {
      return res.status(400).json({
        error: `Sem medida de caixa cadastrada para ${totalQty} unidades (só 2, 4, 6 ou 8). Gere essa etiqueta manualmente.`,
      });
    }

    const addr = order.customer_address || {};
    const cep = String(addr.cep || '').replace(/\D/g, '');
    if (cep.length !== 8) return res.status(400).json({ error: 'CEP do cliente inválido ou ausente.' });

    console.log(`[SuperFrete] [${order.id}] cotando frete...`);
    const quote = await quoteCheapest({ toPostalCode: cep, pkg });
    console.log(`[SuperFrete] [${order.id}] cotado: ${quote.company?.name} R$${quote.price}`);

    const phoneDigits = String(order.customer_phone || '').replace(/\D/g, '').slice(-11).padStart(11, '0');
    const to = {
      name: order.customer_name,
      address: addr.street || '',
      number: addr.number || '',
      district: addr.neighborhood || '',
      city: addr.city || '',
      state_abbr: addr.state || '',
      postal_code: cep,
      document: String(order.customer_cpf || '').replace(/\D/g, ''),
      phone: phoneDigits,
      email: order.customer_email,
    };

    const cartItem = await createCartItem({
      to,
      service: quote.id,
      pkg,
      products: [{ name: 'Luminária Solar Solare', quantity: totalQty, unitary_value: Number(order.total_price) || 0 }],
    });
    console.log(`[SuperFrete] [${order.id}] item no carrinho: ${cartItem.id}, pagando...`);

    const checkoutResult = await checkoutOrders([cartItem.id]);
    console.log(`[SuperFrete] [${order.id}] checkout concluído — pedido pago`);
    const purchased = checkoutResult?.purchase?.orders?.[0];
    if (!purchased) {
      return res.status(502).json({ error: 'SuperFrete não confirmou o pagamento da etiqueta. Confira o saldo da conta.' });
    }

    let trackingCode = purchased.tracking || null;
    let labelUrl = purchased.print?.url || null;

    // O rastreio às vezes demora alguns segundos pra ser atribuído mesmo já
    // com o pagamento confirmado — tenta mais algumas vezes antes de seguir
    // sem ele (o webhook completa depois, se ainda assim não vier).
    for (let i = 0; i < 4 && !trackingCode; i++) {
      await sleep(3000);
      try {
        const info = await getOrderInfo(cartItem.id);
        if (info.tracking) trackingCode = info.tracking;
        if (info.print?.url) labelUrl = info.print.url;
      } catch (e) {
        console.error(`[SuperFrete] [${order.id}] retry getOrderInfo falhou:`, e.message);
      }
    }
    console.log(`[SuperFrete] [${order.id}] rastreio ${trackingCode ? 'obtido: ' + trackingCode : 'ainda não disponível — webhook completa depois'}`);

    // Salva AGORA, com ou sem rastreio — o pagamento já foi feito e a
    // etiqueta já existe na SuperFrete, então isso precisa ficar registrado
    // imediatamente pra nunca gerar de novo (evita cobrar duas vezes).
    await supabase
      .from('orders')
      .update({
        tracking_code: trackingCode, // pode ficar null por enquanto
        customer_address: {
          ...addr,
          superfreteOrderId: cartItem.id,
          superfreteCarrier: quote.company?.name || null,
          superfreteStatus: 'released',
          superfreteLabelUrl: labelUrl,
          superfreteShippingPrice: purchased.price,
        },
      })
      .eq('id', order.id);

    if (trackingCode) {
      // Aguarda de verdade — um .catch() sem await corre o risco da Vercel
      // encerrar a função assim que a resposta é enviada, cortando o envio
      // do e-mail no meio.
      await sendTrackingEmail({
        to: order.customer_email,
        customerName: order.customer_name,
        trackingCode,
        totalPrice: order.total_price,
        quantity: totalQty,
      }).catch(e => console.error('[SuperFrete] sendTrackingEmail failed:', e));
    }
    // Sem rastreio ainda: o webhook (api/superfrete-webhook.js) preenche o
    // tracking_code e manda o e-mail assim que a SuperFrete avisar.

    return res.status(200).json({
      success: true,
      trackingCode,
      pendingTracking: !trackingCode,
      labelUrl,
      carrier: quote.company?.name || null,
      price: purchased.price,
    });

  } catch (err) {
    console.error('[SuperFrete] generate-label error:', err);
    return res.status(500).json({ error: err.message || 'Erro ao gerar etiqueta.' });
  }
}
