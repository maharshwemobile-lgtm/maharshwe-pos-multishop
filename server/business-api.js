const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { getDb, adminPermissions, cashierPermissions } = require('./db');

const id = (prefix) => `${prefix}_${crypto.randomUUID()}`;
const num = (value) => {
  const parsed = Number(String(value ?? '').replaceAll(',', '').trim());
  return Number.isFinite(parsed) ? parsed : 0;
};

async function ensureTables() {
  const db = await getDb();
  await db.exec(`
    CREATE TABLE IF NOT EXISTS pos_customers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      phone TEXT,
      address TEXT,
      balance REAL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS pos_suppliers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      phone TEXT,
      address TEXT,
      balance REAL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS pos_purchases (
      id TEXT PRIMARY KEY,
      purchase_date TEXT NOT NULL,
      supplier TEXT,
      amount REAL DEFAULT 0,
      status TEXT,
      note TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS pos_accounting (
      id TEXT PRIMARY KEY,
      entry_date TEXT NOT NULL,
      entry_type TEXT NOT NULL,
      category TEXT,
      amount REAL DEFAULT 0,
      account TEXT,
      note TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS pos_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  return db;
}

function crudRoutes(app, protect, config) {
  app.get(`/api/${config.route}`, protect, async (_req, res) => {
    const db = await ensureTables();
    const rows = await db.all(`SELECT * FROM ${config.table} ORDER BY created_at DESC`);
    res.json({ ok: true, rows });
  });

  app.post(`/api/${config.route}`, protect, async (req, res) => {
    const db = await ensureTables();
    const values = config.fields.map((field) => field.number ? num(req.body[field.name]) : String(req.body[field.name] ?? '').trim());
    if (!values[0]) return res.status(400).json({ ok: false, message: `${config.fields[0].name} is required` });
    const rowId = id(config.prefix);
    const columns = ['id', ...config.fields.map((field) => field.name)];
    const placeholders = columns.map(() => '?').join(',');
    await db.run(`INSERT INTO ${config.table} (${columns.join(',')}) VALUES (${placeholders})`, rowId, ...values);
    const row = await db.get(`SELECT * FROM ${config.table} WHERE id = ?`, rowId);
    res.status(201).json({ ok: true, row });
  });

  app.delete(`/api/${config.route}/:id`, protect, async (req, res) => {
    const db = await ensureTables();
    const result = await db.run(`DELETE FROM ${config.table} WHERE id = ?`, req.params.id);
    res.json({ ok: true, deleted: result.changes || 0 });
  });
}

function attachBusinessApi(app, { protect }) {
  crudRoutes(app, protect, {
    route: 'customers', table: 'pos_customers', prefix: 'customer',
    fields: [{ name: 'name' }, { name: 'phone' }, { name: 'address' }, { name: 'balance', number: true }],
  });
  crudRoutes(app, protect, {
    route: 'suppliers', table: 'pos_suppliers', prefix: 'supplier',
    fields: [{ name: 'name' }, { name: 'phone' }, { name: 'address' }, { name: 'balance', number: true }],
  });
  crudRoutes(app, protect, {
    route: 'purchases', table: 'pos_purchases', prefix: 'purchase',
    fields: [{ name: 'purchase_date' }, { name: 'supplier' }, { name: 'amount', number: true }, { name: 'status' }, { name: 'note' }],
  });
  crudRoutes(app, protect, {
    route: 'accounting', table: 'pos_accounting', prefix: 'accounting',
    fields: [{ name: 'entry_date' }, { name: 'entry_type' }, { name: 'category' }, { name: 'amount', number: true }, { name: 'account' }, { name: 'note' }],
  });

  app.get('/api/settings/live', protect, async (_req, res) => {
    const db = await ensureTables();
    const row = await db.get("SELECT value FROM pos_settings WHERE key = 'shop'");
    let settings = {};
    try { settings = JSON.parse(row?.value || '{}'); } catch {}
    res.json({ ok: true, settings });
  });

  app.post('/api/settings/live', protect, async (req, res) => {
    const db = await ensureTables();
    const settings = req.body || {};
    await db.run(
      `INSERT INTO pos_settings (key, value, updated_at) VALUES ('shop', ?, CURRENT_TIMESTAMP)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
      JSON.stringify(settings)
    );
    res.json({ ok: true, settings });
  });

  app.get('/api/users/live', protect, async (_req, res) => {
    const db = await ensureTables();
    const rows = await db.all('SELECT id, username, name, role, permissions, active, created_at FROM users ORDER BY created_at DESC');
    res.json({ ok: true, users: rows.map((row) => ({ ...row, permissions: JSON.parse(row.permissions || '{}') })) });
  });

  app.post('/api/users/live', protect, async (req, res) => {
    const db = await ensureTables();
    const username = String(req.body.username || '').trim();
    const password = String(req.body.password || '').trim();
    const name = String(req.body.name || username).trim();
    const role = req.body.role === 'Admin' ? 'Admin' : 'Cashier';
    if (!username || !password) return res.status(400).json({ ok: false, message: 'Username and password are required' });
    const userId = id('user');
    const passwordHash = await bcrypt.hash(password, 12);
    const permissions = role === 'Admin' ? adminPermissions : cashierPermissions;
    try {
      await db.run('INSERT INTO users (id, username, password_hash, name, role, permissions) VALUES (?, ?, ?, ?, ?, ?)', userId, username, passwordHash, name, role, JSON.stringify(permissions));
      res.status(201).json({ ok: true, user: { id: userId, username, name, role, permissions } });
    } catch (error) {
      res.status(400).json({ ok: false, message: error.message.includes('UNIQUE') ? 'Username already exists' : error.message });
    }
  });

  app.delete('/api/users/live/:id', protect, async (req, res) => {
    const db = await ensureTables();
    const user = await db.get('SELECT username FROM users WHERE id = ?', req.params.id);
    if (!user) return res.status(404).json({ ok: false, message: 'User not found' });
    if (user.username === 'admin') return res.status(400).json({ ok: false, message: 'Main admin cannot be deleted' });
    const result = await db.run('DELETE FROM users WHERE id = ?', req.params.id);
    res.json({ ok: true, deleted: result.changes || 0 });
  });

  app.get('/api/reports/summary', protect, async (_req, res) => {
    const db = await ensureTables();
    const sales = await db.get("SELECT COALESCE(SUM(amount),0) totalSales, COALESCE(SUM(cost),0) totalCost, COUNT(*) orders FROM pos_sales WHERE status != 'Voided'");
    const finance = await db.get("SELECT COALESCE(SUM(CASE WHEN lower(entry_type)='income' THEN amount ELSE 0 END),0) otherIncome, COALESCE(SUM(CASE WHEN lower(entry_type)='expense' THEN amount ELSE 0 END),0) expense FROM pos_accounting");
    const purchases = await db.get('SELECT COALESCE(SUM(amount),0) totalPurchases, COUNT(*) purchaseCount FROM pos_purchases');
    const customers = await db.get('SELECT COUNT(*) totalCustomers, COALESCE(SUM(balance),0) receivable FROM pos_customers');
    const suppliers = await db.get('SELECT COUNT(*) totalSuppliers, COALESCE(SUM(balance),0) payable FROM pos_suppliers');
    const totalIncome = num(sales.totalSales) + num(finance.otherIncome);
    const netProfit = totalIncome - num(sales.totalCost) - num(finance.expense);
    res.json({ ok: true, report: { ...sales, ...finance, ...purchases, ...customers, ...suppliers, totalIncome, netProfit } });
  });
}

module.exports = attachBusinessApi;
