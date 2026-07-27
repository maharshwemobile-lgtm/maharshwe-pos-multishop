const { loadTelegramSettings, sendTelegramMessage } = require('./telegram-automation-api');

// Actions that are worth sending as audit notifications (skip noise)
const NOTIFY_ACTIONS = new Set([
  'SALE_CREATED', 'SALE_VOIDED',
  'CUSTOMER_CREDIT_COLLECTED', 'CUSTOMER_CREATED', 'CUSTOMER_UPDATED',
  'MONEY_ACCOUNT_TRANSFERRED', 'MONEY_ACCOUNT_ADJUSTED',
  'REPAIR_INTAKE_CREATED', 'REPAIR_STATUS_CHANGED', 'REPAIR_FINANCE_UPDATED',
  'REPAIR_PROVIDER_LINKED', 'REPAIR_REFERRAL_CREATED', 'REPAIR_REFERRAL_CLAIMED',
  'REPAIR_EXTERNAL_IMPORTED', 'REPAIR_DEVICE_LINKED',
]);

// Entity-type prefix used for dynamic actions (e.g. POST_INVENTORY → inventory)
const NOTIFY_ENTITY_TYPES = new Set([
  'sale', 'customer', 'money_account', 'repair', 'repair_referral',
  'inventory', 'product', 'user',
]);

const ACTION_EMOJI = {
  SALE_CREATED: '🧾',
  SALE_VOIDED: '🚫',
  CUSTOMER_CREDIT_COLLECTED: '💵',
  CUSTOMER_CREATED: '👤',
  CUSTOMER_UPDATED: '✏️',
  MONEY_ACCOUNT_TRANSFERRED: '💸',
  MONEY_ACCOUNT_ADJUSTED: '⚖️',
  REPAIR_INTAKE_CREATED: '🔧',
  REPAIR_STATUS_CHANGED: '🔄',
  REPAIR_FINANCE_UPDATED: '💰',
  REPAIR_PROVIDER_LINKED: '🔗',
  REPAIR_REFERRAL_CREATED: '📋',
  REPAIR_REFERRAL_CLAIMED: '🎯',
  REPAIR_EXTERNAL_IMPORTED: '📥',
  REPAIR_DEVICE_LINKED: '📱',
};

function shouldNotify(event) {
  if (event.outcome !== 'SUCCESS') return false;
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

function formatAuditMessage(event) {
  const emoji = ACTION_EMOJI[event.action] || '📋';
  const actor = event.actor?.name || event.actor?.username || 'User';
  const role = event.actor?.role ? ` (${event.actor.role.replace('_', ' ')})` : '';
  const summary = event.summary || event.action.replace(/_/g, ' ');
  const time = yangonTime();

  const lines = [
    `${emoji} <b>${summary}</b>`,
    `👤 ${actor}${role}`,
    `🕐 ${time} (Yangon)`,
  ];

  // Add useful body fields if present
  const body = event.request?.body || {};
  if (body.invoiceNumber) lines.splice(1, 0, `🧾 ${body.invoiceNumber}`);
  if (body.status) lines.splice(-1, 0, `📌 Status: ${body.status}`);
  if (body.total != null) lines.splice(-1, 0, `💰 ${Number(body.total).toLocaleString()} MMK`);

  return lines.join('\n');
}

async function notifyTelegramAuditEvent(shopId, event) {
  try {
    if (!shouldNotify(event)) return;
    const settings = await loadTelegramSettings(shopId);
    if (!settings.enabled || !settings.auditLogNotifications) return;
    // Use linkedTelegramId as fallback — no manual chatId entry needed (wallet-note style)
    const effectiveChatId = settings.chatId || settings.linkedTelegramId;
    if (!effectiveChatId) return;
    await sendTelegramMessage({ ...settings, chatId: effectiveChatId }, formatAuditMessage(event));
  } catch {
    // fire-and-forget — never block the request
  }
}

module.exports = { notifyTelegramAuditEvent };
