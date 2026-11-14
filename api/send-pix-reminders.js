/**
 * Lembretes de Pix não pago (inicial / 2h / 4h).
 *
 * Diferente de agendar o envio de antemão (Brevo scheduledAt), este cron
 * confere o status ATUAL do pedido direto na Pagar.me antes de cada envio —
 * então quem já pagou nunca recebe lembrete de "pagamento pendente", mesmo
 * que o cliente tenha fechado a aba antes do webhook confirmar.
 *
 * Deve ser chamado periodicamente (ex: a cada 2-5 minutos) por um cron
 * externo (ex: cron-job.org): GET /api/send-pix-reminders?secret=SEU_SYNC_SECRET
 */

import { createClient } from '@supabase/supabase-js';
import { sendPixReminder, sendPixReminder2h, sendPixReminder4h } from '../lib/send-notification.js';
import { PAGARME_BASE, pagarmeAuthHeader, mapChargeStatus } from '../lib/pagarme.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const SYNC_SECRET = process.env.SYNC_SECRET || 'solare-sync-2024';

const STAGES = [
  { flag: 'reminder4mSent',  minMs: 4 * 60 * 1000,        send: (o) => sendPixReminder({ customerName: o.customer_name, customerEmail: o.customer_email, pixCode: o.pix_qr_code }) },
  { flag: 'reminder2hSent',  minMs: 2 * 60 * 60 * 1000,   send: (o) => sendPixReminder2h({ customerName: o.customer_name, customerEmail: o.customer_email }) },
  { flag: 'reminder4hSent',  minMs: 4 * 60 * 60 * 1000,   send: (o) => sendPixReminder4h({ customerName: o.customer_name, customerEmail: o.customer_email }) },
];

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  if (req.query.secret !== SYNC_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    // Janela ampla (cobre o estágio de 4h + folga) — pedidos mais antigos
    // que isso não recebem mais nenhum lembrete.
    const since = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString();

    const { data: orders, error } = await supabase
      .from('orders')
      .select('*')
      .eq('payment_method', 'pix')
      .neq('status', 'approved')
      .gte('created_at', since);

    if (error) {
      console.error('[PixReminders] Supabase error:', error);
      return res.status(500).json({ error: error.message });
    }

    let sent = 0;
    const results = [];

    for (const order of orders || []) {
      const addr = order.customer_address || {};
      if (addr.upsell === true) continue; // só o Pix da compra principal
      if (!order.customer_email) continue;

      const dueStage = STAGES.find(s => !addr[s.flag] && (Date.now() - new Date(order.created_at).getTime()) >= s.minMs);
      if (!dueStage) continue;

      try {
        // Confere o status real antes de mandar — webhook pode ainda não
        // ter chegado, mas o cliente já pode ter pago.
        const chargeRes = await fetch(`${PAGARME_BASE}/charges/${order.mp_payment_id}`, {
          headers: pagarmeAuthHeader(),
        });
        if (chargeRes.ok) {
          const chargeData = await chargeRes.json();
          const liveStatus = mapChargeStatus(chargeData.status);
          if (liveStatus !== order.status) {
            await supabase.from('orders').update({ status: liveStatus }).eq('id', order.id);
          }
          if (liveStatus === 'approved') {
            results.push({ id: order.id, skipped: 'already_paid' });
            continue;
          }
        }

        await dueStage.send(order);

        await supabase
          .from('orders')
          .update({ customer_address: { ...addr, [dueStage.flag]: true } })
          .eq('id', order.id);

        sent++;
        results.push({ id: order.id, stage: dueStage.flag, sent: true });
      } catch (e) {
        console.error(`[PixReminders] Failed for order ${order.id}:`, e.message);
        results.push({ id: order.id, sent: false, error: e.message });
      }
    }

    return res.status(200).json({ checked: (orders || []).length, sent, results });

  } catch (err) {
    console.error('[PixReminders] Unexpected error:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
}
