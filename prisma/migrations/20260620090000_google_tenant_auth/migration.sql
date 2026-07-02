ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "email" TEXT,
  ADD COLUMN IF NOT EXISTS "avatar_url" TEXT,
  ADD COLUMN IF NOT EXISTS "auth_provider" TEXT,
  ADD COLUMN IF NOT EXISTS "provider_id" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "users_email_key"
  ON "users"("email");

CREATE UNIQUE INDEX IF NOT EXISTS "users_auth_provider_provider_id_key"
  ON "users"("auth_provider", "provider_id");
