const crypto = require('crypto');
const { z } = require('zod');
const { Prisma } = require('@prisma/client');
const { prisma } = require('./prisma');
const {
  requireAuth,
  requireShopUser,
  requireWritableSubscription,
} = require('./auth-api');
const { buildDailyCloseReport } = require('./reports-postgres-api');
const {
  isQuickGreeting,
  resolveQuickAction,
  resolveQuickFlow,
  isCancelWord,
  quickKeyboard,
  menuText,
  buildQuickReply,
  startFlow,
  continueFlow,
} = require('./telegram-quick-menu');

const SETTINGS_VERSION = 1;
const DEFAULT_TELEGRAM = Object.freeze({
  enabled: false,
  botToken: '',
  botTokenLast4: '',
  botUsername: '',
  chatId: '',
  notifyChatIds: [],        // extra group/channel IDs to fan-out notifications to
  webhookSecret: '',
  linkedTelegramId: '',
  linkedTelegramName: '',
  linkedUsers: {},
  saleNotifications: false,
  auditLogNotifications: false,
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
  notifyChatIds: z.array(z.string().trim().max(80)).max(20).optional(),
  saleNotifications: z.boolean().default(false),
  auditLogNotifications: z.boolean().default(false),
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
  const notifyChatIds = Array.isArray(settings.notifyChatIds)
    ? settings.notifyChatIds.map((id) => clean(id, 80)).filter(Boolean)
    : [];
  return {
    enabled: Boolean(settings.enabled),
    botUsername: settings.botUsername || '',
    botDeepLink: settings.botUsername ? `https://t.me/${settings.botUsername}` : null,
    chatId: settings.chatId || '',
    notifyChatIds,
    hasBotToken: Boolean(settings.botToken),
    botTokenLast4: settings.botTokenLast4 || '',
    linkedTelegramId: settings.linkedTelegramId || '',
    linkedTelegramName: settings.linkedTelegramName || '',
    webhookRegistered: Boolean(settings.webhookSecret),
    currentUserTelegram: currentUserTelegram.telegramId ? {
      telegramId: currentUserTelegram.telegramId || '',
      chatId: currentUserTelegram.chatId || '',
      name: currentUserTelegram.name || '',
      username: currentUserTelegram.username || '',
      linkedAt: currentUserTelegram.linkedAt || null,
    } : null,
    linkedUserCount: Object.keys(linkedUsers).length,
    saleNotifications: Boolean(settings.saleNotifications),
    auditLogNotifications: Boolean(settings.auditLogNotifications),
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

// Use chatId OR linkedTelegramId (the user's personal Telegram ID, set via /start)
async function sendTelegramMessage(settings, text) {
  const token = clean(settings.botToken || process.env.TELEGRAM_BOT_TOKEN || '', 240);
  const chatId = clean(settings.chatId || settings.linkedTelegramId || '', 80);
  if (!token || !chatId) throw new ApiError(400, 'Telegram Bot Token / Chat ID မထည့်ရသေးပါ');
  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: clean(text, 3900),
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) throw new ApiError(502, data.description || 'Telegram send failed');
  return data.result;
}

// Send to primary chatId + all notifyChatIds in parallel (fire-and-forget safe)
async function sendTelegramMessageToAll(settings, text) {
  const token = clean(settings.botToken || process.env.TELEGRAM_BOT_TOKEN || '', 240);
  if (!token) throw new ApiError(400, 'Telegram Bot Token မထည့်ရသေးပါ');

  const primaryId = clean(settings.chatId || settings.linkedTelegramId || '', 80);
  const extras = Array.isArray(settings.notifyChatIds)
    ? settings.notifyChatIds.map((id) => clean(id, 80)).filter(Boolean)
    : [];

  const allIds = primaryId ? [primaryId, ...extras.filter((id) => id !== primaryId)] : extras;
  if (!allIds.length) throw new ApiError(400, 'Telegram Chat ID မသတ်မှတ်ရသေးပါ');

  const cleanText = clean(text, 3900);
  const results = await Promise.allSettled(allIds.map((chatId) =>
    fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: cleanText, parse_mode: 'HTML', disable_web_page_preview: true }),
    }).then((r) => r.json())
  ));

  const first = results[0];
  if (first.status === 'rejected') throw new ApiError(502, first.reason?.message || 'Telegram send failed');
  if (first.value?.ok === false) throw new ApiError(502, first.value.description || 'Telegram send failed');
  return first.value?.result;
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

// Register a Telegram webhook so the bot auto-captures chatId when user sends /start
async function registerBotWebhook(shopId, botToken, appUrl) {
  const secret = crypto.randomBytes(24).toString('hex');
  const webhookUrl = `${appUrl.replace(/\/$/, '')}/api/telegram/webhook/${shopId}`;
  const response = await fetch(`https://api.telegram.org/bot${botToken}/setWebhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url: webhookUrl,
      secret_token: secret,
      allowed_updates: ['message'],
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!data.ok) throw new Error(data.description || 'setWebhook failed');
  return secret;
}

// Handle incoming Telegram update from the webhook
async function handleBotWebhookUpdate(shopId, update) {
  const msg = update.message;
  if (!msg?.chat?.id || !msg?.from) return;
  if (msg.chat.type !== 'private') return; // only DM chats

  const chatId = String(msg.chat.id);
  const fromId = String(msg.from.id);

  const settings = await loadTelegramSettings(shopId);
  if (!settings.botToken) return;

  // Only the first person to /start the bot gets linked as the notification target
  if (!settings.linkedTelegramId) {
    const firstName = clean(msg.from.first_name || '', 120);
    const lastName = clean(msg.from.last_name || '', 120);
    const fullName = [firstName, lastName].filter(Boolean).join(' ') || clean(msg.from.username || '', 120) || `Telegram ${fromId}`;
    const next = {
      ...settings,
      chatId,
      linkedTelegramId: fromId,
      linkedTelegramName: fullName,
      enabled: true,
    };
    await prisma.$transaction((tx) => saveTelegramSettings(tx, shopId, next));

    await sendBotMessage(
      settings.botToken,
      chatId,
      `✅ Mahar POS Telegram Linked!\n\n${fullName} — notifications will be sent to this chat.\n\n<b>Hi</b> လို့ ရိုက်ပါ — Quick menu ပေါ်ပါမယ်။`,
      quickKeyboard(),
    );
  } else {
    const allowedChatIds = new Set([
      settings.chatId,
      ...(Array.isArray(settings.notifyChatIds) ? settings.notifyChatIds.map((id) => clean(id, 80)) : []),
    ].filter(Boolean));
    const isLinkedChat = allowedChatIds.has(chatId) || settings.linkedTelegramId === fromId;

    if (!isLinkedChat) {
      // Multi chat: tell the newcomer their own Chat ID so an admin can add it
      // under Project Settings → Telegram → Notify Chat IDs.
      const who = clean([msg.from.first_name, msg.from.last_name].filter(Boolean).join(' ') || msg.from.username || '', 120);
      await sendBotMessage(settings.botToken, chatId, [
        'ℹ️ ဒီ chat ကို ခွင့်မပြုရသေးပါ။',
        '',
        `👤 ${who || 'Telegram user'}`,
        `🆔 Chat ID: <code>${chatId}</code>`,
        '',
        'Mahar POS → Project Settings → Telegram → <b>Notify Chat IDs</b> မှာ ဒီ ID ကို ထည့်ပေးဖို့ shop admin ကို ပြောပါ။',
      ].join('\n'));
      return;
    }

    const text = msg.text || '';

    // A running action flow owns the conversation until it finishes or is cancelled
    const flowReply = await continueFlow(shopId, chatId, text).catch((error) => ({
      text: `⚠️ ${error.message || 'Flow failed'}`,
      keyboard: quickKeyboard(),
    }));
    if (flowReply) {
      await sendBotMessage(settings.botToken, chatId, flowReply.text, flowReply.keyboard);
      return;
    }

    const flow = resolveQuickFlow(text);
    if (flow) {
      const started = await startFlow(shopId, chatId, flow);
      await sendBotMessage(settings.botToken, chatId, started.text, started.keyboard);
      return;
    }

    if (isCancelWord(text)) {
      await sendBotMessage(settings.botToken, chatId, 'ℹ️ လုပ်နေတာ မရှိပါ။', quickKeyboard());
      return;
    }

    const action = resolveQuickAction(text);

    if (action) {
      // Quick Function: answer with the live PostgreSQL summary for that area
      let reply = '';
      try {
        reply = await buildQuickReply(shopId, action);
      } catch (error) {
        reply = `⚠️ Data ဖတ်မရပါ: ${error.message || 'unknown error'}`;
      }
      await sendBotMessage(settings.botToken, chatId, reply || 'No data', quickKeyboard());
      return;
    }

    if (isQuickGreeting(text)) {
      const shop = await prisma.shop.findUnique({ where: { id: shopId }, select: { name: true, slug: true } }).catch(() => null);
      const status = `🔗 ${settings.linkedTelegramName || 'Linked'} · 🔔 Alerts: ${settings.auditLogNotifications ? 'On' : 'Off'}`;
      await sendBotMessage(settings.botToken, chatId, menuText(shop?.name || shop?.slug, status), quickKeyboard());
      return;
    }

    if (text) {
      await sendBotMessage(settings.botToken, chatId, 'ℹ️ <b>Hi</b> လို့ ရိုက်ပါ — Repair / Customers / Money Service / Other Records menu ပေါ်ပါမယ်။', quickKeyboard());
    }
  }
}

async function sendBotMessage(botToken, chatId, text, replyMarkup) {
  const body = {
    chat_id: chatId,
    text: clean(text, 3900),
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  };
  if (replyMarkup) body.reply_markup = replyMarkup;
  return fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).catch(() => null);
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
        WHERE shop_id=$1::uuid AND voided_at IS NULL AND transaction_date::date=$2::date`,
      shopId,
      date,
    ).catch(() => [{ sold: 0, profit: 0 }]),
  ]);
  const sale = sales?.[0] || {};
  const moneyRow = money?.[0] || {};
  const billerRow = biller?.[0] || {};
  const paymentLines = (payments || []).map((row) => `- ${row.method}: ${mmk(row.amount)}`);

  // Other income and expense (the Other Records page) come from the same builder the
  // Reports page and the Google Sheet pull use, so the three always agree.
  let close = {};
  try {
    const report = await buildDailyCloseReport(shopId, date, date, 'daily');
    close = report?.rows?.[0] || report?.totals || {};
  } catch {
    close = {};
  }

  const n = (value) => Number(value || 0);
  const otherIncomeTotal = n(close.otherSaleIncome) + n(close.otherServiceIncome)
    + n(close.otherTopupIncome) + n(close.otherOtherIncome);
  const expenseTotal = n(close.otherSaleExpense) + n(close.otherServiceExpense)
    + n(close.otherTopupExpense) + n(close.otherOtherExpense);
  const incomeTotal = n(sale.total) + n(moneyRow.fee) + n(billerRow.profit) + otherIncomeTotal;

  const line = (label, value) => `• ${label}: ${mmk(value)}`;

  return [
    `📌 Daily Report`,
    `🏪 ${shop?.name || shop?.slug || 'Mahar POS'}`,
    `📅 Date: ${date}`,
    '',
    '━━━━━━━━━━━━━━',
    '💰 ဝင်ငွေများ',
    line('Product Sales', sale.total),
    line('Money Service Fee', moneyRow.fee),
    line('Bill/Eload Profit', billerRow.profit),
    line('Other Sale Income', close.otherSaleIncome),
    line('Other Service Income', close.otherServiceIncome),
    line('Other Top-up Income', close.otherTopupIncome),
    line('Other Income', close.otherOtherIncome),
    '',
    `✅ Income Total: ${mmk(incomeTotal)}`,
    `📎 Other Income Total: ${mmk(otherIncomeTotal)}`,
    '',
    '━━━━━━━━━━━━━━',
    '💸 ထွက်ငွေများ',
    line('Other Sale Expense', close.otherSaleExpense),
    line('Other Service Expense', close.otherServiceExpense),
    line('Other Top-up Expense', close.otherTopupExpense),
    line('Other Expense', close.otherOtherExpense),
    '',
    `❗️ Expense Total: ${mmk(expenseTotal)}`,
    '',
    '━━━━━━━━━━━━━━',
    `📊 Net: ${mmk(incomeTotal - expenseTotal)}`,
    `🧾 Sales Count: ${sale.count || 0}`,
    `📈 Product Profit: ${mmk(sale.profit)}`,
    '',
    `💳 Payments:`,
    ...(paymentLines.length ? paymentLines : ['- No payment records']),
  ].join('\n');
}

async function notifyTelegramSale({ shopId, sale }) {
  const settings = await loadTelegramSettings(shopId);
  if (!settings.enabled || !settings.saleNotifications) return { skipped: true };
  const shop = await prisma.shop.findUnique({ where: { id: shopId }, select: { name: true, slug: true } });
  const result = await sendTelegramMessageToAll(settings, formatSaleMessage(shop, sale));
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
      const effectiveChatId = settings.chatId || settings.linkedTelegramId;
      const hasTarget = effectiveChatId || (Array.isArray(settings.notifyChatIds) && settings.notifyChatIds.length > 0);
      if (!settings.enabled || !settings.dailyReportEnabled || !settings.botToken || !hasTarget) continue;
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
    if (Object.prototype.hasOwnProperty.call(input, 'notifyChatIds') && Array.isArray(input.notifyChatIds)) {
      next.notifyChatIds = input.notifyChatIds.map((id) => clean(id, 80)).filter(Boolean).slice(0, 20);
    }
    if (Object.prototype.hasOwnProperty.call(input, 'auditLogNotifications')) {
      next.auditLogNotifications = Boolean(input.auditLogNotifications);
    }
    if (input.clearBotToken) {
      // Delete the webhook before clearing the token
      if (current.botToken) {
        fetch(`https://api.telegram.org/bot${current.botToken}/deleteWebhook`).catch(() => null);
      }
      next.botToken = '';
      next.botTokenLast4 = '';
      next.botUsername = '';
      next.webhookSecret = '';
      next.linkedTelegramId = '';
      next.linkedTelegramName = '';
      next.chatId = '';
    } else if (input.botToken) {
      // Validate the token and auto-discover bot username
      const getMeRes = await fetch(`https://api.telegram.org/bot${input.botToken}/getMe`);
      const getMeData = await getMeRes.json().catch(() => ({}));
      if (!getMeData.ok) throw new ApiError(422, 'Invalid Bot Token — Telegram rejected it. Double-check the token from @BotFather.');

      next.botToken = input.botToken;
      next.botTokenLast4 = input.botToken.slice(-4);
      next.botUsername = getMeData.result?.username || next.botUsername;

      // Register the webhook so users can link by sending /start (no chatId needed)
      const appUrl = process.env.APP_URL || 'https://app.maharshwe.shop';
      try {
        const secret = await registerBotWebhook(req.auth.shopId, input.botToken, appUrl);
        next.webhookSecret = secret;
        // Reset linked state since token changed (new bot = fresh link)
        if (current.botToken && current.botToken !== input.botToken) {
          next.linkedTelegramId = '';
          next.linkedTelegramName = '';
          next.chatId = '';
        }
      } catch (e) {
        console.error('Telegram webhook registration failed:', e.message);
        // Don't block settings save — user can still use Login Widget as fallback
      }
    }
    await prisma.$transaction(async (tx) => {
      await saveTelegramSettings(tx, req.auth.shopId, next);
      await audit(tx, req, 'TELEGRAM_AUTOMATION_UPDATED', {
        enabled: next.enabled,
        saleNotifications: next.saleNotifications,
        dailyReportEnabled: next.dailyReportEnabled,
        hasBotToken: Boolean(next.botToken),
        hasChatId: Boolean(next.chatId || next.linkedTelegramId),
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
      chatId: telegramId,           // always update to this user's Telegram ID
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

  // Unlink Telegram: clear linked chat so someone else can /start
  app.post('/api/project-settings/api/telegram/unlink', ...access, wrap(async (req, res) => {
    const current = await loadTelegramSettings(req.auth.shopId);
    const next = { ...current, linkedTelegramId: '', linkedTelegramName: '', chatId: '' };
    await prisma.$transaction(async (tx) => {
      await saveTelegramSettings(tx, req.auth.shopId, next);
      await audit(tx, req, 'TELEGRAM_UNLINKED', { userId: req.auth.userId });
    });
    res.json({ ok: true, telegram: safeTelegram(next, req.auth.userId), message: 'Telegram account unlinked' });
  }));
}

// Webhook endpoint: Telegram POSTs updates here when user messages the bot.
// Must be attached before auth middleware (no JWT required — verified via secret token).
function attachTelegramWebhookEndpoint(app) {
  app.post('/api/telegram/webhook/:shopId', async (req, res) => {
    try {
      const { shopId } = req.params;
      const secret = req.headers['x-telegram-bot-api-secret-token'];
      const settings = await loadTelegramSettings(shopId);
      if (!settings.webhookSecret || secret !== settings.webhookSecret) {
        return res.status(403).json({ ok: false });
      }
      // Always respond 200 before processing — Telegram retries on non-2xx
      res.json({ ok: true });
      handleBotWebhookUpdate(shopId, req.body || {}).catch(() => null);
    } catch {
      res.json({ ok: true });
    }
  });
}

module.exports = {
  attachTelegramAutomationApi,
  attachTelegramWebhookEndpoint,
  notifyTelegramSale,
  startTelegramAutomationRunner,
  sendDailyReportNow,
  loadTelegramSettings,
  sendTelegramMessage,
  sendTelegramMessageToAll,
};
