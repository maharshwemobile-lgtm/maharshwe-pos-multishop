const crypto = require('crypto');
const { Prisma } = require('@prisma/client');
const { z } = require('zod');
const { prisma } = require('./prisma');
const { requireAuth, requireShopUser, requireWritableSubscription } = require('./auth-api');
const { queueGoogleSheetSync } = require('./google-sheet-sync');

const CHANNELS = ['KPAY', 'WAVE_PAY'];
const MODES = ['TRANSFER', 'CASH_OUT'];
const DEFAULT_RATES = {
  KPAY_TRANSFER: 1,
  KPAY_CASH_OUT: 1,
  WAVE_PAY_TRANSFER: 1,
  WAVE_PAY_CASH_OUT: 1,
  minimumFee: 0,
  roundTo: 100,
};
let schemaPromise;

const createSchema = z.object({
  mode: z.enum(MODES),
  channel: z.enum(CHANNELS),
  amount: z.coerce.number().positive().max(100000000000),
  feeMode: z.enum(['AUTO', 'CUSTOM']).default('AUTO'),
  feeAmount: z.coerce.number().min(0).max(1000000000).optional(),
  senderName: z.string().trim().max(180).optional(),
  senderPhone: z.string().trim().max(60).optional(),
  receiverName: z.string().trim().max(180).optional(),
  receiverPhone: z.string().trim().max(60).optional(),
  withdrawerName: z.string().trim().max(180).optional(),
  withdrawerPhone: z.string().trim().max(60).optional(),
  cashAccountId: z.string().uuid().optional().nullable(),
  walletAccountId: z.string().uuid().optional().nullable(),
  reference: z.string().trim().max(180).optional(),
  note: z.string().trim().max(500).optional(),
}).superRefine((value, ctx) => {
  if (value.mode === 'TRANSFER' && !value.receiverName) ctx.addIssue({ code: 'custom', path: ['receiverName'], message: 'Receiver name is required' });
  if (value.mode === 'TRANSFER' && !value.receiverPhone) ctx.addIssue({ code: 'custom', path: ['receiverPhone'], message: 'Receiver phone is required' });
  if (value.feeMode === 'CUSTOM' && value.feeAmount === undefined) ctx.addIssue({ code: 'custom', path: ['feeAmount'], message: 'Custom fee is required' });
});

const settingsSchema = z.object({
  KPAY_TRANSFER: z.coerce.number().min(0).max(100),
  KPAY_CASH_OUT: z.coerce.number().min(0).max(100),
  WAVE_PAY_TRANSFER: z.coerce.number().min(0).max(100),
  WAVE_PAY_CASH_OUT: z.coerce.number().min(0).max(100),
  minimumFee: z.coerce.number().min(0).max(10000000),
  roundTo: z.coerce.number().int().min(1).max(1000000),
});

class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
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

function requireManager(req, res, next) {
  if (req.auth?.role === 'SUPER_ADMIN' || req.auth?.role === 'SHOP_ADMIN') return next();
  return res.status(403).json({ ok: false, message: 'Shop Admin permission is required' });
}

function number(value) {
  return Number(value || 0);
}

function clean(value, max = 500) {
  const result = String(value ?? '').trim().slice(0, max);
  return result || null;
}

function parse(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) throw new ApiError(400, 'Invalid remittance request', result.error.flatten().fieldErrors);
  return result.data;
}

function currentYangonDate() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Yangon', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}${values.month}${values.day}`;
}

function transactionNumber() {
  return `REM-${currentYangonDate()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

function serviceType(channel, mode) {
  return `${channel}_${mode === 'CASH_OUT' ? 'CASH_OUT' : 'TRANSFER'}`;
}

function roundFee(value, roundTo) {
  const step = Math.max(1, Number(roundTo || 1));
  return Math.ceil(Number(value || 0) / step) * step;
}

async function ensureRemittanceSchema() {
  if (!schemaPromise) {
    schemaPromise = prisma.$transaction(async (tx) => {
      const statements = [
        'ALTER TABLE money_service_transactions ADD COLUMN IF NOT EXISTS transaction_number TEXT',
        'ALTER TABLE money_service_transactions ADD COLUMN IF NOT EXISTS service_channel TEXT',
        'ALTER TABLE money_service_transactions ADD COLUMN IF NOT EXISTS sender_name TEXT',
        'ALTER TABLE money_service_transactions ADD COLUMN IF NOT EXISTS sender_phone TEXT',
        'ALTER TABLE money_service_transactions ADD COLUMN IF NOT EXISTS receiver_name TEXT',
        'ALTER TABLE money_service_transactions ADD COLUMN IF NOT EXISTS receiver_phone TEXT',
        'ALTER TABLE money_service_transactions ADD COLUMN IF NOT EXISTS counterparty_name TEXT',
        'ALTER TABLE money_service_transactions ADD COLUMN IF NOT EXISTS counterparty_phone TEXT',
        'ALTER TABLE money_service_transactions ADD COLUMN IF NOT EXISTS fee_rate NUMERIC(8,4) NOT NULL DEFAULT 0',
        'ALTER TABLE money_service_transactions ADD COLUMN IF NOT EXISTS custom_fee BOOLEAN NOT NULL DEFAULT FALSE',
        'ALTER TABLE money_service_transactions ADD COLUMN IF NOT EXISTS reference TEXT',
        'ALTER TABLE money_service_transactions ADD COLUMN IF NOT EXISTS cash_account_id UUID REFERENCES money_accounts(id) ON DELETE SET NULL',
        'ALTER TABLE money_service_transactions ADD COLUMN IF NOT EXISTS wallet_account_id UUID REFERENCES money_accounts(id) ON DELETE SET NULL',
        'CREATE UNIQUE INDEX IF NOT EXISTS money_service_transactions_shop_number_unique ON money_service_transactions(shop_id,transaction_number) WHERE transaction_number IS NOT NULL',
        'CREATE INDEX IF NOT EXISTS money_service_transactions_channel_date_idx ON money_service_transactions(shop_id,service_channel,created_at DESC)',
      ];
      for (const statement of statements) await tx.$executeRawUnsafe(statement);
      return true;
    }, { maxWait: 5000, timeout: 30000 }).catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  return schemaPromise;
}

async function getRates(shopId) {
  const settings = await prisma.shopSettings.findUnique({ where: { shopId }, select: { moneyServiceRates: true } });
  return { ...DEFAULT_RATES, ...((settings?.moneyServiceRates && typeof settings.moneyServiceRates === 'object') ? settings.moneyServiceRates : {}) };
}

async function resolveAccount(tx, shopId, requestedId, type) {
  if (requestedId) {
    const account = await tx.moneyAccount.findFirst({ where: { id: requestedId, shopId, active: true } });
    if (!account) throw new ApiError(404, `${type} account was not found`);
    if (account.type !== type) throw new ApiError(400, `${account.name} is not a ${type} account`);
    return account;
  }
  const account = await tx.moneyAccount.findFirst({ where: { shopId, type, active: true }, orderBy: { createdAt: 'asc' } });
  if (!account) throw new ApiError(409, `Create an active ${type} money account first`);
  return account;
}

function transactionJson(row) {
  return {
    id: row.id,
    transactionNumber: row.transactionNumber,
    mode: String(row.type || '').endsWith('CASH_OUT') ? 'CASH_OUT' : 'TRANSFER',
    channel: row.channel,
    amount: number(row.amount),
    feeRate: number(row.feeRate),
    feeAmount: number(row.feeAmount),
    feeMode: row.customFee ? 'CUSTOM' : 'AUTO',
    customerPays: number(row.customerPays),
    customerReceives: number(row.customerReceives),
    senderName: row.senderName || '',
    senderPhone: row.senderPhone || '',
    receiverName: row.receiverName || '',
    receiverPhone: row.receiverPhone || '',
    withdrawerName: row.counterpartyName || '',
    withdrawerPhone: row.counterpartyPhone || '',
    reference: row.reference || '',
    note: row.note || '',
    cashAccountName: row.cashAccountName || '',
    walletAccountName: row.walletAccountName || '',
    staffName: row.staffName || row.staffUsername || '',
    createdAt: row.createdAt,
  };
}

async function audit(req, transaction, details) {
  await prisma.auditLog.create({
    data: {
      shopId: req.auth.shopId,
      userId: req.auth.userId,
      action: 'REMITTANCE_CREATED',
      entityType: 'money_service_transaction',
      entityId: transaction.id,
      details,
      ipAddress: req.ip || null,
      userAgent: req.headers['user-agent'] || null,
    },
  }).catch((error) => console.warn('Remittance audit failed:', error.message));
}

function attachRemittanceApi(app) {
  const read = [requireAuth, requireShopUser, requireAccountingRead];
  const write = [requireAuth, requireShopUser, requireWritableSubscription, requireAccountingWrite];
  const manager = [requireAuth, requireShopUser, requireWritableSubscription, requireManager];

  app.get('/api/remittances/settings', ...read, async (req, res) => {
    try {
      await ensureRemittanceSchema();
      const [rates, accounts] = await Promise.all([
        getRates(req.auth.shopId),
        prisma.moneyAccount.findMany({
          where: { shopId: req.auth.shopId, active: true, type: { in: ['CASH', 'KPAY', 'WAVE_PAY'] } },
          select: { id: true, name: true, type: true, balance: true },
          orderBy: [{ type: 'asc' }, { name: 'asc' }],
        }),
      ]);
      return res.json({ ok: true, rates, accounts: accounts.map((row) => ({ ...row, balance: number(row.balance) })) });
    } catch (error) {
      return res.status(error.status || 500).json({ ok: false, message: error.message || 'Remittance settings failed' });
    }
  });

  app.put('/api/remittances/settings', ...manager, async (req, res) => {
    try {
      const rates = parse(settingsSchema, req.body || {});
      await prisma.shopSettings.upsert({
        where: { shopId: req.auth.shopId },
        create: { shopId: req.auth.shopId, moneyServiceRates: rates },
        update: { moneyServiceRates: rates },
      });
      await prisma.auditLog.create({
        data: {
          shopId: req.auth.shopId,
          userId: req.auth.userId,
          action: 'REMITTANCE_FEE_SETTINGS_UPDATED',
          entityType: 'shop_settings',
          entityId: req.auth.shopId,
          details: rates,
          ipAddress: req.ip || null,
          userAgent: req.headers['user-agent'] || null,
        },
      }).catch(() => {});
      return res.json({ ok: true, rates, message: 'Remittance fee settings updated' });
    } catch (error) {
      return res.status(error.status || 500).json({ ok: false, message: error.message || 'Fee settings update failed', details: error.details });
    }
  });

  app.get('/api/remittances', ...read, async (req, res) => {
    try {
      await ensureRemittanceSchema();
      const page = Math.max(1, Number.parseInt(req.query.page || '1', 10) || 1);
      const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit || '20', 10) || 20));
      const query = clean(req.query.q, 100);
      const mode = MODES.includes(req.query.mode) ? req.query.mode : null;
      const channel = CHANNELS.includes(req.query.channel) ? req.query.channel : null;
      const params = [req.auth.shopId];
      const clauses = [`t.shop_id=$1::uuid`, `t.type IN ('KPAY_TRANSFER','KPAY_CASH_OUT','WAVE_PAY_TRANSFER','WAVE_PAY_CASH_OUT')`];
      if (mode) {
        params.push(mode === 'TRANSFER' ? '%_TRANSFER' : '%_CASH_OUT');
        clauses.push(`t.type::text LIKE $${params.length}`);
      }
      if (channel) {
        params.push(channel);
        clauses.push(`t.service_channel=$${params.length}`);
      }
      if (query) {
        params.push(`%${query.toLowerCase()}%`);
        clauses.push(`LOWER(CONCAT_WS(' ',t.transaction_number,t.sender_name,t.sender_phone,t.receiver_name,t.receiver_phone,t.counterparty_name,t.counterparty_phone,t.reference,t.note)) LIKE $${params.length}`);
      }
      const where = clauses.join(' AND ');
      const countRows = await prisma.$queryRawUnsafe(
        `SELECT COUNT(*)::int AS count,COALESCE(SUM(customer_amount),0) AS amount,COALESCE(SUM(fee_amount),0) AS fee
           FROM money_service_transactions t WHERE ${where}`,
        ...params,
      );
      const rows = await prisma.$queryRawUnsafe(
        `SELECT t.id,t.transaction_number AS "transactionNumber",t.type,t.service_channel AS channel,
                t.customer_amount AS amount,t.fee_rate AS "feeRate",t.fee_amount AS "feeAmount",t.custom_fee AS "customFee",
                t.customer_pays_amount AS "customerPays",t.customer_receives_amount AS "customerReceives",
                t.sender_name AS "senderName",t.sender_phone AS "senderPhone",t.receiver_name AS "receiverName",t.receiver_phone AS "receiverPhone",
                t.counterparty_name AS "counterpartyName",t.counterparty_phone AS "counterpartyPhone",t.reference,t.note,t.created_at AS "createdAt",
                ca.name AS "cashAccountName",wa.name AS "walletAccountName",u.name AS "staffName",u.username AS "staffUsername"
           FROM money_service_transactions t
           LEFT JOIN money_accounts ca ON ca.id=t.cash_account_id
           LEFT JOIN money_accounts wa ON wa.id=t.wallet_account_id
           LEFT JOIN users u ON u.id=t.user_id
          WHERE ${where}
          ORDER BY t.created_at DESC,t.id DESC
          LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        ...params,
        limit,
        (page - 1) * limit,
      );
      const total = Number(countRows[0]?.count || 0);
      return res.json({
        ok: true,
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
        summary: { amount: number(countRows[0]?.amount), fee: number(countRows[0]?.fee) },
        transactions: rows.map(transactionJson),
      });
    } catch (error) {
      return res.status(error.status || 500).json({ ok: false, message: error.message || 'Remittance history failed' });
    }
  });

  app.post('/api/remittances', ...write, async (req, res) => {
    try {
      await ensureRemittanceSchema();
      const input = parse(createSchema, req.body || {});
      const rates = await getRates(req.auth.shopId);
      const type = serviceType(input.channel, input.mode);
      const rate = number(rates[type]);
      const calculatedFee = Math.max(number(rates.minimumFee), roundFee(input.amount * rate / 100, rates.roundTo));
      const feeAmount = input.feeMode === 'CUSTOM' ? number(input.feeAmount) : calculatedFee;
      const pays = input.amount + feeAmount;
      const receives = input.amount;
      const id = crypto.randomUUID();
      const numberValue = transactionNumber();

      const result = await prisma.$transaction(async (tx) => {
        const cash = await resolveAccount(tx, req.auth.shopId, input.cashAccountId, 'CASH');
        const wallet = await resolveAccount(tx, req.auth.shopId, input.walletAccountId, input.channel);
        const beforeCash = number(cash.balance);
        const beforeWallet = number(wallet.balance);
        const cashChange = input.mode === 'TRANSFER' ? pays : -receives;
        const walletChange = input.mode === 'TRANSFER' ? -receives : pays;
        const afterCash = beforeCash + cashChange;
        const afterWallet = beforeWallet + walletChange;
        if (afterCash < -0.005) throw new ApiError(409, `Insufficient ${cash.name} balance`);
        if (afterWallet < -0.005) throw new ApiError(409, `Insufficient ${wallet.name} balance`);

        await tx.moneyAccount.update({ where: { id: cash.id }, data: { balance: afterCash } });
        await tx.moneyAccount.update({ where: { id: wallet.id }, data: { balance: afterWallet } });
        await tx.$executeRawUnsafe(
          `INSERT INTO money_service_transactions(
             id,shop_id,account_id,type,fee_mode,customer_amount,fee_amount,customer_pays_amount,customer_receives_amount,
             cash_change,wallet_change,service_profit,before_cash_balance,after_cash_balance,before_wallet_balance,after_wallet_balance,
             user_id,note,created_at,transaction_number,service_channel,sender_name,sender_phone,receiver_name,receiver_phone,
             counterparty_name,counterparty_phone,fee_rate,custom_fee,reference,cash_account_id,wallet_account_id
           ) VALUES(
             $1::uuid,$2::uuid,$3::uuid,$4::"MoneyServiceType",$5::"MoneyFeeMode",$6,$7,$8,$9,
             $10,$11,$12,$13,$14,$15,$16,$17::uuid,$18,NOW(),$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30::uuid,$31::uuid
           )`,
          id, req.auth.shopId, wallet.id, type, input.feeMode === 'CUSTOM' ? 'MANUAL' : 'PROPORTIONAL',
          input.amount, feeAmount, pays, receives, cashChange, walletChange, feeAmount,
          beforeCash, afterCash, beforeWallet, afterWallet, req.auth.userId, clean(input.note), numberValue,
          input.channel, clean(input.senderName, 180), clean(input.senderPhone, 60), clean(input.receiverName, 180), clean(input.receiverPhone, 60),
          clean(input.withdrawerName, 180), clean(input.withdrawerPhone, 60), rate, input.feeMode === 'CUSTOM', clean(input.reference, 180), cash.id, wallet.id,
        );

        return {
          id,
          transactionNumber: numberValue,
          type,
          mode: input.mode,
          channel: input.channel,
          amount: input.amount,
          feeRate: rate,
          feeAmount,
          feeMode: input.feeMode,
          customerPays: pays,
          customerReceives: receives,
          senderName: input.senderName || '',
          senderPhone: input.senderPhone || '',
          receiverName: input.receiverName || '',
          receiverPhone: input.receiverPhone || '',
          withdrawerName: input.withdrawerName || '',
          withdrawerPhone: input.withdrawerPhone || '',
          reference: input.reference || '',
          note: input.note || '',
          cashAccountName: cash.name,
          walletAccountName: wallet.name,
          beforeCash,
          afterCash,
          beforeWallet,
          afterWallet,
          createdAt: new Date().toISOString(),
        };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5000, timeout: 20000 });

      await audit(req, result, {
        transactionNumber: result.transactionNumber,
        mode: result.mode,
        channel: result.channel,
        amount: result.amount,
        feeAmount: result.feeAmount,
        receiverPhone: result.receiverPhone || null,
        withdrawerPhone: result.withdrawerPhone || null,
      });
      await queueGoogleSheetSync({
        shopId: req.auth.shopId,
        dataset: 'remittances',
        action: 'CREATE',
        entityId: result.id,
        payload: result,
      });

      return res.status(201).json({ ok: true, message: 'Remittance transaction saved', transaction: result });
    } catch (error) {
      console.error('Remittance create:', error);
      return res.status(error.status || 500).json({ ok: false, message: error.message || 'Remittance save failed', details: error.details });
    }
  });
}

module.exports = { attachRemittanceApi, ensureRemittanceSchema };
