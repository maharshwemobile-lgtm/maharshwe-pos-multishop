ALTER TABLE "shops"
  ADD COLUMN IF NOT EXISTS "business_type" TEXT NOT NULL DEFAULT 'PHONE_SHOP';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'shops_business_type_check'
  ) THEN
    ALTER TABLE "shops"
      ADD CONSTRAINT "shops_business_type_check"
      CHECK ("business_type" IN ('PHONE_SHOP', 'MINI_MART'));
  END IF;
END $$;
