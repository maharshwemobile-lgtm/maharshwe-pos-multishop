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
const clean = (value, max = 500) => String(value ?? '').trim().slice(0, max) || null;
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
      const [rates, methods, accounts] = await Promise.all([
        getRates(req.auth.shopId),
        prisma.$queryRawUnsafe(`SELECT m.id,m.name,m.code,m.kind,m.account_id AS "accountId",m.supports_money_service AS "supportsMoneyService",m.active,a.type AS "accountType",a.balance
          FROM finance_payment_methods m LEFT JOIN money_accounts a ON a.id=m.account_id WHERE m.shop_id=$1::uuid ORDER BY m.supports_money_service DESC,m.sort_order,LOWER(m.name)`, req.auth.shopId),
        prisma.moneyAccount.findMany({ where: { shopId: req.auth.shopId, active: true }, select: { id: true, name: true, type: true, balance: true }, orderBy: [{ type: 'asc' }, { name: 'asc' }] }),
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
