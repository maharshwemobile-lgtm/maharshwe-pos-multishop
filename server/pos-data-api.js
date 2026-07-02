const { getState, setState, addActivityLog } = require('./db');

function asNumber(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}

function cleanUser(user = {}) {
  const { password_hash, password, ...safe } = user;
  return safe;
}

function getSnapshot(raw = {}) {
  const data = raw.data || raw.state || raw;
  return {
    products: Array.isArray(data.products) ? data.products : [],
    sales: Array.isArray(data.sales) ? data.sales : Array.isArray(data.saleRecords) ? data.saleRecords : [],
    repairs: Array.isArray(data.repairs) ? data.repairs : [],
    accounts: Array.isArray(data.accounts) ? data.accounts : [],
    users: Array.isArray(data.users) ? data.users.map(cleanUser) : [],
    customers: Array.isArray(data.customers) ? data.customers : [],
    suppliers: Array.isArray(data.suppliers) ? data.suppliers : [],
    settings: data.settings || {},
  };
}

function saleDate(sale) {
  return String(sale.date || sale.created_at || sale.createdAt || sale['Date / Time'] || '').slice(0, 10);
}

function saleAmount(sale) {
  return asNumber(sale.payable ?? sale.total ?? sale.amount ?? sale['Sale Payable'] ?? sale['Line Total']);
}

function saleCost(sale) {
  if (Array.isArray(sale.items)) return sale.items.reduce((sum, item) => sum + asNumber(item.cost) * asNumber(item.qty || 1), 0);
  return asNumber(sale.cost ?? sale.dailyCost ?? sale['Daily Cost']);
}

function saleItemsText(sale) {
  if (Array.isArray(sale.items)) return sale.items.map(item => `${item.name || item.model || 'Item'} x${item.qty || 1}`).join(', ');
  return String(sale.itemName || sale['Item Name'] || sale.items || 'Item');
}

function normalizeSale(sale, index) {
  return {
    id: String(sale.id || sale.invoiceNo || sale.invoice || `sale_${index}`),
    invoice: String(sale.invoiceNo || sale.invoice || sale.Invoice || `MS${90473 - index}`),
    dateTime: String(sale.date || sale.created_at || sale.createdAt || sale['Date / Time'] || ''),
    date: saleDate(sale),
    customer: String(sale.customerName || sale.customer || sale.Customer || 'Walk-in Customer').replaceAll('_', ' '),
    items: saleItemsText(sale),
    amount: saleAmount(sale),
    payment: String(sale.payMethod || sale.payment || sale.Payment || 'Cash'),
    status: String(sale.status || sale.Status || 'Completed'),
    cashier: String(sale.user || sale.cashier || sale.Cashier || ''),
  };
}

function normalizeRepair(row, index) {
  const voucher = String(row.voucherNo || row.sourceRepairId || row.repairId || row.id || `MS${String(index + 1).padStart(4, '0')}`);
  return {
    id: voucher,
    repairId: voucher,
    date: String(row.created_at || row.createdAt || row.date || '').slice(0, 10),
    customer: String(row.customerName || row.customer || row.name || ''),
    device: String(row.model || row.device || ''),
    issue: String(row.issue || row.problem || ''),
    status: String(row.status || ''),
    pickup: String(row.pickup || row.pickupStatus || row.collectStatus || ''),
    cost: asNumber(row.repairFee || row.cost || row.amount || 0),
  };
}

function attachPosDataApi(app, { protect }) {
  app.post('/api/db/restore', protect, async (req, res) => {
    const snapshot = getSnapshot(req.body || {});
    await setState('snapshot', snapshot);
    await addActivityLog({ userName: req.user?.name || 'System', action: 'Restore DB', details: 'Backup data restored to server database', ip: req.ip });
    res.json({ ok: true, message: 'DB restore completed', counts: {
      products: snapshot.products.length,
      sales: snapshot.sales.length,
      repairs: snapshot.repairs.length,
      accounts: snapshot.accounts.length,
      users: snapshot.users.length,
    }});
  });

  app.get('/api/dashboard', protect, async (_req, res) => {
    const state = getSnapshot(await getState('snapshot', {}));
    const today = new Date().toISOString().slice(0, 10);
    const todaySales = state.sales.map(normalizeSale).filter(sale => sale.date === today);
    const todayIncome = todaySales.reduce((sum, sale) => sum + sale.amount, 0);
    const todayCost = state.sales.filter(sale => saleDate(sale) === today).reduce((sum, sale) => sum + saleCost(sale), 0);
    const stockBalance = state.products.reduce((sum, p) => sum + asNumber(p.costPrice) * asNumber(p.stockQty), 0);
    const accountBalance = state.accounts.reduce((sum, a) => sum + asNumber(a.balance), 0);
    const last7Days = state.sales.map(normalizeSale).filter(sale => {
      if (!sale.date) return false;
      const diff = (Date.now() - new Date(sale.date).getTime()) / 86400000;
      return diff >= 0 && diff < 7;
    });
    res.json({ ok: true, dashboard: {
      todayTotalIncome: todayIncome,
      todaySaleIncome: todayIncome,
      todayProfit: todayIncome - todayCost,
      todayExpense: 0,
      receivable: 0,
      payable: 0,
      accountBalance,
      stockBalance,
      last7DaysSales: last7Days.reduce((sum, sale) => sum + sale.amount, 0),
      last7DaysOrders: last7Days.length,
    }});
  });

  app.get('/api/sales', protect, async (req, res) => {
    const state = getSnapshot(await getState('snapshot', {}));
    const page = Math.max(1, Number(req.query.page || 1));
    const limit = Math.max(1, Math.min(100, Number(req.query.limit || 10)));
    const rows = state.sales.map(normalizeSale).sort((a, b) => String(b.dateTime).localeCompare(String(a.dateTime)));
    const start = (page - 1) * limit;
    res.json({ ok: true, page, limit, total: rows.length, totalPages: Math.ceil(rows.length / limit), sales: rows.slice(start, start + limit) });
  });

  app.get('/api/products', protect, async (req, res) => {
    const state = getSnapshot(await getState('snapshot', {}));
    const q = String(req.query.q || '').toLowerCase();
    const products = state.products.filter(p => !q || `${p.brand || ''} ${p.model || ''} ${p.category || ''}`.toLowerCase().includes(q));
    res.json({ ok: true, total: products.length, products });
  });

  app.get('/api/repairs', protect, async (req, res) => {
    const state = getSnapshot(await getState('snapshot', {}));
    const q = String(req.query.q || '').toLowerCase();
    const date = String(req.query.date || '');
    const month = String(req.query.month || '');
    const rows = state.repairs.map(normalizeRepair).filter(row => {
      const text = `${row.repairId} ${row.customer} ${row.device} ${row.issue}`.toLowerCase();
      return (!q || text.includes(q)) && (!date || row.date === date) && (!month || row.date.startsWith(month));
    });
    const done = rows.filter(r => /done|complete|finished|ပြင်ပြီး/i.test(r.status)).length;
    const picked = rows.filter(r => /ယူပြီး|picked|collected/i.test(r.pickup || r.status)).length;
    res.json({ ok: true, summary: { total: rows.length, pending: Math.max(0, rows.length - done), done, picked }, repairs: rows });
  });

  app.post('/api/sales/:id/void', protect, async (req, res) => {
    const state = getSnapshot(await getState('snapshot', {}));
    state.sales = state.sales.map(sale => String(sale.id || sale.invoiceNo || sale.invoice) === String(req.params.id) ? { ...sale, status: 'Voided', voidReason: req.body.reason || '' } : sale);
    await setState('snapshot', state);
    res.json({ ok: true, message: 'Sale voided' });
  });
}

module.exports = attachPosDataApi;
