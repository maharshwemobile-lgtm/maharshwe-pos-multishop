const { loadTelegramSettings, sendTelegramMessageToAll } = require('./telegram-automation-api');

// Actions that are worth sending as audit notifications (skip noise)
const NOTIFY_ACTIONS = new Set([
  'SALE_CREATED', 'SALE_VOIDED',
  'CUSTOMER_CREDIT_COLLECTED', 'CUSTOMER_CREATED', 'CUSTOMER_UPDATED',
  'MONEY_ACCOUNT_TRANSFERRED', 'MONEY_ACCOUNT_ADJUSTED',
  'BUSINESS_OTHER_INCOME_CREATED', 'BUSINESS_EXPENSE_CREATED', 'BUSINESS_DAY_CLOSED',
  'REPAIR_INTAKE_CREATED', 'REPAIR_STATUS_CHANGED', 'REPAIR_FINANCE_UPDATED',
  'REPAIR_PROVIDER_LINKED', 'REPAIR_REFERRAL_CREATED', 'REPAIR_REFERRAL_CLAIMED',
  'REPAIR_EXTERNAL_IMPORTED', 'REPAIR_DEVICE_LINKED',
]);

// Entity-type prefix used for dynamic actions (e.g. POST_INVENTORY → inventory)
const NOTIFY_ENTITY_TYPES = new Set([
  'sale', 'customer', 'money_account', 'repair', 'repair_referral',
  'inventory', 'product', 'user',
  'business_other_income', 'business_expense', 'business_day_close',
]);

// What each action reads as in the feed. The English summaries came from the
// route table and described the endpoint — "Changed repair data" — rather than
// what somebody did.
const ACTION_TEXT = {
  SALE_VOIDED: 'ရောင်းအား ပယ်ဖျက်လိုက်သည်',
  CUSTOMER_CREDIT_COLLECTED: 'အကြွေး ကောက်ခံသည်',
  CUSTOMER_CREATED: 'ဖောက်သည် အသစ် ထည့်သည်',
  CUSTOMER_UPDATED: 'ဖောက်သည် အချက်အလက် ပြင်သည်',
  MONEY_ACCOUNT_TRANSFERRED: 'ငွေစာရင်းအချင်းချင်း လွှဲသည်',
  MONEY_ACCOUNT_ADJUSTED: 'ငွေစာရင်း လက်ကျန် ညှိသည်',
  BUSINESS_OTHER_INCOME_CREATED: 'အခြားဝင်ငွေ မှတ်သည်',
  BUSINESS_EXPENSE_CREATED: 'အသုံးစရိတ် မှတ်သည်',
  BUSINESS_DAY_CLOSED: 'နေ့ချုပ် ပိတ်သည်',
  REPAIR_INTAKE_CREATED: 'ဖုန်းပြင် အသစ် လက်ခံသည်',
  REPAIR_STATUS_CHANGED: 'ဖုန်းပြင် အခြေအနေ ပြောင်းသည်',
  REPAIR_DELETED: 'ဖုန်းပြင် မှတ်တမ်း ဖျက်သည်',
  REPAIR_FINANCE_UPDATED: 'ဖုန်းပြင် ငွေကြေး ပြင်သည်',
  REPAIR_PROVIDER_LINKED: 'ပြင်ပ Repair ID ချိတ်သည်',
  REPAIR_PROVIDER_SYNCED: 'ပြင်ပမှ ဖုန်းပြင် အချက်အလက် ဆွဲသည်',
  REPAIR_REFERRAL_CREATED: 'ဖုန်းပြင် လွှဲပြောင်းချက် ဖန်တီးသည်',
  REPAIR_REFERRAL_CLAIMED: 'ဖုန်းပြင် လွှဲပြောင်းချက် လက်ခံသည်',
  REPAIR_EXTERNAL_IMPORTED: 'ပြင်ပ ဖုန်းပြင် သွင်းသည်',
  REPAIR_DEVICE_LINKED: 'IMEI / Serial ချိတ်သည်',
  INVENTORY_POST: 'ကုန်ပစ္စည်း အသစ် ထည့်သည်',
  INVENTORY_PUT: 'ကုန်ပစ္စည်း ပြင်သည်',
  INVENTORY_PATCH: 'ကုန်ပစ္စည်း ပြင်သည်',
  INVENTORY_DELETE: 'ကုန်ပစ္စည်း ဖျက်သည်',
  PRODUCT_POST: 'ပစ္စည်း အသစ် ထည့်သည်',
  PRODUCT_PUT: 'ပစ္စည်း ပြင်သည်',
  PRODUCT_PATCH: 'ပစ္စည်း ပြင်သည်',
  PRODUCT_DELETE: 'ပစ္စည်း ဖျက်သည်',
  USER_POST: 'အသုံးပြုသူ အသစ် ထည့်သည်',
  USER_PUT: 'အသုံးပြုသူ ပြင်သည်',
  USER_PATCH: 'အသုံးပြုသူ ပြင်သည်',
  USER_DELETE: 'အသုံးပြုသူ ဖျက်သည်',
  SETTINGS_PUT: 'ဆိုင် ဆက်တင် ပြင်သည်',
  SETTINGS_POST: 'ဆိုင် ဆက်တင် ပြင်သည်',
};

// The counter reads these three words on the slip and in the sheet; the feed
// should not be the one place that says COMPLETED.
const STATUS_TEXT = {
  RECEIVED: 'ပြင်ရန် ⏳', CHECKING: 'ပြင်ရန် ⏳', IN_PROGRESS: 'ပြင်ရန် ⏳', WAITING_PART: 'ပြင်ရန် ⏳',
  COMPLETED: 'ပြင်ပြီး ✅', DELIVERED: 'ပြင်ပြီး ✅', CANNOT_REPAIR: 'ပြင်မရ ❌',
  PAID: 'ငွေရှင်းပြီး', PARTIAL: 'တစ်ဝက်ရှင်း', PENDING: 'မရှင်းရသေး',
};

const ROLE_TEXT = {
  SUPER_ADMIN: 'စူပါအက်ဒမင်',
  SHOP_ADMIN: 'ဆိုင်ပိုင်ရှင်',
  MANAGER: 'မန်နေဂျာ',
  CASHIER: 'ကောင်တာ',
  STAFF: 'ဝန်ထမ်း',
};

const ACTION_EMOJI = {
  SALE_CREATED: '🧾',
  SALE_VOIDED: '🚫',
  CUSTOMER_CREDIT_COLLECTED: '💵',
  CUSTOMER_CREATED: '👤',
  CUSTOMER_UPDATED: '✏️',
  MONEY_ACCOUNT_TRANSFERRED: '💸',
  MONEY_ACCOUNT_ADJUSTED: '⚖️',
  BUSINESS_OTHER_INCOME_CREATED: '📥',
  BUSINESS_EXPENSE_CREATED: '📤',
  BUSINESS_DAY_CLOSED: '🔒',
  REPAIR_INTAKE_CREATED: '🔧',
  REPAIR_STATUS_CHANGED: '🔄',
  REPAIR_FINANCE_UPDATED: '💰',
  REPAIR_PROVIDER_LINKED: '🔗',
  REPAIR_REFERRAL_CREATED: '📋',
  REPAIR_REFERRAL_CLAIMED: '🎯',
  REPAIR_EXTERNAL_IMPORTED: '📥',
  REPAIR_DEVICE_LINKED: '📱',
  REPAIR_DELETED: '🗑',
  REPAIR_PROVIDER_SYNCED: '🔄',
  INVENTORY_POST: '📦', INVENTORY_PUT: '📦', INVENTORY_PATCH: '📦', INVENTORY_DELETE: '🗑',
  PRODUCT_POST: '🏷', PRODUCT_PUT: '🏷', PRODUCT_PATCH: '🏷', PRODUCT_DELETE: '🗑',
  USER_POST: '👥', USER_PUT: '👥', USER_PATCH: '👥', USER_DELETE: '🗑',
  SETTINGS_PUT: '⚙️', SETTINGS_POST: '⚙️',
};

// A sale already sends its own message with the invoice, the total and every
// line item. The audit feed adding "Completed a sale" underneath it says
// nothing the first one did not, and arrives as a second buzz for one event.
const HAS_OWN_NOTIFICATION = new Set(['SALE_CREATED']);

function shouldNotify(event) {
  if (event.outcome !== 'SUCCESS') return false;
  if (HAS_OWN_NOTIFICATION.has(event.action)) return false;
  if (NOTIFY_ACTIONS.has(event.action)) return true;
  if (NOTIFY_ENTITY_TYPES.has(event.entityType)) return true;
  return false;
}

function yangonTime() {
  return new Date().toLocaleString('en-GB', {
    timeZone: 'Asia/Yangon',
    hour: '2-digit', minute: '2-digit',
    day: '2-digit', month: 'short',
  });
}

// The name of the thing acted on, so the feed says which repair, which
// customer, which product — not just that "repair data" changed.
function subjectOf(event) {
  const body = event.request?.body || {};
  const parts = [
    body.repairNumber, body.invoiceNumber, body.orderNumber,
    body.name, body.customerName, body.productName, body.username,
  ].map((value) => String(value || '').trim()).filter(Boolean);
  if (parts.length) return parts[0];
  const brand = String(body.deviceBrand || '').trim();
  const model = String(body.deviceModel || '').trim();
  return [brand, model].filter(Boolean).join(' ');
}

function money(value) {
  return `${Number(value).toLocaleString('en-US')} ကျပ်`;
}

function formatAuditMessage(event) {
  const emoji = ACTION_EMOJI[event.action] || '📋';
  const actor = event.actor?.name || event.actor?.username || 'အသုံးပြုသူ';
  const role = ROLE_TEXT[event.actor?.role] || event.actor?.role || '';
  const what = ACTION_TEXT[event.action] || event.summary || event.action.replace(/_/g, ' ');
  const subject = subjectOf(event);

  const lines = [
    `${emoji} <b>${what}</b>`,
    `👤 ${actor}${role ? ` · ${role}` : ''}`,
  ];
  if (subject) lines.push(`📌 ${subject}`);

  const body = event.request?.body || {};
  if (body.status) lines.push(`🔄 ${STATUS_TEXT[body.status] || body.status}`);
  if (body.total != null) lines.push(`💰 ${money(body.total)}`);
  if (body.amount != null) lines.push(`💰 ${money(body.amount)}`);
  if (body.finalCost != null) lines.push(`💰 ${money(body.finalCost)}`);
  if (body.category) lines.push(`🏷 ${body.category}`);
  if (body.source) lines.push(`📎 ${body.source}`);
  if (body.method) lines.push(`💳 ${body.method}`);
  if (body.paymentStatus) lines.push(`💳 ${STATUS_TEXT[body.paymentStatus] || body.paymentStatus}`);
  if (body.note) lines.push(`📝 ${body.note}`);
  lines.push(`🕐 ${yangonTime()} (ရန်ကုန်)`);

  return lines.join('\n');
}

async function notifyTelegramAuditEvent(shopId, event) {
  try {
    if (!shouldNotify(event)) return;
    const settings = await loadTelegramSettings(shopId);
    if (!settings.enabled || !settings.auditLogNotifications) return;
    await sendTelegramMessageToAll(settings, formatAuditMessage(event));
  } catch {
    // fire-and-forget — never block the request
  }
}

module.exports = { notifyTelegramAuditEvent };
