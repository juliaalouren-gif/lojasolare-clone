import { createClient } from '@supabase/supabase-js';
import { sendTrackingEmail } from '../lib/send-notification.js';

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

  const { action, orderId, password, trackingCode } = req.body || {};

  if (password !== DASHBOARD_PASSWORD) {
    return res.status(401).json({ error: 'Senha incorreta.' });
  }

  if (!orderId) return res.status(400).json({ error: 'orderId obrigatório.' });

  // ── Marcar pedido como feito ──────────────────────────────────
  if (action === 'place') {
    const { error } = await supabase
      .from('orders')
      .update({ order_placed: true })
      .eq('id', orderId);

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true });
  }

  // ── Enviar código de rastreio ─────────────────────────────────
  if (action === 'tracking') {
    if (!trackingCode || !trackingCode.trim()) {
      return res.status(400).json({ error: 'Código de rastreio obrigatório.' });
    }

    const { data: order, error: fetchErr } = await supabase
      .from('orders')
      .select('customer_name, customer_email, total_price, product_quantity')
      .eq('id', orderId)
      .single();

    if (fetchErr || !order) return res.status(404).json({ error: 'Pedido não encontrado.' });
    if (!order.customer_email) return res.status(400).json({ error: 'Pedido sem email cadastrado.' });

    const { error: updateErr } = await supabase
      .from('orders')
      .update({ tracking_code: trackingCode.trim() })
      .eq('id', orderId);

    if (updateErr) return res.status(500).json({ error: updateErr.message });

    await sendTrackingEmail({
      to: order.customer_email,
      customerName: order.customer_name,
      trackingCode: trackingCode.trim(),
      totalPrice: order.total_price,
      quantity: order.product_quantity,
    });

    return res.status(200).json({ ok: true });
  }

  return res.status(400).json({ error: 'Ação inválida.' });
}
