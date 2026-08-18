// Game Top-up: schema bootstrap.
//
// This feature is platform-level, not shop-level — one MooGold account
// (game_topup_products/variations) is shared across every shop, the same way
// tac_devices in imei-lookup-api.js is a shared cache rather than per-shop
// data. Each shop only owns a wallet: prepaid credit with the platform that
// gets debited per order and topped up manually by the Super Admin after an
// off-platform payment (KBZ Pay, same pattern as the VPN reseller flow).
const { prisma } = require('./prisma');

let schemaPromise;

const statements = [
  `CREATE TABLE IF NOT EXISTS game_topup_products (
    id UUID PRIMARY KEY,
    moogold_product_id TEXT NOT NULL,
    moogold_category_id TEXT,
    name TEXT NOT NULL,
    image_url TEXT,
    requires_player_id BOOLEAN NOT NULL DEFAULT TRUE,
    requires_server BOOLEAN NOT NULL DEFAULT FALSE,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (moogold_product_id)
  )`,
  `CREATE TABLE IF NOT EXISTS game_topup_variations (
    id UUID PRIMARY KEY,
    product_id UUID NOT NULL REFERENCES game_topup_products(id) ON DELETE CASCADE,
    moogold_variation_id TEXT NOT NULL,
    name TEXT NOT NULL,
    moogold_price NUMERIC(14,2) NOT NULL DEFAULT 0,
    shop_cost NUMERIC(14,2) NOT NULL DEFAULT 0,
    suggested_retail NUMERIC(14,2) NOT NULL DEFAULT 0,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (product_id, moogold_variation_id)
  )`,
  `CREATE TABLE IF NOT EXISTS game_topup_wallets (
    shop_id UUID PRIMARY KEY REFERENCES shops(id) ON DELETE CASCADE,
    balance NUMERIC(14,2) NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS game_topup_wallet_ledger (
    id UUID PRIMARY KEY,
    shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    amount NUMERIC(14,2) NOT NULL,
    balance_after NUMERIC(14,2) NOT NULL,
    note TEXT,
    reference_id UUID,
    created_by_id UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS game_topup_orders (
    id UUID PRIMARY KEY,
    order_number TEXT NOT NULL,
    shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
    variation_id UUID NOT NULL REFERENCES game_topup_variations(id),
    quantity INTEGER NOT NULL DEFAULT 1,
    player_id TEXT,
    server_id TEXT,
    customer_name TEXT,
    customer_phone TEXT,
    shop_cost NUMERIC(14,2) NOT NULL,
    retail_price NUMERIC(14,2) NOT NULL,
    profit NUMERIC(14,2) NOT NULL,
    payment_account_id UUID REFERENCES money_accounts(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'PENDING',
    moogold_order_id TEXT,
    moogold_response JSONB,
    failure_reason TEXT,
    created_by_id UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (shop_id, order_number)
  )`,
  `CREATE INDEX IF NOT EXISTS game_topup_orders_shop_idx ON game_topup_orders (shop_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS game_topup_wallet_ledger_shop_idx ON game_topup_wallet_ledger (shop_id, created_at DESC)`,
];

async function ensureGameTopupSchema() {
  if (!schemaPromise) {
    schemaPromise = prisma.$transaction(async (tx) => {
      for (const statement of statements) await tx.$executeRawUnsafe(statement);
      return true;
    }, { maxWait: 5000, timeout: 30000 }).catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  return schemaPromise;
}

module.exports = { ensureGameTopupSchema };
