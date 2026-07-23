ALTER TABLE "ecommerce_orders"
  ADD COLUMN IF NOT EXISTS "customer_id" UUID,
  ADD COLUMN IF NOT EXISTS "idempotency_key" TEXT;

CREATE TABLE IF NOT EXISTS "ecommerce_customers" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "shop_id" UUID NOT NULL REFERENCES "shops"("id") ON DELETE CASCADE,
  "telegram_user_id" TEXT NOT NULL,
  "telegram_chat_id" TEXT,
  "telegram_username" TEXT,
  "telegram_first_name" TEXT NOT NULL,
  "telegram_last_name" TEXT,
  "telegram_photo_url" TEXT,
  "language_code" TEXT,
  "phone" TEXT,
  "notification_consent" BOOLEAN NOT NULL DEFAULT TRUE,
  "telegram_connected_at" TIMESTAMPTZ,
  "last_login_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "last_order_at" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "ecommerce_customers_shop_telegram_key" UNIQUE ("shop_id", "telegram_user_id")
);

CREATE TABLE IF NOT EXISTS "ecommerce_customer_sessions" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "customer_id" UUID NOT NULL REFERENCES "ecommerce_customers"("id") ON DELETE CASCADE,
  "session_token_hash" TEXT NOT NULL UNIQUE,
  "expires_at" TIMESTAMPTZ NOT NULL,
  "revoked_at" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "ecommerce_customer_addresses" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "customer_id" UUID NOT NULL REFERENCES "ecommerce_customers"("id") ON DELETE CASCADE,
  "recipient_name" TEXT NOT NULL,
  "phone" TEXT NOT NULL,
  "address_line" TEXT NOT NULL,
  "township" TEXT,
  "city" TEXT,
  "note" TEXT,
  "is_default" BOOLEAN NOT NULL DEFAULT FALSE,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "ecommerce_customer_favourites" (
  "customer_id" UUID NOT NULL REFERENCES "ecommerce_customers"("id") ON DELETE CASCADE,
  "product_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY ("customer_id", "product_id")
);

CREATE TABLE IF NOT EXISTS "ecommerce_carts" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "shop_id" UUID NOT NULL REFERENCES "shops"("id") ON DELETE CASCADE,
  "customer_id" UUID REFERENCES "ecommerce_customers"("id") ON DELETE CASCADE,
  "guest_session_id" TEXT,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "ecommerce_cart_items" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "cart_id" UUID NOT NULL REFERENCES "ecommerce_carts"("id") ON DELETE CASCADE,
  "product_id" UUID NOT NULL,
  "product_variant_id" UUID,
  "quantity" INTEGER NOT NULL,
  "unit_price_snapshot" DECIMAL(14,2) NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "ecommerce_cart_items_cart_variant_key" UNIQUE ("cart_id", "product_variant_id")
);

CREATE TABLE IF NOT EXISTS "ecommerce_telegram_connection_tokens" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "customer_id" UUID NOT NULL,
  "shop_id" UUID NOT NULL,
  "token_hash" TEXT NOT NULL UNIQUE,
  "expires_at" TIMESTAMPTZ NOT NULL,
  "used_at" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS "ecommerce_orders_shop_idempotency_key"
  ON "ecommerce_orders"("shop_id", "idempotency_key") WHERE "idempotency_key" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "ecommerce_customer_sessions_customer_expires_idx" ON "ecommerce_customer_sessions"("customer_id", "expires_at");
CREATE INDEX IF NOT EXISTS "ecommerce_customer_addresses_customer_default_idx" ON "ecommerce_customer_addresses"("customer_id", "is_default");
CREATE INDEX IF NOT EXISTS "ecommerce_carts_shop_customer_status_idx" ON "ecommerce_carts"("shop_id", "customer_id", "status");
CREATE INDEX IF NOT EXISTS "ecommerce_carts_shop_guest_status_idx" ON "ecommerce_carts"("shop_id", "guest_session_id", "status");
CREATE INDEX IF NOT EXISTS "ecommerce_telegram_tokens_customer_expires_idx" ON "ecommerce_telegram_connection_tokens"("customer_id", "expires_at");

DO $$ BEGIN
  ALTER TABLE "ecommerce_orders" ADD CONSTRAINT "ecommerce_orders_customer_id_fkey"
    FOREIGN KEY ("customer_id") REFERENCES "ecommerce_customers"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
