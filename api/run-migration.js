import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Simple auth check
  const secret = req.query.secret || req.headers['x-secret'];
  if (secret !== process.env.SUPABASE_SERVICE_ROLE_KEY?.slice(-8)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    // Add WhatsApp reminder tracking columns to orders
    const { error } = await supabase.rpc('run_migration');

    // If rpc doesn't exist, try direct approach via pg_catalog trick
    // We'll use a workaround: insert a dummy row to test column existence
    const { error: testError } = await supabase
      .from('orders')
      .select('wa_3min_sent')
      .limit(1);

    if (testError && testError.message.includes('does not exist')) {
      return res.status(200).json({
        status: 'columns_missing',
        message: 'Please run the SQL in supabase-schema.sql manually in Supabase SQL Editor',
        sql: `
ALTER TABLE orders ADD COLUMN IF NOT EXISTS wa_3min_sent BOOLEAN DEFAULT false;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS wa_2h_sent BOOLEAN DEFAULT false;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS wa_4h_sent BOOLEAN DEFAULT false;
        `.trim()
      });
    }

    return res.status(200).json({ status: 'ok', columns_exist: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
