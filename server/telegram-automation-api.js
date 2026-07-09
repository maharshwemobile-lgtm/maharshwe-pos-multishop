const crypto = require('crypto');
const { z } = require('zod');
const { Prisma } = require('@prisma/client');
const { prisma } = require('./prisma');
const {
  requireAuth,
  requireShopUser,
  requireWritableSubscription,
} = require('./auth-api');

const SETTINGS_VERSION = 1;
const DEFAULT_TELEGRAM = Object.freeze({
  enabled: false,
  botToken: '',
  botTokenLast4: '',
  botUsername: '',
  chatId: '',
  linkedTelegramId: '',
  linkedTelegramName: '',
  linkedUsers: {},
  saleNotifications: false,
  dailyReportEnabled: false,
  dailyReportTime: '21:00',
  lastSaleSentAt: null,
  lastReportDate: '',
  lastReportSentAt: null,
  lastTest: null,
});

const cleanText = (max = 500) => z.union([z.string().trim().max(max), z.literal(''), z.null()]).optional();
const settingsSchema = z.object({
  enabled: z.boolean().default(false),
  botToken: z.string().trim().min(20).max(200).optional().or(z.literal('')),
  clearBotToken: z.boolean().optional(),
  botUsername: cleanText(80),
  chatId: cleanText(80),
  saleNotifications: z.boolean().default(false),
  dailyReportEnabled: z.boolean().default(false),
  dailyReportTime: z.string().trim().regex(/^\d{2}:\d{2}$/).default('21:00'),
});

const loginSchema = z.object({
  id: z.union([z.string(), z.number()]),
  first_name: cleanText(120),
  last_name: cleanText(120),
  username: cleanText(120),
  photo_url: cleanText(500),
  auth_date: z.union([z.string(), z.number()]),
  hash: z.string().trim().min(20).max(256),
});

class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

function wrap(handler) {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (error) {
      if (error instanceof ApiError) return res.status(error.status).json({ ok: false, message: error.message, details: error.details });
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') return res.status(404).json({ ok: false, message: 'Telegram settings not found' });
      console.error('Telegram automation API:', error);
      return res.status(500).json({ ok: false, message: error.message || 'Telegram request failed' });
    }
  };
}

function plainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function clean(value, max = 500) {
  if (value === null || value === undefined) return '';
  return String(value).trim().slice(0, max);
}

function number(value) {
  return Number(value || 0);
}

function mmk(value) {
  return `${Math.round(number(value)).toLocaleString('en-US')} MMK`;
}

function yangonParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Yangon',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    date: `${map.year}-${map.month}-${map.day}`,
    time: `${map.hour}:${map.minute}`,
  };
}

function mergeTelegram(raw) {
  return { ...DEFAULT_TELEGRAM, ...plainObject(raw) };
}

function safeTelegram(settings, userId = '') {
  const linkedUsers = plainObject(settings.linkedUsers);
  const currentUserTelegram = userId ? plainObject(linkedUsers[userId]) : {};
  return {
    enabled: Boolean(settings.enabled),
    botUsername: settings.botUsername || '',
    chatId: settings.chatId || '',
    hasBotToken: Boolean(settings.botToken),
    botTokenLast4: settings.botTokenLast4 || '',
    linkedTelegramId: settings.linkedTelegramId || '',
    linkedTelegramName: settings.linkedTelegramName || '',
    currentUserTelegram: currentUserTelegram.telegramId ? {
      telegramId: currentUserTelegram.telegramId || '',
      chatId: currentUserTelegram.chatId || '',
      name: currentUserTelegram.name || '',
      username: currentUserTelegram.username || '',
      linkedAt: currentUserTelegram.linkedAt || null,
    } : null,
    linkedUserCount: Object.keys(linkedUsers).length,
    saleNotifications: Boolean(settings.saleNotifications),
    dailyReportEnabled: Boolean(settings.dailyReportEnabled),
    dailyReportTime: settings.dailyReportTime || DEFAULT_TELEGRAM.dailyReportTime,
    lastSaleSentAt: settings.lastSaleSentAt || null,
    lastReportDate: settings.lastReportDate || '',
    lastReportSentAt: settings.lastReportSentAt || null,
    lastTest: settings.lastTest || null,
    loginWidgetReady: Boolean(settings.botUsername && settings.botToken),
  };
}

async function currentRawSettings(shopId) {
  const row = await prisma.shopSettings.findUnique({ where: { shopId }, select: { settings: true } });
  return plainObject(row?.settings);
}

async function loadTelegramSettings(shopId) {
  const raw = await currentRawSettings(shopId);
  const integrations = plainObject(raw.integrations);
  return mergeTelegram(integrations.telegram);
}

async function saveTelegramSettings(tx, shopId, telegram) {
  const raw = await currentRawSettings(shopId);
  const integrations = plainObject(raw.integrations);
  const system = plainObject(raw.system);
  await tx.shopSettings.upsert({
    where: { shopId },
    create: {
      shopId,
      settings: {
        ...raw,
        integrations: { ...integrations, telegram },
        system: { ...system, settingsVersion: SETTINGS_VERSION },
      },
    },
    update: {
      settings: {
        ...raw,
        integrations: { ...integrations, telegram },
        system: { ...system, settingsVersion: SETTINGS_VERSION },
      },
    },
  });
}

function requireSettingsManager(req, res, next) {
  if (req.auth?.role === 'SUPER_ADMIN' || req.auth?.role === 'SHOP_ADMIN' || req.auth?.permissions?.settings === true) return next();
  return res.status(403).json({ ok: false, message: 'Settings permission is required' });
}

async function audit(tx, req, action, details) {
  await tx.auditLog.create({
    data: {
      shopId: req.auth.shopId,
      userId: req.auth.userId,
      action,
      entityType: 'telegram_automation',
      entityId: req.auth.shopId,
      details,
      ipAddress: req.ip || null,
      userAgent: req.headers['user-agent'] || null,
    },
  }).catch(() => null);
}

async function sendTelegramMessage(settings, text) {
  const token = clean(settings.botToken || process.env.TELEGRAM_BOT_TOKEN || '', 240);
  const chatId = clean(settings.chatId || '', 80);
  if (!token || !chatId) throw new ApiError(400, 'Telegram Bot Token / Chat ID မထည့်ရသေးပါ');
  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: clean(text, 3900),
      disable_web_page_preview: true,
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) throw new ApiError(502, data.description || 'Telegram send failed');
  return data.result;
}

function telegramLoginSecret(botToken) {
  return crypto.createHash('sha256').update(botToken).digest();
}

function verifyTelegramLogin(payload, botToken) {
  if (!botToken) throw new ApiError(400, 'Telegram Bot Token is required before Telegram Login');
  const hash = clean(payload.hash, 256);
  const pairs = Object.entries(payload)
    .filter(([key, value]) => key !== 'hash' && value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${key}=${value}`)
    .sort();
  const checkString = pairs.join('\n');
  const expected = crypto.createHmac('sha256', telegramLoginSecret(botToken)).update(checkString).digest('hex');
  const left = Buffer.from(expected);
  const right = Buffer.from(hash);
  if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) throw new ApiError(401, 'Telegram login verification failed');
  const authDate = Number(payload.auth_date || 0) * 1000;
  if (!authDate || Date.now() - authDate > 86400000) throw new ApiError(401, 'Telegram login expired');
  return true;
}

function formatSaleMessage(shop, sale) {
  const lines = [
    `🧾 Sale Completed`,
    `Shop: ${shop?.name || shop?.slug || 'Mahar POS'}`,
    `Invoice: ${sale.invoiceNumber || sale.invoice || '-'}`,
    `Total: ${mmk(sale.total || sale.amount)}`,
    `Payment: ${sale.payment || sale.paymentMethod || '-'}`,
    `Customer: ${sale.customer || 'Walk-in Customer'}`,
  ];
  if (Array.isArray(sale.items) && sale.items.length) {
    lines.push('', 'Items:');
    for (const item of sale.items.slice(0, 8)) {
      lines.push(`- ${item.productName || item.name || 'Item'} x${item.quantity || 1} = ${mmk((item.unitPrice || 0) * (item.quantity || 1))}`);
    }
    if (sale.items.length > 8) lines.push(`...and ${sale.items.length - 8} more`);
  }
  lines.push('', `Time: ${new Date().toLocaleString('en-GB', { timeZone: 'Asia/Yangon' })}`);
  return lines.join('\n');
}

async function buildDailyReport(shopId) {
  const { date } = yangonParts();
  const saleDate = `((sold_at AT TIME ZONE 'Asia/Yangon')::date)`;
  const [shop, sales, payments, money, biller] = await Promise.all([
    prisma.shop.findUnique({ where: { id: shopId }, select: { name: true, slug: true } }),
    prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS count, COALESCE(SUM(total),0) AS total, COALESCE(SUM(profit_total),0) AS profit
         FROM sales
        WHERE shop_id=$1::uuid AND status IN ('COMPLETED','PARTIAL_RETURN') AND ${saleDate}=$2::date`,
      shopId,
      date,
    ).catch(() => [{ count: 0, total: 0, profit: 0 }]),
    prisma.$queryRawUnsafe(
      `SELECT method, COALESCE(SUM(amount),0) AS amount
         FROM payments
        WHERE shop_id=$1::uuid AND (paid_at AT TIME ZONE 'Asia/Yangon')::date=$2::date AND status='PAID'
        GROUP BY method
        ORDER BY method`,
      shopId,
      date,
    ).catch(() => []),
    prisma.$queryRawUnsafe(
      `SELECT COALESCE(SUM(service_profit),0) AS fee
         FROM money_service_transactions
        WHERE shop_id=$1::uuid AND (created_at AT TIME ZONE 'Asia/Yangon')::date=$2::date`,
      shopId,
      date,
    ).catch(() => [{ fee: 0 }]),
    prisma.$queryRawUnsafe(
      `SELECT COALESCE(SUM(CASE WHEN transaction_type='SOLD' THEN amount ELSE 0 END),0) AS sold,
              COALESCE(SUM(CASE WHEN transaction_type='SOLD' THEN profit_amount ELSE 0 END),0) AS profit
         FROM biller_transactions
        WHERE shop_id=$1::uuid AND transaction_date::date=$2::date`,
      shopId,
      date,
    ).catch(() => [{ sold: 0, profit: 0 }]),
  ]);
  const sale = sales?.[0] || {};
  const moneyRow = money?.[0] || {};
  const billerRow = biller?.[0] || {};
  const paymentLines = (payments || []).map((row) => `- ${row.method}: ${mmk(row.amount)}`);
  return [
    `📊 Daily Auto Report`,
    `Shop: ${shop?.name || shop?.slug || 'Mahar POS'}`,
    `Date: ${date}`,
    '',
    `Sales Count: ${sale.count || 0}`,
    `Product Sales: ${mmk(sale.total)}`,
    `Product Profit: ${mmk(sale.profit)}`,
    `Money Service Fee: ${mmk(moneyRow.fee)}`,
    `Bill/Eload Sold: ${mmk(billerRow.sold)}`,
    `Bill/Eload Profit: ${mmk(billerRow.profit)}`,
    '',
    `Payments:`,
    ...(paymentLines.length ? paymentLines : ['- No payment records']),
  ].join('\n');
}

async function notifyTelegramSale({ shopId, sale }) {
  const settings = await loadTelegramSettings(shopId);
  if (!settings.enabled || !settings.saleNotifications) return { skipped: true };
  const shop = await prisma.shop.findUnique({ where: { id: shopId }, select: { name: true, slug: true } });
  const result = await sendTelegramMessage(settings, formatSaleMessage(shop, sale));
  const next = { ...settings, lastSaleSentAt: new Date().toISOString() };
  await prisma.$transaction((tx) => saveTelegramSettings(tx, shopId, next)).catch(() => null);
  return { ok: true, messageId: result?.message_id || null };
}

async function sendDailyReportNow(shopId) {
  const settings = await loadTelegramSettings(shopId);
  if (!settings.enabled) throw new ApiError(400, 'Telegram automation is disabled');
  const text = await buildDailyReport(shopId);
  const result = await sendTelegramMessage(settings, text);
  const { date } = yangonParts();
  const next = { ...settings, lastReportDate: date, lastReportSentAt: new Date().toISOString() };
  await prisma.$transaction((tx) => saveTelegramSettings(tx, shopId, next));
  return { messageId: result?.message_id || null, date };
}

function startTelegramAutomationRunner() {
  if (startTelegramAutomationRunner.started) return;
  startTelegramAutomationRunner.started = true;
  const run = async () => {
    const { date, time } = yangonParts();
    const rows = await prisma.shopSettings.findMany({ select: { shopId: true, settings: true }, take: 1000 }).catch(() => []);
    for (const row of rows) {
      const raw = plainObject(row.settings);
      const settings = mergeTelegram(plainObject(plainObject(raw.integrations).telegram));
      if (!settings.enabled || !settings.dailyReportEnabled || !settings.botToken || !settings.chatId) continue;
      if (settings.lastReportDate === date) continue;
      if (time < (settings.dailyReportTime || '21:00')) continue;
      sendDailyReportNow(row.shopId).catch((error) => console.error('Telegram daily report failed:', error.message));
    }
  };
  setInterval(() => run().catch((error) => console.error('Telegram automation runner failed:', error.message)), 60 * 1000).unref?.();
}

function attachTelegramAutomationApi(app) {
  const access = [requireAuth, requireShopUser, requireWritableSubscription, requireSettingsManager];

  app.get('/api/project-settings/api/telegram', ...access, wrap(async (req, res) => {
    const settings = await loadTelegramSettings(req.auth.shopId);
    res.json({ ok: true, telegram: safeTelegram(settings, req.auth.userId) });
  }));

  app.put('/api/project-settings/api/telegram', ...access, wrap(async (req, res) => {
    const parsed = settingsSchema.safeParse(req.body || {});
    if (!parsed.success) throw new ApiError(400, 'Invalid Telegram settings', parsed.error.flatten().fieldErrors);
    const input = parsed.data;
    const current = await loadTelegramSettings(req.auth.shopId);
    const next = {
      ...current,
      enabled: input.enabled,
      saleNotifications: input.saleNotifications,
      dailyReportEnabled: input.dailyReportEnabled,
      dailyReportTime: input.dailyReportTime,
    };
    if (Object.prototype.hasOwnProperty.call(input, 'botUsername') && input.botUsername !== undefined) {
      next.botUsername = clean(input.botUsername, 80).replace(/^@/, '');
    }
    if (Object.prototype.hasOwnProperty.call(input, 'chatId') && input.chatId !== undefined) {
      next.chatId = clean(input.chatId, 80);
    }
    if (input.clearBotToken) {
      next.botToken = '';
      next.botTokenLast4 = '';
    } else if (input.botToken) {
      next.botToken = input.botToken;
      next.botTokenLast4 = input.botToken.slice(-4);
    }
    await prisma.$transaction(async (tx) => {
      await saveTelegramSettings(tx, req.auth.shopId, next);
      await audit(tx, req, 'TELEGRAM_AUTOMATION_UPDATED', {
        enabled: next.enabled,
        saleNotifications: next.saleNotifications,
        dailyReportEnabled: next.dailyReportEnabled,
        hasBotToken: Boolean(next.botToken),
        hasChatId: Boolean(next.chatId),
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    res.json({ ok: true, telegram: safeTelegram(next, req.auth.userId), message: 'Telegram automation settings saved' });
  }));

  app.post('/api/project-settings/api/telegram/test', ...access, wrap(async (req, res) => {
    const settings = await loadTelegramSettings(req.auth.shopId);
    const result = await sendTelegramMessage(settings, `✅ Mahar POS Telegram connected\nShop: ${req.auth.shopSlug || req.auth.shopId}\nTime: ${new Date().toLocaleString('en-GB', { timeZone: 'Asia/Yangon' })}`);
    const next = { ...settings, lastTest: { ok: true, messageId: result?.message_id || null, testedAt: new Date().toISOString() } };
    await prisma.$transaction((tx) => saveTelegramSettings(tx, req.auth.shopId, next));
    res.json({ ok: true, telegram: safeTelegram(next, req.auth.userId), message: 'Telegram test message sent' });
  }));

  app.post('/api/project-settings/api/telegram/send-daily-report', ...access, wrap(async (req, res) => {
    const result = await sendDailyReportNow(req.auth.shopId);
    res.json({ ok: true, ...result, message: 'Daily report sent to Telegram' });
  }));

  app.post('/api/project-settings/api/telegram/connect-login', ...access, wrap(async (req, res) => {
    const parsed = loginSchema.safeParse(req.body || {});
    if (!parsed.success) throw new ApiError(400, 'Invalid Telegram login payload', parsed.error.flatten().fieldErrors);
    const current = await loadTelegramSettings(req.auth.shopId);
    verifyTelegramLogin(parsed.data, current.botToken);
    const fullName = [parsed.data.first_name, parsed.data.last_name].map((part) => clean(part, 120)).filter(Boolean).join(' ') || clean(parsed.data.username, 120) || `Telegram ${parsed.data.id}`;
    const telegramId = clean(parsed.data.id, 80);
    const linkedUsers = plainObject(current.linkedUsers);
    const next = {
      ...current,
      enabled: true,
      chatId: current.chatId || telegramId,
      linkedUsers: {
        ...linkedUsers,
        [req.auth.userId]: {
          userId: req.auth.userId,
          username: req.auth.username || '',
          telegramId,
          chatId: telegramId,
          name: fullName,
          telegramUsername: clean(parsed.data.username, 120),
          linkedAt: new Date().toISOString(),
        },
      },
      linkedTelegramId: telegramId,
      linkedTelegramName: fullName,
    };
    await prisma.$transaction(async (tx) => {
      await saveTelegramSettings(tx, req.auth.shopId, next);
      await audit(tx, req, 'TELEGRAM_LOGIN_CONNECTED', { userId: req.auth.userId, telegramId: next.linkedTelegramId, telegramName: next.linkedTelegramName });
    });
    res.json({ ok: true, telegram: safeTelegram(next, req.auth.userId), message: 'Telegram account connected to this POS user' });
  }));
}

module.exports = {
  attachTelegramAutomationApi,
  notifyTelegramSale,
  startTelegramAutomationRunner,
  sendDailyReportNow,
};
