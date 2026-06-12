/**
 * Sync Pending Pix Payments
 * Verifica pedidos Pix pendentes no Supabase, consulta o MP e envia
 * email de confirmação para quem pagou mas não teve a aba aberta.
 *
 * Deve ser chamado a cada 5 minutos por um cron externo (ex: cron-job.org)
 * GET /api/sync-pending-pix?secret=SEU_SYNC_SECRET
 */

import { createClient } from '@supabase/supabase-js';
import { notifyPaymentApproved, schedulePostPurchaseEmails } from '../lib/send-notification.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const SYNC_SECRET = process.env.SYNC_SECRET || 'solare-sync-2024';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  // Proteção básica por secret
  if (req.query.secret !== SYNC_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    // Busca pedidos Pix com status pending criados nas últimas 25 horas
    const since = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    const { data: pendingOrders, error } = await supabase
      .from('orders')
      .select('*')
      .eq('payment_method', 'pix')
      .eq('status', 'pending')
      .gte('created_at', since);

    if (error) {
      console.error('[SyncPix] Supabase error:', error);
      return res.status(500).json({ error: error.message });
    }

    if (!pendingOrders || pendingOrders.length === 0) {
      return res.status(200).json({ checked: 0, confirmed: 0 });
    }

    let confirmed = 0;

    for (const order of pendingOrders) {
      try {
        const mpRes = await fetch(`https://api.mercadopago.com/v1/payments/${order.mp_payment_id}`, {
          headers: { 'Authorization': `Bearer ${process.env.MP_ACCESS_TOKEN}` },
        });

        if (!mpRes.ok) continue;

        const mpData = await mpRes.json();

        if (mpData.status === 'approved') {
          // Atualiza Supabase
          await supabase
            .from('orders')
            .update({ status: 'approved' })
            .eq('id', order.id);

          // Envia email de confirmação
          await notifyPaymentApproved({
            customerName:   order.customer_name,
            customerEmail:  order.customer_email,
            customerPhone:  order.customer_phone,
            totalPrice:     order.total_price,
            shippingMethod: order.shipping_method,
            orderId:        order.id,
          }).catch(e => console.error('[SyncPix] notifyPaymentApproved failed:', e));

          // Agenda emails pós-compra (3h e 2 dias)
          await schedulePostPurchaseEmails({
            customerName:  order.customer_name,
            customerEmail: order.customer_email,
            orderId:       order.id,
          }).catch(e => console.error('[SyncPix] schedulePostPurchaseEmails failed:', e));

          confirmed++;
          console.log(`[SyncPix] Order ${order.id} confirmed and notified.`);
        }
      } catch (e) {
        console.error(`[SyncPix] Error checking order ${order.id}:`, e.message);
      }
    }

    return res.status(200).json({
      checked:   pendingOrders.length,
      confirmed,
    });

  } catch (err) {
    console.error('[SyncPix] Unexpected error:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
}
