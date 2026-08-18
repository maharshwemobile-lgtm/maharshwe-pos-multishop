// Game Top-up — Telegram approval layer for the public storefront.
//
// A public order is funded by a KBZ Pay P2P transfer with a self-reported
// transaction id — there is no merchant API to verify that automatically, so
// approving an order is a deliberate human checkpoint: an admin looks at the
// real KBZ Pay transaction history and taps Approve or Reject. This is the
// same shape as the shop's existing VPN reseller bot (screenshot in,
// approve/reject buttons, delivery on approve), just wired to MooGold instead.
//
// Runs on its own bot (GAME_TOPUP_BOT_TOKEN), never MAIN_BOT_TOKEN — Telegram
// allows only one webhook per bot, and MAIN_BOT_TOKEN's webhook is already
// owned by the external service that handles ecommerce customer login deep
// links. Reusing it here would silently break that.
const { prisma } = require('./prisma');
const moogold = require('./moogold-client');
const { ensureGameTopupSchema } = require('./game-topup-schema');
const { appUrl } = require('./public-urls');

class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function botToken() {
  return String(process.env.GAME_TOPUP_BOT_TOKEN || '').trim();
}
function adminChatIds() {
  return String(process.env.GAME_TOPUP_ADMIN_CHAT_IDS || '')
    .split(',').map((id) => id.trim()).filter(Boolean);
}
function webhookSecret() {
  return String(process.env.GAME_TOPUP_WEBHOOK_SECRET || '').trim();
}
function isConfigured() {
  return Boolean(botToken() && adminChatIds().length);
}

const number = (value) => Number(value || 0);
const money = (value) => `${number(value).toLocaleString('en-US')} MMK`;
function escapeHtml(value) {
  return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

async function callTelegram(method, payload) {
  const token = botToken();
  if (!token) return null;
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).catch(() => null);
  if (!response) return null;
  return response.json().catch(() => null);
}

function orderMessageText(order, extra) {
  const lines = [
    '🎮 <b>Game Top-up Order</b>',
    `Order: <b>${escapeHtml(order.orderNumber)}</b>`,
    `Item: ${escapeHtml(order.productName)} · ${escapeHtml(order.variationName)} × ${order.quantity}`,
    `Price: <b>${money(order.retailPrice)}</b>`,
    `Player ID: ${escapeHtml(order.playerId || '-')}${order.serverId ? ' · Server ' + escapeHtml(order.serverId) : ''}`,
    `Customer: ${escapeHtml(order.customerName || '-')} · ${escapeHtml(order.customerPhone)}`,
    `Payment: ${escapeHtml(order.paymentMethod)} · Txn နောက်ဆုံး ၄ လုံး: <code>${escapeHtml(order.paymentTransactionId)}</code>`,
  ];
  // Four digits repeat by coincidence often enough that this is a "look
  // twice", not an accusation — the admin is checking the real KBZ Pay
  // history anyway, where the amount and time disambiguate.
  if (order.duplicateWarning) lines.push('⚠️ ဒီ ၄ လုံးကို အရင်လည်း တင်ဖူးပါတယ် — ပမာဏနဲ့ အချိန် တိုက်စစ်ပါ');
  if (extra) lines.push('', extra);
  return lines.join('\n');
}

async function notifyAdminsForApproval(order) {
  if (!isConfigured()) return;
  const text = orderMessageText(order);
  const buttons = {
    inline_keyboard: [[
      { text: '✅ Approve', callback_data: `gtapprove|${order.id}` },
      { text: '❌ Reject', callback_data: `gtreject|${order.id}` },
    ]],
  };
  let primary = null;
  for (const chatId of adminChatIds()) {
    const result = await callTelegram('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', reply_markup: buttons });
    const messageId = result?.result?.message_id;
    // Only one chat's copy of the message gets edited on resolution — every
    // other admin's copy keeps its buttons, but tapping a stale one after
    // resolution is a safe no-op (approvePublicOrder/rejectPublicOrder both
    // check the order is still PENDING_APPROVAL first).
    if (messageId && !primary) primary = { chatId: String(chatId), messageId: String(messageId) };
  }
  if (primary) {
    await prisma.$executeRawUnsafe(
      `UPDATE game_topup_public_orders SET telegram_chat_id = $2, telegram_message_id = $3 WHERE id = $1::uuid`,
      order.id, primary.chatId, primary.messageId,
    ).catch(() => {});
  }
}

async function editOrderMessage(order, resultText) {
  if (!order?.telegramChatId || !order?.telegramMessageId) return;
  await callTelegram('editMessageText', {
    chat_id: order.telegramChatId,
    message_id: Number(order.telegramMessageId),
    text: orderMessageText(order, resultText),
    parse_mode: 'HTML',
  });
}

async function loadOrderWithNames(orderId) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT o.id, o.order_number AS "orderNumber", o.quantity, o.player_id AS "playerId", o.server_id AS "serverId",
            o.customer_name AS "customerName", o.customer_phone AS "customerPhone", o.retail_price AS "retailPrice",
            o.payment_method AS "paymentMethod", o.payment_transaction_id AS "paymentTransactionId", o.status,
            o.reject_reason AS "rejectReason", o.moogold_order_id AS "moogoldOrderId", o.failure_reason AS "failureReason",
            o.telegram_chat_id AS "telegramChatId", o.telegram_message_id AS "telegramMessageId",
            o.variation_id AS "variationId", o.created_at AS "createdAt",
            p.moogold_category_id AS "moogoldCategoryId", p.moogold_product_id AS "moogoldProductId", p.name AS "productName",
            v.moogold_variation_id AS "moogoldVariationId", v.name AS "variationName"
       FROM game_topup_public_orders o
       JOIN game_topup_variations v ON v.id = o.variation_id
       JOIN game_topup_products p ON p.id = v.product_id
      WHERE o.id = $1::uuid`,
    orderId,
  );
  return rows[0] || null;
}

async function approvePublicOrder(orderId, reviewerUserId) {
  await ensureGameTopupSchema();
  const order = await loadOrderWithNames(orderId);
  if (!order) throw new ApiError(404, 'Order not found');
  if (order.status !== 'PENDING_APPROVAL') throw new ApiError(409, `Order is already ${order.status}`);

  let moogoldResult;
  try {
    moogoldResult = await moogold.createOrder({
      category: order.moogoldCategoryId,
      productId: order.moogoldVariationId,
      quantity: order.quantity,
      playerId: order.playerId,
      server: order.serverId,
      partnerOrderId: order.orderNumber,
    });
  } catch (error) {
    await prisma.$executeRawUnsafe(
      `UPDATE game_topup_public_orders SET status='FAILED', failure_reason=$2, reviewed_by_id=$3::uuid, reviewed_at=NOW(), updated_at=NOW() WHERE id=$1::uuid`,
      orderId, String(error.message || 'MooGold order failed').slice(0, 500), reviewerUserId || null,
    );
    const updated = await loadOrderWithNames(orderId);
    await editOrderMessage(updated, `❌ <b>Approved, but MooGold order failed:</b>\n${escapeHtml(error.message || '')}`);
    throw new ApiError(502, error.message || 'MooGold order failed');
  }

  await prisma.$executeRawUnsafe(
    `UPDATE game_topup_public_orders SET status='COMPLETED', moogold_order_id=$2, moogold_response=$3::jsonb, reviewed_by_id=$4::uuid, reviewed_at=NOW(), updated_at=NOW() WHERE id=$1::uuid`,
    orderId,
    moogoldResult?.account_details?.order_id ? String(moogoldResult.account_details.order_id) : null,
    JSON.stringify(moogoldResult || {}),
    reviewerUserId || null,
  );
  const updated = await loadOrderWithNames(orderId);
  await editOrderMessage(updated, '✅ <b>Approved &amp; delivered</b>');
  return updated;
}

async function rejectPublicOrder(orderId, reviewerUserId, reason) {
  await ensureGameTopupSchema();
  const order = await loadOrderWithNames(orderId);
  if (!order) throw new ApiError(404, 'Order not found');
  if (order.status !== 'PENDING_APPROVAL') throw new ApiError(409, `Order is already ${order.status}`);
  const cleanReason = String(reason || 'Payment not verified').trim().slice(0, 300);
  await prisma.$executeRawUnsafe(
    `UPDATE game_topup_public_orders SET status='REJECTED', reject_reason=$2, reviewed_by_id=$3::uuid, reviewed_at=NOW(), updated_at=NOW() WHERE id=$1::uuid`,
    orderId, cleanReason, reviewerUserId || null,
  );
  const updated = await loadOrderWithNames(orderId);
  await editOrderMessage(updated, `❌ <b>Rejected</b>: ${escapeHtml(cleanReason)}`);
  return updated;
}

async function setGameTopupWebhook() {
  if (!botToken()) throw new ApiError(400, 'GAME_TOPUP_BOT_TOKEN is not set');
  if (!webhookSecret()) throw new ApiError(400, 'GAME_TOPUP_WEBHOOK_SECRET is not set');
  const url = `${appUrl()}/api/telegram/game-topup-webhook`;
  const result = await callTelegram('setWebhook', { url, secret_token: webhookSecret(), allowed_updates: ['callback_query'] });
  if (!result?.ok) throw new ApiError(502, result?.description || 'setWebhook failed');
  return { url, telegramResponse: result };
}

function attachGameTopupTelegramWebhook(app) {
  // Telegram retries aggressively on anything but a fast 2xx, and nothing the
  // caller needs is time-critical here, so acknowledge immediately and do the
  // real work after responding.
  app.post('/api/telegram/game-topup-webhook', async (req, res) => {
    res.json({ ok: true });
    try {
      const secret = req.headers['x-telegram-bot-api-secret-token'];
      if (!webhookSecret() || secret !== webhookSecret()) return;
      const callback = req.body?.callback_query;
      if (!callback?.data) return;
      const [action, orderId] = String(callback.data).split('|');
      if (!orderId) return;

      if (action === 'gtapprove') {
        try {
          await approvePublicOrder(orderId, null);
          await callTelegram('answerCallbackQuery', { callback_query_id: callback.id, text: 'Approved ✅' });
        } catch (error) {
          await callTelegram('answerCallbackQuery', { callback_query_id: callback.id, text: error.message || 'Failed', show_alert: true });
        }
      } else if (action === 'gtreject') {
        try {
          await rejectPublicOrder(orderId, null, 'Rejected via Telegram');
          await callTelegram('answerCallbackQuery', { callback_query_id: callback.id, text: 'Rejected' });
        } catch (error) {
          await callTelegram('answerCallbackQuery', { callback_query_id: callback.id, text: error.message || 'Failed', show_alert: true });
        }
      }
    } catch {
      // best-effort; the webhook already returned 200 to Telegram
    }
  });
}

module.exports = {
  ApiError,
  isConfigured,
  notifyAdminsForApproval,
  approvePublicOrder,
  rejectPublicOrder,
  setGameTopupWebhook,
  attachGameTopupTelegramWebhook,
};
