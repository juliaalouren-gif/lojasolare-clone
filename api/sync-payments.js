import { createClient } from '@supabase/supabase-js';
import { notifyPaymentApproved, schedulePostPurchaseEmails } from '../lib/send-notification.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD || 'solare@2024';

const MP_STATUS_MAP = {
  approved:   'approved',
  rejected:   'rejected',
  cancelled:  'cancelled',
  refunded:   'cancelled',
  in_process: 'pending',
  pending:    'pending',
};

const PB_STATUS_MAP = {
  PAID:        'approved',
  DECLINED:    'rejected',
  CANCELED:    'cancelled',
  IN_ANALYSIS: 'pending',
  WAITING:     'pending',
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const { password } = req.body || {};
  if (password !== DASHBOARD_PASSWORD) return res.status(401).json({ error: 'Senha incorreta.' });

  try {
    // Busca todos os pedidos pendentes com payment ID
    const { data: pending, error } = await supabase
      .from('orders')
      .select('id, mp_payment_id, payment_method, status')
      .eq('status', 'pending')
      .not('mp_payment_id', 'is', null);

    if (error) throw error;
    if (!pending.length) return res.status(200).json({ updated: 0, results: [] });

    const results = [];

    for (const order of pending) {
      const pid = order.mp_payment_id;
      let newStatus = null;

      try {
        // PagBank orders/charges
        if (pid?.startsWith('ORDE_') || pid?.startsWith('CHAR_')) {
          const endpoint = pid.startsWith('ORDE_')
            ? `https://api.pagseguro.com/orders/${pid}`
            : `https://api.pagseguro.com/charges/${pid}`;
          const r = await fetch(endpoint, {
            headers: { 'Authorization': `Bearer ${process.env.PAGBANK_TOKEN}`, 'Accept': 'application/json' },
          });
          if (r.ok) {
            const d = await r.json();
            const pbStatus = d.charges?.[0]?.status || d.qr_codes?.[0]?.status || d.status;
            newStatus = PB_STATUS_MAP[pbStatus] || null;
          }
        } else {
          // Mercado Pago (payment IDs numéricos)
          const r = await fetch(`https://api.mercadopago.com/v1/payments/${pid}`, {
            headers: { 'Authorization': `Bearer ${process.env.MP_ACCESS_TOKEN}` },
          });
          if (r.ok) {
            const d = await r.json();
            newStatus = MP_STATUS_MAP[d.status] || null;
          }
        }

        if (newStatus && newStatus !== 'pending') {
          // Busca dados completos do pedido para enviar email
          const { data: fullOrder } = await supabase
            .from('orders')
            .select('*')
            .eq('id', order.id)
            .single();

          const { error: upErr } = await supabase
            .from('orders')
            .update({ status: newStatus })
            .eq('id', order.id);

          // Envia email de confirmação para pedidos aprovados
          if (newStatus === 'approved' && fullOrder) {
            notifyPaymentApproved({
              customerName:   fullOrder.customer_name,
              customerEmail:  fullOrder.customer_email,
              customerPhone:  fullOrder.customer_phone,
              totalPrice:     fullOrder.total_price,
              shippingMethod: fullOrder.shipping_method,
              orderId:        fullOrder.id,
            }).catch(e => console.error('[Sync] Email confirmação falhou:', e));

            schedulePostPurchaseEmails({
              customerName:  fullOrder.customer_name,
              customerEmail: fullOrder.customer_email,
              orderId:       fullOrder.id,
            }).catch(e => console.error('[Sync] Emails pós-compra falharam:', e));
          }

          results.push({ id: order.id, mp_payment_id: pid, old: 'pending', new: newStatus, error: upErr?.message || null });
        } else {
          results.push({ id: order.id, mp_payment_id: pid, old: 'pending', new: newStatus || 'pending', changed: false });
        }
      } catch (e) {
        results.push({ id: order.id, mp_payment_id: pid, error: e.message });
      }
    }

    const updated = results.filter(r => r.new && r.new !== 'pending' && !r.error).length;
    return res.status(200).json({ updated, total: pending.length, results });

  } catch (err) {
    console.error('Sync error:', err);
    return res.status(500).json({ error: 'Erro interno.' });
  }
}
