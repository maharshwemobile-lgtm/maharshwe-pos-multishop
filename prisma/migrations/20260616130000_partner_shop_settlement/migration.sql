-- Phase 9: Partner Shop referrals and weekly settlement

CREATE TABLE IF NOT EXISTS partner_shop_links (
  id UUID PRIMARY KEY,
  provider_shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  partner_shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  partner_code TEXT NOT NULL,
  display_name TEXT NOT NULL,
  settlement_weekday INTEGER NOT NULL DEFAULT 1,
  default_partner_profit_percent DECIMAL(6,2) NOT NULL DEFAULT 0,
  default_provider_fee DECIMAL(14,2) NOT NULL DEFAULT 0,
  customer_pays_partner BOOLEAN NOT NULL DEFAULT TRUE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (provider_shop_id, partner_shop_id),
  UNIQUE (provider_shop_id, partner_code)
);

CREATE INDEX IF NOT EXISTS partner_shop_links_provider_idx
  ON partner_shop_links(provider_shop_id, active, display_name);
CREATE INDEX IF NOT EXISTS partner_shop_links_partner_idx
  ON partner_shop_links(partner_shop_id, active);

CREATE TABLE IF NOT EXISTS partner_repair_ledger (
  id UUID PRIMARY KEY,
  provider_shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  partner_shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  partner_link_id UUID NOT NULL REFERENCES partner_shop_links(id) ON DELETE CASCADE,
  referral_id UUID REFERENCES repair_referrals(id) ON DELETE SET NULL,
  partner_repair_id UUID REFERENCES repairs(id) ON DELETE SET NULL,
  provider_repair_id UUID REFERENCES repairs(id) ON DELETE SET NULL,
  partner_repair_number TEXT,
  provider_repair_number TEXT,
  customer_charge DECIMAL(14,2) NOT NULL DEFAULT 0,
  provider_service_fee DECIMAL(14,2) NOT NULL DEFAULT 0,
  parts_cost DECIMAL(14,2) NOT NULL DEFAULT 0,
  other_cost DECIMAL(14,2) NOT NULL DEFAULT 0,
  provider_due DECIMAL(14,2) NOT NULL DEFAULT 0,
  partner_profit DECIMAL(14,2) NOT NULL DEFAULT 0,
  customer_paid BOOLEAN NOT NULL DEFAULT FALSE,
  customer_paid_at TIMESTAMPTZ,
  settlement_status TEXT NOT NULL DEFAULT 'UNSETTLED',
  settlement_id UUID,
  completed_at TIMESTAMPTZ,
  notes TEXT,
  created_by_id UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (provider_shop_id, partner_shop_id, partner_repair_id),
  UNIQUE (provider_shop_id, partner_shop_id, provider_repair_id)
);

CREATE INDEX IF NOT EXISTS partner_repair_ledger_provider_idx
  ON partner_repair_ledger(provider_shop_id, settlement_status, completed_at DESC);
CREATE INDEX IF NOT EXISTS partner_repair_ledger_partner_idx
  ON partner_repair_ledger(partner_shop_id, settlement_status, completed_at DESC);

CREATE TABLE IF NOT EXISTS partner_weekly_settlements (
  id UUID PRIMARY KEY,
  provider_shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  partner_shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  partner_link_id UUID NOT NULL REFERENCES partner_shop_links(id) ON DELETE CASCADE,
  settlement_number TEXT NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'DRAFT',
  total_jobs INTEGER NOT NULL DEFAULT 0,
  customer_collected DECIMAL(14,2) NOT NULL DEFAULT 0,
  provider_due DECIMAL(14,2) NOT NULL DEFAULT 0,
  partner_profit DECIMAL(14,2) NOT NULL DEFAULT 0,
  parts_cost DECIMAL(14,2) NOT NULL DEFAULT 0,
  other_cost DECIMAL(14,2) NOT NULL DEFAULT 0,
  paid_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
  outstanding_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
  confirmed_by_id UUID REFERENCES users(id) ON DELETE SET NULL,
  paid_by_id UUID REFERENCES users(id) ON DELETE SET NULL,
  locked_at TIMESTAMPTZ,
  confirmed_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  notes TEXT,
  created_by_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (provider_shop_id, settlement_number),
  UNIQUE (provider_shop_id, partner_shop_id, period_start, period_end)
);

ALTER TABLE partner_repair_ledger
  ADD CONSTRAINT partner_repair_ledger_settlement_fk
  FOREIGN KEY (settlement_id) REFERENCES partner_weekly_settlements(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS partner_weekly_settlements_provider_idx
  ON partner_weekly_settlements(provider_shop_id, status, period_end DESC);
CREATE INDEX IF NOT EXISTS partner_weekly_settlements_partner_idx
  ON partner_weekly_settlements(partner_shop_id, status, period_end DESC);

CREATE TABLE IF NOT EXISTS partner_settlement_payments (
  id UUID PRIMARY KEY,
  settlement_id UUID NOT NULL REFERENCES partner_weekly_settlements(id) ON DELETE CASCADE,
  provider_shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  partner_shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  amount DECIMAL(14,2) NOT NULL,
  payment_method TEXT NOT NULL DEFAULT 'CASH',
  reference_number TEXT,
  note TEXT,
  received_by_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS partner_settlement_payments_settlement_idx
  ON partner_settlement_payments(settlement_id, created_at DESC);
