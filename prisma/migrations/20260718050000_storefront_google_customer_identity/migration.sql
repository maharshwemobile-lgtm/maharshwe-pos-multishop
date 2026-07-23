ALTER TABLE "ecommerce_customers"
  ALTER COLUMN "telegram_user_id" DROP NOT NULL,
  ALTER COLUMN "telegram_first_name" DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS "google_subject" TEXT,
  ADD COLUMN IF NOT EXISTS "email" TEXT,
  ADD COLUMN IF NOT EXISTS "display_name" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "ecommerce_customers_shop_google_subject_key"
  ON "ecommerce_customers"("shop_id", "google_subject")
  WHERE "google_subject" IS NOT NULL;
