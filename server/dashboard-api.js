const { getDb } = require('./db');

async function ensureTables() {
  const db = await getDb();
  await db.exec(`
    CREATE TABLE IF NOT EXISTS pos_products (id TEXT PRIMARY KEY, brand TEXT, model TEXT, category TEXT, cost_price REAL DEFAULT 0, selling_price REAL DEFAULT 0, stock_qty REAL DEFAULT 0, raw_json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS pos_sales (id TEXT PRIMARY KEY, invoice TEXT UNIQUE, date_time TEXT, sale_date TEXT, customer TEXT, items TEXT, amount REAL DEFAULT 0, cost REAL DEFAULT 0, payment TEXT, status TEXT, raw_json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS pos_accounts (id TEXT PRIMARY KEY, name TEXT, balance REAL DEFAULT 0, raw_json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS pos_customers (id TEXT PRIMARY KEY, name TEXT NOT NULL, phone TEXT, address TEXT, balance REAL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS pos_suppliers (id TEXT PRIMARY KEY, name TEXT NOT NULL, phone TEXT, address TEXT, balance REAL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS pos_accounting (id TEXT PRIMARY KEY, entry_date TEXT NOT NULL, entry_type TEXT NOT NULL, category TEXT, amount REAL DEFAULT 0, account TEXT, note TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
  `);
  return db;
}

function attachDashboardApi(app, { protect }) {
  app.get('/api/dashboard', protect, async (_req, res) => {
    const db = await ensureTables();
    const today = new Date().toISOString().slice(0, 10);
    const weekStart = new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10);
    const salesToday = await db.get("SELECT COALESCE(SUM(amount),0) income, COALESCE(SUM(cost),0) cost FROM pos_sales WHERE sale_date=? AND status!='Voided'", today);
    const financeToday = await db.get("SELECT COALESCE(SUM(CASE WHEN lower(entry_type)='income' THEN amount ELSE 0 END),0) income, COALESCE(SUM(CASE WHEN lower(entry_type)='expense' THEN amount ELSE 0 END),0) expense FROM pos_accounting WHERE entry_date=?", today);
    const week = await db.get("SELECT COALESCE(SUM(amount),0) income, COUNT(*) orders FROM pos_sales WHERE sale_date>=? AND status!='Voided'", weekStart);
    const stock = await db.get('SELECT COALESCE(SUM(cost_price*stock_qty),0) balance FROM pos_products');
    const accounts = await db.get('SELECT COALESCE(SUM(balance),0) balance FROM pos_accounts');
    const customers = await db.get('SELECT COALESCE(SUM(balance),0) balance FROM pos_customers');
    const suppliers = await db.get('SELECT COALESCE(SUM(balance),0) balance FROM pos_suppliers');
    const saleIncome = Number(salesToday.income || 0);
    const otherIncome = Number(financeToday.income || 0);
    const expense = Number(financeToday.expense || 0);
    res.json({ ok:true, dashboard:{ todayTotalIncome:saleIncome+otherIncome, todaySaleIncome:saleIncome, todayProfit:saleIncome-Number(salesToday.cost || 0)+otherIncome-expense, todayExpense:expense, receivable:Number(customers.balance || 0), payable:Number(suppliers.balance || 0), accountBalance:Number(accounts.balance || 0), stockBalance:Number(stock.balance || 0), last7DaysSales:Number(week.income || 0), last7DaysOrders:Number(week.orders || 0) } });
  });
}

module.exports = attachDashboardApi;
