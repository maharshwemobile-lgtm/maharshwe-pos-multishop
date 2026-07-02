CREATE UNIQUE INDEX IF NOT EXISTS "users_email_key"
  ON "users" ("email");

CREATE UNIQUE INDEX IF NOT EXISTS "users_auth_provider_provider_id_key"
  ON "users" ("auth_provider", "provider_id");
