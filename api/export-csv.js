import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD || 'solare@2024';

function escCsv(val) {
  if (val === null || val === undefined) return '';
  const str = String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function fmtPrice(val) {
  if (!val) return 'R$ 0,00';
  return 'R$ ' + parseFloat(val).toFixed(2).replace('.', ',');
}

function fmtAddress(addr) {
  if (!addr) return '';
  try {
    const a = typeof addr === 'string' ? JSON.parse(addr) : addr;
    const parts = [];
    if (a.street)       parts.push(a.street + (a.number ? ', ' + a.number : ''));
    if (a.neighborhood) parts.push(a.neighborhood);
    if (a.city)         parts.push(a.city + (a.state ? ' - ' + a.state : ''));
    if (a.cep)          parts.push('CEP: ' + a.cep);
    return parts.join(' | ');
  } catch { return String(addr); }
}

function fmtStatus(s) {
  const map = { approved: 'Pago', pending: 'Pendente', rejected: 'Rejeitado', cancelled: 'Cancelado' };
  return map[s] || s || '';
}

function fmtMethod(m) {
  if (m === 'pix') return 'Pix';
  if (m === 'credit_card') return 'Cartão';
  return m || '';
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).end();

  const { password, from, to, search, status, method } = req.query;

  if (password !== DASHBOARD_PASSWORD) {
    return res.status(401).json({ error: 'Senha incorreta.' });
  }

  const fromTs = from ? `${from}T00:00:00-03:00` : null;
  const toTs   = to   ? `${to}T23:59:59-03:00`   : null;

  try {
    let q = supabase
      .from('orders')
      .select('*')
      .order('created_at', { ascending: false });

    if (fromTs)                       q = q.gte('created_at', fromTs);
    if (toTs)                         q = q.lte('created_at', toTs);
    if (status && status !== 'all')   q = q.eq('status', status);
    if (method && method !== 'all')   q = q.eq('payment_method', method);
    if (search) {
      q = q.or(`customer_name.ilike.%${search}%,customer_email.ilike.%${search}%,customer_phone.ilike.%${search}%`);
    }

    const { data: orders, error } = await q;
    if (error) throw error;

    const headers = [
      'Data/Hora', 'Nome', 'E-mail', 'CPF', 'Telefone',
      'Endereço', 'Qtd', 'Cor da Luz', 'Valor', 'Frete (Método)', 'Frete (Valor)',
      'Pagamento', 'Status', 'ID Mercado Pago', 'Feito', 'Rastreio'
    ];

    const rows = orders.map(o => [
      fmtDate(o.created_at),
      o.customer_name || '',
      o.customer_email || '',
      o.customer_cpf || '',
      o.customer_phone || '',
      fmtAddress(o.customer_address),
      o.product_quantity || '',
      o.product_light_color || '',
      fmtPrice(o.total_price),
      o.shipping_method || '',
      o.shipping_price ? fmtPrice(o.shipping_price) : 'Grátis',
      fmtMethod(o.payment_method),
      fmtStatus(o.status),
      o.mp_payment_id || '',
      o.order_placed ? 'Sim' : 'Não',
      o.tracking_code || '',
    ]);

    // BOM para Excel abrir corretamente em PT-BR
    const bom = '﻿';
    const csv = bom + [headers, ...rows].map(r => r.map(escCsv).join(',')).join('\r\n');

    const filename = `pedidos-solare-${new Date().toISOString().slice(0,10)}.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.status(200).send(csv);

  } catch (err) {
    console.error('Export CSV error:', err);
    return res.status(500).json({ error: 'Erro ao exportar.' });
  }
}
