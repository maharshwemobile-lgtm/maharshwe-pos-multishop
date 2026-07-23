ALTER TABLE "money_service_transactions_v2"
  ADD COLUMN IF NOT EXISTS "voided_at" TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "void_reason" TEXT,
  ADD COLUMN IF NOT EXISTS "voided_by_id" UUID;

DO $$ BEGIN
  ALTER TABLE "money_service_transactions_v2"
    ADD CONSTRAINT "money_service_transactions_v2_voided_by_id_fkey"
    FOREIGN KEY ("voided_by_id") REFERENCES "users"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "money_service_v2_shop_voided_date_idx"
  ON "money_service_transactions_v2"("shop_id", "voided_at", "created_at" DESC);
