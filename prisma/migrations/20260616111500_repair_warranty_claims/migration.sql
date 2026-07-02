CREATE TABLE IF NOT EXISTS repair_warranty_claims (
  id UUID PRIMARY KEY,
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  repair_id UUID NOT NULL REFERENCES repairs(id) ON DELETE CASCADE,
  claim_number TEXT NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN',
  created_by_id UUID REFERENCES users(id) ON DELETE SET NULL,
  resolved_by_id UUID REFERENCES users(id) ON DELETE SET NULL,
  resolution TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (shop_id, claim_number)
);

CREATE INDEX IF NOT EXISTS repair_warranty_claims_repair_idx
  ON repair_warranty_claims(shop_id, repair_id, created_at DESC);
