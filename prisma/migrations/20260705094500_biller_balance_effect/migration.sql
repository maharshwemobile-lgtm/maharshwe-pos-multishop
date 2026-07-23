ALTER TABLE biller_transactions
  ADD COLUMN IF NOT EXISTS balance_effect_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS balance_adjust_mode TEXT NULL,
  ADD COLUMN IF NOT EXISTS balance_adjust_percent NUMERIC(8,4) NOT NULL DEFAULT 0;

UPDATE biller_transactions
   SET balance_effect_amount = amount
 WHERE balance_effect_amount = 0;
