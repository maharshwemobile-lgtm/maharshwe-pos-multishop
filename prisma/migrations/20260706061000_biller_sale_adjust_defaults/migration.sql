ALTER TABLE billers
  ADD COLUMN IF NOT EXISTS sale_adjust_mode TEXT NOT NULL DEFAULT 'NONE',
  ADD COLUMN IF NOT EXISTS sale_adjust_percent NUMERIC(8,4) NOT NULL DEFAULT 0;

UPDATE billers
   SET sale_adjust_mode = COALESCE(NULLIF(sale_adjust_mode, ''), 'NONE'),
       sale_adjust_percent = COALESCE(sale_adjust_percent, 0);
