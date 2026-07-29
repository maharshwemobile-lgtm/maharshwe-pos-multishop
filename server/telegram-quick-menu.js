// Telegram Quick Function: say "Hi" to the shop bot and get a keyboard with the
// four daily areas — Repair, Customers & Credit, Money Service, Other Records.
// Every reply is read-only and scoped to the shop the bot is linked to.
const { prisma } = require('./prisma');

const YANGON = 'Asia/Yangon';

function mmk(value) {
  return `${Number(value || 0).toLocaleString('en-US')} MMK`;
}

function yangonDate() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: YANGON, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date());
}

const ACTIONS = [
  { key: 'REPAIR', button: '🔧 Repair', match: ['repair', 'ပြုပြင်', 'ရီပဲယာ'] },
  { key: 'CUSTOMERS', button: '👥 Customers', match: ['customer', 'credit', 'အကြွေး', 'ကြွေး'] },
  { key: 'MONEY', button: '💸 Money Service', match: ['money', 'transfer', 'cash out', 'ငွေလွှဲ', 'ငွေထုတ်'] },
  { key: 'OTHER', button: '📋 Other Records', match: ['other record', 'other', 'income', 'ဝင်ငွေ'] },
];

// Write flows — these create real records, so each one confirms before saving.
const FLOWS = [
  { key: 'REPAIR_NEW', button: '➕ Repair မှတ်မယ်', match: ['repair မှတ်မယ်', 'repair new', 'new repair', 'ပြုပြင် မှတ်မယ်'] },
  { key: 'EXPENSE_NEW', button: '➕ အထွက် မှတ်မယ်', match: ['အထွက် မှတ်မယ်', 'အထွက်', 'expense', 'ထွက်ငွေ'] },
  { key: 'INCOME_NEW', button: '➕ ဝင်ငွေ မှတ်မယ်', match: ['ဝင်ငွေ မှတ်မယ်', 'income new', 'new income'] },
];

const CANCEL_WORDS = ['cancel', 'stop', 'ရပ်', 'ရပ်မယ်', 'မလုပ်တော့ဘူး', 'ထွက်'];
const SKIP_WORDS = ['skip', '-', 'မရှိ', 'မသိ', 'no'];

const GREETINGS = ['hi', 'hii', 'hey', 'hello', 'menu', 'start', 'help', 'မင်္ဂလာပါ', 'ဟိုင်း', 'မီနူး'];

function normalize(text) {
  return String(text || '').trim().toLowerCase().replace(/^\//, '');
}

function isQuickGreeting(text) {
  const value = normalize(text);
  if (!value) return false;
  return GREETINGS.includes(value);
}

// keep combining marks (\p{M}) — Burmese vowel signs are marks, not letters
function strip(text) {
  return normalize(text).replace(/[^\p{L}\p{N}\p{M}\s]/gu, '').replace(/\s+/g, ' ').trim();
}

function matches(list, text) {
  const value = strip(text);
  if (!value) return null;
  return list.find((item) => item.match.some((keyword) => value === keyword || value.startsWith(keyword))) || null;
}

function resolveQuickAction(text) {
  // flows are checked first: "ထွက်ငွေ မှတ်မယ်" must not fall through to a report
  if (matches(FLOWS, text)) return '';
  return matches(ACTIONS, text)?.key || '';
}

function resolveQuickFlow(text) {
  return matches(FLOWS, text)?.key || '';
}

function isCancelWord(text) {
  const value = strip(text);
  return CANCEL_WORDS.includes(value);
}

function isSkipWord(text) {
  return SKIP_WORDS.includes(strip(text));
}

// A reply keyboard (not an inline one) so it also works for bots whose webhook
// was registered with allowed_updates: ['message'].
function quickKeyboard() {
  return {
    keyboard: [
      [{ text: ACTIONS[0].button }, { text: ACTIONS[1].button }],
      [{ text: ACTIONS[2].button }, { text: ACTIONS[3].button }],
      [{ text: FLOWS[0].button }, { text: FLOWS[1].button }, { text: FLOWS[2].button }],
    ],
    resize_keyboard: true,
    is_persistent: true,
    input_field_placeholder: 'Hi လို့ရိုက်ရင် menu ပြန်ပေါ်ပါမယ်',
  };
}

function cancelKeyboard() {
  return {
    keyboard: [[{ text: '❌ ရပ်မယ်' }]],
    resize_keyboard: true,
    is_persistent: true,
    input_field_placeholder: 'ဖြေပါ — ရပ်ချင်ရင် ❌ ရပ်မယ်',
  };
}

function menuText(shopName, statusLine) {
  return [
    `👋 ${shopName || 'Mahar POS'}`,
    '',
    'ဘာကြည့်ချင်လဲ အောက်က ခလုတ်ကို နှိပ်ပါ:',
    '',
    '<b>ကြည့်ရန်</b>',
    '🔧 Repair — ယနေ့ ပြုပြင်ရေး အခြေအနေ',
    '👥 Customers — အကြွေးကျန် စာရင်း',
    '💸 Money Service — ယနေ့ ငွေလွှဲ / ငွေထုတ်',
    '📋 Other Records — ဝင်ငွေ / ထွက်ငွေ / Top-up',
    '',
    '<b>မှတ်တမ်းတင်ရန်</b>',
    '➕ Repair မှတ်မယ် — ပြုပြင်ရေး အသစ်',
    '➕ အထွက် မှတ်မယ် — ထွက်ငွေ စာရင်း',
    '➕ ဝင်ငွေ မှတ်မယ် — ဝင်ငွေ စာရင်း',
    ...(statusLine ? ['', statusLine] : []),
  ].join('\n');
}

async function repairSummary(shopId, date) {
  const [today, open, unpaid] = await Promise.all([
    prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS count, COALESCE(SUM(final_cost),0) AS amount
         FROM repairs
        WHERE shop_id=$1::uuid AND (received_at AT TIME ZONE '${YANGON}')::date=$2::date`,
      shopId, date,
    ).catch(() => []),
    prisma.$queryRawUnsafe(
      `SELECT status, COUNT(*)::int AS count
         FROM repairs
        WHERE shop_id=$1::uuid AND status NOT IN ('DELIVERED','CANNOT_REPAIR')
        GROUP BY status ORDER BY status`,
      shopId,
    ).catch(() => []),
    prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS count, COALESCE(SUM(GREATEST(final_cost - deposit, 0)),0) AS due
         FROM repairs
        WHERE shop_id=$1::uuid AND payment_status <> 'PAID' AND status <> 'CANNOT_REPAIR'`,
      shopId,
    ).catch(() => []),
  ]);

  const intake = today?.[0] || {};
  const owing = unpaid?.[0] || {};
  const statusLines = (open || []).map((row) => `• ${String(row.status).replaceAll('_', ' ')}: ${row.count}`);

  return [
    '🔧 <b>Repair — ယနေ့</b>',
    `📅 ${date}`,
    '',
    `📥 ယနေ့ လက်ခံ: ${intake.count || 0} ခု (${mmk(intake.amount)})`,
    '',
    '🛠 လက်ရှိ ဆောင်ရွက်ဆဲ:',
    ...(statusLines.length ? statusLines : ['• မရှိပါ']),
    '',
    `💰 ငွေမရသေးသည့် repair: ${owing.count || 0} ခု`,
    `❗️ ကျန်ငွေ: ${mmk(owing.due)}`,
  ].join('\n');
}

async function customerSummary(shopId) {
  const [totals, top] = await Promise.all([
    prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS count, COALESCE(SUM(balance),0) AS total
         FROM customers WHERE shop_id=$1::uuid AND balance > 0`,
      shopId,
    ).catch(() => []),
    prisma.$queryRawUnsafe(
      `SELECT name, phone, balance FROM customers
        WHERE shop_id=$1::uuid AND balance > 0
        ORDER BY balance DESC LIMIT 5`,
      shopId,
    ).catch(() => []),
  ]);

  const row = totals?.[0] || {};
  const lines = (top || []).map((customer, index) =>
    `${index + 1}. ${customer.name}${customer.phone ? ` (${customer.phone})` : ''} — ${mmk(customer.balance)}`);

  return [
    '👥 <b>Customers & Credit</b>',
    '',
    `🧾 အကြွေးရှိသူ: ${row.count || 0} ဦး`,
    `❗️ စုစုပေါင်း ရရန်ကျန်: ${mmk(row.total)}`,
    '',
    '🔝 အများဆုံး ၅ ဦး:',
    ...(lines.length ? lines : ['• မရှိပါ']),
  ].join('\n');
}

async function moneyServiceSummary(shopId, date) {
  const [today, pending] = await Promise.all([
    prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS count,
              COALESCE(SUM(CASE WHEN mode='TRANSFER' THEN amount ELSE 0 END),0) AS transfer_amount,
              COALESCE(SUM(CASE WHEN mode='CASH_OUT' THEN amount ELSE 0 END),0) AS cashout_amount,
              COALESCE(SUM(fee_amount),0) AS fee
         FROM money_service_transactions_v2
        WHERE shop_id=$1::uuid AND voided_at IS NULL
          AND (created_at AT TIME ZONE '${YANGON}')::date=$2::date`,
      shopId, date,
    ).catch(() => []),
    prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS count, COALESCE(SUM(due_amount),0) AS due
         FROM money_service_transactions_v2
        WHERE shop_id=$1::uuid AND voided_at IS NULL AND due_amount > 0`,
      shopId,
    ).catch(() => []),
  ]);

  const row = today?.[0] || {};
  const due = pending?.[0] || {};

  return [
    '💸 <b>Money Service — ယနေ့</b>',
    `📅 ${date}`,
    '',
    `🔁 ငွေလွှဲ Transfer: ${mmk(row.transfer_amount)}`,
    `🏧 ငွေထုတ် Cash Out: ${mmk(row.cashout_amount)}`,
    `🧮 အရေအတွက်: ${row.count || 0} ကြိမ်`,
    '',
    `✅ ယနေ့ Fee ဝင်ငွေ: ${mmk(row.fee)}`,
    `❗️ ကြွေးကျန်: ${mmk(due.due)} (${due.count || 0} ခု)`,
  ].join('\n');
}

async function otherRecordsSummary(shopId, date) {
  const [income, expense, sales, biller] = await Promise.all([
    prisma.$queryRawUnsafe(
      `SELECT category, COALESCE(SUM(amount),0) AS amount
         FROM business_other_income
        WHERE shop_id=$1::uuid AND income_date=$2::date
        GROUP BY category ORDER BY category`,
      shopId, date,
    ).catch(() => []),
    prisma.$queryRawUnsafe(
      `SELECT category, COALESCE(SUM(amount),0) AS amount
         FROM business_expenses
        WHERE shop_id=$1::uuid AND expense_date=$2::date
        GROUP BY category ORDER BY category`,
      shopId, date,
    ).catch(() => []),
    prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS count, COALESCE(SUM(total),0) AS total, COALESCE(SUM(profit_total),0) AS profit
         FROM sales
        WHERE shop_id=$1::uuid AND status IN ('COMPLETED','PARTIAL_RETURN')
          AND (sold_at AT TIME ZONE '${YANGON}')::date=$2::date`,
      shopId, date,
    ).catch(() => []),
    prisma.$queryRawUnsafe(
      `SELECT COALESCE(SUM(CASE WHEN transaction_type='SOLD' THEN amount ELSE 0 END),0) AS sold,
              COALESCE(SUM(CASE WHEN transaction_type='SOLD' THEN profit_amount ELSE 0 END),0) AS profit,
              COALESCE(SUM(CASE WHEN transaction_type='REFILL' THEN amount ELSE 0 END),0) AS refill
         FROM biller_transactions
        WHERE shop_id=$1::uuid AND voided_at IS NULL AND transaction_date::date=$2::date`,
      shopId, date,
    ).catch(() => []),
  ]);

  const sum = (rows) => (rows || []).reduce((total, row) => total + Number(row.amount || 0), 0);
  const list = (rows) => (rows || []).map((row) => `• ${String(row.category).replaceAll('_', ' ')}: ${mmk(row.amount)}`);
  const incomeTotal = sum(income);
  const expenseTotal = sum(expense);
  const sale = sales?.[0] || {};
  const topup = biller?.[0] || {};
  const topupProfit = Number(topup.profit || 0);

  return [
    '📋 <b>ယနေ့ ဝင်ငွေ / ထွက်ငွေ</b>',
    `📅 ${date}`,
    '',
    '🧾 အရောင်း (Sale POS):',
    `• ရောင်းရငွေ: ${mmk(sale.total)} (${sale.count || 0} ကြိမ်)`,
    `• အမြတ်: ${mmk(sale.profit)}`,
    '',
    '📱 Top-up / Bill Eload:',
    `• ရောင်းငွေ: ${mmk(topup.sold)}`,
    `• အမြတ်: ${mmk(topupProfit)}`,
    `• ဖြည့်ငွေ: ${mmk(topup.refill)}`,
    '',
    '📥 အခြား ဝင်ငွေ:',
    ...(list(income).length ? list(income) : ['• မရှိပါ']),
    `✅ အခြား ဝင်ငွေ စုစုပေါင်း: ${mmk(incomeTotal)}`,
    '',
    '📤 ထွက်ငွေ:',
    ...(list(expense).length ? list(expense) : ['• မရှိပါ']),
    `❗️ ထွက်ငွေ စုစုပေါင်း: ${mmk(expenseTotal)}`,
    '',
    `📊 Net (အခြားဝင်ငွေ + Top-up အမြတ် − ထွက်ငွေ): ${mmk(incomeTotal + topupProfit - expenseTotal)}`,
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Action flows: a tiny per-chat state machine backed by its own table so a
// restart never leaves someone stuck halfway through a repair intake.
// ---------------------------------------------------------------------------
let sessionSchemaPromise;

async function ensureSessionSchema() {
  if (!sessionSchemaPromise) {
    sessionSchemaPromise = prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS telegram_chat_sessions (
      shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
      chat_id TEXT NOT NULL,
      flow TEXT NOT NULL,
      step INTEGER NOT NULL DEFAULT 0,
      data JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (shop_id, chat_id)
    )`).catch((error) => {
      sessionSchemaPromise = null;
      throw error;
    });
  }
  return sessionSchemaPromise;
}

const SESSION_MAX_AGE_MINUTES = 30;

async function getSession(shopId, chatId) {
  await ensureSessionSchema();
  const rows = await prisma.$queryRawUnsafe(
    `SELECT flow, step, data FROM telegram_chat_sessions
      WHERE shop_id=$1::uuid AND chat_id=$2
        AND updated_at > NOW() - INTERVAL '${SESSION_MAX_AGE_MINUTES} minutes'`,
    shopId, chatId,
  );
  return rows?.[0] || null;
}

async function setSession(shopId, chatId, flow, step, data) {
  await ensureSessionSchema();
  await prisma.$executeRawUnsafe(
    `INSERT INTO telegram_chat_sessions (shop_id, chat_id, flow, step, data, updated_at)
     VALUES ($1::uuid, $2, $3, $4, $5::jsonb, NOW())
     ON CONFLICT (shop_id, chat_id) DO UPDATE
       SET flow=EXCLUDED.flow, step=EXCLUDED.step, data=EXCLUDED.data, updated_at=NOW()`,
    shopId, chatId, flow, step, JSON.stringify(data || {}),
  );
}

async function clearSession(shopId, chatId) {
  await ensureSessionSchema();
  await prisma.$executeRawUnsafe('DELETE FROM telegram_chat_sessions WHERE shop_id=$1::uuid AND chat_id=$2', shopId, chatId);
}

const EXPENSE_CATEGORIES = [
  'အခြား အရောင်းပိုင်း ထွက်ငွေ',
  'အခြား Service ထွက်ငွေ',
  'အခြား ငွေဖြည့်ကဒ် ထွက်ငွေ',
  'အခြား အခြား ထွက်ငွေ',
];

const INCOME_CATEGORIES = [
  'အခြား အရောင်းပိုင်း ဝင်ငွေ',
  'အခြား Service ဝင်ငွေ',
  'အခြား ငွေဖြည့်ကဒ် ဝင်ငွေ',
  'အခြား အခြား ဝင်ငွေ',
];

function optionKeyboard(options) {
  return {
    keyboard: [...options.map((option) => [{ text: option }]), [{ text: '❌ ရပ်မယ်' }]],
    resize_keyboard: true,
    is_persistent: true,
  };
}

function confirmKeyboard() {
  return {
    keyboard: [[{ text: '✅ မှတ်မယ်' }, { text: '❌ ရပ်မယ်' }]],
    resize_keyboard: true,
    is_persistent: true,
  };
}

function parseAmount(text) {
  const value = Number(String(text || '').replace(/[^\d.]/g, ''));
  return Number.isFinite(value) ? value : NaN;
}

function isConfirmWord(text) {
  const value = strip(text);
  return ['မှတ်မယ်', 'ok', 'yes', 'သိမ်းမယ်', 'confirm'].some((word) => value === word || value.startsWith(word));
}

const FLOW_DEFS = {
  REPAIR_NEW: {
    title: '🔧 Repair အသစ်',
    steps: [
      { field: 'customerName', ask: '👤 Customer နာမည် ရိုက်ပါ', required: true },
      { field: 'customerPhone', ask: '📞 ဖုန်းနံပါတ်? (မရှိရင် - ရိုက်ပါ)', skippable: true },
      { field: 'device', ask: '📱 ဖုန်းအမျိုးအစား? (ဥပမာ Samsung A12)', skippable: true },
      { field: 'problem', ask: '🔧 ဘာပြဿနာလဲ?', required: true },
      { field: 'estimatedCost', ask: '💰 ခန့်မှန်းကုန်ကျစရိတ်? (မသိရင် 0)', amount: true },
    ],
    summary: (data) => [
      '🔧 <b>Repair မှတ်တမ်း</b>',
      `👤 ${data.customerName}`,
      `📞 ${data.customerPhone || '-'}`,
      `📱 ${data.device || '-'}`,
      `🔧 ${data.problem}`,
      `💰 ${mmk(data.estimatedCost)}`,
      '',
      'မှန်ရင် ✅ မှတ်မယ် နှိပ်ပါ',
    ].join('\n'),
  },
  EXPENSE_NEW: {
    title: '📤 အထွက်စာရင်း',
    steps: [
      { field: 'category', ask: '📂 ဘယ်အမျိုးအစားလဲ?', options: EXPENSE_CATEGORIES, required: true },
      { field: 'amount', ask: '💵 ပမာဏ ဘယ်လောက်လဲ?', amount: true, required: true },
      { field: 'note', ask: '📝 မှတ်ချက်? (မလိုရင် - ရိုက်ပါ)', skippable: true },
    ],
    summary: (data) => [
      '📤 <b>အထွက်စာရင်း</b>',
      `📂 ${data.category}`,
      `💵 ${mmk(data.amount)}`,
      `📝 ${data.note || '-'}`,
      '',
      'မှန်ရင် ✅ မှတ်မယ် နှိပ်ပါ',
    ].join('\n'),
  },
  INCOME_NEW: {
    title: '📥 ဝင်ငွေစာရင်း',
    steps: [
      { field: 'category', ask: '📂 ဘယ်အမျိုးအစားလဲ?', options: INCOME_CATEGORIES, required: true },
      { field: 'source', ask: '🏷 ဘယ်ကရတဲ့ ဝင်ငွေလဲ? (ဥပမာ Top-up ရောင်းငွေ)', required: true },
      { field: 'amount', ask: '💵 ပမာဏ ဘယ်လောက်လဲ?', amount: true, required: true },
      { field: 'note', ask: '📝 မှတ်ချက်? (မလိုရင် - ရိုက်ပါ)', skippable: true },
    ],
    summary: (data) => [
      '📥 <b>ဝင်ငွေစာရင်း</b>',
      `📂 ${data.category}`,
      `🏷 ${data.source}`,
      `💵 ${mmk(data.amount)}`,
      `📝 ${data.note || '-'}`,
      '',
      'မှန်ရင် ✅ မှတ်မယ် နှိပ်ပါ',
    ].join('\n'),
  },
};

function askFor(flowKey, stepIndex) {
  const def = FLOW_DEFS[flowKey];
  const step = def.steps[stepIndex];
  return {
    text: `${def.title} — ${stepIndex + 1}/${def.steps.length}\n\n${step.ask}`,
    keyboard: step.options ? optionKeyboard(step.options) : cancelKeyboard(),
  };
}

async function startFlow(shopId, chatId, flowKey) {
  await setSession(shopId, chatId, flowKey, 0, {});
  return askFor(flowKey, 0);
}

// The shop user a Telegram-created record is attributed to.
async function shopActorUserId(shopId) {
  const user = await prisma.user.findFirst({
    where: { shopId, active: true },
    orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
    select: { id: true },
  });
  return user?.id || null;
}

async function saveFlow(shopId, flowKey, data) {
  const userId = await shopActorUserId(shopId);
  if (!userId) throw new Error('Shop user not found');

  if (flowKey === 'REPAIR_NEW') {
    const { ensureRepairPlatformSchema } = require('./repair-platform-schema');
    const { createRepair } = require('./repair-platform-api');
    await ensureRepairPlatformSchema();
    const [brand, ...rest] = String(data.device || '').trim().split(/\s+/);
    const repairId = await prisma.$transaction(async (tx) => createRepair(tx, shopId, userId, {
      customerName: data.customerName,
      customerPhone: data.customerPhone || null,
      deviceBrand: brand || null,
      deviceModel: rest.join(' ') || null,
      problem: data.problem,
      estimatedCost: Number(data.estimatedCost || 0),
      notes: 'Telegram မှ မှတ်တမ်းတင်သည်',
      status: 'RECEIVED',
    }), { maxWait: 5000, timeout: 20000 });
    const row = await prisma.repair.findUnique({ where: { id: repairId }, select: { repairNumber: true } });
    return `✅ Repair မှတ်ပြီးပါပြီ\n\n🔖 ${row?.repairNumber || repairId}\n👤 ${data.customerName}\n💰 ${mmk(data.estimatedCost)}`;
  }

  if (flowKey === 'EXPENSE_NEW') {
    const { recordExpense } = require('./business-control-api-v2');
    const saved = await recordExpense({ shopId, userId, userAgent: 'telegram-bot' }, {
      category: data.category,
      amount: Number(data.amount),
      method: 'CASH',
      note: data.note || 'Telegram',
    });
    return `✅ အထွက်စာရင်း မှတ်ပြီးပါပြီ\n\n📂 ${saved.category}\n💵 ${mmk(saved.amount)}\n📅 ${saved.expenseDate}`;
  }

  if (flowKey === 'INCOME_NEW') {
    const { recordOtherIncome } = require('./business-control-api-v2');
    const saved = await recordOtherIncome({ shopId, userId, userAgent: 'telegram-bot' }, {
      category: data.category,
      source: data.source,
      amount: Number(data.amount),
      method: 'CASH',
      note: data.note || 'Telegram',
    });
    return `✅ ဝင်ငွေစာရင်း မှတ်ပြီးပါပြီ\n\n📂 ${saved.category}\n🏷 ${saved.source}\n💵 ${mmk(saved.amount)}\n📅 ${saved.incomeDate}`;
  }

  throw new Error('Unknown flow');
}

// Returns { text, keyboard } when the message belongs to a running flow.
async function continueFlow(shopId, chatId, text) {
  const session = await getSession(shopId, chatId);
  if (!session) return null;

  if (isCancelWord(text)) {
    await clearSession(shopId, chatId);
    return { text: '❌ ရပ်လိုက်ပါပြီ။', keyboard: quickKeyboard() };
  }

  const def = FLOW_DEFS[session.flow];
  if (!def) {
    await clearSession(shopId, chatId);
    return null;
  }

  const data = session.data || {};
  const stepIndex = Number(session.step || 0);

  // past the last question → waiting for the confirmation tap
  if (stepIndex >= def.steps.length) {
    if (!isConfirmWord(text)) {
      return { text: 'မှတ်မယ်ဆိုရင် ✅ မှတ်မယ် ကို နှိပ်ပါ။ ရပ်ချင်ရင် ❌ ရပ်မယ်။', keyboard: confirmKeyboard() };
    }
    try {
      const result = await saveFlow(shopId, session.flow, data);
      await clearSession(shopId, chatId);
      return { text: result, keyboard: quickKeyboard() };
    } catch (error) {
      await clearSession(shopId, chatId);
      const reason = /insufficient/i.test(error.message || '')
        ? 'Money Account လက်ကျန် မလုံလောက်ပါ။ Mahar POS မှာ လက်ကျန်ကို အရင်ညှိပါ။'
        : (error.message || 'unknown error');
      return { text: `⚠️ မှတ်လို့မရပါ — ${reason}`, keyboard: quickKeyboard() };
    }
  }

  const step = def.steps[stepIndex];
  const raw = String(text || '').trim();

  if (step.options && !step.options.includes(raw)) {
    return { text: 'အောက်က အမျိုးအစားထဲကနေ ရွေးပါ။', keyboard: optionKeyboard(step.options) };
  }

  let value = raw;
  if (isSkipWord(raw)) {
    if (step.required) return { text: 'ဒါက မဖြစ်မနေ လိုအပ်ပါတယ်။', keyboard: cancelKeyboard() };
    value = '';
  } else if (step.amount) {
    const amount = parseAmount(raw);
    if (!Number.isFinite(amount) || amount < 0) return { text: 'ဂဏန်းနဲ့ ရိုက်ပါ (ဥပမာ 15000)။', keyboard: cancelKeyboard() };
    if (step.required && amount <= 0) return { text: 'ပမာဏက 0 ထက် ကြီးရပါမယ်။', keyboard: cancelKeyboard() };
    value = amount;
  } else if (step.required && !value) {
    return { text: 'ဖြည့်ပေးပါ။', keyboard: cancelKeyboard() };
  }

  const nextData = { ...data, [step.field]: value };
  const nextIndex = stepIndex + 1;
  await setSession(shopId, chatId, session.flow, nextIndex, nextData);

  if (nextIndex >= def.steps.length) {
    return { text: def.summary(nextData), keyboard: confirmKeyboard() };
  }
  return askFor(session.flow, nextIndex);
}

async function buildQuickReply(shopId, actionKey) {
  const date = yangonDate();
  if (actionKey === 'REPAIR') return repairSummary(shopId, date);
  if (actionKey === 'CUSTOMERS') return customerSummary(shopId);
  if (actionKey === 'MONEY') return moneyServiceSummary(shopId, date);
  if (actionKey === 'OTHER') return otherRecordsSummary(shopId, date);
  return '';
}

module.exports = {
  isQuickGreeting,
  resolveQuickAction,
  resolveQuickFlow,
  isCancelWord,
  quickKeyboard,
  menuText,
  buildQuickReply,
  startFlow,
  continueFlow,
  clearSession,
};
