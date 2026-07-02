ALTER TABLE "product_variants" ADD COLUMN IF NOT EXISTS "unit" TEXT;
ALTER TABLE "product_variants" ADD COLUMN IF NOT EXISTS "wholesale_price" DECIMAL(14, 2) NOT NULL DEFAULT 0;
ALTER TABLE "product_variants" ADD COLUMN IF NOT EXISTS "expiry_date" DATE;

CREATE INDEX IF NOT EXISTS "product_variants_shop_id_expiry_date_idx"
ON "product_variants"("shop_id", "expiry_date");
