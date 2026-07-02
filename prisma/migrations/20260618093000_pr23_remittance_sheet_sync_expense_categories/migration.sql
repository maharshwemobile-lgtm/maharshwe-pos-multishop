ALTER TABLE money_service_transactions
  ADD COLUMN IF NOT EXISTS transaction_number TEXT,
  ADD COLUMN IF NOT EXISTS service_channel TEXT,
  ADD COLUMN IF NOT EXISTS sender_name TEXT,
  ADD COLUMN IF NOT EXISTS sender_phone TEXT,
  ADD COLUMN IF NOT EXISTS receiver_name TEXT,
  ADD COLUMN IF NOT EXISTS receiver_phone TEXT,
  ADD COLUMN IF NOT EXISTS counterparty_name TEXT,
  ADD COLUMN IF NOT EXISTS counterparty_phone TEXT,
  ADD COLUMN IF NOT EXISTS fee_rate NUMERIC(8,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS custom_fee BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS reference TEXT,
  ADD COLUMN IF NOT EXISTS cash_account_id UUID REFERENCES money_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS wallet_account_id UUID REFERENCES money_accounts(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS money_service_transactions_shop_number_unique
  ON money_service_transactions(shop_id, transaction_number)
  WHERE transaction_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS money_service_transactions_channel_date_idx
  ON money_service_transactions(shop_id, service_channel, created_at DESC);

CREATE TABLE IF NOT EXISTS business_expense_categories (
  id UUID PRIMARY KEY,
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS business_expense_categories_shop_name_unique
  ON business_expense_categories(shop_id, LOWER(name));
CREATE INDEX IF NOT EXISTS business_expense_categories_shop_active_idx
  ON business_expense_categories(shop_id, active, sort_order, name);

CREATE TABLE IF NOT EXISTS google_sheet_sync_outbox (
  id UUID PRIMARY KEY,
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  dataset TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_id TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'PENDING',
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS google_sheet_sync_outbox_pending_idx
  ON google_sheet_sync_outbox(status, created_at);
CREATE INDEX IF NOT EXISTS google_sheet_sync_outbox_shop_dataset_idx
  ON google_sheet_sync_outbox(shop_id, dataset, created_at DESC);
