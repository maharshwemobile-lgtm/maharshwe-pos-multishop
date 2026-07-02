const crypto = require('crypto');
const { z } = require('zod');
const { prisma } = require('./prisma');
const { requireAuth, requireShopUser, requireWritableSubscription } = require('./auth-api');

const uuid = z.string().uuid();
const paymentMethodSchema = z.object({
  name: z.string().trim().min(1).max(80),
  code: z.string().trim().min(1).max(40).transform((value) => value.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '')),
  kind: z.enum(['CASH', 'WALLET', 'BANK', 'OTHER']).default('WALLET'),
  supportsMoneyService: z.boolean().default(true),
  openingBalance: z.coerce.number().min(0).max(100000000000).default(0),
});
const paymentMethodUpdateSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  active: z.boolean().optional(),
  supportsMoneyService: z.boolean().optional(),
  sortOrder: z.coerce.number().int().min(0).max(10000).optional(),
}).refine((value) => Object.keys(value).length > 0, { message: 'At least one field is required' });
const categorySchema = z.object({ name: z.string().trim().min(1).max(80) });
const categoryUpdateSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  active: z.boolean().optional(),
  sortOrder: z.coerce.number().int().min(0).max(10000).optional(),
}).refine((value) => Object.keys(value).length > 0, { message: 'At least one field is required' });

let schemaPromise;

function parse(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) {
    const error = new Error('Invalid finance settings request');
    error.status = 400;
    error.details = result.error.flatten().fieldErrors;
    throw error;
  }
  return result.data;
}

function requireManager(req, res, next) {
  if (req.auth?.role === 'SUPER_ADMIN' || req.auth?.role === 'SHOP_ADMIN') return next();
  return res.status(403).json({ ok: false, message: 'Shop Admin permission is required' });
}

function field(row, ...names) {
  for (const name of names) {
    if (row?.[name] !== undefined) return row[name];
  }
  return undefined;
}

function paymentMethodJson(row) {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    kind: row.kind,
    accountId: field(row, 'accountId', 'accountid') || null,
    supportsMoneyService: field(row, 'supportsMoneyService', 'supportsmoneyservice') !== false,
    active: row.active !== false,
    sortOrder: Number(field(row, 'sortOrder', 'sortorder') || 0),
    balance: Number(row.balance || 0),
    accountType: field(row, 'accountType', 'accounttype') || null,
  };
}

async function ensureSchema() {
  if (!schemaPromise) {
    schemaPromise = prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS finance_payment_methods (
        id UUID PRIMARY KEY,shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,name TEXT NOT NULL,code TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'WALLET',account_id UUID REFERENCES money_accounts(id) ON DELETE SET NULL,
        supports_money_service BOOLEAN NOT NULL DEFAULT TRUE,active BOOLEAN NOT NULL DEFAULT TRUE,sort_order INTEGER NOT NULL DEFAULT 0,
        created_by_id UUID REFERENCES users(id) ON DELETE SET NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
      await tx.$executeRawUnsafe('CREATE UNIQUE INDEX IF NOT EXISTS finance_payment_methods_shop_code_unique ON finance_payment_methods(shop_id,LOWER(code))');
      await tx.$executeRawUnsafe('CREATE UNIQUE INDEX IF NOT EXISTS finance_payment_methods_shop_name_unique ON finance_payment_methods(shop_id,LOWER(name))');
      await tx.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS business_income_categories (
        id UUID PRIMARY KEY,shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,name TEXT NOT NULL,active BOOLEAN NOT NULL DEFAULT TRUE,
        sort_order INTEGER NOT NULL DEFAULT 0,created_by_id UUID REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
      await tx.$executeRawUnsafe('CREATE UNIQUE INDEX IF NOT EXISTS business_income_categories_shop_name_unique ON business_income_categories(shop_id,LOWER(name))');
      return true;
    }).catch((error) => { schemaPromise = null; throw error; });
  }
  return schemaPromise;
}

async function audit(req, action, entityType, entityId, details) {
  await prisma.auditLog.create({
    data: { shopId: req.auth.shopId, userId: req.auth.userId, action, entityType, entityId, details, ipAddress: req.ip || null, userAgent: req.headers['user-agent'] || null },
  }).catch(() => {});
}

function accountTypeFor(kind, code) {
  const normalized = String(code || '').toUpperCase();
  if (kind === 'CASH') return 'CASH';
  if (normalized === 'KPAY' || normalized === 'KBZPAY' || normalized === 'KBZ_PAY') return 'KPAY';
  if (normalized === 'WAVE_PAY' || normalized === 'WAVEPAY') return 'WAVE_PAY';
  return 'OTHER';
}

function duplicate(error) {
  return /duplicate key|unique constraint/i.test(String(error?.message || ''));
}

function noStore(res) {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
}

function attachFinanceSettingsV23Api(app) {
  const read = [requireAuth, requireShopUser];
  const write = [requireAuth, requireShopUser, requireWritableSubscription, requireManager];

  app.get('/api/finance/settings/catalogs', ...read, async (req, res) => {
    try {
      noStore(res);
      await ensureSchema();
      const [methods, incomes, expenses] = await Promise.all([
        prisma.$queryRawUnsafe(`SELECT m.id,m.name,m.code,m.kind,m.account_id AS "accountId",m.supports_money_service AS "supportsMoneyService",m.active,m.sort_order AS "sortOrder",a.balance,a.type AS "accountType"
          FROM finance_payment_methods m LEFT JOIN money_accounts a ON a.id=m.account_id WHERE m.shop_id=$1::uuid ORDER BY m.active DESC,m.sort_order,LOWER(m.name)`, req.auth.shopId),
        prisma.$queryRawUnsafe(`SELECT id,name,active,sort_order AS "sortOrder" FROM business_income_categories WHERE shop_id=$1::uuid ORDER BY active DESC,sort_order,LOWER(name)`, req.auth.shopId),
        prisma.$queryRawUnsafe(`SELECT id,name,active,sort_order AS "sortOrder" FROM business_expense_categories WHERE shop_id=$1::uuid ORDER BY active DESC,sort_order,LOWER(name)`, req.auth.shopId).catch(() => []),
      ]);
      return res.json({ ok: true, paymentMethods: methods.map(paymentMethodJson), incomeCategories: incomes, expenseCategories: expenses });
    } catch (error) {
      return res.status(500).json({ ok: false, message: error.message || 'Finance settings load failed' });
    }
  });

  app.post('/api/finance/settings/payment-methods', ...write, async (req, res) => {
    try {
      await ensureSchema();
      const input = parse(paymentMethodSchema, req.body || {});
      const result = await prisma.$transaction(async (tx) => {
        const account = await tx.moneyAccount.create({ data: { shopId: req.auth.shopId, name: input.name, type: accountTypeFor(input.kind, input.code), balance: input.openingBalance, active: true } });
        const id = crypto.randomUUID();
        const rows = await tx.$queryRawUnsafe(`INSERT INTO finance_payment_methods(id,shop_id,name,code,kind,account_id,supports_money_service,active,sort_order,created_by_id,created_at,updated_at)
          VALUES($1::uuid,$2::uuid,$3,$4,$5,$6::uuid,$7,TRUE,COALESCE((SELECT MAX(sort_order)+1 FROM finance_payment_methods WHERE shop_id=$2::uuid),1),$8::uuid,NOW(),NOW())
          RETURNING id,name,code,kind,account_id AS "accountId",supports_money_service AS "supportsMoneyService",active,sort_order AS "sortOrder"`,
          id, req.auth.shopId, input.name, input.code, input.kind, account.id, input.supportsMoneyService, req.auth.userId);
        return paymentMethodJson({ ...rows[0], balance: Number(account.balance || 0), accountType: account.type });
      });
      await audit(req, 'FINANCE_PAYMENT_METHOD_CREATED', 'finance_payment_method', result.id, { name: result.name, code: result.code, kind: result.kind });
      return res.status(201).json({ ok: true, paymentMethod: result, message: 'Payment method added' });
    } catch (error) {
      if (duplicate(error)) return res.status(409).json({ ok: false, message: 'Payment method name or code already exists' });
      return res.status(error.status || 500).json({ ok: false, message: error.message || 'Payment method add failed', details: error.details });
    }
  });

  app.patch('/api/finance/settings/payment-methods/:id', ...write, async (req, res) => {
    try {
      await ensureSchema();
      const id = parse(uuid, req.params.id);
      const input = parse(paymentMethodUpdateSchema, req.body || {});
      const existing = await prisma.$queryRawUnsafe('SELECT * FROM finance_payment_methods WHERE id=$1::uuid AND shop_id=$2::uuid LIMIT 1', id, req.auth.shopId);
      if (!existing[0]) return res.status(404).json({ ok: false, message: 'Payment method not found' });
      const rows = await prisma.$queryRawUnsafe(`UPDATE finance_payment_methods SET name=$3,active=$4,supports_money_service=$5,sort_order=$6,updated_at=NOW()
        WHERE id=$1::uuid AND shop_id=$2::uuid RETURNING id,name,code,kind,account_id AS "accountId",supports_money_service AS "supportsMoneyService",active,sort_order AS "sortOrder"`,
        id, req.auth.shopId, input.name ?? existing[0].name, input.active ?? existing[0].active, input.supportsMoneyService ?? existing[0].supports_money_service, input.sortOrder ?? existing[0].sort_order);
      if (input.name && existing[0].account_id) await prisma.moneyAccount.update({ where: { id: existing[0].account_id }, data: { name: input.name } }).catch(() => {});
      if (input.supportsMoneyService === true && existing[0].account_id) await prisma.moneyAccount.update({ where: { id: existing[0].account_id }, data: { active: true } }).catch(() => {});
      await audit(req, 'FINANCE_PAYMENT_METHOD_UPDATED', 'finance_payment_method', id, { before: existing[0], after: rows[0] });
      return res.json({ ok: true, paymentMethod: paymentMethodJson(rows[0]), message: 'Payment method updated' });
    } catch (error) {
      if (duplicate(error)) return res.status(409).json({ ok: false, message: 'Payment method name already exists' });
      return res.status(error.status || 500).json({ ok: false, message: error.message || 'Payment method update failed', details: error.details });
    }
  });

  app.delete('/api/finance/settings/payment-methods/:id', ...write, async (req, res) => {
    try {
      const id = parse(uuid, req.params.id);
      const rows = await prisma.$queryRawUnsafe(`UPDATE finance_payment_methods SET active=FALSE,updated_at=NOW() WHERE id=$1::uuid AND shop_id=$2::uuid AND active=TRUE RETURNING id,name,account_id AS "accountId"`, id, req.auth.shopId);
      if (!rows[0]) return res.status(404).json({ ok: false, message: 'Payment method not found or already hidden' });
      await audit(req, 'FINANCE_PAYMENT_METHOD_ARCHIVED', 'finance_payment_method', id, { name: rows[0].name });
      return res.json({ ok: true, message: 'Payment method hidden from future selection' });
    } catch (error) {
      return res.status(error.status || 500).json({ ok: false, message: error.message || 'Payment method remove failed' });
    }
  });

  app.post('/api/business-control/income-categories', ...write, async (req, res) => {
    try {
      await ensureSchema();
      const input = parse(categorySchema, req.body || {});
      const id = crypto.randomUUID();
      const rows = await prisma.$queryRawUnsafe(`INSERT INTO business_income_categories(id,shop_id,name,active,sort_order,created_by_id,created_at,updated_at)
        VALUES($1::uuid,$2::uuid,$3,TRUE,COALESCE((SELECT MAX(sort_order)+1 FROM business_income_categories WHERE shop_id=$2::uuid),1),$4::uuid,NOW(),NOW())
        RETURNING id,name,active,sort_order AS "sortOrder"`, id, req.auth.shopId, input.name, req.auth.userId);
      await audit(req, 'INCOME_CATEGORY_CREATED', 'business_income_category', id, { name: input.name });
      return res.status(201).json({ ok: true, category: rows[0], message: 'Income category added' });
    } catch (error) {
      if (duplicate(error)) return res.status(409).json({ ok: false, message: 'Income category already exists' });
      return res.status(error.status || 500).json({ ok: false, message: error.message || 'Income category add failed', details: error.details });
    }
  });

  app.patch('/api/business-control/income-categories/:id', ...write, async (req, res) => {
    try {
      const id = parse(uuid, req.params.id);
      const input = parse(categoryUpdateSchema, req.body || {});
      const existing = await prisma.$queryRawUnsafe('SELECT * FROM business_income_categories WHERE id=$1::uuid AND shop_id=$2::uuid LIMIT 1', id, req.auth.shopId);
      if (!existing[0]) return res.status(404).json({ ok: false, message: 'Income category not found' });
      const rows = await prisma.$queryRawUnsafe(`UPDATE business_income_categories SET name=$3,active=$4,sort_order=$5,updated_at=NOW() WHERE id=$1::uuid AND shop_id=$2::uuid
        RETURNING id,name,active,sort_order AS "sortOrder"`, id, req.auth.shopId, input.name ?? existing[0].name, input.active ?? existing[0].active, input.sortOrder ?? existing[0].sort_order);
      await audit(req, 'INCOME_CATEGORY_UPDATED', 'business_income_category', id, { before: existing[0], after: rows[0] });
      return res.json({ ok: true, category: rows[0], message: 'Income category updated' });
    } catch (error) {
      if (duplicate(error)) return res.status(409).json({ ok: false, message: 'Income category already exists' });
      return res.status(error.status || 500).json({ ok: false, message: error.message || 'Income category update failed', details: error.details });
    }
  });

  app.delete('/api/business-control/income-categories/:id', ...write, async (req, res) => {
    try {
      const id = parse(uuid, req.params.id);
      const rows = await prisma.$queryRawUnsafe(`UPDATE business_income_categories SET active=FALSE,updated_at=NOW() WHERE id=$1::uuid AND shop_id=$2::uuid AND active=TRUE RETURNING id,name`, id, req.auth.shopId);
      if (!rows[0]) return res.status(404).json({ ok: false, message: 'Income category not found or already hidden' });
      await audit(req, 'INCOME_CATEGORY_ARCHIVED', 'business_income_category', id, { name: rows[0].name });
      return res.json({ ok: true, message: 'Income category hidden from future selection' });
    } catch (error) {
      return res.status(error.status || 500).json({ ok: false, message: error.message || 'Income category remove failed' });
    }
  });
}

module.exports = { attachFinanceSettingsV23Api, ensureSchema };
