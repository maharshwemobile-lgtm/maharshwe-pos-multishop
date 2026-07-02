const { prisma } = require('./prisma');

let schemaPromise;

const statements = [
  `CREATE TABLE IF NOT EXISTS repair_sequences (
    shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
    period TEXT NOT NULL,
    last_value INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (shop_id, period)
  )`,
  `CREATE TABLE IF NOT EXISTS repair_devices (
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
  )`,
  `CREATE TABLE IF NOT EXISTS repair_events (
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
  )`,
  `CREATE TABLE IF NOT EXISTS repair_referrals (
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
  )`,
  `CREATE TABLE IF NOT EXISTS repair_public_access (
    id UUID PRIMARY KEY,
    shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
    repair_id UUID NOT NULL REFERENCES repairs(id) ON DELETE CASCADE,
    access_token_hash CHAR(64) NOT NULL UNIQUE,
    access_token_last4 CHAR(4) NOT NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    expires_at TIMESTAMPTZ,
    created_by_id UUID REFERENCES users(id) ON DELETE SET NULL,
    last_viewed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (shop_id, repair_id)
  )`,
  `CREATE TABLE IF NOT EXISTS repair_notification_queue (
    id UUID PRIMARY KEY,
    shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
    repair_id UUID NOT NULL REFERENCES repairs(id) ON DELETE CASCADE,
    notification_key TEXT NOT NULL UNIQUE,
    channel TEXT NOT NULL,
    destination TEXT NOT NULL,
    event_type TEXT NOT NULL,
    repair_status TEXT,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    action_url TEXT,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    state TEXT NOT NULL DEFAULT 'PENDING',
    attempts INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 5,
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    sent_at TIMESTAMPTZ,
    last_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS repair_warranty_claims (
    id UUID PRIMARY KEY,
    shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
    repair_id UUID NOT NULL REFERENCES repairs(id) ON DELETE CASCADE,
    claim_number TEXT NOT NULL,
    reason TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'OPEN',
    created_by_id UUID REFERENCES users(id) ON DELETE SET NULL,
    resolved_by_id UUID REFERENCES users(id) ON DELETE SET NULL,
    resolution TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (shop_id, claim_number)
  )`,
  `ALTER TABLE repairs ADD COLUMN IF NOT EXISTS device_id UUID REFERENCES repair_devices(id) ON DELETE SET NULL`,
  `ALTER TABLE repairs ADD COLUMN IF NOT EXISTS source_type TEXT NOT NULL DEFAULT 'LOCAL'`,
  `ALTER TABLE repairs ADD COLUMN IF NOT EXISTS source_provider TEXT`,
  `ALTER TABLE repairs ADD COLUMN IF NOT EXISTS source_shop_name TEXT`,
  `ALTER TABLE repairs ADD COLUMN IF NOT EXISTS external_repair_id TEXT`,
  `ALTER TABLE repairs ADD COLUMN IF NOT EXISTS provider_repair_id TEXT`,
  `ALTER TABLE repairs ADD COLUMN IF NOT EXISTS external_payload JSONB NOT NULL DEFAULT '{}'::jsonb`,
  `ALTER TABLE repairs ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMPTZ`,
  `ALTER TABLE repairs ADD COLUMN IF NOT EXISTS priority TEXT NOT NULL DEFAULT 'NORMAL'`,
  `ALTER TABLE repairs ADD COLUMN IF NOT EXISTS intake_condition TEXT`,
  `ALTER TABLE repairs ADD COLUMN IF NOT EXISTS accessories JSONB NOT NULL DEFAULT '[]'::jsonb`,
  `ALTER TABLE repairs ADD COLUMN IF NOT EXISTS diagnosis TEXT`,
  `ALTER TABLE repairs ADD COLUMN IF NOT EXISTS resolution TEXT`,
  `ALTER TABLE repairs ADD COLUMN IF NOT EXISTS warranty_until DATE`,
  `ALTER TABLE repairs ADD COLUMN IF NOT EXISTS parts_cost NUMERIC(14,2) NOT NULL DEFAULT 0`,
  `ALTER TABLE repairs ADD COLUMN IF NOT EXISTS technician_commission NUMERIC(14,2) NOT NULL DEFAULT 0`,
  `ALTER TABLE repairs ADD COLUMN IF NOT EXISTS other_cost NUMERIC(14,2) NOT NULL DEFAULT 0`,
  `ALTER TABLE repairs ADD COLUMN IF NOT EXISTS customer_telegram_chat_id TEXT`,
  `ALTER TABLE repairs ADD COLUMN IF NOT EXISTS customer_fcm_token TEXT`,
  `ALTER TABLE repairs ADD COLUMN IF NOT EXISTS public_status_enabled BOOLEAN NOT NULL DEFAULT TRUE`,
  `ALTER TABLE repairs ADD COLUMN IF NOT EXISTS estimated_completion_at TIMESTAMPTZ`,
  `ALTER TABLE repairs ADD COLUMN IF NOT EXISTS pickup_code_hash CHAR(64)`,
  `ALTER TABLE repairs ADD COLUMN IF NOT EXISTS pickup_code_last4 CHAR(4)`,
  `ALTER TABLE repairs ADD COLUMN IF NOT EXISTS pickup_code_created_at TIMESTAMPTZ`,
  `ALTER TABLE repairs ADD COLUMN IF NOT EXISTS pickup_verified_at TIMESTAMPTZ`,
  `ALTER TABLE repairs ADD COLUMN IF NOT EXISTS pickup_verified_by_id UUID REFERENCES users(id) ON DELETE SET NULL`,
  `ALTER TABLE repairs ADD COLUMN IF NOT EXISTS pickup_attempts INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE repairs ADD COLUMN IF NOT EXISTS warranty_parent_repair_id UUID REFERENCES repairs(id) ON DELETE SET NULL`,
  `ALTER TABLE repairs ADD COLUMN IF NOT EXISTS warranty_status TEXT`,
  `ALTER TABLE repairs ADD COLUMN IF NOT EXISTS warranty_claim_reason TEXT`,
  `CREATE INDEX IF NOT EXISTS repair_devices_shop_model_idx ON repair_devices(shop_id, brand, model)`,
  `CREATE INDEX IF NOT EXISTS repair_events_timeline_idx ON repair_events(shop_id, repair_id, occurred_at DESC)`,
  `CREATE INDEX IF NOT EXISTS repair_referrals_source_idx ON repair_referrals(source_shop_id, source_repair_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS repair_referrals_provider_idx ON repair_referrals(provider_shop_id, status, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS repair_public_access_lookup_idx ON repair_public_access(shop_id, repair_id, active, expires_at)`,
  `CREATE INDEX IF NOT EXISTS repair_notification_queue_worker_idx ON repair_notification_queue(state, next_attempt_at, created_at)`,
  `CREATE INDEX IF NOT EXISTS repair_notification_queue_repair_idx ON repair_notification_queue(shop_id, repair_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS repair_warranty_claims_repair_idx ON repair_warranty_claims(shop_id, repair_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS repairs_device_history_idx ON repairs(shop_id, device_id, received_at DESC)`,
  `CREATE INDEX IF NOT EXISTS repairs_external_lookup_idx ON repairs(shop_id, source_provider, external_repair_id)`,
  `CREATE INDEX IF NOT EXISTS repairs_finance_week_idx ON repairs(shop_id, completed_at, status)`,
  `CREATE INDEX IF NOT EXISTS repairs_warranty_parent_idx ON repairs(shop_id, warranty_parent_repair_id, received_at DESC)`,
  `CREATE INDEX IF NOT EXISTS repairs_public_status_idx ON repairs(shop_id, repair_number, public_status_enabled)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS repairs_external_unique_idx ON repairs(shop_id, source_provider, external_repair_id) WHERE external_repair_id IS NOT NULL`,
  `CREATE UNIQUE INDEX IF NOT EXISTS repairs_provider_unique_idx ON repairs(shop_id, source_provider, provider_repair_id) WHERE provider_repair_id IS NOT NULL`,
];

async function ensureRepairPlatformSchema() {
  if (!schemaPromise) {
    schemaPromise = prisma.$transaction(async (tx) => {
      for (const statement of statements) await tx.$executeRawUnsafe(statement);
      return true;
    }, { maxWait: 5000, timeout: 30000 }).catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  return schemaPromise;
}

module.exports = { ensureRepairPlatformSchema };
