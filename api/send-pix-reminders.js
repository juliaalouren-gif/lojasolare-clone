import { createClient } from '@supabase/supabase-js';
import { sendWhatsApp } from './whatsapp.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const now = new Date();

    // Fetch all pending PIX orders not older than 5 hours
    const cutoff = new Date(now.getTime() - 5 * 60 * 60 * 1000).toISOString();
    const { data: orders, error } = await supabase
      .from('orders')
      .select('id, created_at, customer_name, customer_phone, wa_3min_sent, wa_2h_sent, wa_4h_sent')
      .eq('status', 'pending')
      .eq('payment_method', 'pix')
      .gte('created_at', cutoff);

    // If columns don't exist yet, skip gracefully
    if (error?.message?.includes('does not exist')) {
      console.warn('[PIX Reminders] wa_ columns missing — skipping');
      return res.status(200).json({ sent: 0, note: 'columns_missing' });
    }

    if (error) throw error;
    if (!orders || orders.length === 0) return res.status(200).json({ sent: 0 });

    let sent = 0;

    for (const order of orders) {
      const created = new Date(order.created_at);
      const ageMs = now - created;
      const firstName = (order.customer_name || '').trim().split(' ')[0];
      const phone = order.customer_phone;

      // 3 min reminder (fires between 3min and 30min after creation)
      if (!order.wa_3min_sent && ageMs >= 3 * 60 * 1000 && ageMs < 30 * 60 * 1000) {
        const ok = await sendWhatsApp(phone,
          `⏳ Oi ${firstName}! Seu PIX ainda está aguardando pagamento.\n\n` +
          `Não deixe expirar — sua Luminária Solare está reservada para você! 💡\n\n` +
          `Abra seu app de banco e pague o PIX para garantir seu pedido.`
        );
        if (ok !== null) {
          await supabase.from('orders').update({ wa_3min_sent: true }).eq('id', order.id);
          sent++;
        }
      }

      // 2h reminder (fires between 2h and 2h30 after creation)
      if (!order.wa_2h_sent && ageMs >= 2 * 60 * 60 * 1000 && ageMs < 2.5 * 60 * 60 * 1000) {
        const ok = await sendWhatsApp(phone,
          `🔔 ${firstName}, sua luminária ainda está te esperando!\n\n` +
          `Seu PIX foi gerado há 2 horas e ainda não foi pago. ` +
          `Ainda dá tempo de garantir a promoção! 💚\n\n` +
          `Qualquer problema, estamos aqui para ajudar.`
        );
        if (ok !== null) {
          await supabase.from('orders').update({ wa_2h_sent: true }).eq('id', order.id);
          sent++;
        }
      }

      // 4h reminder (fires between 4h and 4h30 after creation)
      if (!order.wa_4h_sent && ageMs >= 4 * 60 * 60 * 1000 && ageMs < 4.5 * 60 * 60 * 1000) {
        const ok = await sendWhatsApp(phone,
          `🚨 Última chance, ${firstName}!\n\n` +
          `Seu PIX está prestes a expirar. Após isso você perde a promoção e terá que fazer um novo pedido.\n\n` +
          `Pague agora e garanta sua Luminária Solare! 💡`
        );
        if (ok !== null) {
          await supabase.from('orders').update({ wa_4h_sent: true }).eq('id', order.id);
          sent++;
        }
      }
    }

    // ── Abandoned checkout check ─────────────────────────────
    const cutoff30m = new Date(now.getTime() - 30 * 60 * 1000).toISOString();
    const cutoff24h = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

    const { data: leads } = await supabase
      .from('leads')
      .select('id, name, phone')
      .eq('converted', false)
      .eq('whatsapp_sent', false)
      .lte('last_seen', cutoff30m)
      .gte('last_seen', cutoff24h);

    for (const lead of (leads || [])) {
      const firstName = lead.name.trim().split(' ')[0];
      const ok = await sendWhatsApp(lead.phone,
        `Oi ${firstName}! 👋 Vimos que você quase finalizou seu pedido na Solare.\n\n` +
        `Ficou com alguma dúvida ou ocorreu algum problema? Estamos aqui para ajudar! 💚\n\n` +
        `Acesse novamente: ${process.env.SITE_URL || 'https://www.solarelojas.com.br'}`
      );
      if (ok !== null) {
        await supabase.from('leads').update({ whatsapp_sent: true }).eq('id', lead.id);
        sent++;
      }
    }

    return res.status(200).json({ sent, checked: orders.length });

  } catch (err) {
    console.error('send-pix-reminders error:', err);
    return res.status(500).end();
  }
}
