ALTER TABLE biller_transactions
  ADD COLUMN IF NOT EXISTS payment_status "PaymentStatus" NOT NULL DEFAULT 'PAID',
  ADD COLUMN IF NOT EXISTS paid_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS due_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS due_date DATE NULL;

CREATE INDEX IF NOT EXISTS biller_transactions_shop_payment_status_idx
  ON biller_transactions(shop_id, payment_status, due_date, transaction_date DESC);
