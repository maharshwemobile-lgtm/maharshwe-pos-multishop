-- Phase 7 repair finance and export

ALTER TABLE repairs ADD COLUMN IF NOT EXISTS parts_cost DECIMAL(14,2) NOT NULL DEFAULT 0;
ALTER TABLE repairs ADD COLUMN IF NOT EXISTS technician_commission DECIMAL(14,2) NOT NULL DEFAULT 0;
ALTER TABLE repairs ADD COLUMN IF NOT EXISTS other_cost DECIMAL(14,2) NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS repairs_finance_week_idx
  ON repairs(shop_id, completed_at, status);
