-- Phase: Central Mahar Admin Portal integrations
-- Adds local product registry, campaign history, ads history, admin audit logs,
-- and optional admin role assignments. Existing POS tables remain untouched.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS "admin_products" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL UNIQUE,
  "type" TEXT NOT NULL,
  "domain" TEXT,
  "package_name" TEXT,
  "firebase_project" TEXT,
  "topic" TEXT,
  "push_type" TEXT,
  "ads_api_enabled" BOOLEAN NOT NULL DEFAULT FALSE,
  "metadata" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "admin_products_type_idx" ON "admin_products"("type");

INSERT INTO "admin_products"
  ("name", "slug", "type", "domain", "package_name", "firebase_project", "topic", "push_type", "ads_api_enabled", "metadata")
VALUES
  ('Mahar POS Web App', 'mahar_pos_web', 'web', 'https://app.maharshwe.shop', NULL, 'maharshweonlinevpn', NULL, 'web_fcm', FALSE, '{}'::jsonb),
  ('Mahar Shwe VPN', 'mahar_shwe_vpn', 'android', NULL, 'com.maharshwe.vpn', 'maharshweonlinevpn', 'maharshwe-vpn', 'topic_fcm', TRUE, '{"androidAppId":"1:648689584934:android:d12e28d3c2d6c54132cfe7"}'::jsonb),
  ('Facebook Video Downloader', 'facebook_video_downloader', 'android', NULL, 'com.maharshwe.videodownloader', 'maharshweonlinevpn', NULL, 'android_fcm_or_future', FALSE, '{"androidAppId":"1:648689584934:android:72865b27b54897f932cfe7"}'::jsonb)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "type" = EXCLUDED."type",
  "domain" = EXCLUDED."domain",
  "package_name" = EXCLUDED."package_name",
  "firebase_project" = EXCLUDED."firebase_project",
  "topic" = EXCLUDED."topic",
  "push_type" = EXCLUDED."push_type",
  "ads_api_enabled" = EXCLUDED."ads_api_enabled",
  "metadata" = EXCLUDED."metadata",
  "updated_at" = NOW();

CREATE TABLE IF NOT EXISTS "admin_push_campaigns" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "product_slug" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "url" TEXT,
  "topic" TEXT,
  "provider" TEXT NOT NULL DEFAULT 'firebase',
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "response_json" JSONB,
  "created_by" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "sent_at" TIMESTAMPTZ(6)
);

CREATE INDEX IF NOT EXISTS "admin_push_campaigns_product_created_idx"
  ON "admin_push_campaigns"("product_slug", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "admin_push_campaigns_status_created_idx"
  ON "admin_push_campaigns"("status", "created_at" DESC);

CREATE TABLE IF NOT EXISTS "admin_ads_history" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "product_slug" TEXT NOT NULL,
  "ads_type" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL,
  "title" TEXT,
  "message" TEXT,
  "image_url" TEXT,
  "video_url" TEXT,
  "media_type" TEXT NOT NULL DEFAULT 'auto',
  "click_url" TEXT,
  "cta" TEXT,
  "background_color" TEXT,
  "text_color" TEXT,
  "response_json" JSONB,
  "created_by" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "admin_ads_history_product_created_idx"
  ON "admin_ads_history"("product_slug", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "admin_ads_history_type_created_idx"
  ON "admin_ads_history"("ads_type", "created_at" DESC);

CREATE TABLE IF NOT EXISTS "admin_audit_logs" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "admin_user_id" UUID,
  "action" TEXT NOT NULL,
  "resource_type" TEXT NOT NULL,
  "resource_id" TEXT,
  "metadata_json" JSONB,
  "ip_address" TEXT,
  "user_agent" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "admin_audit_logs_user_created_idx"
  ON "admin_audit_logs"("admin_user_id", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "admin_audit_logs_action_created_idx"
  ON "admin_audit_logs"("action", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "admin_audit_logs_resource_created_idx"
  ON "admin_audit_logs"("resource_type", "created_at" DESC);

CREATE TABLE IF NOT EXISTS "admin_user_roles" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "role" TEXT NOT NULL,
  "permissions" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "active" BOOLEAN NOT NULL DEFAULT TRUE,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  CONSTRAINT "admin_user_roles_user_role_key" UNIQUE ("user_id", "role")
);

CREATE INDEX IF NOT EXISTS "admin_user_roles_user_active_idx"
  ON "admin_user_roles"("user_id", "active");

CREATE INDEX IF NOT EXISTS "admin_user_roles_role_active_idx"
  ON "admin_user_roles"("role", "active");
