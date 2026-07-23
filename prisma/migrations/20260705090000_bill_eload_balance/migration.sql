DO $$ BEGIN
  CREATE TYPE "BillerType" AS ENUM ('TOPUP_CARD', 'ELOAD', 'BILL_PAYMENT', 'OTHER');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "BillerTransactionType" AS ENUM ('OPENING', 'REFILL', 'SOLD', 'ADJUSTMENT');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS billers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  branch_id UUID NULL,
  name TEXT NOT NULL,
  type "BillerType" NOT NULL DEFAULT 'OTHER',
  opening_balance NUMERIC(14,2) NOT NULL DEFAULT 0,
  current_balance NUMERIC(14,2) NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS billers_shop_branch_name_unique
  ON billers(shop_id, COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::uuid), LOWER(name));
CREATE INDEX IF NOT EXISTS billers_shop_active_idx ON billers(shop_id, is_active);
CREATE INDEX IF NOT EXISTS billers_shop_branch_idx ON billers(shop_id, branch_id);

CREATE TABLE IF NOT EXISTS biller_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  branch_id UUID NULL,
  biller_id UUID NOT NULL REFERENCES billers(id) ON DELETE CASCADE,
  transaction_type "BillerTransactionType" NOT NULL,
  amount NUMERIC(14,2) NOT NULL,
  cost_amount NUMERIC(14,2) NULL,
  profit_amount NUMERIC(14,2) NULL,
  customer_phone TEXT NULL,
  payment_method TEXT NULL,
  payment_account_id UUID NULL REFERENCES money_accounts(id) ON DELETE SET NULL,
  staff_id UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  note TEXT NULL,
  transaction_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS biller_transactions_shop_branch_date_idx ON biller_transactions(shop_id, branch_id, transaction_date);
CREATE INDEX IF NOT EXISTS biller_transactions_shop_biller_date_idx ON biller_transactions(shop_id, biller_id, transaction_date);
CREATE INDEX IF NOT EXISTS biller_transactions_shop_type_date_idx ON biller_transactions(shop_id, transaction_type, transaction_date);
