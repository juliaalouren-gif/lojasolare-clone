import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD || 'solare@2024';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { password, search, from, to, method } = req.query;
  if (password !== DASHBOARD_PASSWORD) return res.status(401).json({ error: 'Senha incorreta.' });

  // Datas com timezone Brasil (UTC-3), mesmo padrão do /api/dashboard-data
  const fromTs = from ? `${from}T00:00:00-03:00` : null;
  const toTs   = to   ? `${to}T23:59:59-03:00`   : null;

  try {
    let q = supabase
      .from('orders')
      .select('id, created_at, customer_name, customer_email, customer_phone, customer_address, product_quantity, total_price, payment_method, tracking_code')
      .eq('status', 'approved')
      .order('created_at', { ascending: false })
      .limit(300);

    if (fromTs)                     q = q.gte('created_at', fromTs);
    if (toTs)                       q = q.lte('created_at', toTs);
    if (method && method !== 'all') q = q.eq('payment_method', method);
    if (search) {
      q = q.or(`customer_name.ilike.%${search}%,customer_email.ilike.%${search}%`);
    }

    const { data: orders, error } = await q;
    if (error) throw error;

    return res.status(200).json({ orders: orders || [] });
  } catch (err) {
    console.error('[SuperFrete] list-labels error:', err);
    return res.status(500).json({ error: 'Erro ao listar pedidos.' });
  }
}
