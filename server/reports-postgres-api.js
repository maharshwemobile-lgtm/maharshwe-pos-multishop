const { prisma } = require('./prisma');
const {
  ACTIVE_SALE_STATUSES,
  round,
  resolvePeriod,
} = require('./report-utils');

const number = (value) => Number(value || 0);
const isoDate = (value) => new Date(value).toISOString().slice(0, 10);
const {
  buildTrend,
  buildPaymentMix,
  buildProductReports,
  buildStaff,
  buildRepairReports,
  buildSummary,
} = require('./report-builders');
const { requireAuth, requireShopUser } = require('./auth-api');
const {
  businessRecordCategories,
  normalizeBusinessRecordCategory,
} = require('./business-record-categories');

function requireReportAccess(req, res, next) {
  if (req.auth?.role === 'SUPER_ADMIN' || req.auth?.role === 'SHOP_ADMIN') return next();
  const permissions = req.auth?.permissions || {};
  if (permissions.accounting === true || permissions.history === true || permissions.sale === true) return next();
  return res.status(403).json({ ok: false, message: 'Insufficient reports permission' });
}

const categoryValue = (type, englishName) => (
  businessRecordCategories[type].find((item) => item.en === englishName)?.value
);

const OTHER_INCOME_CATEGORY_KEYS = {
  otherServiceIncome: categoryValue('income', 'Other Service Income'),
  otherSaleIncome: categoryValue('income', 'Other Sales Income'),
  otherTopupIncome: categoryValue('income', 'Other Top-up Income'),
  otherOtherIncome: categoryValue('income', 'Other Income'),
};

// Cash float categories. Deliberately outside the four bucket maps above, so
// businessRecordMetric returns null for them and the income and expense
// totals never see them — they are reported, not counted.
const CASH_SUMMARY_CATEGORY_KEYS = {
  income: { ownerCashIn: categoryValue('income', 'Income From Owner') },
  expense: { cashierCashOut: categoryValue('expense', 'Expense From Casher') },
};

const OTHER_EXPENSE_CATEGORY_KEYS = {
  otherServiceExpense: categoryValue('expense', 'Other Service Expense'),
  otherSaleExpense: categoryValue('expense', 'Other Sales Expense'),
  otherTopupExpense: categoryValue('expense', 'Other Top-up Expense'),
  otherOtherExpense: categoryValue('expense', 'Other Expense'),
};

function businessRecordMetric(type, category) {
  const normalized = normalizeBusinessRecordCategory(type, category);
  const keys = type === 'expense' ? OTHER_EXPENSE_CATEGORY_KEYS : OTHER_INCOME_CATEGORY_KEYS;
  return Object.keys(keys).find((key) => keys[key] === normalized) || null;
}

function mergeBusinessRecordRows(target, rows, type) {
  const cashKeys = CASH_SUMMARY_CATEGORY_KEYS[type] || {};
  for (const raw of rows || []) {
    const bucket = String(raw.bucket || '');
    if (!bucket) continue;
    const normalized = normalizeBusinessRecordCategory(type, raw.category);
    const cashMetric = Object.keys(cashKeys).find((key) => cashKeys[key] === normalized);
    if (cashMetric) {
      const cashRow = target.get(bucket) || emptyCloseRow(bucket);
      cashRow[cashMetric] = round(Number(cashRow[cashMetric] || 0) + number(raw.amount));
      target.set(bucket, cashRow);
      continue;
    }
    const metric = businessRecordMetric(type, raw.category);
    if (!metric) continue;
    const row = target.get(bucket) || emptyCloseRow(bucket);
    row[metric] = round(Number(row[metric] || 0) + number(raw.amount));
    target.set(bucket, row);
  }
}

function closePeriod(value) {
  const normalized = String(value || '').toLowerCase();
  if (normalized === 'monthly' || normalized === 'month') return 'monthly';
  if (normalized === 'yearly' || normalized === 'year') return 'yearly';
  return 'daily';
}

function bucketExpression(dateExpression, period) {
  if (period === 'monthly') return `TO_CHAR(${dateExpression}, 'YYYY-MM')`;
  if (period === 'yearly') return `TO_CHAR(${dateExpression}, 'YYYY')`;
  return `TO_CHAR(${dateExpression}, 'YYYY-MM-DD')`;
}

function bucketStartExpression(dateExpression, period) {
  if (period === 'monthly') return `DATE_TRUNC('month', ${dateExpression})::date`;
  if (period === 'yearly') return `DATE_TRUNC('year', ${dateExpression})::date`;
  return `${dateExpression}::date`;
}

function emptyCloseRow(bucket) {
  return {
    bucket,
    salePosIncome: 0,
    salePosExpense: 0,
    salePosProfit: 0,
    saleCount: 0,
    servicePosIncome: 0,
    servicePosExpense: 0,
    servicePosProfit: 0,
    moneyServiceFee: 0,
    billOpeningBalance: 0,
    billRefill: 0,
    billSoldVolume: 0,
    billAdjustment: 0,
    billClosingBalance: 0,
    billEloadProfit: 0,
    otherSaleIncome: 0,
    otherServiceIncome: 0,
    otherTopupIncome: 0,
    otherOtherIncome: 0,
    otherIncomeSubtotal: 0,
    otherSaleExpense: 0,
    otherServiceExpense: 0,
    otherTopupExpense: 0,
    otherOtherExpense: 0,
    otherExpenseSubtotal: 0,
    incomeTotal: 0,
    expenseTotal: 0,
    netProfit: 0,
    closedDays: 0,
    cashierCashIn: 0,
    ownerCashIn: 0,
    cashierCashOut: 0,
    cashReturnToOwner: 0,
    lastClosedAt: null,
  };
}

function mergeCloseRows(target, rows, mapper) {
  for (const raw of rows || []) {
    const bucket = String(raw.bucket || '');
    if (!bucket) continue;
    const row = target.get(bucket) || emptyCloseRow(bucket);
    mapper(row, raw);
    target.set(bucket, row);
  }
}

async function buildDailyCloseReport(shopId, from, to, requestedPeriod) {
  const period = closePeriod(requestedPeriod);
  const fromDay = isoDate(from);
  const toDay = isoDate(to);
  const saleDate = `((sold_at AT TIME ZONE 'Asia/Yangon')::date)`;
  const repairDate = `((COALESCE(completed_at,delivered_at,updated_at) AT TIME ZONE 'Asia/Yangon')::date)`;
  const serviceDate = `((created_at AT TIME ZONE 'Asia/Yangon')::date)`;
  const paymentDate = `((created_at AT TIME ZONE 'Asia/Yangon')::date)`;
  const saleBucket = bucketExpression(saleDate, period);
  const repairBucket = bucketExpression(repairDate, period);
  const serviceBucket = bucketExpression(serviceDate, period);
  const billerBucket = bucketExpression('transaction_date', period);
  const billerBucketStart = bucketStartExpression('transaction_date', period);
  const recordBucket = bucketExpression('income_date', period);
  const expenseBucket = bucketExpression('expense_date', period);
  const closeBucket = bucketExpression('closing_date', period);

  const [
    saleRows,
    repairRows,
    moneyServiceRows,
    billerRows,
    incomeRows,
    expenseRows,
    closingRows,
  ] = await Promise.all([
    prisma.$queryRawUnsafe(
      `SELECT ${saleBucket} AS bucket,
              COALESCE(SUM(total),0) AS "salePosIncome",
              COALESCE(SUM(total-profit_total),0) AS "salePosExpense",
              COALESCE(SUM(profit_total),0) AS "salePosProfit",
              COUNT(*)::int AS "saleCount"
         FROM sales
        WHERE shop_id=$1::uuid
          AND status IN ('COMPLETED','PARTIAL_RETURN')
          AND ${saleDate} >= $2::date
          AND ${saleDate} <= $3::date
        GROUP BY 1`,
      shopId,
      fromDay,
      toDay,
    ).catch(() => []),
    prisma.$queryRawUnsafe(
      `SELECT ${repairBucket} AS bucket,
              COALESCE(SUM(final_cost),0) AS "servicePosIncome",
              COALESCE(SUM(final_cost-parts_cost-technician_commission-other_cost),0) AS "servicePosProfit",
              COALESCE(SUM(parts_cost+technician_commission+other_cost),0) AS "servicePosExpense"
         FROM repairs
        WHERE shop_id=$1::uuid
          AND status IN ('COMPLETED','DELIVERED')
          AND ${repairDate} >= $2::date
          AND ${repairDate} <= $3::date
        GROUP BY 1`,
      shopId,
      fromDay,
      toDay,
    ).catch(() => []),
    prisma.$queryRawUnsafe(
      `SELECT ${serviceBucket} AS bucket,
              COALESCE(SUM(service_profit),0) AS "moneyServiceFee"
         FROM money_service_transactions
        WHERE shop_id=$1::uuid
          AND ${serviceDate} >= $2::date
          AND ${serviceDate} <= $3::date
        GROUP BY 1`,
      shopId,
      fromDay,
      toDay,
    ).catch(() => []),
    prisma.$queryRawUnsafe(
      `WITH buckets AS (
          SELECT DISTINCT ${billerBucket} AS bucket,
                 ${billerBucketStart} AS bucket_start
           FROM biller_transactions
           WHERE shop_id=$1::uuid
             AND voided_at IS NULL
             AND transaction_date::date >= $2::date
             AND transaction_date::date <= $3::date
        ),
        scoped AS (
          SELECT ${billerBucket} AS bucket,
                 transaction_type,
                 amount,
                 COALESCE(balance_effect_amount,0) AS balance_effect_amount,
                 COALESCE(profit_amount,0) AS profit_amount
            FROM biller_transactions
           WHERE shop_id=$1::uuid
             AND voided_at IS NULL
             AND transaction_date::date >= $2::date
             AND transaction_date::date <= $3::date
        )
        SELECT b.bucket,
               (
                 COALESCE((SELECT SUM(opening_balance) FROM billers WHERE shop_id=$1::uuid AND is_active=TRUE),0)
                 + COALESCE((
                    SELECT SUM(CASE
                      WHEN t2.transaction_type IN ('REFILL','ADJUSTMENT') THEN t2.amount
                      WHEN t2.transaction_type='SOLD' THEN -COALESCE(NULLIF(t2.balance_effect_amount,0),t2.amount)
                      ELSE 0
                    END)
                    FROM biller_transactions t2
                    WHERE t2.shop_id=$1::uuid
                      AND t2.voided_at IS NULL
                      AND t2.transaction_date::date < b.bucket_start
                 ),0)
               ) AS "billOpeningBalance",
               COALESCE(SUM(s.amount) FILTER (WHERE s.transaction_type='REFILL'),0) AS "billRefill",
               COALESCE(SUM(s.amount) FILTER (WHERE s.transaction_type='SOLD'),0) AS "billSoldVolume",
               COALESCE(SUM(COALESCE(NULLIF(s.balance_effect_amount,0),s.amount)) FILTER (WHERE s.transaction_type='SOLD'),0) AS "billBalanceSold",
               COALESCE(SUM(s.amount) FILTER (WHERE s.transaction_type='ADJUSTMENT'),0) AS "billAdjustment",
               COALESCE(SUM(s.profit_amount) FILTER (WHERE s.transaction_type='SOLD'),0) AS "billEloadProfit"
          FROM buckets b
          LEFT JOIN scoped s ON s.bucket=b.bucket
         GROUP BY b.bucket,b.bucket_start`,
      shopId,
      fromDay,
      toDay,
    ).catch(() => []),
    prisma.$queryRawUnsafe(
      `SELECT ${recordBucket} AS bucket,
              category,
              COALESCE(SUM(amount),0) AS amount
         FROM business_other_income
        WHERE shop_id=$1::uuid
          AND income_date >= $2::date
          AND income_date <= $3::date
        GROUP BY 1,2`,
      shopId,
      fromDay,
      toDay,
    ).catch(() => []),
    prisma.$queryRawUnsafe(
      `SELECT ${expenseBucket} AS bucket,
              category,
              COALESCE(SUM(amount),0) AS amount
         FROM business_expenses
        WHERE shop_id=$1::uuid
          AND expense_date >= $2::date
          AND expense_date <= $3::date
        GROUP BY 1,2`,
      shopId,
      fromDay,
      toDay,
    ).catch(() => []),
    prisma.$queryRawUnsafe(
      `SELECT ${closeBucket} AS bucket,
              COUNT(*)::int AS "closedDays",
              MAX(closed_at) AS "lastClosedAt"
         FROM daily_closings
        WHERE shop_id=$1::uuid
          AND closing_date >= $2::date
          AND closing_date <= $3::date
        GROUP BY 1`,
      shopId,
      fromDay,
      toDay,
    ).catch(() => []),
  ]);

  const map = new Map();
  mergeCloseRows(map, saleRows, (row, raw) => {
    row.salePosIncome = round(raw.salePosIncome);
    row.salePosExpense = round(raw.salePosExpense);
    row.salePosProfit = round(raw.salePosProfit);
    row.saleCount = Number(raw.saleCount || 0);
  });
  mergeCloseRows(map, repairRows, (row, raw) => {
    row.servicePosIncome = round(raw.servicePosIncome);
    row.servicePosExpense = round(raw.servicePosExpense);
    row.servicePosProfit = round(raw.servicePosProfit);
  });
  mergeCloseRows(map, moneyServiceRows, (row, raw) => {
    row.moneyServiceFee = round(raw.moneyServiceFee);
  });
  mergeCloseRows(map, billerRows, (row, raw) => {
    row.billOpeningBalance = round(raw.billOpeningBalance);
    row.billRefill = round(raw.billRefill);
    row.billSoldVolume = round(raw.billSoldVolume);
    row.billBalanceSold = round(raw.billBalanceSold);
    row.billAdjustment = round(raw.billAdjustment);
    row.billEloadProfit = round(raw.billEloadProfit);
  });
  mergeBusinessRecordRows(map, incomeRows, 'income');
  mergeBusinessRecordRows(map, expenseRows, 'expense');
  mergeCloseRows(map, closingRows, (row, raw) => {
    row.closedDays = Number(raw.closedDays || 0);
    row.lastClosedAt = raw.lastClosedAt || null;
  });
  const rows = [...map.values()]
    .map((row) => {
      row.otherTopupIncome = round(Number(row.otherTopupIncome || 0) + Number(row.billSoldVolume || 0));
      const otherIncomeSubtotal = row.otherSaleIncome + row.otherServiceIncome + row.otherTopupIncome + row.otherOtherIncome;
      const otherExpenseSubtotal = row.otherSaleExpense + row.otherServiceExpense + row.otherTopupExpense + row.otherOtherExpense;
      const billOpeningBalance = row.billOpeningBalance;
      const billClosingBalance = billOpeningBalance + row.billRefill - (row.billBalanceSold || row.billSoldVolume) + row.billAdjustment;
      const incomeTotal = row.salePosIncome + row.servicePosIncome + row.moneyServiceFee + row.billEloadProfit + otherIncomeSubtotal;
      const expenseTotal = row.salePosExpense + row.servicePosExpense + otherExpenseSubtotal;
      // Cash Summary. The first two are recorded on Other Records; the money
      // the cashier still owes back is whatever the day took in beyond them.
      const ownerCashIn = Number(row.ownerCashIn || 0);
      const cashierCashOut = Number(row.cashierCashOut || 0);
      return {
        ...row,
        billOpeningBalance: round(billOpeningBalance),
        billClosingBalance: round(billClosingBalance),
        otherIncomeSubtotal: round(otherIncomeSubtotal),
        otherExpenseSubtotal: round(otherExpenseSubtotal),
        incomeTotal: round(incomeTotal),
        expenseTotal: round(expenseTotal),
        netProfit: round(incomeTotal - expenseTotal),
        cashierCashIn: round(incomeTotal - ownerCashIn),
        ownerCashIn: round(ownerCashIn),
        cashierCashOut: round(cashierCashOut),
        cashReturnToOwner: round(incomeTotal - ownerCashIn - cashierCashOut),
      };
    })
    .sort((a, b) => b.bucket.localeCompare(a.bucket));

  const totals = rows.reduce((acc, row) => {
    for (const key of Object.keys(acc)) acc[key] += Number(row[key] || 0);
    return acc;
  }, {
    salePosIncome: 0,
    salePosExpense: 0,
    salePosProfit: 0,
    saleCount: 0,
    servicePosIncome: 0,
    servicePosExpense: 0,
    servicePosProfit: 0,
    moneyServiceFee: 0,
    billOpeningBalance: 0,
    billRefill: 0,
    billSoldVolume: 0,
    billBalanceSold: 0,
    billAdjustment: 0,
    billClosingBalance: 0,
    billEloadProfit: 0,
    otherSaleIncome: 0,
    otherServiceIncome: 0,
    otherTopupIncome: 0,
    otherOtherIncome: 0,
    otherIncomeSubtotal: 0,
    otherSaleExpense: 0,
    otherServiceExpense: 0,
    otherTopupExpense: 0,
    otherOtherExpense: 0,
    otherExpenseSubtotal: 0,
    incomeTotal: 0,
    expenseTotal: 0,
    netProfit: 0,
    closedDays: 0,
    cashierCashIn: 0,
    ownerCashIn: 0,
    cashierCashOut: 0,
    cashReturnToOwner: 0,
  });

  for (const key of Object.keys(totals)) totals[key] = round(totals[key]);

  return {
    period,
    from: fromDay,
    to: toDay,
    rows,
    totals,
    categories: {
      income: OTHER_INCOME_CATEGORY_KEYS,
      expense: OTHER_EXPENSE_CATEGORY_KEYS,
    },
  };
}

function attachReportsPostgresApi(app) {
  const access = [requireAuth, requireShopUser, requireReportAccess];

  app.get('/api/reports/daily-close', ...access, async (req, res) => {
    try {
      const date = String(req.query.date || new Date().toISOString().slice(0, 10)).slice(0, 10);
      const fromDate = String(req.query.from || date).slice(0, 10);
      const toDate = String(req.query.to || date).slice(0, 10);
      const start = new Date(`${fromDate}T00:00:00.000+06:30`);
      const end = new Date(`${toDate}T23:59:59.999+06:30`);
      const report = await buildDailyCloseReport(req.auth.shopId, start, end, req.query.closePeriod || 'daily');
      return res.json({ ok: true, date, report });
    } catch (error) {
      return res.status(500).json({ ok: false, message: error.message || 'Daily close report failed' });
    }
  });

  app.get('/api/reports/business', ...access, async (req, res) => {
    try {
      const { from, to, days, previousFrom, previousTo } = resolvePeriod(req.query || {});
      const shopId = req.auth.shopId;
      const [
        shop,
        sales,
        previousSales,
        salePayments,
        repairPayments,
        repairs,
        customers,
        inventory,
        accounts,
        serviceTransactions,
      ] = await Promise.all([
        prisma.shop.findUnique({
          where: { id: shopId },
          select: { businessType: true },
        }),
        prisma.sale.findMany({
          where: { shopId, soldAt: { gte: from, lte: to } },
          include: {
            items: true,
            user: { select: { id: true, name: true, username: true } },
            customer: { select: { id: true, name: true, phone: true } },
          },
          orderBy: { soldAt: 'asc' },
          take: 10000,
        }),
        prisma.sale.findMany({
          where: {
            shopId,
            status: { in: ACTIVE_SALE_STATUSES },
            soldAt: { gte: previousFrom, lte: previousTo },
          },
          select: { total: true, profitTotal: true },
          take: 10000,
        }),
        prisma.payment.findMany({
          where: { shopId, status: 'PAID', paidAt: { gte: from, lte: to } },
          select: { method: true, amount: true, paidAt: true },
          take: 20000,
        }),
        prisma.repairPayment.findMany({
          where: { shopId, status: 'PAID', paidAt: { gte: from, lte: to } },
          select: { method: true, amount: true, paidAt: true },
          take: 20000,
        }),
        prisma.repair.findMany({
          where: { shopId, receivedAt: { gte: from, lte: to } },
          select: {
            id: true,
            status: true,
            finalCost: true,
            estimatedCost: true,
            receivedAt: true,
            completedAt: true,
            deliveredAt: true,
            technician: { select: { id: true, name: true, username: true } },
          },
          take: 10000,
        }),
        prisma.customer.findMany({
          where: { shopId },
          select: { id: true, name: true, phone: true, balance: true },
          take: 10000,
        }),
        prisma.inventoryBalance.findMany({
          where: { shopId },
          include: {
            productVariant: {
              select: {
                id: true,
                variantName: true,
                sku: true,
                barcode: true,
                unit: true,
                expiryDate: true,
                costPrice: true,
                standardSellingPrice: true,
                wholesalePrice: true,
                category: { select: { id: true, name: true } },
                product: { select: { id: true, name: true, brand: true } },
              },
            },
          },
          take: 20000,
        }),
        prisma.moneyAccount.findMany({
          where: { shopId, active: true },
          select: { id: true, name: true, type: true, balance: true },
          orderBy: { name: 'asc' },
        }),
        prisma.moneyServiceTransaction.findMany({
          where: { shopId, createdAt: { gte: from, lte: to } },
          select: { serviceProfit: true, createdAt: true, type: true },
          take: 20000,
        }),
      ]);

      const { activeSales, summary } = buildSummary({
        sales,
        previousSales,
        salePayments,
        repairPayments,
        repairs,
        customers,
        inventory,
        serviceTransactions,
      });
      const productReports = buildProductReports(activeSales);
      const repairReports = buildRepairReports(repairs);
      const dailyCloseReport = await buildDailyCloseReport(shopId, from, to, req.query?.closePeriod);
      res.json({
        ok: true,
        period: {
          from: from.toISOString(),
          to: to.toISOString(),
          days,
          previousFrom: previousFrom.toISOString(),
          previousTo: previousTo.toISOString(),
        },
        summary,
        trend: buildTrend(from, to, activeSales, salePayments, repairPayments),
        paymentMix: buildPaymentMix(salePayments, repairPayments),
        topProducts: productReports.topProducts,
        categories: productReports.categories,
        staff: buildStaff(activeSales),
        repairStatuses: repairReports.repairStatuses,
        technicians: repairReports.technicians,
        dailyCloseReport,
        accounts: accounts.map((account) => ({
          id: account.id,
          name: account.name,
          type: account.type,
          balance: round(account.balance),
        })),
      });
    } catch (error) {
      console.error('Business report failed:', error);
      res.status(error.status || 500).json({ ok: false, message: error.message || 'Business report failed' });
    }
  });
}

module.exports = attachReportsPostgresApi;
module.exports.buildDailyCloseReport = buildDailyCloseReport;
