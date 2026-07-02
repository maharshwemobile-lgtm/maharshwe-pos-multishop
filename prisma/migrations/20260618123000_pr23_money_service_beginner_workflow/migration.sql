CREATE TABLE IF NOT EXISTS finance_payment_methods (
  id UUID PRIMARY KEY,
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  code TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'WALLET',
  account_id UUID REFERENCES money_accounts(id) ON DELETE SET NULL,
  supports_money_service BOOLEAN NOT NULL DEFAULT TRUE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT finance_payment_methods_kind_check CHECK (kind IN ('CASH','WALLET','BANK','OTHER'))
);

CREATE UNIQUE INDEX IF NOT EXISTS finance_payment_methods_shop_code_unique
  ON finance_payment_methods(shop_id, LOWER(code));
CREATE UNIQUE INDEX IF NOT EXISTS finance_payment_methods_shop_name_unique
  ON finance_payment_methods(shop_id, LOWER(name));
CREATE INDEX IF NOT EXISTS finance_payment_methods_shop_active_idx
  ON finance_payment_methods(shop_id, active, sort_order, name);

CREATE TABLE IF NOT EXISTS business_income_categories (
  id UUID PRIMARY KEY,
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS business_income_categories_shop_name_unique
  ON business_income_categories(shop_id, LOWER(name));
CREATE INDEX IF NOT EXISTS business_income_categories_shop_active_idx
  ON business_income_categories(shop_id, active, sort_order, name);

CREATE TABLE IF NOT EXISTS money_service_transactions_v2 (
  id UUID PRIMARY KEY,
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  transaction_number TEXT NOT NULL,
  mode TEXT NOT NULL,
  payment_method_id UUID REFERENCES finance_payment_methods(id) ON DELETE SET NULL,
  cash_account_id UUID REFERENCES money_accounts(id) ON DELETE SET NULL,
  wallet_account_id UUID REFERENCES money_accounts(id) ON DELETE SET NULL,
  sender_name TEXT,
  sender_phone TEXT,
  receiver_name TEXT,
  receiver_phone TEXT,
  withdrawer_name TEXT,
  withdrawer_phone TEXT,
  amount NUMERIC(14,2) NOT NULL,
  fee_mode TEXT NOT NULL DEFAULT 'AUTO',
  fee_rate NUMERIC(8,4) NOT NULL DEFAULT 0,
  fee_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  customer_pays NUMERIC(14,2) NOT NULL DEFAULT 0,
  customer_receives NUMERIC(14,2) NOT NULL DEFAULT 0,
  payment_status TEXT NOT NULL DEFAULT 'PAID',
  paid_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  due_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  due_date DATE,
  reference TEXT,
  note TEXT,
  created_by_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT money_service_v2_mode_check CHECK (mode IN ('TRANSFER','CASH_OUT')),
  CONSTRAINT money_service_v2_fee_mode_check CHECK (fee_mode IN ('AUTO','CUSTOM')),
  CONSTRAINT money_service_v2_payment_status_check CHECK (payment_status IN ('PENDING','PARTIAL','PAID')),
  CONSTRAINT money_service_v2_amounts_check CHECK (amount > 0 AND fee_amount >= 0 AND paid_amount >= 0 AND due_amount >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS money_service_v2_shop_number_unique
  ON money_service_transactions_v2(shop_id, transaction_number);
CREATE INDEX IF NOT EXISTS money_service_v2_shop_created_idx
  ON money_service_transactions_v2(shop_id, created_at DESC);
CREATE INDEX IF NOT EXISTS money_service_v2_shop_status_idx
  ON money_service_transactions_v2(shop_id, payment_status, due_date, created_at DESC);

CREATE TABLE IF NOT EXISTS money_service_payments_v2 (
  id UUID PRIMARY KEY,
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  transaction_id UUID NOT NULL REFERENCES money_service_transactions_v2(id) ON DELETE CASCADE,
  payment_method_id UUID REFERENCES finance_payment_methods(id) ON DELETE SET NULL,
  account_id UUID REFERENCES money_accounts(id) ON DELETE SET NULL,
  amount NUMERIC(14,2) NOT NULL,
  note TEXT,
  collected_by_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT money_service_payments_v2_amount_check CHECK (amount > 0)
);

CREATE INDEX IF NOT EXISTS money_service_payments_v2_transaction_idx
  ON money_service_payments_v2(transaction_id, created_at DESC);
CREATE INDEX IF NOT EXISTS money_service_payments_v2_shop_created_idx
  ON money_service_payments_v2(shop_id, created_at DESC);
