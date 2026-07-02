const crypto = require('crypto');
const { z } = require('zod');
const { Prisma } = require('@prisma/client');
const { prisma } = require('./prisma');
const {
  requireAuth,
  requireShopUser,
  requireWritableSubscription,
} = require('./auth-api');
const { queuePush, sendPushToShop } = require('./push-notifications-api');

const uuid = z.string().uuid();
const amountSchema = z.coerce.number().finite().positive();
const text = (max = 300) => z.string().trim().max(max).optional().nullable();

const adjustmentSchema = z.object({
  direction: z.enum(['increase', 'decrease']),
  amount: amountSchema,
  note: z.string().trim().min(1).max(300),
  reference: text(180),
});

const transferSchema = z.object({
  fromAccountId: uuid,
  toAccountId: uuid,
  amount: amountSchema,
  note: text(300),
});

const DEFAULT_ACCOUNTS = [
  { type: 'CASH', name: 'Cash' },
  { type: 'KPAY', name: 'KPay' },
  { type: 'WAVE_PAY', name: 'Wave Pay' },
  { type: 'OTHER', name: 'Other' },
];

const METHOD_TO_TYPE = {
  CASH: 'CASH',
  KPAY: 'KPAY',
  WAVE_PAY: 'WAVE_PAY',
  OTHER: 'OTHER',
  MIXED: 'OTHER',
};

class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

function parse(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) throw new ApiError(400, 'Invalid payment request', result.error.flatten().fieldErrors);
  return result.data;
}

function wrap(handler) {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (error) {
      if (error instanceof ApiError) {
        return res.status(error.status).json({ ok: false, message: error.message, details: error.details });
      }
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        return res.status(404).json({ ok: false, message: 'Account not found' });
      }
      console.error('Payments accounts API:', error);
      return res.status(500).json({ ok: false, message: error.message || 'Payment request failed' });
    }
  };
}

const number = (value) => Number(value || 0);
const clean = (value) => String(value || '').trim() || null;

function requireAccountingAccess(req, res, next) {
  if (req.auth?.role === 'SUPER_ADMIN' || req.auth?.role === 'SHOP_ADMIN') return next();
  const permissions = req.auth?.permissions || {};
  if (permissions.accounting === true || permissions.history === true) return next();
  return res.status(403).json({ ok: false, message: 'Insufficient accounting permission' });
}

async function serializable(work) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.$transaction(work, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 5000,
        timeout: 20000,
      });
    } catch (error) {
      if (error.code === 'P2034' && attempt < 2) continue;
      throw error;
    }
  }
}

async function ensureDefaultAccounts(db, shopId) {
  for (const account of DEFAULT_ACCOUNTS) {
    await db.moneyAccount.upsert({
      where: { shopId_name: { shopId, name: account.name } },
      update: { active: true },
      create: { shopId, type: account.type, name: account.name, active: true },
    });
  }
  return db.moneyAccount.findMany({
    where: { shopId, active: true },
    orderBy: [{ type: 'asc' }, { createdAt: 'asc' }],
  });
}

function groupedAmounts(rows) {
  const totals = { CASH: 0, KPAY: 0, WAVE_PAY: 0, OTHER: 0 };
  for (const row of rows || []) {
    const type = METHOD_TO_TYPE[row.method] || 'OTHER';
    totals[type] += number(row._sum?.amount);
  }
  return totals;
}

async function rebuildBalances(db, shopId) {
  const accounts = await ensureDefaultAccounts(db, shopId);
  const [saleGroups, repairGroups, serviceRows] = await Promise.all([
    db.payment.groupBy({
      by: ['method'],
      where: { shopId, status: 'PAID' },
      _sum: { amount: true },
    }),
    db.repairPayment.groupBy({
      by: ['method'],
      where: { shopId, status: 'PAID' },
      _sum: { amount: true },
    }),
    db.moneyServiceTransaction.findMany({
      where: { shopId },
      select: { accountId: true, cashChange: true, walletChange: true },
    }),
  ]);

  const paymentTotals = groupedAmounts(saleGroups);
  const repairTotals = groupedAmounts(repairGroups);
  const adjustments = new Map();
  for (const row of serviceRows) {
    if (!row.accountId) continue;
    adjustments.set(row.accountId, (adjustments.get(row.accountId) || 0) + number(row.cashChange) + number(row.walletChange));
  }

  const defaultByType = new Map();
  for (const defaultAccount of DEFAULT_ACCOUNTS) {
    const found = accounts.find((account) => account.name === defaultAccount.name);
    if (found) defaultByType.set(defaultAccount.type, found.id);
  }

  const updated = [];
  for (const account of accounts) {
    const isDefault = defaultByType.get(account.type) === account.id;
    const base = isDefault ? number(paymentTotals[account.type]) + number(repairTotals[account.type]) : 0;
    const balance = base + number(adjustments.get(account.id));
    if (Math.abs(number(account.balance) - balance) > 0.005) {
      await db.moneyAccount.update({ where: { id: account.id }, data: { balance } });
    }
    updated.push({ ...account, balance });
  }
  return updated;
}

function accountJson(account) {
  return {
    id: account.id,
    type: account.type,
    name: account.name,
    balance: number(account.balance),
    active: account.active,
    updatedAt: account.updatedAt,
  };
}

function dayStart(dateValue) {
  if (!dateValue) return null;
  const date = new Date(`${dateValue}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function dayEnd(dateValue) {
  if (!dateValue) return null;
  const date = new Date(`${dateValue}T23:59:59.999Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function attachPaymentsAccountsPostgresApi(app) {
  const read = [requireAuth, requireShopUser, requireAccountingAccess];
  const write = [requireAuth, requireShopUser, requireWritableSubscription, requireAccountingAccess];

  app.get('/api/payments/accounts', ...read, wrap(async (req, res) => {
    const page = Math.max(1, Number.parseInt(req.query.page || '1', 10) || 1);
    const limit = Math.min(50, Math.max(1, Number.parseInt(req.query.limit || '20', 10) || 20));
    const search = String(req.query.q || '').trim().toLowerCase();
    const accountType = String(req.query.accountType || '').trim();
    const source = String(req.query.source || '').trim();
    const from = dayStart(req.query.from);
    const to = dayEnd(req.query.to);

    const accounts = await serializable((tx) => rebuildBalances(tx, req.auth.shopId));
    const dateWhere = {
      ...(from || to ? { gte: from || undefined, lte: to || undefined } : {}),
    };

    const [salePayments, repairPayments, serviceTransactions, receivable, todaySale, todayRepair] = await Promise.all([
      prisma.payment.findMany({
        where: { shopId: req.auth.shopId, ...(from || to ? { paidAt: dateWhere } : {}) },
        include: {
          sale: {
            include: {
              customer: { select: { name: true, phone: true } },
              user: { select: { name: true, username: true } },
            },
          },
        },
        orderBy: { paidAt: 'desc' },
        take: 300,
      }),
      prisma.repairPayment.findMany({
        where: { shopId: req.auth.shopId, ...(from || to ? { paidAt: dateWhere } : {}) },
        include: {
          repair: { select: { repairNumber: true, customerName: true, customerPhone: true } },
          receivedBy: { select: { name: true, username: true } },
        },
        orderBy: { paidAt: 'desc' },
        take: 300,
      }),
      prisma.moneyServiceTransaction.findMany({
        where: { shopId: req.auth.shopId, ...(from || to ? { createdAt: dateWhere } : {}) },
        include: {
          account: { select: { name: true, type: true } },
          user: { select: { name: true, username: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 300,
      }),
      prisma.customer.aggregate({
        where: { shopId: req.auth.shopId },
        _sum: { balance: true },
      }),
      prisma.payment.aggregate({
        where: { shopId: req.auth.shopId, status: 'PAID', paidAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) } },
        _sum: { amount: true },
        _count: { id: true },
      }),
      prisma.repairPayment.aggregate({
        where: { shopId: req.auth.shopId, status: 'PAID', paidAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) } },
        _sum: { amount: true },
        _count: { id: true },
      }),
    ]);

    const transactions = [
      ...salePayments.map((payment) => ({
        id: `sale:${payment.id}`,
        source: 'SALE',
        accountType: METHOD_TO_TYPE[payment.method] || 'OTHER',
        accountName: (payment.method || 'OTHER').replaceAll('_', ' '),
        direction: payment.status === 'PAID' ? 'IN' : 'VOID',
        amount: number(payment.amount),
        status: payment.status,
        reference: payment.reference || payment.sale?.invoiceNumber || null,
        description: `${payment.sale?.invoiceNumber || 'Sale'} · ${payment.sale?.customer?.name || 'Walk-in Customer'}`,
        actor: payment.sale?.user?.name || payment.sale?.user?.username || '-',
        customer: payment.sale?.customer?.name || 'Walk-in Customer',
        date: payment.paidAt,
      })),
      ...repairPayments.map((payment) => ({
        id: `repair:${payment.id}`,
        source: 'REPAIR',
        accountType: METHOD_TO_TYPE[payment.method] || 'OTHER',
        accountName: (payment.method || 'OTHER').replaceAll('_', ' '),
        direction: payment.status === 'PAID' ? 'IN' : 'VOID',
        amount: number(payment.amount),
        status: payment.status,
        reference: payment.repair?.repairNumber || null,
        description: `${payment.repair?.repairNumber || 'Repair'} · ${payment.repair?.customerName || 'Customer'}`,
        actor: payment.receivedBy?.name || payment.receivedBy?.username || '-',
        customer: payment.repair?.customerName || 'Customer',
        date: payment.paidAt,
      })),
      ...serviceTransactions.map((row) => {
        const delta = number(row.cashChange) + number(row.walletChange);
        return {
          id: `account:${row.id}`,
          source: row.note?.startsWith('[TRANSFER:') ? 'TRANSFER' : 'ADJUSTMENT',
          accountType: row.account?.type || 'OTHER',
          accountName: row.account?.name || 'Account',
          direction: delta >= 0 ? 'IN' : 'OUT',
          amount: Math.abs(delta),
          status: 'POSTED',
          reference: row.reversalOfId || null,
          description: row.note || row.type.replaceAll('_', ' '),
          actor: row.user?.name || row.user?.username || '-',
          customer: '-',
          date: row.createdAt,
        };
      }),
    ].sort((a, b) => new Date(b.date) - new Date(a.date));

    const filtered = transactions.filter((row) => {
      if (accountType && row.accountType !== accountType) return false;
      if (source && row.source !== source) return false;
      if (!search) return true;
      return [row.description, row.reference, row.actor, row.customer, row.accountName]
        .some((value) => String(value || '').toLowerCase().includes(search));
    });

    const total = filtered.length;
    const pageRows = filtered.slice((page - 1) * limit, page * limit);
    const todayReceived = number(todaySale._sum?.amount) + number(todayRepair._sum?.amount);
    const todayCount = Number(todaySale._count?.id || 0) + Number(todayRepair._count?.id || 0);

    res.json({
      ok: true,
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      summary: {
        totalBalance: accounts.reduce((sum, account) => sum + number(account.balance), 0),
        todayReceived,
        todayCount,
        receivable: number(receivable._sum?.balance),
        activeAccounts: accounts.length,
      },
      accounts: accounts.map(accountJson),
      transactions: pageRows,
    });
  }));

  app.post('/api/payments/accounts/:id/adjust', ...write, wrap(async (req, res) => {
    const accountId = parse(uuid, req.params.id);
    const input = parse(adjustmentSchema, req.body || {});
    const result = await serializable(async (tx) => {
      await rebuildBalances(tx, req.auth.shopId);
      const account = await tx.moneyAccount.findFirst({ where: { id: accountId, shopId: req.auth.shopId, active: true } });
      if (!account) throw new ApiError(404, 'Account not found');
      const before = number(account.balance);
      const delta = input.direction === 'decrease' ? -input.amount : input.amount;
      const after = before + delta;
      if (after < 0) throw new ApiError(409, 'Account balance cannot be negative', { before, delta, after });

      await tx.moneyAccount.update({ where: { id: account.id }, data: { balance: after } });
      const transaction = await tx.moneyServiceTransaction.create({
        data: {
          shopId: req.auth.shopId,
          accountId: account.id,
          type: 'ACCOUNT_ADJUSTMENT',
          feeMode: 'MANUAL',
          cashChange: account.type === 'CASH' ? delta : 0,
          walletChange: account.type === 'CASH' ? 0 : delta,
          beforeCashBalance: account.type === 'CASH' ? before : 0,
          afterCashBalance: account.type === 'CASH' ? after : 0,
          beforeWalletBalance: account.type === 'CASH' ? 0 : before,
          afterWalletBalance: account.type === 'CASH' ? 0 : after,
          userId: req.auth.userId,
          note: [input.reference ? `[${input.reference}]` : null, input.note].filter(Boolean).join(' '),
        },
      });
      await tx.auditLog.create({
        data: {
          shopId: req.auth.shopId,
          userId: req.auth.userId,
          action: 'MONEY_ACCOUNT_ADJUSTED',
          entityType: 'money_account',
          entityId: account.id,
          details: { accountName: account.name, direction: input.direction, amount: input.amount, before, after, note: input.note },
          ipAddress: req.ip || null,
          userAgent: req.headers['user-agent'] || null,
        },
      });
      return { account: { ...accountJson(account), balance: after }, transactionId: transaction.id, before, delta, after };
    });
    queuePush(() => sendPushToShop({
      shopId: req.auth.shopId,
      eventType: 'MONEY_ACCOUNT_MOVEMENT',
      title: 'Money account movement',
      body: 'A money account balance was updated. Open Mahar POS to review.',
      url: '/accounting',
      data: { source: 'account-adjustment', transactionId: result.transactionId },
    }), 'money account adjustment push');
    res.json({ ok: true, message: 'Account adjusted', adjustment: result });
  }));

  app.post('/api/payments/accounts/transfer', ...write, wrap(async (req, res) => {
    const input = parse(transferSchema, req.body || {});
    if (input.fromAccountId === input.toAccountId) throw new ApiError(400, 'Choose two different accounts');
    const result = await serializable(async (tx) => {
      await rebuildBalances(tx, req.auth.shopId);
      const [from, to] = await Promise.all([
        tx.moneyAccount.findFirst({ where: { id: input.fromAccountId, shopId: req.auth.shopId, active: true } }),
        tx.moneyAccount.findFirst({ where: { id: input.toAccountId, shopId: req.auth.shopId, active: true } }),
      ]);
      if (!from || !to) throw new ApiError(404, 'Transfer account not found');
      const fromBefore = number(from.balance);
      const toBefore = number(to.balance);
      if (input.amount > fromBefore) throw new ApiError(409, 'Transfer amount is greater than source balance');
      const fromAfter = fromBefore - input.amount;
      const toAfter = toBefore + input.amount;
      const transferId = crypto.randomUUID();
      const note = `[TRANSFER:${transferId}] ${from.name} → ${to.name}${input.note ? ` · ${input.note}` : ''}`;

      await tx.moneyAccount.update({ where: { id: from.id }, data: { balance: fromAfter } });
      await tx.moneyAccount.update({ where: { id: to.id }, data: { balance: toAfter } });
      await tx.moneyServiceTransaction.createMany({
        data: [
          {
            shopId: req.auth.shopId,
            accountId: from.id,
            type: 'ACCOUNT_ADJUSTMENT',
            feeMode: 'MANUAL',
            cashChange: from.type === 'CASH' ? -input.amount : 0,
            walletChange: from.type === 'CASH' ? 0 : -input.amount,
            beforeCashBalance: from.type === 'CASH' ? fromBefore : 0,
            afterCashBalance: from.type === 'CASH' ? fromAfter : 0,
            beforeWalletBalance: from.type === 'CASH' ? 0 : fromBefore,
            afterWalletBalance: from.type === 'CASH' ? 0 : fromAfter,
            userId: req.auth.userId,
            note,
          },
          {
            shopId: req.auth.shopId,
            accountId: to.id,
            type: 'ACCOUNT_ADJUSTMENT',
            feeMode: 'MANUAL',
            cashChange: to.type === 'CASH' ? input.amount : 0,
            walletChange: to.type === 'CASH' ? 0 : input.amount,
            beforeCashBalance: to.type === 'CASH' ? toBefore : 0,
            afterCashBalance: to.type === 'CASH' ? toAfter : 0,
            beforeWalletBalance: to.type === 'CASH' ? 0 : toBefore,
            afterWalletBalance: to.type === 'CASH' ? 0 : toAfter,
            userId: req.auth.userId,
            note,
          },
        ],
      });
      await tx.auditLog.create({
        data: {
          shopId: req.auth.shopId,
          userId: req.auth.userId,
          action: 'MONEY_ACCOUNT_TRANSFERRED',
          entityType: 'money_account',
          entityId: from.id,
          details: { transferId, from: from.name, to: to.name, amount: input.amount, fromBefore, fromAfter, toBefore, toAfter, note: clean(input.note) },
          ipAddress: req.ip || null,
          userAgent: req.headers['user-agent'] || null,
        },
      });
      return { transferId, amount: input.amount, from: { id: from.id, name: from.name, before: fromBefore, after: fromAfter }, to: { id: to.id, name: to.name, before: toBefore, after: toAfter } };
    });
    queuePush(() => sendPushToShop({
      shopId: req.auth.shopId,
      eventType: 'MONEY_ACCOUNT_MOVEMENT',
      title: 'Money account movement',
      body: 'A money account transfer was completed. Open Mahar POS to review.',
      url: '/accounting',
      data: { source: 'account-transfer', transferId: result.transferId },
    }), 'money account transfer push');
    res.json({ ok: true, message: 'Account transfer completed', transfer: result });
  }));
}

module.exports = attachPaymentsAccountsPostgresApi;
