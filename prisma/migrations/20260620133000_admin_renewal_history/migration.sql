-- Phase: Admin renewal history
-- Records POS tenant renewals for the central admin portal without changing
-- existing subscription or tenant data.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS "admin_renewal_history" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "product_slug" TEXT NOT NULL DEFAULT 'mahar_pos_web',
  "shop_id" UUID NOT NULL,
  "tenant_id" TEXT,
  "shop_name" TEXT,
  "subscription_id" UUID,
  "plan" TEXT,
  "months" INTEGER,
  "custom_days" INTEGER,
  "duration_label" TEXT,
  "previous_ends_at" TIMESTAMPTZ(6),
  "starts_at" TIMESTAMPTZ(6),
  "new_ends_at" TIMESTAMPTZ(6) NOT NULL,
  "note" TEXT,
  "renewed_by" UUID,
  "metadata_json" JSONB,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "admin_renewal_history_product_created_idx"
  ON "admin_renewal_history"("product_slug", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "admin_renewal_history_shop_created_idx"
  ON "admin_renewal_history"("shop_id", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "admin_renewal_history_renewed_by_created_idx"
  ON "admin_renewal_history"("renewed_by", "created_at" DESC);
