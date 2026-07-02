const crypto = require('crypto');
const { getDb, addActivityLog } = require('./db');

const toNumber = (value) => {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
};

const safeDate = (value) => String(value || '').slice(0, 10);

const first = (obj, keys, fallback = '') => {
  for (const key of keys) {
    if (obj?.[key] !== undefined && obj?.[key] !== null && obj?.[key] !== '') return obj[key];
  }
  return fallback;
};

const parseRoot = (payload = {}) => payload.data || payload.state || payload;

const saleAmount = (row) => toNumber(first(row, ['payable', 'total', 'amount', 'Sale Payable', 'Line Total'], 0));
const saleItems = (row) => Array.isArray(row.items)
  ? row.items.map((item) => `${item.name || item.model || 'Item'} x${item.qty || 1}`).join(', ')
  : String(first(row, ['itemName', 'Item Name', 'items'], 'Item'));
const saleCost = (row) => Array.isArray(row.items)
  ? row.items.reduce((sum, item) => sum + toNumber(item.cost) * toNumber(item.qty || 1), 0)
  : toNumber(first(row, ['cost', 'Daily Cost'], 0));

async function ensureTables() {
  const db = await getDb();
  await db.exec(`
    CREATE TABLE IF NOT EXISTS pos_products (
      id TEXT PRIMARY KEY,
      brand TEXT,
      model TEXT,
      category TEXT,
      cost_price REAL DEFAULT 0,
      selling_price REAL DEFAULT 0,
      stock_qty REAL DEFAULT 0,
      raw_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS pos_sales (
      id TEXT PRIMARY KEY,
      invoice TEXT UNIQUE,
      date_time TEXT,
      sale_date TEXT,
      customer TEXT,
      items TEXT,
      amount REAL DEFAULT 0,
      cost REAL DEFAULT 0,
      payment TEXT,
      status TEXT,
      raw_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS pos_service_jobs (
      id TEXT PRIMARY KEY,
      repair_id TEXT,
      job_date TEXT,
      customer TEXT,
      device TEXT,
      issue TEXT,
      status TEXT,
      pickup TEXT,
      cost REAL DEFAULT 0,
      raw_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS pos_accounts (
      id TEXT PRIMARY KEY,
      name TEXT,
      balance REAL DEFAULT 0,
      raw_json TEXT NOT NULL
    );
  `);
  return db;
}

async function restoreSnapshot(payload) {
  const data = parseRoot(payload || {});
  const products = Array.isArray(data.products) ? data.products : [];
  const sales = Array.isArray(data.sales) ? data.sales : Array.isArray(data.saleRecords) ? data.saleRecords : [];
  const jobs = Array.isArray(data.repairs) ? data.repairs : [];
  const accounts = Array.isArray(data.accounts) ? data.accounts : [];
  const db = await ensureTables();
  await db.exec('BEGIN');
  try {
    await db.exec('DELETE FROM pos_products; DELETE FROM pos_sales; DELETE FROM pos_service_jobs; DELETE FROM pos_accounts;');
    for (const [i, row] of products.entries()) {
      await db.run(
        'INSERT INTO pos_products (id, brand, model, category, cost_price, selling_price, stock_qty, raw_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        String(first(row, ['id'], `product_${i}`)), String(first(row, ['brand'], '')), String(first(row, ['model', 'name'], '')), String(first(row, ['category'], '')),
        toNumber(first(row, ['costPrice', 'cost_price'], 0)), toNumber(first(row, ['sellingPrice', 'selling_price', 'price'], 0)), toNumber(first(row, ['stockQty', 'qty', 'stock'], 0)), JSON.stringify(row)
      );
    }
    for (const [i, row] of sales.entries()) {
      const id = String(first(row, ['id', 'invoiceNo', 'invoice'], `sale_${i}`));
      const dateTime = String(first(row, ['date', 'created_at', 'createdAt', 'Date / Time'], ''));
      await db.run(
        'INSERT INTO pos_sales (id, invoice, date_time, sale_date, customer, items, amount, cost, payment, status, raw_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        id, String(first(row, ['invoiceNo', 'invoice', 'Invoice'], `MS${90473 - i}`)), dateTime, safeDate(dateTime), String(first(row, ['customerName', 'customer', 'Customer'], 'Walk-in Customer')).replaceAll('_', ' '),
        saleItems(row), saleAmount(row), saleCost(row), String(first(row, ['payMethod', 'payment', 'Payment'], 'Cash')), String(first(row, ['status', 'Status'], 'Completed')), JSON.stringify(row)
      );
    }
    for (const [i, row] of jobs.entries()) {
      const rid = String(first(row, ['voucherNo', 'sourceRepairId', 'repairId', 'id'], `MS${String(i + 1).padStart(4, '0')}`));
      const jobDate = safeDate(first(row, ['created_at', 'createdAt', 'date'], ''));
      await db.run(
        'INSERT INTO pos_service_jobs (id, repair_id, job_date, customer, device, issue, status, pickup, cost, raw_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        rid, rid, jobDate, String(first(row, ['customerName', 'customer', 'name'], '')), String(first(row, ['model', 'device'], '')), String(first(row, ['issue', 'problem'], '')),
        String(first(row, ['status'], '')), String(first(row, ['pickup', 'pickupStatus', 'collectStatus'], '')), toNumber(first(row, ['repairFee', 'cost', 'amount'], 0)), JSON.stringify(row)
      );
    }
    for (const [i, row] of accounts.entries()) {
      await db.run('INSERT INTO pos_accounts (id, name, balance, raw_json) VALUES (?, ?, ?, ?)', String(first(row, ['id'], `account_${i}`)), String(first(row, ['name', 'accountName'], 'Account')), toNumber(first(row, ['balance'], 0)), JSON.stringify(row));
    }
    await db.exec('COMMIT');
    return { products: products.length, sales: sales.length, repairs: jobs.length, accounts: accounts.length };
  } catch (err) {
    await db.exec('ROLLBACK');
    throw err;
  }
}

async function findPaymentAccount(db, payment) {
  const keyword = `%${String(payment || '').toLowerCase()}%`;
  return (await db.get('SELECT id, balance FROM pos_accounts WHERE lower(name) LIKE ? ORDER BY rowid LIMIT 1', keyword))
    || (await db.get('SELECT id, balance FROM pos_accounts ORDER BY rowid LIMIT 1'));
}

function attachHardDbApi(app, { protect }) {
  app.post('/api/db/restore', protect, async (req, res) => {
    try {
      const counts = await restoreSnapshot(req.body || {});
      await addActivityLog({ userName: req.user?.name || 'System', action: 'Hard DB Restore', details: JSON.stringify(counts), ip: req.ip });
      res.json({ ok: true, message: 'Hard DB restore completed', counts });
    } catch (err) {
      res.status(500).json({ ok: false, message: err.message });
    }
  });

  app.get('/api/dashboard', protect, async (_req, res) => {
    const db = await ensureTables();
    const today = new Date().toISOString().slice(0, 10);
    const d7 = new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10);
    const todayRow = await db.get("SELECT COALESCE(SUM(amount),0) income, COALESCE(SUM(cost),0) cost, COUNT(*) orders FROM pos_sales WHERE sale_date = ? AND status != 'Voided'", today);
    const weekRow = await db.get("SELECT COALESCE(SUM(amount),0) income, COUNT(*) orders FROM pos_sales WHERE sale_date >= ? AND status != 'Voided'", d7);
    const stockRow = await db.get('SELECT COALESCE(SUM(cost_price * stock_qty),0) stockBalance FROM pos_products');
    const accountRow = await db.get('SELECT COALESCE(SUM(balance),0) accountBalance FROM pos_accounts');
    res.json({ ok: true, dashboard: { todayTotalIncome: todayRow.income, todaySaleIncome: todayRow.income, todayProfit: todayRow.income - todayRow.cost, todayExpense: 0, receivable: 0, payable: 0, accountBalance: accountRow.accountBalance, stockBalance: stockRow.stockBalance, last7DaysSales: weekRow.income, last7DaysOrders: weekRow.orders } });
  });

  app.get('/api/sales', protect, async (req, res) => {
    const db = await ensureTables();
    const page = Math.max(1, Number(req.query.page || 1));
    const limit = Math.max(1, Math.min(100, Number(req.query.limit || 10)));
    const total = (await db.get('SELECT COUNT(*) total FROM pos_sales')).total;
    const rows = await db.all('SELECT id, invoice, date_time as dateTime, sale_date as date, customer, items, amount, payment, status FROM pos_sales ORDER BY date_time DESC LIMIT ? OFFSET ?', limit, (page - 1) * limit);
    res.json({ ok: true, page, limit, total, totalPages: Math.ceil(total / limit), sales: rows });
  });

  app.get('/api/sales/:id', protect, async (req, res) => {
    const db = await ensureTables();
    const row = await db.get('SELECT id, invoice, date_time as dateTime, sale_date as date, customer, items, amount, cost, payment, status, raw_json as rawJson FROM pos_sales WHERE id = ? OR invoice = ?', req.params.id, req.params.id);
    if (!row) return res.status(404).json({ ok: false, message: 'Sale not found' });
    res.json({ ok: true, sale: { ...row, raw: JSON.parse(row.rawJson || '{}') } });
  });

  app.post('/api/sales', protect, async (req, res) => {
    const db = await ensureTables();
    const inputItems = Array.isArray(req.body.items) ? req.body.items : [];
    if (!inputItems.length) return res.status(400).json({ ok: false, message: 'Cart is empty' });

    await db.exec('BEGIN IMMEDIATE');
    try {
      let subtotal = 0;
      let totalCost = 0;
      const items = [];

      for (const input of inputItems) {
        const qty = Math.max(1, Math.floor(toNumber(input.qty || 1)));
        const product = await db.get('SELECT id, brand, model, cost_price as costPrice, selling_price as sellingPrice, stock_qty as stockQty FROM pos_products WHERE id = ?', input.productId || input.id);
        if (!product) throw new Error('Product not found');
        if (toNumber(product.stockQty) < qty) throw new Error(`${product.model || product.brand} stock မလုံလောက်ပါ`);
        const price = toNumber(product.sellingPrice);
        subtotal += price * qty;
        totalCost += toNumber(product.costPrice) * qty;
        items.push({ productId: product.id, name: `${product.brand || ''} ${product.model || ''}`.trim(), qty, price, cost: toNumber(product.costPrice), lineTotal: price * qty });
      }

      const discount = Math.max(0, Math.min(subtotal, toNumber(req.body.discount)));
      const total = subtotal - discount;
      const payment = String(req.body.payment || 'Cash');
      const customer = String(req.body.customer || 'Walk-in Customer').trim() || 'Walk-in Customer';
      const now = new Date().toISOString();
      const id = `sale_${crypto.randomUUID()}`;
      const invoice = `MS${Date.now().toString().slice(-8)}`;

      for (const item of items) {
        await db.run('UPDATE pos_products SET stock_qty = stock_qty - ? WHERE id = ?', item.qty, item.productId);
      }

      const raw = { id, invoiceNo: invoice, date: now, customerName: customer, items, subtotal, discount, total, payable: total, payMethod: payment, status: 'Completed' };
      await db.run(
        'INSERT INTO pos_sales (id, invoice, date_time, sale_date, customer, items, amount, cost, payment, status, raw_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        id, invoice, now, safeDate(now), customer, saleItems(raw), total, totalCost, payment, 'Completed', JSON.stringify(raw)
      );

      const account = await findPaymentAccount(db, payment);
      if (account) await db.run('UPDATE pos_accounts SET balance = balance + ? WHERE id = ?', total, account.id);

      await db.exec('COMMIT');
      await addActivityLog({ userName: req.user?.name || 'POS', action: 'Create Sale', details: `${invoice} - ${total}`, ip: req.ip });
      res.status(201).json({ ok: true, message: 'Sale completed', sale: { id, invoice, dateTime: now, customer, items, subtotal, discount, amount: total, payment, status: 'Completed' } });
    } catch (err) {
      await db.exec('ROLLBACK');
      res.status(400).json({ ok: false, message: err.message || 'Sale failed' });
    }
  });

  app.post('/api/sales/:id/void', protect, async (req, res) => {
    const db = await ensureTables();
    await db.exec('BEGIN IMMEDIATE');
    try {
      const row = await db.get('SELECT * FROM pos_sales WHERE id = ? OR invoice = ?', req.params.id, req.params.id);
      if (!row) throw new Error('Sale not found');
      if (row.status === 'Voided') throw new Error('Sale already voided');
      const raw = JSON.parse(row.raw_json || '{}');
      for (const item of Array.isArray(raw.items) ? raw.items : []) {
        await db.run('UPDATE pos_products SET stock_qty = stock_qty + ? WHERE id = ?', toNumber(item.qty || 1), item.productId);
      }
      const account = await findPaymentAccount(db, row.payment);
      if (account) await db.run('UPDATE pos_accounts SET balance = balance - ? WHERE id = ?', toNumber(row.amount), account.id);
      raw.status = 'Voided';
      raw.voidReason = String(req.body.reason || '');
      await db.run("UPDATE pos_sales SET status = 'Voided', raw_json = ? WHERE id = ?", JSON.stringify(raw), row.id);
      await db.exec('COMMIT');
      res.json({ ok: true, message: 'Sale voided and stock restored' });
    } catch (err) {
      await db.exec('ROLLBACK');
      res.status(400).json({ ok: false, message: err.message });
    }
  });

  app.get('/api/products', protect, async (req, res) => {
    const db = await ensureTables();
    const q = `%${String(req.query.q || '').toLowerCase()}%`;
    const rows = await db.all('SELECT id, brand, model, category, cost_price as costPrice, selling_price as sellingPrice, stock_qty as stockQty FROM pos_products WHERE lower(brand || " " || model || " " || category) LIKE ? ORDER BY model LIMIT 500', q);
    res.json({ ok: true, total: rows.length, products: rows });
  });

  app.get('/api/service-jobs', protect, async (req, res) => {
    const db = await ensureTables();
    const q = `%${String(req.query.q || '').toLowerCase()}%`;
    const date = String(req.query.date || '');
    const month = String(req.query.month || '');
    const rows = await db.all('SELECT id, repair_id as repairId, job_date as date, customer, device, issue, status, pickup, cost FROM pos_service_jobs WHERE lower(repair_id || " " || customer || " " || device || " " || issue) LIKE ? AND (? = "" OR job_date = ?) AND (? = "" OR job_date LIKE ?) ORDER BY job_date DESC', q, date, date, month, `${month}%`);
    const done = rows.filter(r => /done|complete|finished|ပြင်ပြီး/i.test(r.status || '')).length;
    const picked = rows.filter(r => /picked|collected|ယူပြီး/i.test((r.pickup || '') + (r.status || ''))).length;
    res.json({ ok: true, summary: { total: rows.length, pending: Math.max(0, rows.length - done), done, picked }, repairs: rows });
  });
}

module.exports = attachHardDbApi;
