const { z } = require('zod');
const { prisma } = require('./prisma');
const { requireAuth, requireShopUser, requirePermission } = require('./auth-api');
const { ensureSchema: ensureFinanceSettingsSchema } = require('./finance-settings-v23-api');
const { syncActiveAccounts } = require('./pos-all-wallets-v24');

const uuid = z.string().uuid();
let schemaPromise;

function normalizeCode(value) {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function normalizeName(value) {
  return String(value || '').trim().toLowerCase();
}

function field(row, ...names) {
  for (const name of names) {
    if (row?.[name] !== undefined) return row[name];
  }
  return undefined;
}

function legacyMethod(row) {
  const code = normalizeCode(row?.code);
  if (row?.kind === 'CASH' || code === 'CASH') return 'CASH';
  if (code === 'KPAY' || code === 'KBZPAY' || code === 'KBZ_PAY') return 'KPAY';
  if (code === 'WAVE_PAY' || code === 'WAVEPAY') return 'WAVE_PAY';
  return 'OTHER';
}

function accountTypeFor(row) {
  const legacy = legacyMethod(row);
  if (legacy === 'CASH') return 'CASH';
  if (legacy === 'KPAY') return 'KPAY';
  if (legacy === 'WAVE_PAY') return 'WAVE_PAY';
  return 'OTHER';
}

function safeLegacy(value) {
  const normalized = normalizeCode(value);
  return ['CASH', 'KPAY', 'WAVE_PAY', 'OTHER'].includes(normalized) ? normalized : 'OTHER';
}

async function ensureSchema() {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      await ensureFinanceSettingsSchema();
      await prisma.$executeRawUnsafe('ALTER TABLE payments ADD COLUMN IF NOT EXISTS payment_method_id UUID REFERENCES finance_payment_methods(id) ON DELETE SET NULL');
      await prisma.$executeRawUnsafe('ALTER TABLE payments ADD COLUMN IF NOT EXISTS payment_method_name_snapshot TEXT');
      await prisma.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS payments_shop_dynamic_method_paid_idx ON payments(shop_id,payment_method_id,paid_at DESC)');
      return true;
    })().catch((error) => { schemaPromise = null; throw error; });
  }
  return schemaPromise;
}

async function seedDefaults(shopId, userId) {
  await ensureSchema();
  await syncActiveAccounts(shopId, userId);
}

async function fetchMethodRow(shopId, clause, ...params) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT m.id,m.name,m.code,m.kind,m.account_id AS "accountId",m.active,
            a.id AS "linkedAccountId",a.balance,a.type AS "accountType",a.active AS "accountActive"
       FROM finance_payment_methods m
       LEFT JOIN money_accounts a ON a.id=m.account_id
      WHERE m.shop_id=$1::uuid AND ${clause}
      ORDER BY m.active DESC,m.sort_order,LOWER(m.name)
      LIMIT 1`,
    shopId,
    ...params,
  );
  return rows[0] || null;
}

async function findMethod(shopId, id) {
  const parsed = uuid.safeParse(id);
  if (!parsed.success) return null;
  return fetchMethodRow(shopId, 'm.id=$2::uuid', parsed.data);
}

async function findMethodByCodeOrName(shopId, code, name) {
  const safeCode = normalizeCode(code);
  const safeName = normalizeName(name);
  if (safeCode) {
    const byCode = await fetchMethodRow(shopId, 'm.active=TRUE AND UPPER(m.code)=$2', safeCode);
    if (byCode) return byCode;
  }
  if (safeName) {
    const byName = await fetchMethodRow(shopId, 'm.active=TRUE AND LOWER(m.name)=$2', safeName);
    if (byName) return byName;
  }
  return null;
}

async function findLegacyMethod(shopId, method) {
  const normalized = safeLegacy(method);
  const aliases = normalized === 'WAVE_PAY' ? ['WAVE_PAY', 'WAVEPAY']
    : normalized === 'KPAY' ? ['KPAY', 'KBZPAY', 'KBZ_PAY']
      : normalized === 'CASH' ? ['CASH'] : ['OTHER'];
  const rows = await prisma.$queryRawUnsafe(
    `SELECT m.id,m.name,m.code,m.kind,m.account_id AS "accountId",m.active,
            a.id AS "linkedAccountId",a.balance,a.type AS "accountType",a.active AS "accountActive"
       FROM finance_payment_methods m
       LEFT JOIN money_accounts a ON a.id=m.account_id
      WHERE m.shop_id=$1::uuid AND m.active=TRUE AND UPPER(m.code)=ANY($2::text[])
      ORDER BY m.sort_order,LOWER(m.name)
      LIMIT 1`,
    shopId,
    aliases,
  );
  return rows[0] || null;
}

async function repairMethodAccount(shopId, method) {
  if (!method || method.active === false) return null;
  const linkedAccountId = field(method, 'linkedAccountId', 'linkedaccountid');
  const accountActive = field(method, 'accountActive', 'accountactive');
  if (linkedAccountId && accountActive !== false) {
    return {
      ...method,
      accountId: field(method, 'accountId', 'accountid') || linkedAccountId,
      linkedAccountId,
      accountType: field(method, 'accountType', 'accounttype') || 'OTHER',
      accountActive,
    };
  }

  const account = await prisma.moneyAccount.upsert({
    where: { shopId_name: { shopId, name: method.name } },
    update: { active: true },
    create: { shopId, name: method.name, type: accountTypeFor(method), active: true },
  });

  await prisma.$executeRawUnsafe(
    `UPDATE finance_payment_methods
        SET account_id=$3::uuid,active=TRUE,updated_at=NOW()
      WHERE id=$1::uuid AND shop_id=$2::uuid`,
    method.id,
    shopId,
    account.id,
  );

  return {
    ...method,
    accountId: account.id,
    linkedAccountId: account.id,
    accountType: account.type,
    accountActive: account.active,
    balance: account.balance,
    active: true,
  };
}

async function resolveSelectedMethod(shopId, body) {
  let method = null;
  if (body?.paymentMethodId) method = await findMethod(shopId, body.paymentMethodId);
  if (!method || method.active === false) {
    method = await findMethodByCodeOrName(shopId, body?.paymentMethodCode, body?.paymentMethodName);
  }
  if (!method || method.active === false) {
    method = await findLegacyMethod(shopId, body?.paymentMethod || 'CASH');
  }
  return repairMethodAccount(shopId, method);
}

function methodJson(row) {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    kind: row.kind,
    accountId: field(row, 'accountId', 'accountid', 'linkedAccountId', 'linkedaccountid') || null,
    accountType: field(row, 'accountType', 'accounttype') || 'OTHER',
    balance: Number(row.balance || 0),
    legacyMethod: legacyMethod(row),
  };
}

function noStore(res) {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
}

function attachResponsePersistence(req, res, method) {
  const originalJson = res.json.bind(res);
  let handled = false;
  res.json = (body) => {
    if (handled) return res;
    handled = true;
    const saleId = body?.sale?.id;
    if (res.statusCode < 200 || res.statusCode >= 300 || !saleId || !method) {
      return originalJson(body);
    }
    const accountId = field(method, 'accountId', 'accountid', 'linkedAccountId', 'linkedaccountid') || null;
    prisma.$queryRawUnsafe(
      `WITH updated_payment AS (
         UPDATE payments
            SET payment_method_id=$1::uuid,payment_method_name_snapshot=$2
          WHERE shop_id=$3::uuid
            AND sale_id=$4::uuid
            AND status='PAID'
            AND payment_method_id IS DISTINCT FROM $1::uuid
          RETURNING amount
       ),
       balance_update AS (
         UPDATE money_accounts
            SET balance=balance+COALESCE((SELECT SUM(amount) FROM updated_payment),0),
                updated_at=NOW()
          WHERE $5::uuid IS NOT NULL AND id=$5::uuid AND shop_id=$3::uuid
          RETURNING id,balance
       )
       SELECT COALESCE((SELECT SUM(amount) FROM updated_payment),0) AS applied_amount`,
      method.id,
      method.name,
      req.auth.shopId,
      saleId,
      accountId,
    ).then(() => {
      body.sale.payment = method.name;
      body.sale.paymentMethodId = method.id;
      body.sale.paymentMethodCode = method.code;
      body.sale.paymentMethodKind = method.kind;
      originalJson(body);
    }).catch((error) => {
      console.error('POS dynamic payment persistence:', error);
      body.warning = 'Sale completed, but payment method link needs review';
      originalJson(body);
    });
    return res;
  };
}

function attachPosSalePaymentMethodsV23(app) {
  const saleRead = [requireAuth, requireShopUser, requirePermission('sale')];

  app.get('/api/pos/payment-methods', ...saleRead, async (req, res) => {
    try {
      noStore(res);
      await seedDefaults(req.auth.shopId, req.auth.userId);
      const rows = await prisma.$queryRawUnsafe(
        `SELECT m.id,m.name,m.code,m.kind,m.account_id AS "accountId",m.active,
                a.id AS "linkedAccountId",a.balance,a.type AS "accountType",a.active AS "accountActive"
           FROM finance_payment_methods m
           LEFT JOIN money_accounts a ON a.id=m.account_id
          WHERE m.shop_id=$1::uuid AND m.active=TRUE
          ORDER BY CASE WHEN m.kind='CASH' THEN 0 ELSE 1 END,m.sort_order,LOWER(m.name)`,
        req.auth.shopId,
      );

      const repaired = [];
      for (const row of rows) {
        const method = await repairMethodAccount(req.auth.shopId, row);
        if (method) repaired.push(methodJson(method));
      }

      return res.json({
        ok: true,
        paymentMethods: repaired,
        credit: { id: null, name: 'Credit', code: 'CREDIT', kind: 'CREDIT', legacyMethod: 'CREDIT' },
      });
    } catch (error) {
      return res.status(500).json({ ok: false, message: error.message || 'POS payment methods failed' });
    }
  });

  app.use('/api/sales', ...saleRead, async (req, res, next) => {
    if (req.method !== 'POST') return next();
    try {
      await seedDefaults(req.auth.shopId, req.auth.userId);
      if (String(req.body?.paymentMethod || '').toUpperCase() === 'CREDIT') return next();

      const method = await resolveSelectedMethod(req.auth.shopId, req.body || {});
      if (!method) {
        req.body.paymentMethod = safeLegacy(req.body?.paymentMethod);
        delete req.body.paymentMethodId;
        delete req.body.paymentMethodCode;
        delete req.body.paymentMethodName;
        return next();
      }

      req.body.paymentMethod = legacyMethod(method);
      req.body.paymentMethodId = method.id;
      req.body.paymentMethodCode = method.code;
      req.body.paymentMethodName = method.name;
      attachResponsePersistence(req, res, method);
      return next();
    } catch (error) {
      console.error('POS dynamic payment fallback:', error);
      req.body.paymentMethod = safeLegacy(req.body?.paymentMethod);
      delete req.body.paymentMethodId;
      delete req.body.paymentMethodCode;
      delete req.body.paymentMethodName;
      return next();
    }
  });
}

module.exports = attachPosSalePaymentMethodsV23;
