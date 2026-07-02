-- Phase: Firebase Cloud Messaging push notifications
-- Adds generic in-app notification storage plus tenant/user scoped FCM tokens.

CREATE TABLE IF NOT EXISTS "app_notifications" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "shop_id" UUID NOT NULL REFERENCES "shops"("id") ON DELETE CASCADE,
  "user_id" UUID REFERENCES "users"("id") ON DELETE CASCADE,
  "event_type" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "url" TEXT,
  "data" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "is_read" BOOLEAN NOT NULL DEFAULT FALSE,
  "read_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "app_notifications_shop_user_read_created_idx"
  ON "app_notifications"("shop_id", "user_id", "is_read", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "app_notifications_shop_event_created_idx"
  ON "app_notifications"("shop_id", "event_type", "created_at" DESC);

CREATE TABLE IF NOT EXISTS "user_push_tokens" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "shop_id" UUID NOT NULL REFERENCES "shops"("id") ON DELETE CASCADE,
  "token" TEXT NOT NULL UNIQUE,
  "platform" TEXT,
  "browser" TEXT,
  "is_active" BOOLEAN NOT NULL DEFAULT TRUE,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "last_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "user_push_tokens_shop_active_idx"
  ON "user_push_tokens"("shop_id", "is_active");

CREATE INDEX IF NOT EXISTS "user_push_tokens_user_active_idx"
  ON "user_push_tokens"("user_id", "is_active");

CREATE INDEX IF NOT EXISTS "user_push_tokens_shop_user_active_idx"
  ON "user_push_tokens"("shop_id", "user_id", "is_active");
