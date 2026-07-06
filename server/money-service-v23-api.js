const crypto = require('crypto');
const { Prisma } = require('@prisma/client');
const { z } = require('zod');
const { prisma } = require('./prisma');
const { requireAuth, requireShopUser, requireWritableSubscription } = require('./auth-api');
const { queueGoogleSheetSync } = require('./google-sheet-sync');
const { ensureSchema: ensureFinanceSettingsSchema } = require('./finance-settings-v23-api');
const { queuePush, sendPushToShop } = require('./push-notifications-api');

const uuid = z.string().uuid();
const transactionSchema = z.object({
  mode: z.enum(['TRANSFER', 'CASH_OUT']),
  paymentMethodId: uuid,
  cashAccountId: uuid,
  amount: z.coerce.number().positive().max(100000000000),
  feeMode: z.enum(['AUTO', 'CUSTOM']).default('AUTO'),
  feeAmount: z.coerce.number().min(0).max(1000000000).optional(),
  senderName: z.string().trim().max(180).optional(),
  senderPhone: z.string().trim().max(60).optional(),
  receiverName: z.string().trim().max(180).optional(),
  receiverPhone: z.string().trim().max(60).optional(),
  withdrawerName: z.string().trim().max(180).optional(),
  withdrawerPhone: z.string().trim().max(60).optional(),
  paymentTiming: z.enum(['PAID_NOW', 'PAY_LATER', 'PARTIAL']).default('PAID_NOW'),
  paidAmount: z.coerce.number().min(0).max(100000000000).optional(),
  dueDate: z.string().trim().max(20).optional().nullable(),
  reference: z.string().trim().max(180).optional(),
  note: z.string().trim().max(500).optional(),
}).superRefine((value, ctx) => {
  if (value.mode === 'TRANSFER' && !value.receiverName) ctx.addIssue({ code: 'custom', path: ['receiverName'], message: 'Receiver name is required' });
  if (value.mode === 'TRANSFER' && !value.receiverPhone) ctx.addIssue({ code: 'custom', path: ['receiverPhone'], message: 'Receiver phone is required' });
  if (value.feeMode === 'CUSTOM' && value.feeAmount === undefined) ctx.addIssue({ code: 'custom', path: ['feeAmount'], message: 'Custom fee is required' });
});
const collectSchema = z.object({
  amount: z.coerce.number().positive().max(100000000000),
  accountId: uuid,
  paymentMethodId: uuid.optional().nullable(),
  note: z.string().trim().max(300).optional(),
});
const billerSchema = z.object({
  name: z.string().trim().min(1).max(160),
  type: z.enum(['TOPUP_CARD', 'ELOAD', 'BILL_PAYMENT', 'OTHER']).default('OTHER'),
  branchId: z.union([uuid, z.literal(''), z.null()]).optional(),
  openingBalance: z.coerce.number().min(0).max(100000000000).default(0),
  currentBalance: z.coerce.number().min(0).max(100000000000).optional(),
  saleAdjustMode: z.enum(['NONE', 'ADD_PERCENT', 'SUBTRACT_PERCENT']).default('NONE'),
  saleAdjustPercent: z.coerce.number().min(0).max(100).optional().default(0),
  isActive: z.boolean().optional(),
});
const billerPatchSchema = billerSchema.partial();
const billerTxBaseSchema = z.object({
  billerId: uuid,
  branchId: z.union([uuid, z.literal(''), z.null()]).optional(),
  amount: z.coerce.number().positive().max(100000000000),
  balanceAdjustMode: z.enum(['NONE', 'ADD_PERCENT', 'SUBTRACT_PERCENT']).default('NONE'),
  balanceAdjustPercent: z.coerce.number().min(0).max(100).optional().default(0),
  costAmount: z.coerce.number().min(0).max(100000000000).optional().nullable(),
  profitAmount: z.coerce.number().min(-100000000000).max(100000000000).optional().nullable(),
  customerPhone: z.string().trim().max(80).optional().nullable(),
  paymentMethod: z.string().trim().max(80).optional().nullable(),
  paymentAccountId: z.union([uuid, z.literal(''), z.null()]).optional(),
  paymentTiming: z.enum(['PAID_NOW', 'PAY_LATER', 'PARTIAL']).default('PAID_NOW'),
  paidAmount: z.coerce.number().min(0).max(100000000000).optional(),
  dueDate: z.string().trim().max(20).optional().nullable(),
  staffId: z.union([uuid, z.literal(''), z.null()]).optional(),
  note: z.string().trim().max(500).optional().nullable(),
  transactionDate: z.string().trim().max(40).optional().nullable(),
});
const adjustmentSchema = billerTxBaseSchema.extend({
  amount: z.coerce.number().min(-100000000000).max(100000000000).refine((value) => value !== 0, 'Adjustment amount cannot be zero'),
  note: z.string().trim().min(1).max(500),
});

let schemaPromise;

class ApiError extends Error {
  constructor(status, message, details) { super(message); this.status = status; this.details = details; }
}

function parse(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) throw new ApiError(400, 'Invalid Money Service request', result.error.flatten().fieldErrors);
  return result.data;
}
const number = (value) => Number(value || 0);
const round = (value) => Math.round((number(value) + Number.EPSILON) * 100) / 100;
const clean = (value, max = 500) => String(value ?? '').trim().slice(0, max) || null;
const maybeUuid = (value) => value || null;
function field(row, ...names) {
  for (const name of names) {
    if (row?.[name] !== undefined) return row[name];
  }
  return undefined;
}

function requireAccountingRead(req, res, next) {
  if (req.auth?.role === 'SUPER_ADMIN' || req.auth?.role === 'SHOP_ADMIN') return next();
  const permissions = req.auth?.permissions || {};
  if (permissions.accounting === true || permissions.history === true || permissions.reports === true) return next();
  return res.status(403).json({ ok: false, message: 'Accounting permission is required' });
}
function requireAccountingWrite(req, res, next) {
  if (req.auth?.role === 'SUPER_ADMIN' || req.auth?.role === 'SHOP_ADMIN') return next();
  if (req.auth?.permissions?.accounting === true) return next();
  return res.status(403).json({ ok: false, message: 'Accounting permission is required' });
}

async function ensureSchema() {
  if (!schemaPromise) {
    schemaPromise = prisma.$transaction(async (tx) => {
      await ensureFinanceSettingsSchema();
      await tx.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS money_service_transactions_v2 (
        id UUID PRIMARY KEY,shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,transaction_number TEXT NOT NULL,
        mode TEXT NOT NULL,payment_method_id UUID REFERENCES finance_payment_methods(id) ON DELETE SET NULL,
        cash_account_id UUID REFERENCES money_accounts(id) ON DELETE SET NULL,wallet_account_id UUID REFERENCES money_accounts(id) ON DELETE SET NULL,
        sender_name TEXT,sender_phone TEXT,receiver_name TEXT,receiver_phone TEXT,withdrawer_name TEXT,withdrawer_phone TEXT,
        amount NUMERIC(14,2) NOT NULL,fee_mode TEXT NOT NULL DEFAULT 'AUTO',fee_rate NUMERIC(8,4) NOT NULL DEFAULT 0,
        fee_amount NUMERIC(14,2) NOT NULL DEFAULT 0,customer_pays NUMERIC(14,2) NOT NULL DEFAULT 0,customer_receives NUMERIC(14,2) NOT NULL DEFAULT 0,
        payment_status TEXT NOT NULL DEFAULT 'PAID',paid_amount NUMERIC(14,2) NOT NULL DEFAULT 0,due_amount NUMERIC(14,2) NOT NULL DEFAULT 0,due_date DATE,
        reference TEXT,note TEXT,created_by_id UUID REFERENCES users(id) ON DELETE SET NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
      await tx.$executeRawUnsafe('CREATE UNIQUE INDEX IF NOT EXISTS money_service_v2_shop_number_unique ON money_service_transactions_v2(shop_id,transaction_number)');
      await tx.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS money_service_v2_shop_status_idx ON money_service_transactions_v2(shop_id,payment_status,due_date,created_at DESC)');
      await tx.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS money_service_payments_v2 (
        id UUID PRIMARY KEY,shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,transaction_id UUID NOT NULL REFERENCES money_service_transactions_v2(id) ON DELETE CASCADE,
        payment_method_id UUID REFERENCES finance_payment_methods(id) ON DELETE SET NULL,account_id UUID REFERENCES money_accounts(id) ON DELETE SET NULL,
        amount NUMERIC(14,2) NOT NULL,note TEXT,collected_by_id UUID REFERENCES users(id) ON DELETE SET NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
      await tx.$executeRawUnsafe(`DO $$ BEGIN
        CREATE TYPE "BillerType" AS ENUM ('TOPUP_CARD','ELOAD','BILL_PAYMENT','OTHER');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$`);
      await tx.$executeRawUnsafe(`DO $$ BEGIN
        CREATE TYPE "BillerTransactionType" AS ENUM ('OPENING','REFILL','SOLD','ADJUSTMENT');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$`);
      await tx.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS billers (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,branch_id UUID NULL,
        name TEXT NOT NULL,type "BillerType" NOT NULL DEFAULT 'OTHER',opening_balance NUMERIC(14,2) NOT NULL DEFAULT 0,
        current_balance NUMERIC(14,2) NOT NULL DEFAULT 0,is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
      await tx.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS billers_shop_branch_name_unique ON billers(shop_id,COALESCE(branch_id,'00000000-0000-0000-0000-000000000000'::uuid),LOWER(name))`);
      await tx.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS billers_shop_active_idx ON billers(shop_id,is_active)`);
      await tx.$executeRawUnsafe(`ALTER TABLE billers
        ADD COLUMN IF NOT EXISTS sale_adjust_mode TEXT NOT NULL DEFAULT 'NONE',
        ADD COLUMN IF NOT EXISTS sale_adjust_percent NUMERIC(8,4) NOT NULL DEFAULT 0`);
      await tx.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS biller_transactions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,branch_id UUID NULL,
        biller_id UUID NOT NULL REFERENCES billers(id) ON DELETE CASCADE,transaction_type "BillerTransactionType" NOT NULL,
        amount NUMERIC(14,2) NOT NULL,cost_amount NUMERIC(14,2) NULL,profit_amount NUMERIC(14,2) NULL,
        customer_phone TEXT NULL,payment_method TEXT NULL,payment_account_id UUID NULL REFERENCES money_accounts(id) ON DELETE SET NULL,
        staff_id UUID NULL REFERENCES users(id) ON DELETE SET NULL,note TEXT NULL,transaction_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
      await tx.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS biller_transactions_shop_branch_date_idx ON biller_transactions(shop_id,branch_id,transaction_date)`);
      await tx.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS biller_transactions_shop_biller_date_idx ON biller_transactions(shop_id,biller_id,transaction_date)`);
      await tx.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS biller_transactions_shop_type_date_idx ON biller_transactions(shop_id,transaction_type,transaction_date)`);
      await tx.$executeRawUnsafe(`ALTER TABLE biller_transactions
        ADD COLUMN IF NOT EXISTS payment_status "PaymentStatus" NOT NULL DEFAULT 'PAID',
        ADD COLUMN IF NOT EXISTS paid_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS due_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS due_date DATE NULL`);
      await tx.$executeRawUnsafe(`ALTER TABLE biller_transactions
        ADD COLUMN IF NOT EXISTS balance_effect_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS balance_adjust_mode TEXT NULL,
        ADD COLUMN IF NOT EXISTS balance_adjust_percent NUMERIC(8,4) NOT NULL DEFAULT 0`);
      await tx.$executeRawUnsafe(`UPDATE biller_transactions SET balance_effect_amount=amount WHERE balance_effect_amount=0`);
      await tx.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS biller_transactions_shop_payment_status_idx ON biller_transactions(shop_id,payment_status,due_date,transaction_date DESC)`);
      return true;
    }, { maxWait: 5000, timeout: 30000 }).catch((error) => { schemaPromise = null; throw error; });
  }
  await schemaPromise;
}

function currentYangonDate() {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Yangon', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}${values.month}${values.day}`;
}
function transactionNumber() { return `MS-${currentYangonDate()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`; }
function roundFee(value, roundTo) { const step = Math.max(1, Number(roundTo || 1)); return Math.ceil(number(value) / step) * step; }

async function seedPaymentMethods(shopId, userId) {
  await ensureSchema();
  const existing = await prisma.$queryRawUnsafe('SELECT COUNT(*)::int AS count FROM finance_payment_methods WHERE shop_id=$1::uuid', shopId);
  if (Number(existing[0]?.count || 0) > 0) return;
  const accounts = await prisma.moneyAccount.findMany({ where: { shopId, active: true }, orderBy: { createdAt: 'asc' } });
  for (const account of accounts) {
    const code = account.type === 'WAVE_PAY' ? 'WAVE_PAY' : account.type === 'KPAY' ? 'KPAY' : account.type === 'CASH' ? 'CASH' : account.name.toUpperCase().replace(/[^A-Z0-9]+/g, '_');
    await prisma.$executeRawUnsafe(`INSERT INTO finance_payment_methods(id,shop_id,name,code,kind,account_id,supports_money_service,active,sort_order,created_by_id,created_at,updated_at)
      VALUES($1::uuid,$2::uuid,$3,$4,$5,$6::uuid,$7,TRUE,$8,$9::uuid,NOW(),NOW()) ON CONFLICT DO NOTHING`,
      crypto.randomUUID(), shopId, account.name, code, account.type === 'CASH' ? 'CASH' : 'WALLET', account.id, account.type !== 'CASH', accounts.indexOf(account) + 1, userId);
  }
}

const DEFAULT_BILLERS = [
  ['NearMe', 'TOPUP_CARD'],
  ['Atom', 'TOPUP_CARD'],
  ['Mytel', 'TOPUP_CARD'],
  ['MPT', 'TOPUP_CARD'],
  ['U9', 'TOPUP_CARD'],
  ['MPT Eload', 'ELOAD'],
  ['Mytel Eload', 'ELOAD'],
  ['ATOM ELOAD', 'ELOAD'],
];

async function seedBillers(shopId) {
  await ensureSchema();
  const existing = await prisma.$queryRawUnsafe('SELECT COUNT(*)::int AS count FROM billers WHERE shop_id=$1::uuid', shopId);
  if (Number(existing[0]?.count || 0) > 0) return;
  for (const [name, type] of DEFAULT_BILLERS) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO billers(id,shop_id,name,type,opening_balance,current_balance,is_active,sale_adjust_mode,sale_adjust_percent,created_at,updated_at)
       VALUES($1::uuid,$2::uuid,$3,$4::"BillerType",0,0,TRUE,'NONE',0,NOW(),NOW()) ON CONFLICT DO NOTHING`,
      crypto.randomUUID(), shopId, name, type,
    );
  }
}

function billerJson(row) {
  return {
    id: row.id,
    branchId: row.branchId || row.branchid || null,
    name: row.name,
    type: row.type,
    openingBalance: number(row.openingBalance ?? row.openingbalance),
    currentBalance: number(row.currentBalance ?? row.currentbalance),
    saleAdjustMode: row.saleAdjustMode || row.saleadjustmode || 'NONE',
    saleAdjustPercent: number(row.saleAdjustPercent ?? row.saleadjustpercent),
    isActive: row.isActive ?? row.isactive ?? true,
    createdAt: row.createdAt || row.createdat,
    updatedAt: row.updatedAt || row.updatedat,
  };
}

function billerTxJson(row) {
  return {
    id: row.id,
    billerId: row.billerId || row.billerid,
    billerName: row.billerName || row.billername || '',
    billerType: row.billerType || row.billertype || '',
    branchId: row.branchId || row.branchid || null,
    transactionType: row.transactionType || row.transactiontype,
    amount: number(row.amount),
    balanceEffectAmount: number(row.balanceEffectAmount ?? row.balanceeffectamount ?? row.amount),
    balanceAdjustMode: row.balanceAdjustMode || row.balanceadjustmode || 'NONE',
    balanceAdjustPercent: number(row.balanceAdjustPercent ?? row.balanceadjustpercent),
    costAmount: row.costAmount === null || row.costamount === null ? null : number(row.costAmount ?? row.costamount),
    profitAmount: row.profitAmount === null || row.profitamount === null ? null : number(row.profitAmount ?? row.profitamount),
    customerPhone: row.customerPhone || row.customerphone || '',
    paymentMethod: row.paymentMethod || row.paymentmethod || '',
    paymentAccountId: row.paymentAccountId || row.paymentaccountid || null,
    paymentAccountName: row.paymentAccountName || row.paymentaccountname || '',
    paymentStatus: row.paymentStatus || row.paymentstatus || 'PAID',
    paidAmount: number(row.paidAmount ?? row.paidamount),
    dueAmount: number(row.dueAmount ?? row.dueamount),
    dueDate: row.dueDate || row.duedate || null,
    staffId: row.staffId || row.staffid || null,
    staffName: row.staffName || row.staffname || row.staffUsername || row.staffusername || '',
    note: row.note || '',
    transactionDate: row.transactionDate || row.transactiondate,
    createdAt: row.createdAt || row.createdat,
  };
}

async function findBillerForUpdate(tx, shopId, billerId) {
  const rows = await tx.$queryRawUnsafe(
    `SELECT id,shop_id AS "shopId",branch_id AS "branchId",name,type,opening_balance AS "openingBalance",current_balance AS "currentBalance",
            sale_adjust_mode AS "saleAdjustMode",sale_adjust_percent AS "saleAdjustPercent",is_active AS "isActive"
       FROM billers WHERE id=$1::uuid AND shop_id=$2::uuid FOR UPDATE`,
    billerId, shopId,
  );
  const biller = rows[0];
  if (!biller) throw new ApiError(404, 'Biller not found');
  if (biller.isActive === false) throw new ApiError(409, 'Biller is inactive');
  return biller;
}

async function applyPaymentAccountChange(tx, shopId, accountId, delta) {
  if (!accountId || Math.abs(delta) <= 0.005) return null;
  const account = await tx.moneyAccount.findFirst({ where: { id: accountId, shopId, active: true } });
  if (!account) throw new ApiError(404, 'Payment account not found');
  const after = number(account.balance) + delta;
  if (after < -0.005) throw new ApiError(409, `${account.name} balance is not enough`);
  await tx.moneyAccount.update({ where: { id: account.id }, data: { balance: after } });
  return { id: account.id, name: account.name, before: number(account.balance), after };
}

function txDate(input) {
  const date = input ? new Date(input) : new Date();
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

async function getRates(shopId) {
  const settings = await prisma.shopSettings.findUnique({ where: { shopId }, select: { moneyServiceRates: true } });
  const raw = settings?.moneyServiceRates && typeof settings.moneyServiceRates === 'object' ? settings.moneyServiceRates : {};
  return { minimumFee: number(raw.minimumFee), roundTo: Math.max(1, number(raw.roundTo || 100)), ...raw };
}

async function getMethod(shopId, id) {
  const rows = await prisma.$queryRawUnsafe(`SELECT m.id,m.name,m.code,m.kind,m.account_id AS "accountId",m.supports_money_service AS "supportsMoneyService",m.active,a.type AS "accountType",a.balance
    FROM finance_payment_methods m LEFT JOIN money_accounts a ON a.id=m.account_id WHERE m.id=$1::uuid AND m.shop_id=$2::uuid LIMIT 1`, id, shopId);
  const row = rows[0];
  if (!row || field(row, 'supportsMoneyService', 'supportsmoneyservice') === false || !field(row, 'accountId', 'accountid')) {
    throw new ApiError(404, 'Wallet is not enabled for Cash In / Cash Out');
  }
  return {
    ...row,
    accountId: field(row, 'accountId', 'accountid'),
    supportsMoneyService: field(row, 'supportsMoneyService', 'supportsmoneyservice'),
    accountType: field(row, 'accountType', 'accounttype') || 'OTHER',
  };
}

async function getAccount(shopId, id) {
  const account = await prisma.moneyAccount.findFirst({ where: { id, shopId, active: true } });
  if (!account) throw new ApiError(404, 'Money account was not found');
  return account;
}

async function getLinkedWalletAccount(shopId, id) {
  const account = await prisma.moneyAccount.findFirst({ where: { id, shopId } });
  if (!account) throw new ApiError(404, 'Linked wallet account was not found');
  return account;
}

function rowJson(row) {
  return {
    id: row.id, transactionNumber: row.transactionNumber, mode: row.mode, walletName: row.walletName || '', paymentMethodId: row.paymentMethodId,
    amount: number(row.amount), feeMode: row.feeMode, feeRate: number(row.feeRate), feeAmount: number(row.feeAmount), customerPays: number(row.customerPays),
    customerReceives: number(row.customerReceives), paymentStatus: row.paymentStatus, paidAmount: number(row.paidAmount), dueAmount: number(row.dueAmount), dueDate: row.dueDate,
    senderName: row.senderName || '', senderPhone: row.senderPhone || '', receiverName: row.receiverName || '', receiverPhone: row.receiverPhone || '',
    withdrawerName: row.withdrawerName || '', withdrawerPhone: row.withdrawerPhone || '', reference: row.reference || '', note: row.note || '',
    staffName: row.staffName || row.staffUsername || '', createdAt: row.createdAt, updatedAt: row.updatedAt,
  };
}

async function audit(req, action, entityId, details) {
  await prisma.auditLog.create({ data: { shopId: req.auth.shopId, userId: req.auth.userId, action, entityType: 'money_service_transaction_v2', entityId, details, ipAddress: req.ip || null, userAgent: req.headers['user-agent'] || null } }).catch(() => {});
}

function attachMoneyServiceV23Api(app) {
  const read = [requireAuth, requireShopUser, requireAccountingRead];
  const write = [requireAuth, requireShopUser, requireWritableSubscription, requireAccountingWrite];

  app.get('/api/money-service/settings', ...read, async (req, res) => {
    try {
      await seedPaymentMethods(req.auth.shopId, req.auth.userId);
      await seedBillers(req.auth.shopId);
      const [rates, methods, accounts, billers, staff] = await Promise.all([
        getRates(req.auth.shopId),
        prisma.$queryRawUnsafe(`SELECT m.id,m.name,m.code,m.kind,m.account_id AS "accountId",m.supports_money_service AS "supportsMoneyService",m.active,a.type AS "accountType",a.balance
          FROM finance_payment_methods m LEFT JOIN money_accounts a ON a.id=m.account_id WHERE m.shop_id=$1::uuid ORDER BY m.supports_money_service DESC,m.sort_order,LOWER(m.name)`, req.auth.shopId),
        prisma.moneyAccount.findMany({ where: { shopId: req.auth.shopId, active: true }, select: { id: true, name: true, type: true, balance: true }, orderBy: [{ type: 'asc' }, { name: 'asc' }] }),
        prisma.$queryRawUnsafe(`SELECT id,branch_id AS "branchId",name,type,opening_balance AS "openingBalance",current_balance AS "currentBalance",
            sale_adjust_mode AS "saleAdjustMode",sale_adjust_percent AS "saleAdjustPercent",is_active AS "isActive",created_at AS "createdAt",updated_at AS "updatedAt"
          FROM billers WHERE shop_id=$1::uuid ORDER BY is_active DESC,LOWER(name)`, req.auth.shopId),
        prisma.user.findMany({ where: { shopId: req.auth.shopId, active: true }, select: { id: true, name: true, username: true, role: true }, orderBy: { name: 'asc' } }),
      ]);
      return res.json({
        ok: true,
        rates,
        paymentMethods: methods.map((row) => ({
          ...row,
          accountId: field(row, 'accountId', 'accountid') || null,
          supportsMoneyService: field(row, 'supportsMoneyService', 'supportsmoneyservice') !== false,
          accountType: field(row, 'accountType', 'accounttype') || 'OTHER',
          balance: number(row.balance),
        })),
        accounts: accounts.map((row) => ({ ...row, balance: number(row.balance) })),
        billers: billers.map(billerJson),
        staff: staff.map((row) => ({ ...row, label: row.name || row.username })),
      });
    } catch (error) { return res.status(500).json({ ok: false, message: error.message || 'Money Service settings failed' }); }
  });

  app.get('/api/money-service/dashboard', ...read, async (req, res) => {
    try {
      await ensureSchema();
      const summary = await prisma.$queryRawUnsafe(`SELECT
        COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE)::int AS "todayCount",
        COALESCE(SUM(amount) FILTER (WHERE created_at >= CURRENT_DATE),0) AS "todayAmount",
        COALESCE(SUM(amount) FILTER (WHERE created_at >= CURRENT_DATE AND mode='TRANSFER'),0) AS "todayTransferAmount",
        COALESCE(SUM(amount) FILTER (WHERE created_at >= CURRENT_DATE AND mode='CASH_OUT'),0) AS "todayCashOutAmount",
        COALESCE(SUM(fee_amount) FILTER (WHERE created_at >= CURRENT_DATE),0) AS "todayFee",
        COALESCE(SUM(due_amount) FILTER (WHERE payment_status <> 'PAID'),0) AS "totalDue",
        COUNT(*) FILTER (WHERE payment_status <> 'PAID')::int AS "pendingCount",
        COUNT(*) FILTER (WHERE due_date < CURRENT_DATE AND payment_status <> 'PAID')::int AS "overdueCount"
        FROM money_service_transactions_v2 WHERE shop_id=$1::uuid`, req.auth.shopId);
      const recent = await prisma.$queryRawUnsafe(`SELECT t.id,t.transaction_number AS "transactionNumber",t.mode,t.amount,t.fee_amount AS "feeAmount",t.payment_status AS "paymentStatus",t.due_amount AS "dueAmount",t.receiver_name AS "receiverName",t.withdrawer_name AS "withdrawerName",t.reference,t.note,t.created_at AS "createdAt",m.name AS "walletName"
        FROM money_service_transactions_v2 t LEFT JOIN finance_payment_methods m ON m.id=t.payment_method_id WHERE t.shop_id=$1::uuid ORDER BY t.created_at DESC LIMIT 8`, req.auth.shopId);
      const row = summary[0] || {};
      return res.json({ ok: true, summary: { todayCount: Number(row.todayCount || 0), todayAmount: number(row.todayAmount), todayTransferAmount: number(row.todayTransferAmount), todayCashOutAmount: number(row.todayCashOutAmount), todayFee: number(row.todayFee), totalDue: number(row.totalDue), pendingCount: Number(row.pendingCount || 0), overdueCount: Number(row.overdueCount || 0) }, recent: recent.map(rowJson) });
    } catch (error) { return res.status(500).json({ ok: false, message: error.message || 'Money Service dashboard failed' }); }
  });

  app.get('/api/money-service/transactions', ...read, async (req, res) => {
    try {
      await ensureSchema();
      const page = Math.max(1, Number.parseInt(req.query.page || '1', 10) || 1);
      const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit || '20', 10) || 20));
      const query = String(req.query.q || '').trim().toLowerCase();
      const status = ['PENDING', 'PARTIAL', 'PAID'].includes(req.query.status) ? req.query.status : null;
      const mode = ['TRANSFER', 'CASH_OUT'].includes(req.query.mode) ? req.query.mode : null;
      const params = [req.auth.shopId];
      const clauses = ['t.shop_id=$1::uuid'];
      if (status) { params.push(status); clauses.push(`t.payment_status=$${params.length}`); }
      if (mode) { params.push(mode); clauses.push(`t.mode=$${params.length}`); }
      if (query) { params.push(`%${query}%`); clauses.push(`LOWER(CONCAT_WS(' ',t.transaction_number,t.sender_name,t.sender_phone,t.receiver_name,t.receiver_phone,t.withdrawer_name,t.withdrawer_phone,t.reference)) LIKE $${params.length}`); }
      const where = clauses.join(' AND ');
      const count = await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS count FROM money_service_transactions_v2 t WHERE ${where}`, ...params);
      const rows = await prisma.$queryRawUnsafe(`SELECT t.id,t.transaction_number AS "transactionNumber",t.mode,t.payment_method_id AS "paymentMethodId",t.amount,t.fee_mode AS "feeMode",t.fee_rate AS "feeRate",t.fee_amount AS "feeAmount",t.customer_pays AS "customerPays",t.customer_receives AS "customerReceives",t.payment_status AS "paymentStatus",t.paid_amount AS "paidAmount",t.due_amount AS "dueAmount",t.due_date AS "dueDate",t.sender_name AS "senderName",t.sender_phone AS "senderPhone",t.receiver_name AS "receiverName",t.receiver_phone AS "receiverPhone",t.withdrawer_name AS "withdrawerName",t.withdrawer_phone AS "withdrawerPhone",t.reference,t.note,t.created_at AS "createdAt",t.updated_at AS "updatedAt",m.name AS "walletName",u.name AS "staffName",u.username AS "staffUsername"
        FROM money_service_transactions_v2 t LEFT JOIN finance_payment_methods m ON m.id=t.payment_method_id LEFT JOIN users u ON u.id=t.created_by_id WHERE ${where} ORDER BY t.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        ...params, limit, (page - 1) * limit);
      const total = Number(count[0]?.count || 0);
      return res.json({ ok: true, page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)), transactions: rows.map(rowJson) });
    } catch (error) { return res.status(500).json({ ok: false, message: error.message || 'Money Service history failed' }); }
  });

  app.get('/api/money-service/transactions/:id', ...read, async (req, res) => {
    try {
      const id = parse(uuid, req.params.id);
      const rows = await prisma.$queryRawUnsafe(`SELECT t.id,t.transaction_number AS "transactionNumber",t.mode,t.payment_method_id AS "paymentMethodId",t.amount,t.fee_mode AS "feeMode",t.fee_rate AS "feeRate",t.fee_amount AS "feeAmount",t.customer_pays AS "customerPays",t.customer_receives AS "customerReceives",t.payment_status AS "paymentStatus",t.paid_amount AS "paidAmount",t.due_amount AS "dueAmount",t.due_date AS "dueDate",t.sender_name AS "senderName",t.sender_phone AS "senderPhone",t.receiver_name AS "receiverName",t.receiver_phone AS "receiverPhone",t.withdrawer_name AS "withdrawerName",t.withdrawer_phone AS "withdrawerPhone",t.reference,t.note,t.created_at AS "createdAt",t.updated_at AS "updatedAt",m.name AS "walletName",u.name AS "staffName",u.username AS "staffUsername"
        FROM money_service_transactions_v2 t LEFT JOIN finance_payment_methods m ON m.id=t.payment_method_id LEFT JOIN users u ON u.id=t.created_by_id WHERE t.id=$1::uuid AND t.shop_id=$2::uuid LIMIT 1`, id, req.auth.shopId);
      if (!rows[0]) return res.status(404).json({ ok: false, message: 'Transaction not found' });
      const payments = await prisma.$queryRawUnsafe(`SELECT p.id,p.amount,p.note,p.created_at AS "createdAt",a.name AS "accountName",m.name AS "paymentMethodName",u.name AS "collectedBy" FROM money_service_payments_v2 p LEFT JOIN money_accounts a ON a.id=p.account_id LEFT JOIN finance_payment_methods m ON m.id=p.payment_method_id LEFT JOIN users u ON u.id=p.collected_by_id WHERE p.transaction_id=$1::uuid ORDER BY p.created_at DESC`, id);
      return res.json({ ok: true, transaction: rowJson(rows[0]), payments: payments.map((row) => ({ ...row, amount: number(row.amount) })) });
    } catch (error) { return res.status(error.status || 500).json({ ok: false, message: error.message || 'Transaction detail failed' }); }
  });

  app.get('/api/billers', ...read, async (req, res) => {
    try {
      await seedBillers(req.auth.shopId);
      const rows = await prisma.$queryRawUnsafe(`SELECT id,branch_id AS "branchId",name,type,opening_balance AS "openingBalance",current_balance AS "currentBalance",
          sale_adjust_mode AS "saleAdjustMode",sale_adjust_percent AS "saleAdjustPercent",is_active AS "isActive",created_at AS "createdAt",updated_at AS "updatedAt"
        FROM billers WHERE shop_id=$1::uuid ORDER BY is_active DESC,LOWER(name)`, req.auth.shopId);
      return res.json({ ok: true, billers: rows.map(billerJson) });
    } catch (error) { return res.status(error.status || 500).json({ ok: false, message: error.message || 'Billers load failed' }); }
  });

  app.post('/api/billers', ...write, async (req, res) => {
    try {
      await ensureSchema();
      const input = parse(billerSchema, req.body || {});
      const id = crypto.randomUUID();
      const currentBalance = input.currentBalance ?? input.openingBalance;
      await prisma.$executeRawUnsafe(`INSERT INTO billers(id,shop_id,branch_id,name,type,opening_balance,current_balance,is_active,sale_adjust_mode,sale_adjust_percent,created_at,updated_at)
        VALUES($1::uuid,$2::uuid,$3::uuid,$4,$5::"BillerType",$6,$7,$8,$9,$10,NOW(),NOW())`,
        id, req.auth.shopId, maybeUuid(input.branchId), input.name, input.type, input.openingBalance, currentBalance, input.isActive !== false, input.saleAdjustMode || 'NONE', number(input.saleAdjustPercent));
      await audit(req, 'BILLER_CREATED', id, { name: input.name, type: input.type });
      return res.status(201).json({ ok: true, message: 'Biller created', biller: { id, ...input, currentBalance } });
    } catch (error) { return res.status(error.status || 500).json({ ok: false, message: error.message || 'Biller create failed', details: error.details }); }
  });

  app.put('/api/billers/:id', ...write, async (req, res) => {
    try {
      await ensureSchema();
      const id = parse(uuid, req.params.id);
      const input = parse(billerPatchSchema, req.body || {});
      const existing = await prisma.$queryRawUnsafe('SELECT id FROM billers WHERE id=$1::uuid AND shop_id=$2::uuid LIMIT 1', id, req.auth.shopId);
      if (!existing[0]) throw new ApiError(404, 'Biller not found');
      await prisma.$executeRawUnsafe(`UPDATE billers SET
        name=COALESCE($3,name),type=COALESCE($4::"BillerType",type),branch_id=$5::uuid,
        opening_balance=COALESCE($6,opening_balance),current_balance=COALESCE($7,current_balance),
        sale_adjust_mode=COALESCE($8,sale_adjust_mode),sale_adjust_percent=COALESCE($9,sale_adjust_percent),
        is_active=COALESCE($10,is_active),updated_at=NOW()
        WHERE id=$1::uuid AND shop_id=$2::uuid`,
        id, req.auth.shopId, input.name ?? null, input.type ?? null, maybeUuid(input.branchId), input.openingBalance ?? null, input.currentBalance ?? null,
        input.saleAdjustMode ?? null, input.saleAdjustPercent ?? null, input.isActive ?? null);
      await audit(req, 'BILLER_UPDATED', id, input);
      return res.json({ ok: true, message: 'Biller updated' });
    } catch (error) { return res.status(error.status || 500).json({ ok: false, message: error.message || 'Biller update failed', details: error.details }); }
  });

  app.delete('/api/billers/:id', ...write, async (req, res) => {
    try {
      const id = parse(uuid, req.params.id);
      const result = await prisma.$executeRawUnsafe('UPDATE billers SET is_active=FALSE,updated_at=NOW() WHERE id=$1::uuid AND shop_id=$2::uuid', id, req.auth.shopId);
      if (!result) throw new ApiError(404, 'Biller not found');
      await audit(req, 'BILLER_DEACTIVATED', id, {});
      return res.json({ ok: true, message: 'Biller deactivated' });
    } catch (error) { return res.status(error.status || 500).json({ ok: false, message: error.message || 'Biller deactivate failed' }); }
  });

  async function createBillerTransaction(req, res, transactionType) {
    try {
      await seedBillers(req.auth.shopId);
      const schema = transactionType === 'ADJUSTMENT' ? adjustmentSchema : billerTxBaseSchema;
      const input = parse(schema, req.body || {});
      const id = crypto.randomUUID();
      const result = await prisma.$transaction(async (tx) => {
        const biller = await findBillerForUpdate(tx, req.auth.shopId, input.billerId);
        const current = number(biller.currentBalance);
        const defaultAdjustMode = biller.saleAdjustMode || biller.saleadjustmode || 'NONE';
        const defaultAdjustPercent = number(biller.saleAdjustPercent ?? biller.saleadjustpercent);
        const requestedAdjustMode = input.balanceAdjustMode || 'NONE';
        const requestedAdjustPercent = number(input.balanceAdjustPercent);
        const adjustMode = transactionType === 'SOLD' ? (requestedAdjustMode !== 'NONE' || requestedAdjustPercent > 0 ? requestedAdjustMode : defaultAdjustMode) : 'NONE';
        const adjustPercent = transactionType === 'SOLD' ? (requestedAdjustMode !== 'NONE' || requestedAdjustPercent > 0 ? requestedAdjustPercent : defaultAdjustPercent) : 0;
        const effectRaw = adjustMode === 'ADD_PERCENT'
          ? input.amount * (1 + adjustPercent / 100)
          : adjustMode === 'SUBTRACT_PERCENT'
            ? input.amount * (1 - adjustPercent / 100)
            : input.amount;
        const balanceEffectAmount = transactionType === 'SOLD' ? round(Math.max(0, effectRaw)) : input.amount;
        const balanceDelta = transactionType === 'SOLD' ? -balanceEffectAmount : input.amount;
        const closing = current + balanceDelta;
        const isProviderCreditBiller = /atom\s*eload/i.test(biller.name || '');
        if (transactionType === 'SOLD' && closing < -0.005 && !isProviderCreditBiller) throw new ApiError(409, 'Biller balance is not enough');
        const profit = input.profitAmount ?? (transactionType === 'SOLD' && input.costAmount !== null && input.costAmount !== undefined ? input.amount - number(input.costAmount) : 0);
        const isCreditSale = transactionType === 'SOLD' && input.paymentTiming === 'PAY_LATER';
        const paidAmount = transactionType === 'SOLD'
          ? (isCreditSale ? 0 : input.paymentTiming === 'PARTIAL' ? Math.min(input.amount, number(input.paidAmount)) : input.amount)
          : 0;
        const dueAmount = transactionType === 'SOLD' ? Math.max(0, input.amount - paidAmount) : 0;
        const paymentStatus = dueAmount <= 0.005 ? 'PAID' : paidAmount > 0 ? 'PARTIAL' : 'PENDING';
        const accountDelta = transactionType === 'SOLD' ? paidAmount : transactionType === 'REFILL' ? -input.amount : 0;
        const account = await applyPaymentAccountChange(tx, req.auth.shopId, maybeUuid(input.paymentAccountId), accountDelta);
        await tx.$executeRawUnsafe(`INSERT INTO biller_transactions(id,shop_id,branch_id,biller_id,transaction_type,amount,balance_effect_amount,balance_adjust_mode,balance_adjust_percent,cost_amount,profit_amount,customer_phone,payment_method,payment_account_id,payment_status,paid_amount,due_amount,due_date,staff_id,note,transaction_date,created_at,updated_at)
          VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::"BillerTransactionType",$6,$7,$8,$9,$10,$11,$12,$13,$14::uuid,$15::"PaymentStatus",$16,$17,$18::date,$19::uuid,$20,$21::timestamptz,NOW(),NOW())`,
          id, req.auth.shopId, maybeUuid(input.branchId) || biller.branchId || null, biller.id, transactionType, input.amount, balanceEffectAmount, adjustMode, adjustPercent, input.costAmount ?? null, profit,
          clean(input.customerPhone,80), clean(input.paymentMethod,80), maybeUuid(input.paymentAccountId), paymentStatus, paidAmount, dueAmount, input.dueDate || null, maybeUuid(input.staffId), clean(input.note), txDate(input.transactionDate));
        if (transactionType === 'OPENING') {
          await tx.$executeRawUnsafe('UPDATE billers SET opening_balance=opening_balance+$3,current_balance=$4,updated_at=NOW() WHERE id=$1::uuid AND shop_id=$2::uuid', biller.id, req.auth.shopId, input.amount, closing);
        } else {
          await tx.$executeRawUnsafe('UPDATE billers SET current_balance=$3,updated_at=NOW() WHERE id=$1::uuid AND shop_id=$2::uuid', biller.id, req.auth.shopId, closing);
        }
        return { id, billerId: biller.id, billerName: biller.name, transactionType, amount: input.amount, balanceEffectAmount, balanceAdjustMode: adjustMode, balanceAdjustPercent: adjustPercent, profitAmount: profit, paidAmount, dueAmount, paymentStatus, beforeBalance: current, closingBalance: closing, account };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5000, timeout: 20000 });
      await audit(req, `BILLER_${transactionType}_CREATED`, id, result);
      await queueGoogleSheetSync({ shopId: req.auth.shopId, dataset: 'money-service', action: `BILLER_${transactionType}`, entityId: id, payload: result });
      return res.status(201).json({ ok: true, message: `${transactionType} saved`, transaction: result });
    } catch (error) { return res.status(error.status || 500).json({ ok: false, message: error.message || 'Biller transaction failed', details: error.details }); }
  }

  app.post('/api/biller-transactions/opening', ...write, (req, res) => createBillerTransaction(req, res, 'OPENING'));
  app.post('/api/biller-transactions/refill', ...write, (req, res) => createBillerTransaction(req, res, 'REFILL'));
  app.post('/api/biller-transactions/sold', ...write, (req, res) => createBillerTransaction(req, res, 'SOLD'));
  app.post('/api/biller-transactions/adjustment', ...write, (req, res) => createBillerTransaction(req, res, 'ADJUSTMENT'));

  app.get('/api/biller-transactions', ...read, async (req, res) => {
    try {
      await ensureSchema();
      const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit || '20', 10) || 20));
      const rows = await prisma.$queryRawUnsafe(`SELECT t.id,t.biller_id AS "billerId",b.name AS "billerName",b.type AS "billerType",t.branch_id AS "branchId",t.transaction_type AS "transactionType",
        t.amount,t.balance_effect_amount AS "balanceEffectAmount",t.balance_adjust_mode AS "balanceAdjustMode",t.balance_adjust_percent AS "balanceAdjustPercent",
        t.cost_amount AS "costAmount",t.profit_amount AS "profitAmount",t.customer_phone AS "customerPhone",t.payment_method AS "paymentMethod",
        t.payment_status AS "paymentStatus",t.paid_amount AS "paidAmount",t.due_amount AS "dueAmount",t.due_date AS "dueDate",
        t.payment_account_id AS "paymentAccountId",a.name AS "paymentAccountName",t.staff_id AS "staffId",u.name AS "staffName",u.username AS "staffUsername",
        t.note,t.transaction_date AS "transactionDate",t.created_at AS "createdAt"
        FROM biller_transactions t JOIN billers b ON b.id=t.biller_id
        LEFT JOIN money_accounts a ON a.id=t.payment_account_id LEFT JOIN users u ON u.id=t.staff_id
        WHERE t.shop_id=$1::uuid ORDER BY t.transaction_date DESC LIMIT $2`, req.auth.shopId, limit);
      return res.json({ ok: true, transactions: rows.map(billerTxJson) });
    } catch (error) { return res.status(error.status || 500).json({ ok: false, message: error.message || 'Biller transactions load failed' }); }
  });

  app.get('/api/reports/biller-balance', ...read, async (req, res) => {
    try {
      await seedBillers(req.auth.shopId);
      const startDate = String(req.query.startDate || new Date().toISOString().slice(0, 10)).slice(0, 10);
      const endDate = String(req.query.endDate || startDate).slice(0, 10);
      const rows = await prisma.$queryRawUnsafe(`SELECT b.id,b.name,b.type,
        (b.opening_balance + COALESCE(SUM(CASE WHEN t.transaction_date::date < $2::date THEN CASE WHEN t.transaction_type IN ('REFILL','ADJUSTMENT') THEN t.amount WHEN t.transaction_type='SOLD' THEN -COALESCE(NULLIF(t.balance_effect_amount,0),t.amount) ELSE 0 END ELSE 0 END),0)) AS "openingBalance",
        COALESCE(SUM(CASE WHEN t.transaction_type='REFILL' AND t.transaction_date::date BETWEEN $2::date AND $3::date THEN t.amount ELSE 0 END),0) AS refill,
        COALESCE(SUM(CASE WHEN t.transaction_type='SOLD' AND t.transaction_date::date BETWEEN $2::date AND $3::date THEN t.amount ELSE 0 END),0) AS sold,
        COALESCE(SUM(CASE WHEN t.transaction_type='SOLD' AND t.transaction_date::date BETWEEN $2::date AND $3::date THEN COALESCE(NULLIF(t.balance_effect_amount,0),t.amount) ELSE 0 END),0) AS "balanceSold",
        COALESCE(SUM(CASE WHEN t.transaction_type='ADJUSTMENT' AND t.transaction_date::date BETWEEN $2::date AND $3::date THEN t.amount ELSE 0 END),0) AS adjustment,
        COALESCE(SUM(CASE WHEN t.transaction_type='SOLD' AND t.transaction_date::date BETWEEN $2::date AND $3::date THEN COALESCE(t.profit_amount,0) ELSE 0 END),0) AS profit
        FROM billers b LEFT JOIN biller_transactions t ON t.biller_id=b.id AND t.shop_id=b.shop_id
        WHERE b.shop_id=$1::uuid AND b.is_active=TRUE GROUP BY b.id,b.name,b.type,b.opening_balance ORDER BY LOWER(b.name)`,
        req.auth.shopId, startDate, endDate);
      const reportRows = rows.map((row) => {
        const opening = number(row.openingBalance ?? row.openingbalance);
        const refill = number(row.refill);
        const sold = number(row.sold);
        const balanceSold = number(row.balanceSold ?? row.balancesold ?? row.sold);
        const adjustment = number(row.adjustment);
        return { id: row.id, billerName: row.name, type: row.type, openingBalance: round(opening), refill: round(refill), sold: round(sold), balanceSold: round(balanceSold), adjustment: round(adjustment), closingBalance: round(opening + refill - balanceSold + adjustment), profit: round(row.profit) };
      });
      const totals = reportRows.reduce((acc, row) => {
        acc.openingBalance += row.openingBalance; acc.refill += row.refill; acc.sold += row.sold; acc.balanceSold += row.balanceSold; acc.adjustment += row.adjustment; acc.closingBalance += row.closingBalance; acc.profit += row.profit;
        return acc;
      }, { openingBalance: 0, refill: 0, sold: 0, balanceSold: 0, adjustment: 0, closingBalance: 0, profit: 0 });
      for (const key of Object.keys(totals)) totals[key] = round(totals[key]);
      return res.json({ ok: true, startDate, endDate, rows: reportRows, totals });
    } catch (error) { return res.status(error.status || 500).json({ ok: false, message: error.message || 'Biller balance report failed' }); }
  });

  app.post('/api/money-service/transactions', ...write, async (req, res) => {
    try {
      await seedPaymentMethods(req.auth.shopId, req.auth.userId);
      const input = parse(transactionSchema, req.body || {});
      const [method, cash, rates] = await Promise.all([getMethod(req.auth.shopId, input.paymentMethodId), getAccount(req.auth.shopId, input.cashAccountId), getRates(req.auth.shopId)]);
      const wallet = await getLinkedWalletAccount(req.auth.shopId, method.accountId);
      if (wallet.id === cash.id) throw new ApiError(400, 'Cash/collection account and wallet must be different');
      const rateKey = `${method.code}_${input.mode}`;
      const rate = number(rates[rateKey] ?? rates[`${wallet.type}_${input.mode}`] ?? 0);
      const fee = input.feeMode === 'CUSTOM' ? number(input.feeAmount) : Math.max(number(rates.minimumFee), roundFee(input.amount * rate / 100, rates.roundTo));
      const customerPays = input.amount + fee;
      const customerReceives = input.amount;
      const cashOutPending = input.mode === 'CASH_OUT' && input.paymentTiming === 'PAY_LATER';
      let paid = customerPays;
      if (input.mode === 'TRANSFER' && input.paymentTiming === 'PAY_LATER') paid = 0;
      if (input.mode === 'TRANSFER' && input.paymentTiming === 'PARTIAL') paid = Math.min(customerPays, Math.max(0, number(input.paidAmount)));
      if (cashOutPending) paid = 0;
      const due = cashOutPending ? input.amount : Math.max(0, customerPays - paid);
      const paymentStatus = due <= 0.005 ? 'PAID' : paid > 0 ? 'PARTIAL' : 'PENDING';
      const id = crypto.randomUUID();
      const txNumber = transactionNumber();

      const transaction = await prisma.$transaction(async (tx) => {
        const cashCurrent = await tx.moneyAccount.findUnique({ where: { id: cash.id } });
        const walletCurrent = await tx.moneyAccount.findUnique({ where: { id: wallet.id } });
        const cashChange = input.mode === 'TRANSFER' ? paid : (cashOutPending ? 0 : -input.amount);
        const walletChange = input.mode === 'TRANSFER' ? -input.amount : customerPays;
        const cashAfter = number(cashCurrent.balance) + cashChange;
        const walletAfter = number(walletCurrent.balance) + walletChange;
        if (cashAfter < -0.005) throw new ApiError(409, `${cash.name} ထဲမှာ ငွေလက်ကျန်မလုံလောက်ပါ`);
        if (walletAfter < -0.005) throw new ApiError(409, `${wallet.name} ထဲမှာ ငွေလက်ကျန်မလုံလောက်ပါ`);
        await tx.moneyAccount.update({ where: { id: cash.id }, data: { balance: cashAfter } });
        await tx.moneyAccount.update({ where: { id: wallet.id }, data: { balance: walletAfter } });
        await tx.$executeRawUnsafe(`INSERT INTO money_service_transactions_v2(id,shop_id,transaction_number,mode,payment_method_id,cash_account_id,wallet_account_id,sender_name,sender_phone,receiver_name,receiver_phone,withdrawer_name,withdrawer_phone,amount,fee_mode,fee_rate,fee_amount,customer_pays,customer_receives,payment_status,paid_amount,due_amount,due_date,reference,note,created_by_id,created_at,updated_at)
          VALUES($1::uuid,$2::uuid,$3,$4,$5::uuid,$6::uuid,$7::uuid,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23::date,$24,$25,$26::uuid,NOW(),NOW())`,
          id, req.auth.shopId, txNumber, input.mode, method.id, cash.id, wallet.id, clean(input.senderName,180), clean(input.senderPhone,60), clean(input.receiverName,180), clean(input.receiverPhone,60), clean(input.withdrawerName,180), clean(input.withdrawerPhone,60), input.amount, input.feeMode, rate, fee, customerPays, customerReceives, paymentStatus, paid, due, input.dueDate || null, clean(input.reference,180), clean(input.note), req.auth.userId);
        const paymentRecordAmount = input.mode === 'CASH_OUT' ? customerPays : paid;
        if (paymentRecordAmount > 0) {
          await tx.$executeRawUnsafe(`INSERT INTO money_service_payments_v2(id,shop_id,transaction_id,payment_method_id,account_id,amount,note,collected_by_id,created_at) VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6,$7,$8::uuid,NOW())`,
            crypto.randomUUID(), req.auth.shopId, id, method.id, input.mode === 'TRANSFER' ? cash.id : wallet.id, paymentRecordAmount, cashOutPending ? 'Wallet received; cash payout pending' : 'Initial payment', req.auth.userId);
        }
        return { id, transactionNumber: txNumber, mode: input.mode, walletName: method.name, amount: input.amount, feeAmount: fee, feeRate: rate, customerPays, customerReceives, paymentStatus, paidAmount: paid, dueAmount: due, dueDate: input.dueDate || null, receiverName: input.receiverName || '', receiverPhone: input.receiverPhone || '', withdrawerName: input.withdrawerName || '', withdrawerPhone: input.withdrawerPhone || '', createdAt: new Date().toISOString() };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5000, timeout: 20000 });

      await audit(req, 'MONEY_SERVICE_V2_CREATED', id, { transactionNumber: txNumber, mode: input.mode, amount: input.amount, fee, paid, due, paymentStatus });
      await queueGoogleSheetSync({ shopId: req.auth.shopId, dataset: 'remittances', action: 'CREATE_V2', entityId: id, payload: transaction });
      queuePush(() => sendPushToShop({
        shopId: req.auth.shopId,
        eventType: 'MONEY_ACCOUNT_MOVEMENT',
        title: 'Money account movement',
        body: 'A money service transaction was recorded. Open Mahar POS to review.',
        url: '/accounting',
        data: { source: 'money-service', transactionId: id },
      }), 'money service movement push');
      return res.status(201).json({ ok: true, message: paymentStatus === 'PAID' ? 'Transaction saved' : 'Transaction saved with customer due', transaction });
    } catch (error) {
      console.error('Money Service V2 create:', error);
      return res.status(error.status || 500).json({ ok: false, message: error.message || 'Transaction save failed', details: error.details });
    }
  });

  app.post('/api/money-service/transactions/:id/collect', ...write, async (req, res) => {
    try {
      const id = parse(uuid, req.params.id);
      const input = parse(collectSchema, req.body || {});
      const account = await getAccount(req.auth.shopId, input.accountId);
      const result = await prisma.$transaction(async (tx) => {
        const rows = await tx.$queryRawUnsafe('SELECT id,transaction_number AS "transactionNumber",mode,amount,paid_amount AS "paidAmount",due_amount AS "dueAmount",customer_pays AS "customerPays",payment_status AS "paymentStatus" FROM money_service_transactions_v2 WHERE id=$1::uuid AND shop_id=$2::uuid FOR UPDATE', id, req.auth.shopId);
        const record = rows[0];
        if (!record) throw new ApiError(404, 'Transaction not found');
        const due = number(record.dueAmount);
        if (due <= 0.005) throw new ApiError(409, 'This transaction is already fully paid');
        if (input.amount > due + 0.005) throw new ApiError(400, `Amount cannot exceed due balance ${due}`);
        const accountRow = await tx.moneyAccount.findUnique({ where: { id: account.id } });
        const isCashOutPayout = record.mode === 'CASH_OUT';
        const accountAfter = number(accountRow.balance) + (isCashOutPayout ? -input.amount : input.amount);
        if (accountAfter < -0.005) throw new ApiError(409, `${account.name} ထဲမှာ ငွေလက်ကျန်မလုံလောက်ပါ`);
        await tx.moneyAccount.update({ where: { id: account.id }, data: { balance: accountAfter } });
        const paidAfter = number(record.paidAmount) + input.amount;
        const dueTarget = isCashOutPayout ? number(record.amount) : number(record.customerPays);
        const dueAfter = Math.max(0, dueTarget - paidAfter);
        const status = dueAfter <= 0.005 ? 'PAID' : 'PARTIAL';
        await tx.$executeRawUnsafe('UPDATE money_service_transactions_v2 SET paid_amount=$3,due_amount=$4,payment_status=$5,updated_at=NOW() WHERE id=$1::uuid AND shop_id=$2::uuid', id, req.auth.shopId, paidAfter, dueAfter, status);
        await tx.$executeRawUnsafe(`INSERT INTO money_service_payments_v2(id,shop_id,transaction_id,payment_method_id,account_id,amount,note,collected_by_id,created_at) VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6,$7,$8::uuid,NOW())`,
          crypto.randomUUID(), req.auth.shopId, id, input.paymentMethodId || null, account.id, input.amount, clean(input.note,300), req.auth.userId);
        return { id, transactionNumber: record.transactionNumber, amount: input.amount, paidAmount: paidAfter, dueAmount: dueAfter, paymentStatus: status, accountName: account.name };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5000, timeout: 20000 });
      await audit(req, 'MONEY_SERVICE_PAYMENT_COLLECTED', id, result);
      await queueGoogleSheetSync({ shopId: req.auth.shopId, dataset: 'remittances', action: 'PAYMENT_COLLECTED', entityId: id, payload: result });
      queuePush(() => sendPushToShop({
        shopId: req.auth.shopId,
        eventType: 'MONEY_ACCOUNT_MOVEMENT',
        title: 'Money account movement',
        body: 'A money service payment was collected. Open Mahar POS to review.',
        url: '/accounting',
        data: { source: 'money-service-collection', transactionId: id },
      }), 'money service collection push');
      return res.json({ ok: true, message: 'Payment collected', collection: result });
    } catch (error) { return res.status(error.status || 500).json({ ok: false, message: error.message || 'Payment collection failed', details: error.details }); }
  });
}

module.exports = { attachMoneyServiceV23Api, ensureMoneyServiceV23Schema: ensureSchema };
