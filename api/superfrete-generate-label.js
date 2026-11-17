/**
 * Gera e paga a etiqueta de envio (Jadlog ou Loggi, a mais barata) pra um
 * pedido já aprovado, usando os dados que já estão salvos no pedido — sem
 * precisar preencher nada de novo. Chamado pela aba "Etiquetas" do painel.
 */
import { createClient } from '@supabase/supabase-js';
import { packageForQuantity, quoteCheapest, createCartItem, checkoutOrders } from '../lib/superfrete.js';
import { sendTrackingEmail } from '../lib/send-notification.js';

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
    if (order.tracking_code) return res.status(400).json({ error: 'Este pedido já tem rastreio gerado.' });

    const pkg = packageForQuantity(order.product_quantity);
    if (!pkg) {
      return res.status(400).json({
        error: `Sem medida de caixa cadastrada para ${order.product_quantity} unidades (só 2, 4, 6 ou 8). Gere essa etiqueta manualmente.`,
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
      products: [{ name: 'Luminária Solar Solare', quantity: order.product_quantity, unitary_value: Number(order.total_price) || 0 }],
    });
    console.log(`[SuperFrete] [${order.id}] item no carrinho: ${cartItem.id}, pagando...`);

    const checkoutResult = await checkoutOrders([cartItem.id]);
    console.log(`[SuperFrete] [${order.id}] checkout concluído`);
    const purchased = checkoutResult?.purchase?.orders?.[0];
    if (!purchased?.tracking) {
      return res.status(502).json({ error: 'SuperFrete não retornou o código de rastreio. Confira o saldo da conta.' });
    }

    const trackingCode = purchased.tracking;
    const labelUrl = purchased.print?.url || null;

    await supabase
      .from('orders')
      .update({
        tracking_code: trackingCode,
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

    // Aguarda de verdade — um .catch() sem await corre o risco da Vercel
    // encerrar a função assim que a resposta é enviada, cortando o envio
    // do e-mail no meio (mesmo pedido já pago/gerado na SuperFrete).
    await sendTrackingEmail({
      to: order.customer_email,
      customerName: order.customer_name,
      trackingCode,
      totalPrice: order.total_price,
      quantity: order.product_quantity,
    }).catch(e => console.error('[SuperFrete] sendTrackingEmail failed:', e));

    return res.status(200).json({
      success: true,
      trackingCode,
      labelUrl,
      carrier: quote.company?.name || null,
      price: purchased.price,
    });

  } catch (err) {
    console.error('[SuperFrete] generate-label error:', err);
    return res.status(500).json({ error: err.message || 'Erro ao gerar etiqueta.' });
  }
}
