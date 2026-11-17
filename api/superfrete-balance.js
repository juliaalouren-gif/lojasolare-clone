import { getBalance } from '../lib/superfrete.js';

const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD || 'solare@2024';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { password } = req.query;
  if (password !== DASHBOARD_PASSWORD) return res.status(401).json({ error: 'Senha incorreta.' });

  try {
    const info = await getBalance();
    return res.status(200).json(info);
  } catch (err) {
    console.error('[SuperFrete] balance error:', err);
    return res.status(500).json({ error: err.message || 'Erro ao consultar saldo.' });
  }
}
