const crypto = require('crypto');
const { z } = require('zod');
const { prisma } = require('./prisma');
const { requireAuth, requireShopUser, requireWritableSubscription } = require('./auth-api');
const { ensureDefaultExpenseCategories, ensureExpenseCategoriesSchema } = require('./expense-categories-core');

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

const DEFAULT_INCOME_CATEGORIES = [
  'အခြား Service ဝင်ငွေ',
  'အခြား အရောင်းပိုင် ဝင်ငွေ',
  'အခြား ငွေဖြည့်ကဒ် ဝင်ငွေ',
  'အခြား အခြား ဝင်ငွေ',
];

async function ensureDefaultIncomeCategories(shopId, userId) {
  const existing = await prisma.businessIncomeCategories.findMany({
    where: { shopId },
    select: { name: true },
  });
  const have = new Set(existing.map((row) => row.name.toLowerCase()));
  const missing = DEFAULT_INCOME_CATEGORIES
    .map((name, index) => ({ name, sortOrder: index + 1 }))
    .filter((row) => !have.has(row.name.toLowerCase()));
  if (!missing.length) return;
  await prisma.businessIncomeCategories.createMany({
    data: missing.map((row) => ({
      id: crypto.randomUUID(),
      shopId,
      name: row.name,
      active: true,
      sortOrder: row.sortOrder,
      createdById: userId || null,
    })),
    skipDuplicates: true,
  });
}

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
      await ensureExpenseCategoriesSchema();
      await ensureDefaultIncomeCategories(req.auth.shopId, req.auth.userId);
      await ensureDefaultExpenseCategories(req.auth.shopId, req.auth.userId);
      const categoryOrder = [{ active: 'desc' }, { sortOrder: 'asc' }, { name: 'asc' }];
      const [methodRows, incomes, expenses] = await Promise.all([
        prisma.financePaymentMethods.findMany({
          where: { shopId: req.auth.shopId },
          orderBy: [{ active: 'desc' }, { sortOrder: 'asc' }, { name: 'asc' }],
        }),
        prisma.businessIncomeCategories.findMany({
          where: { shopId: req.auth.shopId },
          select: { id: true, name: true, active: true, sortOrder: true },
          orderBy: categoryOrder,
        }),
        prisma.businessExpenseCategories.findMany({
          where: { shopId: req.auth.shopId },
          select: { id: true, name: true, active: true, sortOrder: true },
          orderBy: categoryOrder,
        }).catch(() => []),
      ]);
      // the account balance and type used to come from a LEFT JOIN
      const accounts = await prisma.moneyAccount.findMany({
        where: { id: { in: methodRows.map((row) => row.accountId).filter(Boolean) } },
        select: { id: true, balance: true, type: true },
      });
      const accountById = new Map(accounts.map((account) => [account.id, account]));
      const methods = methodRows.map((row) => ({
        ...row,
        balance: accountById.get(row.accountId)?.balance || 0,
        accountType: accountById.get(row.accountId)?.type || null,
      }));
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
        const last = await tx.financePaymentMethods.findFirst({
          where: { shopId: req.auth.shopId },
          orderBy: { sortOrder: 'desc' },
          select: { sortOrder: true },
        });
        const created = await tx.financePaymentMethods.create({
          data: {
            id,
            shopId: req.auth.shopId,
            name: input.name,
            code: input.code,
            kind: input.kind,
            accountId: account.id,
            supportsMoneyService: input.supportsMoneyService,
            active: true,
            sortOrder: (last?.sortOrder || 0) + 1,
            createdById: req.auth.userId,
          },
        });
        return paymentMethodJson({ ...created, balance: Number(account.balance || 0), accountType: account.type });
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
      const existing = await prisma.financePaymentMethods.findFirst({ where: { id, shopId: req.auth.shopId } });
      if (!existing) return res.status(404).json({ ok: false, message: 'Payment method not found' });
      const updated = await prisma.financePaymentMethods.update({
        where: { id },
        data: {
          name: input.name ?? existing.name,
          active: input.active ?? existing.active,
          supportsMoneyService: input.supportsMoneyService ?? existing.supportsMoneyService,
          sortOrder: input.sortOrder ?? existing.sortOrder,
          updatedAt: new Date(),
        },
      });
      if (input.name && existing.accountId) await prisma.moneyAccount.update({ where: { id: existing.accountId }, data: { name: input.name } }).catch(() => {});
      if (input.supportsMoneyService === true && existing.accountId) await prisma.moneyAccount.update({ where: { id: existing.accountId }, data: { active: true } }).catch(() => {});
      await audit(req, 'FINANCE_PAYMENT_METHOD_UPDATED', 'finance_payment_method', id, { before: existing, after: updated });
      return res.json({ ok: true, paymentMethod: paymentMethodJson(updated), message: 'Payment method updated' });
    } catch (error) {
      if (duplicate(error)) return res.status(409).json({ ok: false, message: 'Payment method name already exists' });
      return res.status(error.status || 500).json({ ok: false, message: error.message || 'Payment method update failed', details: error.details });
    }
  });

  app.delete('/api/finance/settings/payment-methods/:id', ...write, async (req, res) => {
    try {
      const id = parse(uuid, req.params.id);
      const target = await prisma.financePaymentMethods.findFirst({
        where: { id, shopId: req.auth.shopId, active: true },
        select: { id: true, name: true, accountId: true },
      });
      if (!target) return res.status(404).json({ ok: false, message: 'Payment method not found or already hidden' });
      await prisma.financePaymentMethods.update({ where: { id }, data: { active: false, updatedAt: new Date() } });
      const rows = [target];
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
      const last = await prisma.businessIncomeCategories.findFirst({
        where: { shopId: req.auth.shopId },
        orderBy: { sortOrder: 'desc' },
        select: { sortOrder: true },
      });
      const category = await prisma.businessIncomeCategories.create({
        data: {
          id,
          shopId: req.auth.shopId,
          name: input.name,
          active: true,
          sortOrder: (last?.sortOrder || 0) + 1,
          createdById: req.auth.userId,
        },
        select: { id: true, name: true, active: true, sortOrder: true },
      });
      await audit(req, 'INCOME_CATEGORY_CREATED', 'business_income_category', id, { name: input.name });
      return res.status(201).json({ ok: true, category, message: 'Income category added' });
    } catch (error) {
      if (duplicate(error)) return res.status(409).json({ ok: false, message: 'Income category already exists' });
      return res.status(error.status || 500).json({ ok: false, message: error.message || 'Income category add failed', details: error.details });
    }
  });

  app.patch('/api/business-control/income-categories/:id', ...write, async (req, res) => {
    try {
      const id = parse(uuid, req.params.id);
      const input = parse(categoryUpdateSchema, req.body || {});
      const existing = await prisma.businessIncomeCategories.findFirst({ where: { id, shopId: req.auth.shopId } });
      if (!existing) return res.status(404).json({ ok: false, message: 'Income category not found' });
      const category = await prisma.businessIncomeCategories.update({
        where: { id },
        data: {
          name: input.name ?? existing.name,
          active: input.active ?? existing.active,
          sortOrder: input.sortOrder ?? existing.sortOrder,
          updatedAt: new Date(),
        },
        select: { id: true, name: true, active: true, sortOrder: true },
      });
      await audit(req, 'INCOME_CATEGORY_UPDATED', 'business_income_category', id, { before: existing, after: category });
      return res.json({ ok: true, category, message: 'Income category updated' });
    } catch (error) {
      if (duplicate(error)) return res.status(409).json({ ok: false, message: 'Income category already exists' });
      return res.status(error.status || 500).json({ ok: false, message: error.message || 'Income category update failed', details: error.details });
    }
  });

  app.delete('/api/business-control/income-categories/:id', ...write, async (req, res) => {
    try {
      const id = parse(uuid, req.params.id);
      const target = await prisma.businessIncomeCategories.findFirst({
        where: { id, shopId: req.auth.shopId, active: true },
        select: { id: true, name: true },
      });
      if (!target) return res.status(404).json({ ok: false, message: 'Income category not found or already hidden' });
      await prisma.businessIncomeCategories.update({ where: { id }, data: { active: false, updatedAt: new Date() } });
      await audit(req, 'INCOME_CATEGORY_ARCHIVED', 'business_income_category', id, { name: target.name });
      return res.json({ ok: true, message: 'Income category hidden from future selection' });
    } catch (error) {
      return res.status(error.status || 500).json({ ok: false, message: error.message || 'Income category remove failed' });
    }
  });
}

module.exports = { attachFinanceSettingsV23Api, ensureSchema };
