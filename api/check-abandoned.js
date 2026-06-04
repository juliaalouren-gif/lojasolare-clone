import { createClient } from '@supabase/supabase-js';
import { sendWhatsApp } from './whatsapp.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const SITE_URL = process.env.SITE_URL || 'https://www.solarelojas.com.br';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Allow GET (cron) or POST (manual trigger from dashboard)
  const secret = req.headers['x-cron-secret'] || req.query.secret;
  if (secret !== process.env.CRON_SECRET && process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const cutoff30m = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const cutoff24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    // Leads that reached payment step 30min ago and never converted, no whatsapp sent yet
    const { data: leads } = await supabase
      .from('leads')
      .select('*')
      .eq('converted', false)
      .eq('whatsapp_sent', false)
      .lte('last_seen', cutoff30m)
      .gte('last_seen', cutoff24h);

    if (!leads || leads.length === 0) {
      return res.status(200).json({ sent: 0 });
    }

    let sent = 0;
    for (const lead of leads) {
      const firstName = lead.name.trim().split(' ')[0];
      const msg =
        `Oi ${firstName}! 👋 Vimos que você quase finalizou seu pedido na Solare.\n\n` +
        `Ficou com alguma dúvida ou teve algum problema? Estamos aqui para ajudar! 💚\n\n` +
        `Acesse novamente: ${SITE_URL}`;

      const ok = await sendWhatsApp(lead.phone, msg);
      if (ok) {
        await supabase
          .from('leads')
          .update({ whatsapp_sent: true })
          .eq('id', lead.id);
        sent++;
      }
    }

    return res.status(200).json({ sent });
  } catch (err) {
    console.error('check-abandoned error:', err);
    return res.status(500).end();
  }
}
