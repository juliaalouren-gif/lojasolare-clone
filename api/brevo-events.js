/**
 * Lista os e-mails enviados via Brevo (todas as automações) numa janela de
 * dias, pra alimentar a aba "Automação" do painel (cards por etapa + tabela
 * detalhada). Também cruza os destinatários com os pedidos aprovados pra
 * saber quem converteu depois do e-mail. Nenhuma chave de API é exposta ao
 * navegador.
 */
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD || 'solare@2024';
const BREVO_API_KEY = process.env.BREVO_API_KEY;
const PAGE_LIMIT = 500;
const MAX_PAGES = 4; // até 2000 eventos — suficiente pra 30 dias no volume atual

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { password, email, days } = req.query;
  if (password !== DASHBOARD_PASSWORD) return res.status(401).json({ error: 'Senha incorreta.' });

  if (!BREVO_API_KEY) return res.status(200).json({ events: [] });

  const windowDays = Math.max(1, parseInt(days) || 7);
  const startDate = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  // A Brevo rejeita endDate maior que a data atual — usa hoje (em UTC) como teto.
  const endDate = new Date().toISOString().slice(0, 10);

  try {
    const events = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      const params = new URLSearchParams({
        limit: String(PAGE_LIMIT),
        offset: String(page * PAGE_LIMIT),
        sort: 'desc',
        startDate,
        endDate,
      });
      if (email) params.set('email', email);

      const resp = await fetch(`https://api.brevo.com/v3/smtp/statistics/events?${params}`, {
        headers: { 'api-key': BREVO_API_KEY },
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data?.message || 'Erro na Brevo');

      const batch = data.events || [];
      events.push(...batch);
      if (batch.length < PAGE_LIMIT) break; // última página
    }

    const clean = events.map(e => ({
      date: e.date,
      email: e.email,
      subject: e.subject,
      event: e.event,
      messageId: e.messageId || null,
    }));

    // Cruza os destinatários únicos com pedidos aprovados, pra marcar quem
    // converteu depois de receber o e-mail (até 7 dias depois do envio).
    const recipients = [...new Set(clean.map(e => e.email).filter(Boolean))];
    let conversions = {};
    if (recipients.length) {
      const { data: orders, error: ordersErr } = await supabase
        .from('orders')
        .select('customer_email, created_at, total_price')
        .eq('status', 'approved')
        .in('customer_email', recipients);

      if (!ordersErr && orders) {
        for (const o of orders) {
          (conversions[o.customer_email] ||= []).push({ created_at: o.created_at, total_price: o.total_price });
        }
      }
    }

    return res.status(200).json({ events: clean, windowDays, conversions });
  } catch (err) {
    console.error('[brevo-events] error:', err);
    return res.status(500).json({ error: 'Erro ao buscar eventos da Brevo.' });
  }
}
