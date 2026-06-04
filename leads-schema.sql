-- Executar no Supabase SQL Editor
CREATE TABLE IF NOT EXISTS leads (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at   TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_seen    TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  name         TEXT NOT NULL,
  phone        TEXT NOT NULL UNIQUE,
  email        TEXT,
  price        NUMERIC(10,2),
  qty          INTEGER,
  converted    BOOLEAN DEFAULT false,
  whatsapp_sent BOOLEAN DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_leads_phone     ON leads (phone);
CREATE INDEX IF NOT EXISTS idx_leads_converted ON leads (converted);
CREATE INDEX IF NOT EXISTS idx_leads_last_seen ON leads (last_seen);

ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON leads USING (true) WITH CHECK (true);
