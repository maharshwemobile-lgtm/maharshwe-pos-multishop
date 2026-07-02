ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS payment_method_id UUID REFERENCES finance_payment_methods(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS payment_method_name_snapshot TEXT;

CREATE INDEX IF NOT EXISTS payments_shop_dynamic_method_paid_idx
  ON payments(shop_id, payment_method_id, paid_at DESC);
