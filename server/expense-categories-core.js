const crypto = require('crypto');
const { prisma } = require('./prisma');

const DEFAULT_CATEGORIES = [
  'Electricity',
  'Transport',
  'Rent',
  'Salary',
  'Food',
  'Internet',
  'Repair Parts',
  'Office Supplies',
  'Other',
];

let schemaPromise;

async function ensureExpenseCategoriesSchema() {
  if (!schemaPromise) {
    schemaPromise = prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS business_expense_categories (
        id UUID PRIMARY KEY,
        shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        active BOOLEAN NOT NULL DEFAULT TRUE,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_by_id UUID REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
      await tx.$executeRawUnsafe('CREATE UNIQUE INDEX IF NOT EXISTS business_expense_categories_shop_name_unique ON business_expense_categories(shop_id,LOWER(name))');
      await tx.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS business_expense_categories_shop_active_idx ON business_expense_categories(shop_id,active,sort_order,name)');
      return true;
    }, { maxWait: 5000, timeout: 20000 }).catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  return schemaPromise;
}

async function ensureDefaultExpenseCategories(shopId, userId) {
  const rows = await prisma.$queryRawUnsafe(
    'SELECT COUNT(*)::int AS count FROM business_expense_categories WHERE shop_id=$1::uuid',
    shopId,
  );
  if (Number(rows[0]?.count || 0) > 0) return;

  for (let index = 0; index < DEFAULT_CATEGORIES.length; index += 1) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO business_expense_categories(id,shop_id,name,active,sort_order,created_by_id,created_at,updated_at)
       VALUES($1::uuid,$2::uuid,$3,TRUE,$4,$5::uuid,NOW(),NOW())
       ON CONFLICT DO NOTHING`,
      crypto.randomUUID(),
      shopId,
      DEFAULT_CATEGORIES[index],
      index + 1,
      userId || null,
    );
  }
}

module.exports = {
  DEFAULT_CATEGORIES,
  ensureDefaultExpenseCategories,
  ensureExpenseCategoriesSchema,
};
