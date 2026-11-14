/**
 * Envia o e-mail de "Pedido em processamento" ~24h após a aprovação do
 * pagamento. Diferente dos lembretes de Pix (que são pré-agendados e
 * disparados sem verificação), este e-mail CONFERE o status atual do
 * pedido no momento do envio, pois numa janela de 24h muita coisa pode
 * mudar (cancelamento, reembolso, envio já realizado).
 *
 * Deve ser chamado periodicamente (ex: a cada 30 minutos) por um cron
 * externo (ex: cron-job.org): GET /api/send-order-processing-emails?secret=SEU_SYNC_SECRET
 */

import { createClient } from '@supabase/supabase-js';
import { sendOrderProcessingEmail } from '../lib/send-notification.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const SYNC_SECRET = process.env.SYNC_SECRET || 'solare-sync-2024';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  if (req.query.secret !== SYNC_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    // Janela de 24h-26h: dá margem pro cron rodar a cada ~30min sem perder pedidos
    const windowStart = new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString();
    const windowEnd = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const { data: orders, error } = await supabase
      .from('orders')
      .select('*')
      .eq('status', 'approved') // só pedidos ainda aprovados — cancelado/reembolsado some do filtro sozinho
      .gte('created_at', windowStart)
      .lte('created_at', windowEnd);

    if (error) {
      console.error('[OrderProcessing] Supabase error:', error);
      return res.status(500).json({ error: error.message });
    }

    let sent = 0;
    const results = [];

    for (const order of orders || []) {
      const addr = order.customer_address || {};
      if (addr.upsell === true) continue; // só pedido principal
      if (addr.processingEmailSent === true) continue; // evita duplicado
      if (!order.customer_email) continue;

      try {
        await sendOrderProcessingEmail({
          customerName: order.customer_name,
          customerEmail: order.customer_email,
          orderId: order.id,
          trackingCode: order.tracking_code || null,
        });

        await supabase
          .from('orders')
          .update({ customer_address: { ...addr, processingEmailSent: true } })
          .eq('id', order.id);

        sent++;
        results.push({ id: order.id, sent: true, shipped: !!order.tracking_code });
      } catch (e) {
        console.error(`[OrderProcessing] Failed for order ${order.id}:`, e.message);
        results.push({ id: order.id, sent: false, error: e.message });
      }
    }

    return res.status(200).json({ checked: (orders || []).length, sent, results });

  } catch (err) {
    console.error('[OrderProcessing] Unexpected error:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
}
