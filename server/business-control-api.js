const crypto = require('crypto');
const { Prisma } = require('@prisma/client');
const { prisma } = require('./prisma');
const {
  requireAuth,
  requireShopUser,
  requireWritableSubscription,
} = require('./auth-api');
const { ensureRepairPlatformSchema } = require('./repair-platform-schema');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ACCOUNT_TYPES = ['CASH', 'KPAY', 'WAVE_PAY', 'OTHER'];
const PAYMENT_METHODS = new Set(ACCOUNT_TYPES);
let schemaPromise;

class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

const number = (value) => Number(value || 0);
const clean = (value, max = 500) => String(value ?? '').trim().slice(0, max);

function wrap(handler) {
  return async (req, res) => {
    try {
      await ensureBusinessControlSchema();
      await ensureRepairPlatformSchema();
      await handler(req, res);
    } catch (error) {
      if (error instanceof ApiError) {
        return res.status(error.status).json({ ok: false, message: error.message, details: error.details });
      }
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return res.status(409).json({ ok: false, message: 'This business day is already closed' });
      }
      console.error('Business Control API:', error);
      return res.status(500).json({ ok: false, message: error.message || 'Business Control request failed' });
    }
  };
}

function requireAccountingRead(req, res, next) {
  if (req.auth?.role === 'SUPER_ADMIN' || req.auth?.role === 'SHOP_ADMIN') return next();
  const permissions = req.auth?.permissions || {};
  if (permissions.accounting === true || permissions.reports === true || permissions.history === true) return next();
  return res.status(403).json({ ok: false, message: 'Accounting or reports permission is required' });
}

function requireAccountingWrite(req, res, next) {
  if (req.auth?.role === 'SUPER_ADMIN' || req.auth?.role === 'SHOP_ADMIN') return next();
  if (req.auth?.permissions?.accounting === true) return next();
  return res.status(403).json({ ok: false, message: 'Accounting permission is required' });
}

function requireManager(req, res, next) {
  if (req.auth?.role === 'SUPER_ADMIN' || req.auth?.role === 'SHOP_ADMIN') return next();
  return res.status(403).json({ ok: false, message: 'Only a Shop Admin can close the business day' });
}

function currentYangonDate() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Yangon',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function parseBusinessDate(value, fallback = currentYangonDate()) {
  const candidate = clean(value || fallback, 10);
  if (!DATE_RE.test(candidate)) throw new ApiError(400, 'Business date must use YYYY-MM-DD');
  const parsed = new Date(`${candidate}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== candidate) {
    throw new ApiError(400, 'Business date is invalid');
  }
  return candidate;
}

function shiftDate(value, days) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function businessBounds(value) {
  return {
    start: new Date(`${value}T00:00:00+06:30`),
    end: new Date(`${shiftDate(value, 1)}T00:00:00+06:30`),
  };
}

async function ensureBusinessControlSchema() {
  if (!schemaPromise) {
    schemaPromise = prisma.$transaction(async (tx) => {
      const statements = [
        `CREATE TABLE IF NOT EXISTS business_expenses (
          id UUID PRIMARY KEY,
          shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
          expense_date DATE NOT NULL,
          category TEXT NOT NULL,
          amount NUMERIC(14,2) NOT NULL DEFAULT 0,
          method TEXT NOT NULL DEFAULT 'CASH',
          money_account_id UUID REFERENCES money_accounts(id) ON DELETE SET NULL,
          note TEXT,
          created_by_id UUID REFERENCES users(id) ON DELETE SET NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`,
        `CREATE INDEX IF NOT EXISTS business_expenses_shop_date_idx ON business_expenses(shop_id, expense_date DESC, created_at DESC)`,
        `ALTER TABLE daily_closings ADD COLUMN IF NOT EXISTS repair_income_total NUMERIC(14,2) NOT NULL DEFAULT 0`,
        `ALTER TABLE daily_closings ADD COLUMN IF NOT EXISTS repair_profit_total NUMERIC(14,2) NOT NULL DEFAULT 0`,
        `ALTER TABLE daily_closings ADD COLUMN IF NOT EXISTS expense_total NUMERIC(14,2) NOT NULL DEFAULT 0`,
        `ALTER TABLE daily_closings ADD COLUMN IF NOT EXISTS receivable_total NUMERIC(14,2) NOT NULL DEFAULT 0`,
        `ALTER TABLE daily_closings ADD COLUMN IF NOT EXISTS payable_total NUMERIC(14,2) NOT NULL DEFAULT 0`,
        `ALTER TABLE daily_closings ADD COLUMN IF NOT EXISTS total_profit NUMERIC(14,2) NOT NULL DEFAULT 0`,
        `ALTER TABLE daily_closings ADD COLUMN IF NOT EXISTS closed_by_id UUID REFERENCES users(id) ON DELETE SET NULL`,
        `ALTER TABLE daily_closings ADD COLUMN IF NOT EXISTS note TEXT`,
        `ALTER TABLE daily_closings ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`,
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

async function supplierSummary(shopId, businessDate) {
  try {
    const rows = await prisma.$queryRawUnsafe(
      `WITH payable_rows AS (
         SELECT COALESCE((SELECT SUM(pri.line_total)
                            FROM purchase_receipts pr
                            JOIN purchase_receipt_items pri ON pri.purchase_receipt_id=pr.id AND pri.shop_id=pr.shop_id
                           WHERE pr.purchase_order_id=po.id AND pr.shop_id=po.shop_id),0)
                  - COALESCE((SELECT SUM(pri.line_total)
                                FROM purchase_returns pr
                                JOIN purchase_return_items pri ON pri.purchase_return_id=pr.id AND pri.shop_id=pr.shop_id
                               WHERE pr.purchase_order_id=po.id AND pr.shop_id=po.shop_id),0) AS received,
                COALESCE((SELECT SUM(sp.amount)
                            FROM supplier_payments sp
                           WHERE sp.purchase_order_id=po.id AND sp.shop_id=po.shop_id),0) AS paid
           FROM purchase_orders po
          WHERE po.shop_id=$1::uuid AND po.status IN ('PARTIALLY_RECEIVED','RECEIVED')
       )
       SELECT COALESCE(SUM(GREATEST(received-paid,0)),0) AS payable,
              COALESCE((SELECT SUM(amount) FROM supplier_payments WHERE shop_id=$1::uuid AND payment_date=$2::date),0) AS "paidToday"
         FROM payable_rows`,
      shopId,
      businessDate,
    );
    return {
      payable: number(rows[0]?.payable),
      paidToday: number(rows[0]?.paidToday),
    };
  } catch (error) {
    console.warn('Business Control supplier summary unavailable:', error.message);
    return { payable: 0, paidToday: 0 };
  }
}

function accountTotals(accounts) {
  const totals = { CASH: 0, KPAY: 0, WAVE_PAY: 0, OTHER: 0, TOTAL: 0 };
  for (const account of accounts || []) {
    const type = ACCOUNT_TYPES.includes(account.type) ? account.type : 'OTHER';
    const balance = number(account.balance);
    totals[type] += balance;
    totals.TOTAL += balance;
  }
  return totals;
}

function closingJson(row) {
  if (!row) return null;
  return {
    id: row.id,
    businessDate: String(row.businessDate || row.closingDate || '').slice(0, 10),
    salesTotal: number(row.salesTotal),
    productProfitTotal: number(row.productProfitTotal),
    serviceIncomeTotal: number(row.serviceIncomeTotal),
    moneyProfitTotal: number(row.moneyProfitTotal),
    repairIncomeTotal: number(row.repairIncomeTotal),
    repairProfitTotal: number(row.repairProfitTotal),
    expenseTotal: number(row.expenseTotal),
    receivableTotal: number(row.receivableTotal),
    payableTotal: number(row.payableTotal),
    totalProfit: number(row.totalProfit),
    cashBalance: number(row.cashBalance),
    kpayBalance: number(row.kpayBalance),
    wavePayBalance: number(row.wavePayBalance),
    note: row.note || '',
    closedAt: row.closedAt,
    closedByName: row.closedByName || '',
  };
}

async function buildOverview(shopId, businessDate) {
  const { start, end } = businessBounds(businessDate);
  const firstTrendDate = shiftDate(businessDate, -6);
  const trendStart = businessBounds(firstTrendDate).start;

  const [
    sales,
    repairPayments,
    moneyProfit,
    receivable,
    accounts,
    inventory,
    pendingRepairs,
    repairFinanceRows,
    expenseRows,
    recentExpenses,
    closingRows,
    trendRows,
    supplier,
  ] = await Promise.all([
    prisma.sale.aggregate({
      where: { shopId, status: { not: 'VOIDED' }, soldAt: { gte: start, lt: end } },
      _sum: { total: true, profitTotal: true },
      _count: { _all: true },
    }),
    prisma.repairPayment.aggregate({
      where: { shopId, status: 'PAID', paidAt: { gte: start, lt: end } },
      _sum: { amount: true },
      _count: { _all: true },
    }),
    prisma.moneyServiceTransaction.aggregate({
      where: { shopId, createdAt: { gte: start, lt: end } },
      _sum: { serviceProfit: true },
    }),
    prisma.customer.aggregate({
      where: { shopId, balance: { gt: 0 } },
      _sum: { balance: true },
      _count: { _all: true },
    }),
    prisma.moneyAccount.findMany({
      where: { shopId, active: true },
      select: { id: true, name: true, type: true, balance: true, updatedAt: true },
      orderBy: [{ type: 'asc' }, { name: 'asc' }],
    }),
    prisma.productVariant.findMany({
      where: { shopId, active: true },
      select: {
        id: true,
        variantName: true,
        sku: true,
        costPrice: true,
        product: { select: { name: true, brand: true, model: true } },
        inventoryBalance: { select: { quantity: true, minAlertQuantity: true } },
      },
    }),
    prisma.repair.count({
      where: { shopId, status: { in: ['RECEIVED', 'CHECKING', 'IN_PROGRESS', 'WAITING_PART'] } },
    }),
    prisma.$queryRawUnsafe(
      `SELECT COALESCE(SUM(final_cost),0) AS "repairRevenue",
              COALESCE(SUM(final_cost-parts_cost-technician_commission-other_cost),0) AS "repairProfit",
              COUNT(*)::int AS "completedRepairs"
         FROM repairs
        WHERE shop_id=$1::uuid
          AND status IN ('COMPLETED','DELIVERED')
          AND COALESCE(completed_at,delivered_at,updated_at)>=$2
          AND COALESCE(completed_at,delivered_at,updated_at)<$3`,
      shopId,
      start,
      end,
    ),
    prisma.$queryRawUnsafe(
      `SELECT COALESCE(SUM(amount),0) AS total,COUNT(*)::int AS count
         FROM business_expenses
        WHERE shop_id=$1::uuid AND expense_date=$2::date`,
      shopId,
      businessDate,
    ),
    prisma.$queryRawUnsafe(
      `SELECT e.id,e.expense_date AS "expenseDate",e.category,e.amount,e.method,e.note,e.created_at AS "createdAt",
              a.name AS "accountName",u.name AS "createdByName"
         FROM business_expenses e
         LEFT JOIN money_accounts a ON a.id=e.money_account_id AND a.shop_id=e.shop_id
         LEFT JOIN users u ON u.id=e.created_by_id
        WHERE e.shop_id=$1::uuid AND e.expense_date=$2::date
        ORDER BY e.created_at DESC LIMIT 8`,
      shopId,
      businessDate,
    ),
    prisma.$queryRawUnsafe(
      `SELECT dc.id,dc.closing_date AS "businessDate",dc.sales_total AS "salesTotal",
              dc.product_profit_total AS "productProfitTotal",dc.service_income_total AS "serviceIncomeTotal",
              dc.money_profit_total AS "moneyProfitTotal",dc.repair_income_total AS "repairIncomeTotal",
              dc.repair_profit_total AS "repairProfitTotal",dc.expense_total AS "expenseTotal",
              dc.receivable_total AS "receivableTotal",dc.payable_total AS "payableTotal",
              dc.total_profit AS "totalProfit",dc.cash_balance AS "cashBalance",
              dc.kpay_balance AS "kpayBalance",dc.wave_pay_balance AS "wavePayBalance",
              dc.note,dc.closed_at AS "closedAt",u.name AS "closedByName"
         FROM daily_closings dc
         LEFT JOIN users u ON u.id=dc.closed_by_id
        WHERE dc.shop_id=$1::uuid AND dc.closing_date=$2::date LIMIT 1`,
      shopId,
      businessDate,
    ),
    prisma.$queryRawUnsafe(
      `SELECT ((sold_at AT TIME ZONE 'Asia/Yangon')::date)::text AS day,
              COALESCE(SUM(total),0) AS sales,
              COALESCE(SUM(profit_total),0) AS profit,
              COUNT(*)::int AS orders
         FROM sales
        WHERE shop_id=$1::uuid AND status!='VOIDED' AND sold_at>=$2 AND sold_at<$3
        GROUP BY ((sold_at AT TIME ZONE 'Asia/Yangon')::date)
        ORDER BY day`,
      shopId,
      trendStart,
      end,
    ),
    supplierSummary(shopId, businessDate),
  ]);

  const repairFinance = repairFinanceRows[0] || {};
  const expense = expenseRows[0] || {};
  const balances = accountTotals(accounts);
  const lowStock = inventory
    .filter((row) => Number(row.inventoryBalance?.quantity || 0) <= Number(row.inventoryBalance?.minAlertQuantity || 0))
    .sort((a, b) => Number(a.inventoryBalance?.quantity || 0) - Number(b.inventoryBalance?.quantity || 0))
    .slice(0, 10)
    .map((row) => ({
      id: row.id,
      name: [row.product?.brand, row.product?.model, row.product?.name, row.variantName].filter(Boolean).join(' · '),
      sku: row.sku || '',
      quantity: Number(row.inventoryBalance?.quantity || 0),
      minAlertQuantity: Number(row.inventoryBalance?.minAlertQuantity || 0),
    }));
  const stockBalance = inventory.reduce(
    (sum, row) => sum + number(row.costPrice) * Number(row.inventoryBalance?.quantity || 0),
    0,
  );
  const trendMap = new Map(trendRows.map((row) => [row.day, row]));
  const trend = Array.from({ length: 7 }, (_, index) => {
    const day = shiftDate(firstTrendDate, index);
    const row = trendMap.get(day) || {};
    return { day, sales: number(row.sales), profit: number(row.profit), orders: Number(row.orders || 0) };
  });

  const todaySaleIncome = number(sales._sum.total);
  const productProfit = number(sales._sum.profitTotal);
  const repairIncome = number(repairPayments._sum.amount);
  const repairRevenue = number(repairFinance.repairRevenue);
  const repairProfit = number(repairFinance.repairProfit);
  const serviceProfit = number(moneyProfit._sum.serviceProfit);
  const todayExpense = number(expense.total);
  const todayTotalIncome = todaySaleIncome + repairIncome + serviceProfit;
  const todayProfit = productProfit + repairProfit + serviceProfit - todayExpense;

  return {
    businessDate,
    timezone: 'Asia/Yangon',
    generatedAt: new Date().toISOString(),
    isToday: businessDate === currentYangonDate(),
    dashboard: {
      todayTotalIncome,
      todaySaleIncome,
      productProfit,
      repairIncome,
      repairRevenue,
      repairProfit,
      moneyServiceProfit: serviceProfit,
      todayProfit,
      todayExpense,
      receivable: number(receivable._sum.balance),
      payable: supplier.payable,
      supplierPaidToday: supplier.paidToday,
      accountBalance: balances.TOTAL,
      stockBalance,
      todayOrders: Number(sales._count._all || 0),
      repairPayments: Number(repairPayments._count._all || 0),
      completedRepairs: Number(repairFinance.completedRepairs || 0),
      pendingRepairs,
      lowStockCount: lowStock.length,
      expenseCount: Number(expense.count || 0),
      receivableCustomers: Number(receivable._count._all || 0),
    },
    accountBalances: balances,
    accounts: accounts.map((account) => ({ ...account, balance: number(account.balance) })),
    lowStock,
    trend,
    recentExpenses: recentExpenses.map((row) => ({ ...row, amount: number(row.amount) })),
    closing: closingJson(closingRows[0]),
  };
}

async function audit(req, action, entityType, entityId, details) {
  try {
    await prisma.auditLog.create({
      data: {
        shopId: req.auth.shopId,
        userId: req.auth.userId,
        action,
        entityType,
        entityId,
        details,
        ipAddress: req.ip || null,
        userAgent: req.headers['user-agent'] || null,
      },
    });
  } catch (error) {
    console.warn(`${action} succeeded but audit logging failed:`, error.message);
  }
}

function attachBusinessControlApi(app) {
  const read = [requireAuth, requireShopUser, requireAccountingRead];
  const write = [requireAuth, requireShopUser, requireWritableSubscription, requireAccountingWrite];
  const close = [requireAuth, requireShopUser, requireWritableSubscription, requireManager];

  app.get('/api/business-control/overview', ...read, wrap(async (req, res) => {
    const businessDate = parseBusinessDate(req.query.date);
    res.json({ ok: true, ...(await buildOverview(req.auth.shopId, businessDate)) });
  }));

  app.post('/api/business-control/expenses', ...write, wrap(async (req, res) => {
    const expenseDate = parseBusinessDate(req.body?.expenseDate);
    if (expenseDate > currentYangonDate()) throw new ApiError(400, 'Future expense dates are not allowed');
    const category = clean(req.body?.category, 80);
    const amount = Number(req.body?.amount);
    const method = clean(req.body?.method || 'CASH', 20).toUpperCase();
    const note = clean(req.body?.note, 500) || null;
    const requestedAccountId = clean(req.body?.moneyAccountId, 50) || null;
    if (!category) throw new ApiError(400, 'Expense category is required');
    if (!Number.isFinite(amount) || amount <= 0) throw new ApiError(400, 'Expense amount must be greater than zero');
    if (!PAYMENT_METHODS.has(method)) throw new ApiError(400, 'Expense method is invalid');

    const id = crypto.randomUUID();
    await prisma.$transaction(async (tx) => {
      let account = null;
      if (requestedAccountId) {
        account = await tx.moneyAccount.findFirst({ where: { id: requestedAccountId, shopId: req.auth.shopId, active: true } });
        if (!account) throw new ApiError(404, 'Money account was not found');
      } else {
        account = await tx.moneyAccount.findFirst({
          where: { shopId: req.auth.shopId, active: true, type: method },
          orderBy: { createdAt: 'asc' },
        });
      }

      if (account) {
        const before = number(account.balance);
        const after = before - amount;
        if (after < -0.005) throw new ApiError(409, `Insufficient ${account.name} balance`);
        await tx.moneyAccount.update({ where: { id: account.id }, data: { balance: after } });
        await tx.moneyServiceTransaction.create({
          data: {
            shopId: req.auth.shopId,
            accountId: account.id,
            type: 'ACCOUNT_ADJUSTMENT',
            feeMode: 'MANUAL',
            cashChange: account.type === 'CASH' ? -amount : 0,
            walletChange: account.type === 'CASH' ? 0 : -amount,
            beforeCashBalance: account.type === 'CASH' ? before : 0,
            afterCashBalance: account.type === 'CASH' ? after : 0,
            beforeWalletBalance: account.type === 'CASH' ? 0 : before,
            afterWalletBalance: account.type === 'CASH' ? 0 : after,
            userId: req.auth.userId,
            note: `[EXPENSE:${category}] ${note || ''}`.trim(),
          },
        });
      }

      await tx.$executeRawUnsafe(
        `INSERT INTO business_expenses (id,shop_id,expense_date,category,amount,method,money_account_id,note,created_by_id,created_at)
         VALUES ($1::uuid,$2::uuid,$3::date,$4,$5,$6,$7::uuid,$8,$9::uuid,NOW())`,
        id,
        req.auth.shopId,
        expenseDate,
        category,
        amount,
        method,
        account?.id || null,
        note,
        req.auth.userId,
      );
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5000, timeout: 20000 });

    await audit(req, 'BUSINESS_EXPENSE_CREATED', 'business_expense', id, { expenseDate, category, amount, method, note });
    res.status(201).json({ ok: true, message: 'Expense saved', ...(await buildOverview(req.auth.shopId, expenseDate)) });
  }));

  app.post('/api/business-control/daily-closing', ...close, wrap(async (req, res) => {
    const businessDate = parseBusinessDate(req.body?.businessDate);
    if (businessDate > currentYangonDate()) throw new ApiError(400, 'Future business dates cannot be closed');
    const note = clean(req.body?.note, 500) || null;
    const snapshot = await buildOverview(req.auth.shopId, businessDate);
    if (snapshot.closing) throw new ApiError(409, 'This business day is already closed');

    const id = crypto.randomUUID();
    const values = snapshot.dashboard;
    const balances = snapshot.accountBalances;
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `INSERT INTO daily_closings (
           id,shop_id,closing_date,sales_total,product_profit_total,service_income_total,money_profit_total,
           cash_balance,kpay_balance,wave_pay_balance,created_at,updated_at,repair_income_total,
           repair_profit_total,expense_total,receivable_total,payable_total,total_profit,closed_by_id,note,closed_at
         ) VALUES (
           $1::uuid,$2::uuid,$3::date,$4,$5,$6,$7,$8,$9,$10,NOW(),NOW(),$11,$12,$13,$14,$15,$16,$17::uuid,$18,NOW()
         )`,
        id,
        req.auth.shopId,
        businessDate,
        values.todaySaleIncome,
        values.productProfit,
        values.repairRevenue,
        values.moneyServiceProfit,
        balances.CASH,
        balances.KPAY,
        balances.WAVE_PAY,
        values.repairIncome,
        values.repairProfit,
        values.todayExpense,
        values.receivable,
        values.payable,
        values.todayProfit,
        req.auth.userId,
        note,
      );
      await tx.auditLog.create({
        data: {
          shopId: req.auth.shopId,
          userId: req.auth.userId,
          action: 'BUSINESS_DAY_CLOSED',
          entityType: 'daily_closing',
          entityId: id,
          details: { businessDate, note, dashboard: values, accountBalances: balances },
          ipAddress: req.ip || null,
          userAgent: req.headers['user-agent'] || null,
        },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5000, timeout: 20000 });

    res.status(201).json({ ok: true, message: `${businessDate} business day closed`, ...(await buildOverview(req.auth.shopId, businessDate)) });
  }));
}

module.exports = attachBusinessControlApi;
