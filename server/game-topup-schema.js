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

  // A second, separate order table for the public consumer storefront — no
  // shop, no wallet. The platform sells directly and is paid directly (a P2P
  // KBZ Pay transfer with a self-reported transaction id), which is a
  // fundamentally different trust model from the shop-cashier flow above:
  // every row here starts PENDING_APPROVAL and only moves once a human admin
  // has eyeballed the real KBZ Pay transaction history and approved it.
  `CREATE TABLE IF NOT EXISTS game_topup_public_orders (
    id UUID PRIMARY KEY,
    order_number TEXT NOT NULL UNIQUE,
    variation_id UUID NOT NULL REFERENCES game_topup_variations(id),
    quantity INTEGER NOT NULL DEFAULT 1,
    player_id TEXT,
    server_id TEXT,
    customer_name TEXT,
    customer_phone TEXT NOT NULL,
    retail_price NUMERIC(14,2) NOT NULL,
    payment_method TEXT NOT NULL DEFAULT 'KBZ_PAY',
    payment_transaction_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING_APPROVAL',
    reject_reason TEXT,
    moogold_order_id TEXT,
    moogold_response JSONB,
    failure_reason TEXT,
    share_key_hash TEXT NOT NULL,
    telegram_chat_id TEXT,
    telegram_message_id TEXT,
    reviewed_by_id UUID REFERENCES users(id) ON DELETE SET NULL,
    reviewed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS game_topup_public_orders_status_idx ON game_topup_public_orders (status, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS game_topup_public_orders_txn_idx ON game_topup_public_orders (payment_transaction_id)`,

  `ALTER TABLE game_topup_products ADD COLUMN IF NOT EXISTS player_field TEXT NOT NULL DEFAULT 'User ID'`,
  `ALTER TABLE game_topup_products ADD COLUMN IF NOT EXISTS server_field TEXT NOT NULL DEFAULT 'Server ID'`,

  // Single-row settings a Grand Admin can change without a deploy. MooGold
  // prices everything in USD; this is what a sync converts to MMK for a
  // package's shop_cost/suggested_retail default, and what the platform's
  // own wallet top-ups are priced against.
  `CREATE TABLE IF NOT EXISTS game_topup_settings (
    id BOOLEAN PRIMARY KEY DEFAULT TRUE,
    usd_to_mmk_rate NUMERIC(14,2) NOT NULL DEFAULT 4500,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT game_topup_settings_singleton CHECK (id)
  )`,
  `INSERT INTO game_topup_settings (id) VALUES (TRUE) ON CONFLICT (id) DO NOTHING`,

  // A REFUNDED public order is money MooGold gave back to the platform that
  // an admin still owes the customer over KBZ Pay — that transfer happens
  // outside this system, so these two columns are the record that it was
  // actually done, and by whom.
  `ALTER TABLE game_topup_public_orders ADD COLUMN IF NOT EXISTS refund_sent_at TIMESTAMPTZ`,
  `ALTER TABLE game_topup_public_orders ADD COLUMN IF NOT EXISTS refund_sent_by_id UUID REFERENCES users(id) ON DELETE SET NULL`,
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
