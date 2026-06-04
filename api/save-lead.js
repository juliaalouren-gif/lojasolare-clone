import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const { name, phone, email, price, qty } = req.body;
    if (!phone || !name) return res.status(400).json({ error: 'Missing data' });

    await supabase.from('leads').upsert({
      name,
      phone: String(phone).replace(/\D/g, ''),
      email:      email || null,
      price:      parseFloat(price) || 0,
      qty:        parseInt(qty) || 1,
      converted:  false,
      last_seen:  new Date().toISOString(),
    }, { onConflict: 'phone' });

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('save-lead error:', err);
    return res.status(500).end();
  }
}
