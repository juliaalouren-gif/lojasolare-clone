/**
 * Lista os últimos e-mails enviados via Brevo (todas as automações), pra
 * exibir na aba "Automação" do painel. Só repassa o que a Brevo retorna —
 * nenhuma chave de API é exposta ao navegador.
 */

const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD || 'solare@2024';
const BREVO_API_KEY = process.env.BREVO_API_KEY;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { password, email } = req.query;
  if (password !== DASHBOARD_PASSWORD) return res.status(401).json({ error: 'Senha incorreta.' });

  if (!BREVO_API_KEY) return res.status(200).json({ events: [] });

  try {
    const params = new URLSearchParams({ limit: '200', sort: 'desc' });
    if (email) params.set('email', email);

    const resp = await fetch(`https://api.brevo.com/v3/smtp/statistics/events?${params}`, {
      headers: { 'api-key': BREVO_API_KEY },
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data?.message || 'Erro na Brevo');

    const events = (data.events || []).map(e => ({
      date: e.date,
      email: e.email,
      subject: e.subject,
      event: e.event,
    }));

    return res.status(200).json({ events });
  } catch (err) {
    console.error('[brevo-events] error:', err);
    return res.status(500).json({ error: 'Erro ao buscar eventos da Brevo.' });
  }
}
