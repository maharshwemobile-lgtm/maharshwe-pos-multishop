const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const {
  adminPermissions,
  cashierPermissions,
  getDb,
  verifyUser,
  upsertCashiers,
  getState,
  setState,
  addActivityLog,
  listActivityLogs,
} = require('./db');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use((req, _res, next) => {
  if (req.url.startsWith('/pos/api/')) req.url = req.url.replace(/^\/pos\/api/, '/api');
  next();
});

const SETTINGS_FILE = path.join(__dirname, 'pos-settings.json');
const DATA_FILE = path.join(__dirname, 'pos-external-data.json');
const DIST_DIR = path.join(__dirname, '..', 'dist');
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(48).toString('hex');
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '12h';

const readSettings = () => {
  try { return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')); } catch { return {}; }
};
const writeSettings = (data) => fs.writeFileSync(SETTINGS_FILE, JSON.stringify(data, null, 2));
const readExternalData = () => {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch { return {}; }
};
const writeExternalData = (data) => fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
const requireToken = (req, res, next) => {
  const saved = readSettings()?.shopConfig?.appToken || process.env.POS_API_TOKEN || 'maharshwe123';
  if (saved && req.headers['x-pos-token'] !== saved) return res.status(401).json({ ok: false, message: 'Invalid POS API token' });
  next();
};
const signToken = (user) => jwt.sign({ sub: user.id, username: user.username, role: user.role, name: user.name }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
const requireJwt = (req, res, next) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return res.status(401).json({ ok: false, message: 'Login token မရှိပါ။ ပြန်ဝင်ပါ။' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ ok: false, message: 'Login token မမှန်ပါ။ ပြန်ဝင်ပါ။' });
  }
};
const protect = (req, res, next) => {
  if (req.headers.authorization) return requireJwt(req, res, next);
  return requireToken(req, res, next);
};
const sendTelegramMessage = async (cfg, text) => {
  const savedCfg = readSettings().shopConfig || {};
  const botToken = cfg?.telegramBotToken || savedCfg.telegramBotToken || process.env.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_API_KEY;
  const chatId = cfg?.adminChatId || savedCfg.adminChatId || process.env.TELEGRAM_ADMIN_CHAT_ID;
  if (!botToken || !chatId) throw new Error('Telegram Bot Token / Admin Chat ID မထည့်ရသေးပါ');
  const tg = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
  const data = await tg.json().catch(() => ({}));
  if (!tg.ok || data.ok === false) throw new Error(data.description || 'Telegram send failed');
  return data;
};

const pickFirst = (source, keys, fallback = '') => {
  for (const key of keys) {
    if (source?.[key] !== undefined && source?.[key] !== null && source?.[key] !== '') return source[key];
  }
  return fallback;
};

const normalizeRepairRow = (row = {}, index = 0) => {
  const voucherNo = String(pickFirst(row, ['voucherNo', 'voucher', 'Voucher', 'VOUCHER', 'Voucher No', 'VoucherNo', 'ဘောက်ချာ'], '')).trim();
  const status = String(pickFirst(row, ['status', 'Status', 'STATUS', 'အခြေအနေ'], 'Pending')).trim() || 'Pending';
  return {
    id: String(pickFirst(row, ['id', 'ID'], voucherNo ? `sheet_${voucherNo}` : `sheet_${Date.now()}_${index}`)),
    voucherNo,
    customerName: String(pickFirst(row, ['customerName', 'customer', 'Customer', 'CUSTOMER', 'Customer Name', 'အမည်'], '')).trim(),
    phone: String(pickFirst(row, ['phone', 'Phone', 'PHONE', 'ဖုန်း'], '')).trim(),
    model: String(pickFirst(row, ['model', 'Model', 'MODEL', 'Phone Model', 'အမျိုးအစား'], '')).trim(),
    issue: String(pickFirst(row, ['issue', 'Issue', 'ISSUE', 'Repair Needed', 'Error', 'ပြင်ရန်'], '')).trim(),
    shop: String(pickFirst(row, ['shop', 'Shop', 'SHOP', 'ဆိုင်'], '')).trim(),
    status,
    repairFee: Number(pickFirst(row, ['repairFee', 'fee', 'Fee', 'FEES', 'Amount', 'ပြင်ခ'], 0)) || 0,
    staffId: String(pickFirst(row, ['staffId', 'technician', 'Technician', 'TECHNICIAN'], fixedTechnicians[0]?.name || '')).trim(),
    created_at: String(pickFirst(row, ['created_at', 'createdAt', 'date', 'Date', 'DATE'], new Date().toISOString().substring(0, 10))),
    completed_at: String(pickFirst(row, ['completed_at', 'completedAt'], '')),
  };
};

const readRepairRowsFromPayload = (data) => {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.repairs)) return data.repairs;
  if (Array.isArray(data?.pending)) return data.pending;
  if (Array.isArray(data?.data)) return data.data;
  if (Array.isArray(data?.rows)) return data.rows;
  return [];
};


const fixedTechnicians = [
  { name: 'Khun Lwin OO', chatId: '5386894413' },
  { name: 'Khun Mg Ponn', chatId: '6730666866' },
  { name: 'Sayar San', chatId: '8035358430' },
  { name: 'Ba Mg', chatId: '8731433727' },
  { name: 'KMA', chatId: '8128573692' },
];

function verifyTelegramInitData(initData, botToken) {
  if (!initData || !botToken) return { ok: false, message: 'Telegram Bot Token / initData မရှိပါ' };
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return { ok: false, message: 'Telegram hash မပါပါ' };
  params.delete('hash');
  const dataCheckString = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const calculated = crypto.createHmac('sha256', secret).update(dataCheckString).digest('hex');
  if (!crypto.timingSafeEqual(Buffer.from(calculated), Buffer.from(hash))) return { ok: false, message: 'Telegram verification failed' };
  const user = JSON.parse(params.get('user') || '{}');
  return { ok: true, user };
}

app.get('/api/health', (req, res) => res.json({ ok: true, app: 'MaharShwe POS' }));
app.get('/api/version', (req, res) => res.json({ version: '2.5.0', latest: true, message: 'Your POS is up to date' }));

app.post('/api/auth/login', async (req, res) => {
  try {
    const username = String(req.body.username || '').trim();
    const password = String(req.body.password || '').trim();
    if (!username || !password) return res.status(400).json({ ok: false, message: 'Username / Password ရိုက်ထည့်ပါ' });

    await upsertCashiers(req.body.cashiers || []);
    const user = await verifyUser(username, password);
    if (!user) return res.status(401).json({ ok: false, message: 'Login မအောင်မြင်ပါ။ Username / Password မှားနေပါတယ်' });

    const token = signToken(user);
    await addActivityLog({ userId: user.id, userName: user.name, action: 'Login', details: `${user.name} logged in`, ip: req.ip });
    res.json({ ok: true, token, user });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message || 'Login မအောင်မြင်ပါ' });
  }
});

app.post('/api/auth/logout', requireJwt, async (req, res) => {
  await addActivityLog({ userId: req.user.sub, userName: req.user.name, action: 'Logout', details: `${req.user.name} logged out`, ip: req.ip });
  res.json({ ok: true });
});

app.post('/api/auth/telegram', (req, res) => {
  const cfg = req.body.shopConfig || readSettings().shopConfig || {};
  const botToken = cfg.telegramBotToken || process.env.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_API_KEY;
  const result = verifyTelegramInitData(req.body.initData, botToken);
  if (!result.ok) return res.status(401).json(result);

  const tgUser = result.user;
  const username = String(tgUser.username || '').toLowerCase();
  const chatId = String(tgUser.id || '');
  const cashiers = req.body.cashiers || [];
  const savedTechs = readSettings().technicians || [];
  const technicians = [...fixedTechnicians, ...(req.body.technicians || savedTechs || [])];

  const adminChatId = String(cfg.adminChatId || process.env.TELEGRAM_ADMIN_CHAT_ID || '');
  if (adminChatId && chatId === adminChatId) {
    const user = { id: `tg_${chatId}`, name: tgUser.first_name || 'Telegram Admin', role: 'Admin', loginType: 'Telegram WebApp', permissions: adminPermissions };
    return res.json({ ok: true, token: signToken({ ...user, username: `tg_${chatId}` }), user });
  }

  const cashier = cashiers.find(c => String(c.chatId || '') === chatId || String(c.username || '').toLowerCase() === username);
  if (cashier) {
    const user = { id: cashier.id || `tg_${chatId}`, name: cashier.name || tgUser.first_name || 'Telegram Cashier', role: 'Cashier', loginType: 'Telegram WebApp', permissions: cashier.permissions || cashierPermissions };
    return res.json({ ok: true, token: signToken({ ...user, username: cashier.username || `tg_${chatId}` }), user });
  }

  const tech = technicians.find(t => String(t.chatId || '') === chatId || String(t.username || '').toLowerCase() === username);
  if (tech) {
    const user = { id: `tg_${chatId}`, name: tech.name || tgUser.first_name || 'Technician', role: 'Cashier', loginType: 'Telegram WebApp', permissions: cashierPermissions };
    return res.json({ ok: true, token: signToken({ ...user, username: `tg_${chatId}` }), user });
  }

  res.status(403).json({ ok: false, message: 'ဤ Telegram user ကို Admin/Cashier/Technician ထဲ မတွေ့ပါ' });
});

app.post('/api/settings', requireJwt, async (req, res) => {
  const payload = {
    shopConfig: { ...(req.body.shopConfig || {}), adminPassword: undefined },
    technicians: req.body.technicians || [],
    customCategories: req.body.customCategories || [],
    updatedAt: new Date().toISOString(),
  };
  writeSettings(payload);
  await setState('settings', payload);
  await upsertCashiers(req.body.cashiers || []);
  res.json({ ok: true, message: 'System settings updated', updatedAt: payload.updatedAt });
});

app.get('/api/state', requireJwt, async (_req, res) => {
  const state = await getState('snapshot', readExternalData());
  const settings = await getState('settings', readSettings());
  const logs = await listActivityLogs();
  res.json({ ok: true, state, settings, logs });
});

app.post('/api/activity-log', requireJwt, async (req, res) => {
  await addActivityLog({
    userId: req.user.sub,
    userName: req.body.user || req.user.name,
    action: req.body.action || 'Activity',
    details: req.body.details || '',
    ip: req.ip,
  });
  res.json({ ok: true });
});

app.post('/api/google-sync', protect, async (req, res) => {
  try {
    const savedGoogleUrl = readSettings()?.shopConfig?.googleSheetApiUrl;
    const fallbackGoogleUrl = '';
    const url = process.env.GOOGLE_SHEET_WEB_APP_URL || req.body?.shopConfig?.googleSheetApiUrl || savedGoogleUrl || fallbackGoogleUrl;
    if (!url || url === '/api/google-sync' || url === '/pos/api/google-sync') {
      return res.status(400).json({ ok: false, message: 'Report Sheet full sync Web App URL မထည့်ရသေးပါ။ Report daily_summary အတွက် Accounting Daily Web App Link ကိုသုံးပါ။' });
    }
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'syncPOS',
        token: req.body?.shopConfig?.appToken || '',
        products: req.body.products || [],
        sales: req.body.sales || [],
        saleRecords: req.body.saleRecords || [],
        purchases: req.body.purchases || [],
        saleReturns: req.body.saleReturns || [],
        transfers: req.body.transfers || [],
        adjustments: req.body.adjustments || [],
        accounts: req.body.accounts || [],
        accountTransactions: req.body.accountTransactions || [],
        repairs: req.body.repairs || [],
        expenses: req.body.expenses || [],
        financials: req.body.financials || {},
        todayFinancials: req.body.todayFinancials || {},
        dailyReportRecord: req.body.dailyReportRecord || {},
        financialCategories: req.body.financialCategories || [],
        financialRows: req.body.financialRows || [],
        allFinancialRows: req.body.allFinancialRows || [],
        syncedAt: new Date().toISOString(),
      }),
    });
    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { ok: response.ok, message: text }; }
    if (!response.ok || data.ok === false) return res.status(502).json({ ok: false, message: data.message || 'Google Sheet API rejected sync' });
    res.json({
      ok: true,
      message: data.message || 'Google Sheet real API sync completed',
      products: data.products || undefined,
      sales: data.sales || undefined,
      saleRecords: data.saleRecords || undefined,
      purchases: data.purchases || undefined,
      saleReturns: data.saleReturns || undefined,
      transfers: data.transfers || undefined,
      adjustments: data.adjustments || undefined,
      accounts: data.accounts || undefined,
      accountTransactions: data.accountTransactions || undefined,
      repairs: data.repairs || undefined,
      expenses: data.expenses || undefined,
      financials: data.financials || undefined,
      todayFinancials: data.todayFinancials || undefined,
      dailyReportRecord: data.dailyReportRecord || undefined,
      financialCategories: data.financialCategories || undefined,
      financialRows: data.financialRows || undefined,
      allFinancialRows: data.allFinancialRows || undefined,
    });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message || 'Google Sheet sync failed' });
  }
});

app.post('/api/accounting-daily-summary', protect, async (req, res) => {
  try {
    const savedUrl = readSettings()?.shopConfig?.accountingDailyApiUrl;
    const url = process.env.ACCOUNTING_DAILY_WEB_APP_URL || req.body?.shopConfig?.accountingDailyApiUrl || savedUrl;
    if (!url) {
      return res.status(400).json({ ok: false, message: 'ACCOUNTING_DAILY_WEB_APP_URL မထည့်ရသေးပါ' });
    }

    const record = req.body.dailyReportRecord || {};
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'daily_summary',
        sales: String(record.saleIncome || 0),
        other_income: String(record.otherIncome || 0),
        expenses: String(record.expense || 0),
        source: 'Mahar Shwe POS',
        syncedAt: new Date().toISOString(),
      }),
    });
    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { status: response.ok ? 'success' : 'error', message: text }; }
    if (!response.ok || data.status === 'error' || data.ok === false) {
      return res.status(502).json({ ok: false, message: data.msg || data.message || 'Accounting daily summary rejected' });
    }
    res.json({ ok: true, message: 'Accounting daily summary synced', data });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message || 'Accounting daily summary sync failed' });
  }
});

app.get('/api/repair/voucher/:id', protect, async (req, res) => {
  try {
    const savedUrl = readSettings()?.shopConfig?.repairApiUrl;
    const url = process.env.REPAIR_TRACKING_WEB_APP_URL || savedUrl;
    if (!url) return res.status(400).json({ ok: false, found: false, message: 'Repair Tracking Web App URL မထည့်ရသေးပါ' });

    const endpoint = new URL(url);
    endpoint.searchParams.set('voucher', req.params.id);
    const response = await fetch(endpoint);
    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { found: false, message: text }; }
    if (!response.ok || data.ok === false || data.found === false) {
      return res.status(response.ok ? 404 : 502).json({ ok: false, found: false, message: data.message || data.error || 'Voucher မတွေ့ပါ' });
    }
    res.json({ ok: true, found: true, ...data });
  } catch (err) {
    res.status(500).json({ ok: false, found: false, message: err.message || 'Repair Tracking lookup failed' });
  }
});

app.get('/api/repairs/pending', protect, async (_req, res) => {
  try {
    const savedUrl = readSettings()?.shopConfig?.repairApiUrl;
    const url = process.env.REPAIR_TRACKING_WEB_APP_URL || savedUrl;
    if (!url) return res.status(400).json({ ok: false, repairs: [], message: 'Repair Tracking Web App URL မထည့်ရသေးပါ' });

    const attempts = [
      { action: 'pending_repairs', status: 'Pending' },
      { action: 'list_repairs', status: 'Pending' },
      { type: 'pending_repairs', status: 'Pending' },
      { status: 'Pending' },
    ];

    let lastMessage = '';
    for (const params of attempts) {
      const endpoint = new URL(url);
      Object.entries(params).forEach(([key, value]) => endpoint.searchParams.set(key, value));
      const response = await fetch(endpoint);
      const text = await response.text();
      let data;
      try { data = JSON.parse(text); } catch { data = { ok: response.ok, message: text }; }
      const rows = readRepairRowsFromPayload(data);
      if (response.ok && rows.length) {
        const repairs = rows
          .map(normalizeRepairRow)
          .filter(row => row.voucherNo || row.customerName || row.model || row.issue)
          .filter(row => !['collected', 'done', 'finished', 'complete', 'completed'].includes(String(row.status || '').trim().toLowerCase()));
        return res.json({ ok: true, repairs, count: repairs.length, message: `${repairs.length} pending repairs pulled from sheet` });
      }
      lastMessage = data.message || data.error || text || lastMessage;
    }

    res.json({ ok: true, repairs: [], count: 0, message: lastMessage || 'No pending repair rows found in sheet' });
  } catch (err) {
    res.status(500).json({ ok: false, repairs: [], message: err.message || 'Pending repair pull failed' });
  }
});

app.post('/api/telegram/daily-report', protect, async (req, res) => {
  try {
    await sendTelegramMessage(req.body.shopConfig || {}, req.body.text || 'Daily report is empty');
    res.json({ ok: true, message: 'Telegram Daily Report sent' });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message || 'Telegram Daily Report failed' });
  }
});

app.post('/api/telegram/sale-report', protect, async (req, res) => {
  try {
    await sendTelegramMessage(req.body.shopConfig || {}, req.body.text || 'New sale');
    res.json({ ok: true, message: 'Telegram Sale Report sent' });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message || 'Telegram Sale Report failed' });
  }
});




app.post('/api/external/snapshot', protect, async (req, res) => {
  const snapshot = { ...req.body, updatedAt: new Date().toISOString() };
  writeExternalData(snapshot);
  await setState('snapshot', snapshot);
  res.json({ ok: true, message: 'External API snapshot updated', updatedAt: snapshot.updatedAt });
});

app.get('/api/external/reports/all', requireToken, (req, res) => {
  const data = readExternalData();
  res.json({ ok: true, generatedAt: new Date().toISOString(), report: data });
});

app.get('/api/external/settings', requireToken, (req, res) => {
  res.json({ ok: true, settings: readSettings() });
});

app.get('/api/external/products', requireToken, (req, res) => {
  const data = readExternalData();
  res.json({ ok: true, products: data.products || [] });
});

app.get('/api/external/sales', requireToken, (req, res) => {
  const data = readExternalData();
  res.json({ ok: true, sales: data.sales || [], salesByUser: data.salesByUser || [] });
});

app.get('/api/external/finance', requireToken, (req, res) => {
  const data = readExternalData();
  res.json({ ok: true, financials: data.financials || {}, todayFinancials: data.todayFinancials || {} });
});

if (fs.existsSync(DIST_DIR)) {
  app.use('/pos', express.static(DIST_DIR));
  app.use('/pos', (req, res, next) => req.path.startsWith('/api') ? next() : res.sendFile(path.join(DIST_DIR, 'index.html')));
  app.use(express.static(DIST_DIR));
  app.use((req, res, next) => req.path.startsWith('/api') ? next() : res.sendFile(path.join(DIST_DIR, 'index.html')));
}

const PORT = process.env.PORT || 4000;
const HOST = process.env.HOST || '127.0.0.1';
getDb()
  .then(() => app.listen(PORT, HOST, () => console.log(`API running on http://${HOST}:${PORT}`)))
  .catch((err) => {
    console.error('Database initialization failed:', err);
    process.exit(1);
  });
