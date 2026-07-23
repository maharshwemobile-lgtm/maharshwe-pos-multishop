ALTER TABLE "business_other_income"
  ADD COLUMN IF NOT EXISTS "voided_at" TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "void_reason" TEXT,
  ADD COLUMN IF NOT EXISTS "voided_by_id" UUID;

ALTER TABLE "business_expenses"
  ADD COLUMN IF NOT EXISTS "voided_at" TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "void_reason" TEXT,
  ADD COLUMN IF NOT EXISTS "voided_by_id" UUID;

DO $$ BEGIN
  ALTER TABLE "business_other_income"
    ADD CONSTRAINT "business_other_income_voided_by_id_fkey"
    FOREIGN KEY ("voided_by_id") REFERENCES "users"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "business_expenses"
    ADD CONSTRAINT "business_expenses_voided_by_id_fkey"
    FOREIGN KEY ("voided_by_id") REFERENCES "users"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
