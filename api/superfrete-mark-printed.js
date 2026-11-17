/**
 * Marca uma etiqueta já gerada como impressa/embalada — tira ela da fila
 * de impressão da aba Etiquetas.
 */
import { createClient } from '@supabase/supabase-js';

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
      .select('customer_address, tracking_code')
      .eq('id', orderId)
      .single();

    if (fetchErr || !order) return res.status(404).json({ error: 'Pedido não encontrado.' });
    if (!order.tracking_code) return res.status(400).json({ error: 'Este pedido ainda não tem etiqueta gerada.' });

    const { error: updateErr } = await supabase
      .from('orders')
      .update({ customer_address: { ...(order.customer_address || {}), superfreteLabelPrinted: true } })
      .eq('id', orderId);

    if (updateErr) throw updateErr;

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('[SuperFrete] mark-printed error:', err);
    return res.status(500).json({ error: 'Erro ao marcar etiqueta como impressa.' });
  }
}
