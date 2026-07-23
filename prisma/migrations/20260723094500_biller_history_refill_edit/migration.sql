ALTER TABLE "biller_transactions"
  ADD COLUMN IF NOT EXISTS "created_by_id" UUID,
  ADD COLUMN IF NOT EXISTS "edited_at" TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "edit_reason" TEXT,
  ADD COLUMN IF NOT EXISTS "edited_by_id" UUID;

DO $$ BEGIN
  ALTER TABLE "biller_transactions"
    ADD CONSTRAINT "biller_transactions_created_by_id_fkey"
    FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "biller_transactions"
    ADD CONSTRAINT "biller_transactions_edited_by_id_fkey"
    FOREIGN KEY ("edited_by_id") REFERENCES "users"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
