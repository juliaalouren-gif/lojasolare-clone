-- ============================================================
-- Solare — Schema Supabase
-- Executar no SQL Editor: supabase.com → seu projeto → SQL Editor → New Query
-- ============================================================

CREATE TABLE IF NOT EXISTS orders (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  -- Customer info
  customer_name TEXT NOT NULL,
  customer_email TEXT NOT NULL,
  customer_cpf TEXT,
  customer_phone TEXT,
  customer_address JSONB,

  -- Product info
  product_quantity INTEGER NOT NULL,
  product_light_color TEXT,
  total_price NUMERIC(10, 2) NOT NULL,

  -- Shipping
  shipping_method TEXT,
  shipping_price NUMERIC(10, 2),

  -- Payment info
  payment_method TEXT,
  mp_payment_id TEXT,
  pix_qr_code TEXT,
  pix_qr_code_base64 TEXT,

  -- Dashboard
  order_placed BOOLEAN DEFAULT false,
  tracking_code TEXT,

  -- Upsell (1-click card charge)
  mp_customer_id TEXT,
  mp_card_id TEXT,

  -- Status: pending | approved | rejected | cancelled
  status TEXT DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled'))
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_orders_mp_payment_id   ON orders (mp_payment_id);
CREATE INDEX IF NOT EXISTS idx_orders_status           ON orders (status);
CREATE INDEX IF NOT EXISTS idx_orders_customer_email   ON orders (customer_email);

-- Enable Row Level Security
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

-- Service role (backend) can do everything
CREATE POLICY "Service role full access"
  ON orders
  USING (true)
  WITH CHECK (true);
