const { prisma } = require('./prisma');
const { requireAuth, requireShopUser } = require('./auth-api');
const { normalizeBusinessRecordCategory } = require('./business-record-categories');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SERVICE_PREFIX = '__SERVICE_INCOME__:';
let schemaPromise;

function requireAccountingRead(req, res, next) {
  if (req.auth?.role === 'SUPER_ADMIN' || req.auth?.role === 'SHOP_ADMIN') return next();
  const permissions = req.auth?.permissions || {};
  if (permissions.accounting === true || permissions.reports === true || permissions.history === true) return next();
  return res.status(403).json({ ok: false, message: 'Accounting or reports permission is required' });
}

function requireAccountingWrite(req, res, next) {
  if (req.auth?.role === 'SUPER_ADMIN' || req.auth?.role === 'SHOP_ADMIN') return next();
  const permissions = req.auth?.permissions || {};
  if (permissions.accounting === true) return next();
  return res.status(403).json({ ok: false, message: 'Accounting permission is required' });
}

function yangonToday() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Yangon', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function firstDayOfMonth(value) {
  return `${String(value).slice(0, 7)}-01`;
}

function dateValue(value, fallback) {
  const result = String(value || fallback || '').slice(0, 10);
  if (!DATE_RE.test(result)) throw Object.assign(new Error('Date must use YYYY-MM-DD'), { status: 400 });
  return result;
}

function recordType(value) {
  const type = String(value || 'income').toLowerCase();
  if (!['income', 'expense'].includes(type)) throw Object.assign(new Error('Record type must be income or expense'), { status: 400 });
  return type;
}

function amountValue(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) throw Object.assign(new Error('Amount must be greater than 0'), { status: 400 });
  return amount;
}

function cleanText(value, max = 500) {
  return String(value || '').trim().slice(0, max);
}

function cleanMethod(value) {
  return cleanText(value || 'CASH', 40).toUpperCase() || 'CASH';
}

function nullableUuid(value) {
  const text = String(value || '').trim();
  return text || null;
}

async function ensureRecordsSchema() {
  if (!schemaPromise) {
    schemaPromise = prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS business_expenses (
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
      )`);
      await tx.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS business_other_income (
        id UUID PRIMARY KEY,
        shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
        income_date DATE NOT NULL,
        category TEXT NOT NULL DEFAULT 'OTHER_INCOME',
        source TEXT NOT NULL,
        amount NUMERIC(14,2) NOT NULL DEFAULT 0,
        method TEXT NOT NULL DEFAULT 'CASH',
        money_account_id UUID REFERENCES money_accounts(id) ON DELETE SET NULL,
        note TEXT,
        created_by_id UUID REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
      await tx.$executeRawUnsafe(`ALTER TABLE business_expenses ADD COLUMN IF NOT EXISTS updated_by_id UUID REFERENCES users(id) ON DELETE SET NULL`);
      await tx.$executeRawUnsafe(`ALTER TABLE business_expenses ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ`);
      await tx.$executeRawUnsafe(`ALTER TABLE business_other_income ADD COLUMN IF NOT EXISTS updated_by_id UUID REFERENCES users(id) ON DELETE SET NULL`);
      await tx.$executeRawUnsafe(`ALTER TABLE business_other_income ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ`);
      await tx.$executeRawUnsafe(`ALTER TABLE business_other_income ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'OTHER_INCOME'`);
      await tx.$executeRawUnsafe(`ALTER TABLE business_expenses
        ADD COLUMN IF NOT EXISTS voided_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS void_reason TEXT,
        ADD COLUMN IF NOT EXISTS voided_by_id UUID REFERENCES users(id) ON DELETE SET NULL`);
      await tx.$executeRawUnsafe(`ALTER TABLE business_other_income
        ADD COLUMN IF NOT EXISTS voided_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS void_reason TEXT,
        ADD COLUMN IF NOT EXISTS voided_by_id UUID REFERENCES users(id) ON DELETE SET NULL`);
      return true;
    }, { maxWait: 5000, timeout: 20000 }).catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  return schemaPromise;
}

function configuration(type) {
  if (type === 'expense') {
    return { table: 'business_expenses', alias: 'e', dateColumn: 'expense_date', titleColumn: 'category' };
  }
  return { table: 'business_other_income', alias: 'i', dateColumn: 'income_date', titleColumn: 'source' };
}

function filterSql(type, from, to, query) {
  const config = configuration(type);
  const params = [from, to];
  let search = '';
  if (query) {
    params.push(`%${query.toLowerCase()}%`);
    search = ` AND LOWER(CONCAT_WS(' ', ${config.alias}.${config.titleColumn}, ${config.alias}.method, ${config.alias}.note, COALESCE(a.name,''), COALESCE(u.name,''), COALESCE(u.username,''))) LIKE $${params.length + 1}`;
  }
  return { config, params, search };
}

function normalizeRow(type, row) {
  const title = String(row.title || '');
  const serviceIncome = type === 'income' && (row.category === 'SERVICE_INCOME' || title.startsWith(SERVICE_PREFIX));
  return {
    id: row.id,
    type,
    businessDate: String(row.businessDate || '').slice(0, 10),
    category: type === 'expense' ? title : (serviceIncome ? 'SERVICE_INCOME' : (row.category || 'OTHER_INCOME')),
    title: serviceIncome ? title.slice(SERVICE_PREFIX.length) : title,
    amount: Number(row.amount || 0),
    method: row.method || 'CASH',
    moneyAccountId: row.moneyAccountId || '',
    accountName: row.accountName || '',
    note: row.note || '',
    createdByName: row.createdByName || row.createdByUsername || '',
    createdByUsername: row.createdByUsername || '',
    voidedAt: row.voidedAt || null,
    voidReason: row.voidReason || '',
    voidedByName: row.voidedByName || row.voidedByUsername || '',
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function findRecords(shopId, options) {
  const { type, from, to, query, page, limit, exportAll = false } = options;
  const income = type !== 'expense';
  const model = income ? prisma.businessOtherIncome : prisma.businessExpenses;
  const dateField = income ? 'incomeDate' : 'expenseDate';
  const titleField = income ? 'source' : 'category';

  const where = {
    shopId,
    [dateField]: { gte: new Date(`${from}T00:00:00.000Z`), lte: new Date(`${to}T00:00:00.000Z`) },
  };

  // the SQL matched the search against the joined account and user names too,
  // so resolve those ids first and fold them into the filter
  if (query) {
    const term = query.toLowerCase();
    const [accounts, users] = await Promise.all([
      prisma.moneyAccount.findMany({ where: { shopId, name: { contains: term, mode: 'insensitive' } }, select: { id: true } }),
      prisma.user.findMany({
        where: { shopId, OR: [{ name: { contains: term, mode: 'insensitive' } }, { username: { contains: term, mode: 'insensitive' } }] },
        select: { id: true },
      }),
    ]);
    where.OR = [
      { [titleField]: { contains: term, mode: 'insensitive' } },
      { method: { contains: term, mode: 'insensitive' } },
      { note: { contains: term, mode: 'insensitive' } },
      ...(accounts.length ? [{ moneyAccountId: { in: accounts.map((row) => row.id) } }] : []),
      ...(users.length ? [{ createdById: { in: users.map((row) => row.id) } }] : []),
    ];
  }

  const [count, totals, rows] = await Promise.all([
    model.count({ where }),
    model.aggregate({ where: { ...where, voidedAt: null }, _sum: { amount: true } }),
    model.findMany({
      where,
      orderBy: [{ [dateField]: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
      take: exportAll ? 10000 : limit,
      skip: exportAll ? 0 : (page - 1) * limit,
    }),
  ]);

  // account and user names used to arrive through three LEFT JOINs
  const accountIds = [...new Set(rows.map((row) => row.moneyAccountId).filter(Boolean))];
  const userIds = [...new Set(rows.flatMap((row) => [row.createdById, row.voidedById]).filter(Boolean))];
  const [accounts, users] = await Promise.all([
    accountIds.length ? prisma.moneyAccount.findMany({ where: { id: { in: accountIds } }, select: { id: true, name: true } }) : [],
    userIds.length ? prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, username: true } }) : [],
  ]);
  const accountById = new Map(accounts.map((row) => [row.id, row]));
  const userById = new Map(users.map((row) => [row.id, row]));

  // keep the exact shape the SQL produced so normalizeRow behaves as before
  const shaped = rows.map((row) => {
    const creator = userById.get(row.createdById);
    const voider = userById.get(row.voidedById);
    return {
      id: row.id,
      businessDate: row[dateField] instanceof Date ? row[dateField].toISOString() : row[dateField],
      title: row[titleField],
      category: row.category,
      amount: row.amount,
      method: row.method,
      moneyAccountId: row.moneyAccountId,
      note: row.note,
      voidedAt: row.voidedAt,
      voidReason: row.voidReason,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      accountName: accountById.get(row.moneyAccountId)?.name || null,
      createdByName: creator?.name || null,
      createdByUsername: creator?.username || null,
      voidedByName: voider?.name || null,
      voidedByUsername: voider?.username || null,
    };
  });

  const total = Number(count || 0);
  return {
    rows: shaped.map((row) => normalizeRow(type, row)),
    total,
    totalAmount: Number(totals._sum.amount || 0),
    totalPages: Math.max(1, Math.ceil(total / limit)),
  };
}

function csvCell(value) {
  let text = String(value ?? '');
  if (/^[=+@]/.test(text) || /^-\D/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

function csvText(rows) {
  const header = ['Date', 'Record Type', 'Category', 'Source / Expense', 'Amount', 'Payment Method', 'Account', 'Note', 'Created By', 'Created At'];
  const lines = rows.map((row) => [
    row.businessDate,
    row.type === 'income' ? 'Other Income' : 'Quick Expense',
    row.category,
    row.title,
    row.amount,
    row.method,
    row.accountName,
    row.note,
    row.createdByName,
    row.createdAt ? new Date(row.createdAt).toISOString() : '',
  ].map(csvCell).join(','));
  return `\uFEFF${header.map(csvCell).join(',')}\n${lines.join('\n')}`;
}

async function updateMoneyAccount(tx, shopId, accountId, delta) {
  if (!accountId || Number(delta) === 0) return;
  const result = await tx.$executeRawUnsafe(
    `UPDATE money_accounts
        SET balance = COALESCE(balance,0) + $3::numeric,
            updated_at = NOW()
      WHERE id=$1::uuid AND shop_id=$2::uuid`,
    accountId,
    shopId,
    delta,
  );
  if (!result) throw Object.assign(new Error('Money account not found for this shop'), { status: 404 });
}

async function loadRecordForUpdate(tx, shopId, type, id) {
  const config = configuration(type);
  const rows = await tx.$queryRawUnsafe(
    `SELECT id,
            ${config.dateColumn} AS "businessDate",
            ${config.titleColumn} AS title,
            ${type === 'income' ? 'category,' : ''}
            amount,
            method,
            money_account_id AS "moneyAccountId",
            voided_at AS "voidedAt",
            note
       FROM ${config.table}
      WHERE id=$1::uuid AND shop_id=$2::uuid
      FOR UPDATE`,
    id,
    shopId,
  );
  return rows[0] || null;
}

async function loadUpdatedRecord(tx, shopId, type, id) {
  const config = configuration(type);
  const rows = await tx.$queryRawUnsafe(
    `SELECT ${config.alias}.id,
            ${config.alias}.${config.dateColumn} AS "businessDate",
            ${config.alias}.${config.titleColumn} AS title,
            ${type === 'income' ? `${config.alias}.category,` : ''}
            ${config.alias}.amount,
            ${config.alias}.method,
            ${config.alias}.money_account_id AS "moneyAccountId",
            ${config.alias}.note,
            ${config.alias}.voided_at AS "voidedAt",
            ${config.alias}.void_reason AS "voidReason",
            ${config.alias}.created_at AS "createdAt",
            ${config.alias}.updated_at AS "updatedAt",
            a.name AS "accountName",
            u.name AS "createdByName",
            u.username AS "createdByUsername",
            v.name AS "voidedByName",
            v.username AS "voidedByUsername"
       FROM ${config.table} ${config.alias}
       LEFT JOIN money_accounts a ON a.id=${config.alias}.money_account_id AND a.shop_id=${config.alias}.shop_id
       LEFT JOIN users u ON u.id=${config.alias}.created_by_id
       LEFT JOIN users v ON v.id=${config.alias}.voided_by_id
      WHERE ${config.alias}.id=$1::uuid AND ${config.alias}.shop_id=$2::uuid`,
    id,
    shopId,
  );
  return rows[0] || null;
}

function editPayload(type, body) {
  const businessDate = dateValue(type === 'expense' ? body.expenseDate : body.incomeDate, yangonToday());
  const amount = amountValue(body.amount);
  const method = cleanMethod(body.method);
  const moneyAccountId = nullableUuid(body.moneyAccountId);
  const note = cleanText(body.note, 500);

  if (type === 'expense') {
    const title = normalizeBusinessRecordCategory('expense', body.category);
    if (!title) throw Object.assign(new Error('Expense category is required'), { status: 400 });
    return { businessDate, title, amount, method, moneyAccountId, note };
  }

  const category = normalizeBusinessRecordCategory('income', body.category);
  if (!category) throw Object.assign(new Error('Income category is invalid'), { status: 400 });
  const source = cleanText(body.source, 80);
  if (!source) throw Object.assign(new Error('Income source is required'), { status: 400 });
  const title = category === 'SERVICE_INCOME' ? `${SERVICE_PREFIX}${source}` : source;
  return { businessDate, category, title, amount, method, moneyAccountId, note };
}

function attachBusinessRecordsApi(app) {
  const read = [requireAuth, requireShopUser, requireAccountingRead];
  const write = [requireAuth, requireShopUser, requireAccountingWrite];

  app.get('/api/business-control/records', ...read, async (req, res) => {
    try {
      await ensureRecordsSchema();
      const type = recordType(req.query.type);
      const today = yangonToday();
      const from = dateValue(req.query.from, firstDayOfMonth(today));
      const to = dateValue(req.query.to, today);
      if (from > to) return res.status(400).json({ ok: false, message: 'From date cannot be after To date' });
      const query = String(req.query.q || '').trim().slice(0, 100);
      const page = Math.max(1, Number.parseInt(req.query.page || '1', 10) || 1);
      const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit || '10', 10) || 10));
      const result = await findRecords(req.auth.shopId, { type, from, to, query, page, limit });
      return res.json({ ok: true, type, from, to, query, page, limit, ...result });
    } catch (error) {
      console.error('Business records list:', error);
      return res.status(error.status || 500).json({ ok: false, message: error.message || 'Business records failed' });
    }
  });

  app.get('/api/business-control/records/export', ...read, async (req, res) => {
    try {
      await ensureRecordsSchema();
      const type = recordType(req.query.type);
      const today = yangonToday();
      const from = dateValue(req.query.from, firstDayOfMonth(today));
      const to = dateValue(req.query.to, today);
      if (from > to) return res.status(400).json({ ok: false, message: 'From date cannot be after To date' });
      const query = String(req.query.q || '').trim().slice(0, 100);
      const result = await findRecords(req.auth.shopId, { type, from, to, query, page: 1, limit: 10000, exportAll: true });
      const filename = `${type === 'income' ? 'other-income' : 'quick-expense'}-${from}-to-${to}.csv`;
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return res.send(csvText(result.rows));
    } catch (error) {
      console.error('Business records export:', error);
      return res.status(error.status || 500).json({ ok: false, message: error.message || 'Business records export failed' });
    }
  });

  app.patch('/api/business-control/records/:type/:id', ...write, async (req, res) => {
    try {
      await ensureRecordsSchema();
      const type = recordType(req.params.type);
      const id = String(req.params.id || '').trim();
      if (!id) return res.status(400).json({ ok: false, message: 'Record id is required' });

      const payload = editPayload(type, req.body || {});
      const updated = await prisma.$transaction(async (tx) => {
        const oldRecord = await loadRecordForUpdate(tx, req.auth.shopId, type, id);
        if (!oldRecord) throw Object.assign(new Error('Record not found for this shop'), { status: 404 });
        if (oldRecord.voidedAt) throw Object.assign(new Error('Voided record cannot be edited'), { status: 409 });

        const oldAmount = Number(oldRecord.amount || 0);
        const newAmount = Number(payload.amount || 0);

        if (oldRecord.moneyAccountId) {
          await updateMoneyAccount(tx, req.auth.shopId, oldRecord.moneyAccountId, type === 'income' ? -oldAmount : oldAmount);
        }
        if (payload.moneyAccountId) {
          await updateMoneyAccount(tx, req.auth.shopId, payload.moneyAccountId, type === 'income' ? newAmount : -newAmount);
        }

        const config = configuration(type);
        const updateValues = [
          id,
          req.auth.shopId,
          payload.businessDate,
          payload.title,
          newAmount,
          payload.method,
          payload.moneyAccountId,
          payload.note || null,
          req.auth.userId || req.auth.id || null,
        ];
        if (type === 'income') updateValues.push(payload.category || 'OTHER_INCOME');
        await tx.$executeRawUnsafe(
          `UPDATE ${config.table}
              SET ${config.dateColumn}=$3::date,
                  ${type === 'income' ? 'category=$10,' : ''}
                  ${config.titleColumn}=$4,
                  amount=$5::numeric,
                  method=$6,
                  money_account_id=$7::uuid,
                  note=$8,
                  updated_by_id=$9::uuid,
                  updated_at=NOW()
            WHERE id=$1::uuid AND shop_id=$2::uuid`,
          ...updateValues,
        );

        const row = await loadUpdatedRecord(tx, req.auth.shopId, type, id);
        return normalizeRow(type, row);
      }, { maxWait: 5000, timeout: 20000 });

      return res.json({ ok: true, record: updated, message: 'Record updated and account balance adjusted' });
    } catch (error) {
      console.error('Business record update:', error);
      return res.status(error.status || 500).json({ ok: false, message: error.message || 'Business record update failed' });
    }
  });

  app.post('/api/business-control/records/:type/:id/void', ...write, async (req, res) => {
    try {
      await ensureRecordsSchema();
      const type = recordType(req.params.type);
      const id = String(req.params.id || '').trim();
      const reason = cleanText(req.body?.reason, 500);
      if (!id) return res.status(400).json({ ok: false, message: 'Record id is required' });
      if (reason.length < 3) return res.status(400).json({ ok: false, message: 'Void reason is required' });

      const result = await prisma.$transaction(async (tx) => {
        const record = await loadRecordForUpdate(tx, req.auth.shopId, type, id);
        if (!record) throw Object.assign(new Error('Record not found for this shop'), { status: 404 });
        if (record.voidedAt) throw Object.assign(new Error('Record is already voided'), { status: 409 });
        const amount = Number(record.amount || 0);
        if (record.moneyAccountId) {
          await updateMoneyAccount(tx, req.auth.shopId, record.moneyAccountId, type === 'income' ? -amount : amount);
        }
        const config = configuration(type);
        await tx.$executeRawUnsafe(
          `UPDATE ${config.table} SET voided_at=NOW(),void_reason=$3,voided_by_id=$4::uuid,updated_at=NOW()
            WHERE id=$1::uuid AND shop_id=$2::uuid`,
          id, req.auth.shopId, reason, req.auth.userId || req.auth.id || null,
        );
        return { id, type, amount, moneyAccountId: record.moneyAccountId || null, reason };
      }, { maxWait: 5000, timeout: 20000 });

      await prisma.auditLog.create({
        data: {
          shopId: req.auth.shopId, userId: req.auth.userId || req.auth.id || null,
          action: 'BUSINESS_RECORD_VOIDED', entityType: type === 'income' ? 'business_other_income' : 'business_expense',
          entityId: id, details: result, ipAddress: req.ip || null, userAgent: req.headers['user-agent'] || null,
        },
      }).catch(() => {});
      return res.json({ ok: true, message: 'Record voided and account balance restored', record: result });
    } catch (error) {
      console.error('Business record void:', error);
      return res.status(error.status || 500).json({ ok: false, message: error.message || 'Business record void failed' });
    }
  });
}

module.exports = attachBusinessRecordsApi;
