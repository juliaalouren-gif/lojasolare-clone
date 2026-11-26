/**
 * Lembretes de Pix não pago (inicial / 2h / 4h).
 *
 * Diferente de agendar o envio de antemão (Brevo scheduledAt), este cron
 * confere o status ATUAL do pedido direto no gateway antes de cada envio —
 * então quem já pagou nunca recebe lembrete de "pagamento pendente", mesmo
 * que o cliente tenha fechado a aba antes do webhook confirmar.
 *
 * Disparado pelo Cron nativo da Vercel a cada 5 minutos (ver vercel.json).
 * A Vercel autentica a chamada automaticamente enviando
 * "Authorization: Bearer <CRON_SECRET>" — não precisa de cron externo.
 */

import { createClient } from '@supabase/supabase-js';
import { sendPixReminder, sendPixReminder2h, sendPixReminder4h } from '../lib/send-notification.js';
import { PAGARME_BASE, pagarmeAuthHeader, mapChargeStatus } from '../lib/pagarme.js';
import { MP_BASE, mpAuthHeader, mapPaymentStatus } from '../lib/mercadopago.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const STAGES = [
  { flag: 'reminder4mSent',  minMs: 4 * 60 * 1000,        send: (o) => sendPixReminder({ customerName: o.customer_name, customerEmail: o.customer_email, pixCode: o.pix_qr_code }) },
  { flag: 'reminder2hSent',  minMs: 2 * 60 * 60 * 1000,   send: (o) => sendPixReminder2h({ customerName: o.customer_name, customerEmail: o.customer_email }) },
  { flag: 'reminder4hSent',  minMs: 4 * 60 * 60 * 1000,   send: (o) => sendPixReminder4h({ customerName: o.customer_name, customerEmail: o.customer_email }) },
];

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
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
        // ter chegado, mas o cliente já pode ter pago. Pedidos novos têm
        // payment_id numérico (Mercado Pago); pedidos antigos (Pagar.me/Stone)
        // ainda dentro da janela de 5h no dia da troca caem no fallback.
        const isMp = /^\d+$/.test(String(order.mp_payment_id));
        const chargeRes = isMp
          ? await fetch(`${MP_BASE}/v1/payments/${order.mp_payment_id}`, { headers: mpAuthHeader() })
          : await fetch(`${PAGARME_BASE}/charges/${order.mp_payment_id}`, { headers: pagarmeAuthHeader() });
        if (chargeRes.ok) {
          const chargeData = await chargeRes.json();
          const liveStatus = isMp ? mapPaymentStatus(chargeData.status) : mapChargeStatus(chargeData.status);
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
