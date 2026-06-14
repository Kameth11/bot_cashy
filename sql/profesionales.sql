CREATE TABLE IF NOT EXISTS profesionales (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  telegram_user_id TEXT NOT NULL UNIQUE,
  nombre TEXT NOT NULL,
  activo BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE profesionales ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access" ON profesionales
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
