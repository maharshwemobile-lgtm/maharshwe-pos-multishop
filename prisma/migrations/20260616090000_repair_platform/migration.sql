-- Phase 7: Multi-Tenant Repair Platform

CREATE TABLE IF NOT EXISTS repair_sequences (
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  period TEXT NOT NULL,
  last_value INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (shop_id, period)
);

CREATE TABLE IF NOT EXISTS repair_devices (
  id UUID PRIMARY KEY,
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  identity_type TEXT NOT NULL,
  identity_value TEXT NOT NULL,
  identity_hash CHAR(64) NOT NULL,
  identity_last4 TEXT,
  brand TEXT,
  model TEXT,
  color TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (shop_id, identity_hash)
);

CREATE INDEX IF NOT EXISTS repair_devices_shop_model_idx
  ON repair_devices(shop_id, brand, model);

CREATE TABLE IF NOT EXISTS repair_events (
  id UUID PRIMARY KEY,
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  repair_id UUID NOT NULL REFERENCES repairs(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  status TEXT,
  changed_by_id UUID REFERENCES users(id) ON DELETE SET NULL,
  source TEXT NOT NULL DEFAULT 'LOCAL',
  note TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS repair_events_timeline_idx
  ON repair_events(shop_id, repair_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS repair_referrals (
  id UUID PRIMARY KEY,
  source_shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  source_repair_id UUID NOT NULL REFERENCES repairs(id) ON DELETE CASCADE,
  provider_shop_id UUID REFERENCES shops(id) ON DELETE SET NULL,
  provider_repair_id UUID REFERENCES repairs(id) ON DELETE SET NULL,
  provider_name TEXT,
  provider_external_repair_id TEXT,
  referral_code TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'OPEN',
  shared_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by_id UUID REFERENCES users(id) ON DELETE SET NULL,
  claimed_by_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS repair_referrals_source_idx
  ON repair_referrals(source_shop_id, source_repair_id, created_at DESC);
CREATE INDEX IF NOT EXISTS repair_referrals_provider_idx
  ON repair_referrals(provider_shop_id, status, created_at DESC);

ALTER TABLE repairs ADD COLUMN IF NOT EXISTS device_id UUID REFERENCES repair_devices(id) ON DELETE SET NULL;
ALTER TABLE repairs ADD COLUMN IF NOT EXISTS source_type TEXT NOT NULL DEFAULT 'LOCAL';
ALTER TABLE repairs ADD COLUMN IF NOT EXISTS source_provider TEXT;
ALTER TABLE repairs ADD COLUMN IF NOT EXISTS source_shop_name TEXT;
ALTER TABLE repairs ADD COLUMN IF NOT EXISTS external_repair_id TEXT;
ALTER TABLE repairs ADD COLUMN IF NOT EXISTS provider_repair_id TEXT;
ALTER TABLE repairs ADD COLUMN IF NOT EXISTS external_payload JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE repairs ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMPTZ;
ALTER TABLE repairs ADD COLUMN IF NOT EXISTS priority TEXT NOT NULL DEFAULT 'NORMAL';
ALTER TABLE repairs ADD COLUMN IF NOT EXISTS intake_condition TEXT;
ALTER TABLE repairs ADD COLUMN IF NOT EXISTS accessories JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE repairs ADD COLUMN IF NOT EXISTS diagnosis TEXT;
ALTER TABLE repairs ADD COLUMN IF NOT EXISTS resolution TEXT;
ALTER TABLE repairs ADD COLUMN IF NOT EXISTS warranty_until DATE;

CREATE INDEX IF NOT EXISTS repairs_device_history_idx
  ON repairs(shop_id, device_id, received_at DESC);
CREATE INDEX IF NOT EXISTS repairs_external_lookup_idx
  ON repairs(shop_id, source_provider, external_repair_id);
CREATE UNIQUE INDEX IF NOT EXISTS repairs_external_unique_idx
  ON repairs(shop_id, source_provider, external_repair_id)
  WHERE external_repair_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS repairs_provider_unique_idx
  ON repairs(shop_id, source_provider, provider_repair_id)
  WHERE provider_repair_id IS NOT NULL;
