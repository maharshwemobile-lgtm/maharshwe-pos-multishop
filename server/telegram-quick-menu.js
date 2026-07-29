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
  { key: 'OTHER', button: '📋 Other Records', match: ['other record', 'other', 'income', 'expense', 'ဝင်ငွေ', 'ထွက်ငွေ'] },
];

const GREETINGS = ['hi', 'hii', 'hey', 'hello', 'menu', 'start', 'help', 'မင်္ဂလာပါ', 'ဟိုင်း', 'မီနူး'];

function normalize(text) {
  return String(text || '').trim().toLowerCase().replace(/^\//, '');
}

function isQuickGreeting(text) {
  const value = normalize(text);
  if (!value) return false;
  return GREETINGS.includes(value);
}

function resolveQuickAction(text) {
  const value = normalize(text);
  if (!value) return '';
  // keep combining marks (\p{M}) — Burmese vowel signs are marks, not letters
  const stripped = value.replace(/[^\p{L}\p{N}\p{M}\s]/gu, '').trim();
  const found = ACTIONS.find((action) => action.match.some((keyword) => stripped === keyword || stripped.startsWith(keyword)));
  return found?.key || '';
}

// A reply keyboard (not an inline one) so it also works for bots whose webhook
// was registered with allowed_updates: ['message'].
function quickKeyboard() {
  return {
    keyboard: [
      [{ text: ACTIONS[0].button }, { text: ACTIONS[1].button }],
      [{ text: ACTIONS[2].button }, { text: ACTIONS[3].button }],
    ],
    resize_keyboard: true,
    is_persistent: true,
    input_field_placeholder: 'Hi လို့ရိုက်ရင် menu ပြန်ပေါ်ပါမယ်',
  };
}

function menuText(shopName, statusLine) {
  return [
    `👋 ${shopName || 'Mahar POS'}`,
    '',
    'ဘာကြည့်ချင်လဲ အောက်က ခလုတ်ကို နှိပ်ပါ:',
    '',
    '🔧 Repair — ယနေ့ ပြုပြင်ရေး အခြေအနေ',
    '👥 Customers — အကြွေးကျန် စာရင်း',
    '💸 Money Service — ယနေ့ ငွေလွှဲ / ငွေထုတ်',
    '📋 Other Records — ယနေ့ ဝင်ငွေ / ထွက်ငွေ',
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
  const [income, expense] = await Promise.all([
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
  ]);

  const sum = (rows) => (rows || []).reduce((total, row) => total + Number(row.amount || 0), 0);
  const list = (rows) => (rows || []).map((row) => `• ${String(row.category).replaceAll('_', ' ')}: ${mmk(row.amount)}`);
  const incomeTotal = sum(income);
  const expenseTotal = sum(expense);

  return [
    '📋 <b>Other Records — ယနေ့</b>',
    `📅 ${date}`,
    '',
    '📥 ဝင်ငွေ:',
    ...(list(income).length ? list(income) : ['• မရှိပါ']),
    `✅ ဝင်ငွေ စုစုပေါင်း: ${mmk(incomeTotal)}`,
    '',
    '📤 ထွက်ငွေ:',
    ...(list(expense).length ? list(expense) : ['• မရှိပါ']),
    `❗️ ထွက်ငွေ စုစုပေါင်း: ${mmk(expenseTotal)}`,
    '',
    `📊 Net: ${mmk(incomeTotal - expenseTotal)}`,
  ].join('\n');
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
  quickKeyboard,
  menuText,
  buildQuickReply,
};
