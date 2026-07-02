const { prisma } = require('./prisma');
const { requireAuth, requireShopUser } = require('./auth-api');

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

const number = (value) => Number(value || 0);
function field(row, ...names) {
  for (const name of names) {
    if (row?.[name] !== undefined) return row[name];
  }
  return undefined;
}

async function ensureColumns() {
  await prisma.$executeRawUnsafe('ALTER TABLE payments ADD COLUMN IF NOT EXISTS payment_method_id UUID REFERENCES finance_payment_methods(id) ON DELETE SET NULL');
  await prisma.$executeRawUnsafe('ALTER TABLE payments ADD COLUMN IF NOT EXISTS payment_method_name_snapshot TEXT');
}

function groupedLegacy(rows) {
  const totals = { CASH: 0, KPAY: 0, WAVE_PAY: 0, OTHER: 0 };
  for (const row of rows || []) {
    const type = METHOD_TO_TYPE[row.method] || 'OTHER';
    totals[type] += number(row.amount);
  }
  return totals;
}

async function correctAccountResponse(shopId, body) {
  if (!body?.accounts || !Array.isArray(body.accounts)) return body;
  await ensureColumns();

  const [dynamicRows, legacyRows, repairRows, adjustmentRows, accountRows] = await Promise.all([
    prisma.$queryRawUnsafe(
      `SELECT m.account_id AS "accountId",COALESCE(SUM(p.amount),0) AS amount
         FROM payments p
         JOIN finance_payment_methods m ON m.id=p.payment_method_id
        WHERE p.shop_id=$1::uuid AND p.status='PAID' AND m.account_id IS NOT NULL
        GROUP BY m.account_id`,
      shopId,
    ),
    prisma.$queryRawUnsafe(
      `SELECT method::text AS method,COALESCE(SUM(amount),0) AS amount
         FROM payments
        WHERE shop_id=$1::uuid AND status='PAID' AND payment_method_id IS NULL
        GROUP BY method`,
      shopId,
    ),
    prisma.$queryRawUnsafe(
      `SELECT method::text AS method,COALESCE(SUM(amount),0) AS amount
         FROM repair_payments
        WHERE shop_id=$1::uuid AND status='PAID'
        GROUP BY method`,
      shopId,
    ),
    prisma.$queryRawUnsafe(
      `SELECT account_id AS "accountId",COALESCE(SUM(cash_change+wallet_change),0) AS amount
         FROM money_service_transactions
        WHERE shop_id=$1::uuid AND account_id IS NOT NULL
        GROUP BY account_id`,
      shopId,
    ),
    prisma.moneyAccount.findMany({
      where: { shopId, active: true },
      orderBy: [{ type: 'asc' }, { createdAt: 'asc' }],
    }),
  ]);

  const dynamic = new Map(dynamicRows.map((row) => [field(row, 'accountId', 'accountid'), number(row.amount)]));
  const adjustments = new Map(adjustmentRows.map((row) => [field(row, 'accountId', 'accountid'), number(row.amount)]));
  const legacy = groupedLegacy(legacyRows);
  const repairs = groupedLegacy(repairRows);
  const defaultByType = new Map();
  for (const definition of DEFAULT_ACCOUNTS) {
    const found = accountRows.find((account) => account.name === definition.name);
    if (found) defaultByType.set(definition.type, found.id);
  }

  const corrected = [];
  for (const account of accountRows) {
    const legacyBase = defaultByType.get(account.type) === account.id
      ? number(legacy[account.type]) + number(repairs[account.type])
      : 0;
    const balance = legacyBase + number(dynamic.get(account.id)) + number(adjustments.get(account.id));
    if (Math.abs(number(account.balance) - balance) > 0.005) {
      await prisma.moneyAccount.update({ where: { id: account.id }, data: { balance } });
    }
    corrected.push({
      id: account.id,
      type: account.type,
      name: account.name,
      balance,
      active: account.active,
      updatedAt: account.updatedAt,
    });
  }

  const saleIds = new Set((body.transactions || [])
    .filter((row) => row.source === 'SALE' && String(row.id || '').startsWith('sale:'))
    .map((row) => String(row.id).slice(5)));
  let labels = new Map();
  if (saleIds.size) {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT p.id,COALESCE(p.payment_method_name_snapshot,m.name) AS name,
              COALESCE(a.type::text,CASE WHEN p.method='CASH' THEN 'CASH' WHEN p.method='KPAY' THEN 'KPAY' WHEN p.method='WAVE_PAY' THEN 'WAVE_PAY' ELSE 'OTHER' END) AS "accountType"
         FROM payments p
         LEFT JOIN finance_payment_methods m ON m.id=p.payment_method_id
         LEFT JOIN money_accounts a ON a.id=m.account_id
        WHERE p.shop_id=$1::uuid
        ORDER BY p.paid_at DESC
        LIMIT 1000`,
      shopId,
    );
    labels = new Map(rows.filter((row) => saleIds.has(row.id)).map((row) => [row.id, row]));
  }

  const transactions = (body.transactions || []).map((row) => {
    if (row.source !== 'SALE' || !String(row.id || '').startsWith('sale:')) return row;
    const label = labels.get(String(row.id).slice(5));
    return label ? { ...row, accountName: label.name || row.accountName, accountType: label.accountType || row.accountType } : row;
  });

  return {
    ...body,
    accounts: corrected,
    transactions,
    summary: {
      ...(body.summary || {}),
      totalBalance: corrected.reduce((sum, account) => sum + number(account.balance), 0),
      activeAccounts: corrected.length,
    },
  };
}

function attachPaymentsAccountsDynamicV23(app) {
  app.use('/api/payments/accounts', requireAuth, requireShopUser, (req, res, next) => {
    if (req.method !== 'GET') return next();
    const originalJson = res.json.bind(res);
    let handled = false;
    res.json = (body) => {
      if (handled) return res;
      handled = true;
      if (res.statusCode < 200 || res.statusCode >= 300) return originalJson(body);
      correctAccountResponse(req.auth.shopId, body)
        .then((corrected) => originalJson(corrected))
        .catch((error) => {
          console.error('Dynamic payment account correction:', error);
          originalJson(body);
        });
      return res;
    };
    return next();
  });
}

module.exports = attachPaymentsAccountsDynamicV23;
