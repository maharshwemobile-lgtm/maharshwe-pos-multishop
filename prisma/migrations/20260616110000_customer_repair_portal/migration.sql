-- Phase 8: Customer Repair Portal, notifications, pickup security and warranty claims

CREATE TABLE IF NOT EXISTS repair_public_access (
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
);

CREATE INDEX IF NOT EXISTS repair_public_access_lookup_idx
  ON repair_public_access(shop_id, repair_id, active, expires_at);

CREATE TABLE IF NOT EXISTS repair_notification_queue (
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
);

CREATE INDEX IF NOT EXISTS repair_notification_queue_worker_idx
  ON repair_notification_queue(state, next_attempt_at, created_at);
CREATE INDEX IF NOT EXISTS repair_notification_queue_repair_idx
  ON repair_notification_queue(shop_id, repair_id, created_at DESC);

ALTER TABLE repairs ADD COLUMN IF NOT EXISTS customer_telegram_chat_id TEXT;
ALTER TABLE repairs ADD COLUMN IF NOT EXISTS customer_fcm_token TEXT;
ALTER TABLE repairs ADD COLUMN IF NOT EXISTS public_status_enabled BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE repairs ADD COLUMN IF NOT EXISTS estimated_completion_at TIMESTAMPTZ;

ALTER TABLE repairs ADD COLUMN IF NOT EXISTS pickup_code_hash CHAR(64);
ALTER TABLE repairs ADD COLUMN IF NOT EXISTS pickup_code_last4 CHAR(4);
ALTER TABLE repairs ADD COLUMN IF NOT EXISTS pickup_code_created_at TIMESTAMPTZ;
ALTER TABLE repairs ADD COLUMN IF NOT EXISTS pickup_verified_at TIMESTAMPTZ;
ALTER TABLE repairs ADD COLUMN IF NOT EXISTS pickup_verified_by_id UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE repairs ADD COLUMN IF NOT EXISTS pickup_attempts INTEGER NOT NULL DEFAULT 0;

ALTER TABLE repairs ADD COLUMN IF NOT EXISTS warranty_parent_repair_id UUID REFERENCES repairs(id) ON DELETE SET NULL;
ALTER TABLE repairs ADD COLUMN IF NOT EXISTS warranty_status TEXT;
ALTER TABLE repairs ADD COLUMN IF NOT EXISTS warranty_claim_reason TEXT;

CREATE INDEX IF NOT EXISTS repairs_warranty_parent_idx
  ON repairs(shop_id, warranty_parent_repair_id, received_at DESC);
CREATE INDEX IF NOT EXISTS repairs_public_status_idx
  ON repairs(shop_id, repair_number, public_status_enabled);
