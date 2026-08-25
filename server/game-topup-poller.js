// Game Top-up — settle orders MooGold is still working on.
//
// create_order answers "processing" and only later becomes completed or
// refunded, so an order is not finished when the API call returns. Without
// this, a refunded order would sit in the books as delivered: the shop has
// taken the customer's money, MooGold has quietly given ours back, and nobody
// finds out until someone reconciles by hand.
//
// Shop orders debited a prepaid wallet, so a refund puts that back with a
// ledger row, mirroring the debit written when the order was placed. Public
// orders were paid by the customer over KBZ Pay, which cannot be reversed from
// here — those are flagged so a human refunds the customer.
const crypto = require('crypto');
const { Prisma } = require('@prisma/client');
const { prisma } = require('./prisma');
const { ensureGameTopupSchema } = require('./game-topup-schema');
const moogold = require('./moogold-client');
const { notifyAdminsOfRefund } = require('./game-topup-telegram');

const POLL_INTERVAL_MS = 2 * 60 * 1000;
// An order MooGold has not settled within a day is not going to settle on its
// own; leaving it in the queue forever would poll it until the end of time.
const GIVE_UP_AFTER_HOURS = 24;
const BATCH = 20;

const number = (value) => Number(value || 0);
const round = (value) => Math.round((number(value) + Number.EPSILON) * 100) / 100;

function refundedBy(status) {
  return ['refunded', 'cancelled', 'failed'].includes(String(status || '').toLowerCase());
}

async function pendingShopOrders() {
  return prisma.$queryRawUnsafe(
    `SELECT id, shop_id AS "shopId", order_number AS "orderNumber", moogold_order_id AS "moogoldOrderId",
            shop_cost AS "shopCost", retail_price AS "retailPrice"
       FROM game_topup_orders
      WHERE status = 'PROCESSING'
        AND moogold_order_id IS NOT NULL
        AND created_at > NOW() - INTERVAL '${GIVE_UP_AFTER_HOURS} hours'
      ORDER BY created_at ASC
      LIMIT ${BATCH}`,
  );
}

async function pendingPublicOrders() {
  return prisma.$queryRawUnsafe(
    `SELECT id, order_number AS "orderNumber", moogold_order_id AS "moogoldOrderId", retail_price AS "retailPrice",
            customer_name AS "customerName", customer_phone AS "customerPhone", shop_id AS "shopId"
       FROM game_topup_public_orders
      WHERE status = 'PROCESSING'
        AND moogold_order_id IS NOT NULL
        AND created_at > NOW() - INTERVAL '${GIVE_UP_AFTER_HOURS} hours'
      ORDER BY created_at ASC
      LIMIT ${BATCH}`,
  );
}

// Puts the wholesale cost back on the shop's prepaid wallet and records why,
// in one transaction so the balance and the ledger cannot disagree.
async function refundShopWallet(order, reason) {
  await prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRawUnsafe(
      `SELECT balance FROM game_topup_wallets WHERE shop_id = $1::uuid FOR UPDATE`, order.shopId,
    );
    const closing = round(number(rows[0]?.balance) + number(order.shopCost));
    await tx.$executeRawUnsafe(
      `UPDATE game_topup_wallets SET balance = $2, updated_at = NOW() WHERE shop_id = $1::uuid`,
      order.shopId, closing,
    );
    await tx.$executeRawUnsafe(
      `INSERT INTO game_topup_wallet_ledger(id, shop_id, type, amount, closing_balance, note, order_id, created_at)
       VALUES($1::uuid,$2::uuid,'ORDER_REFUND',$3,$4,$5,$6::uuid,NOW())`,
      crypto.randomUUID(), order.shopId, number(order.shopCost), closing,
      `${order.orderNumber} refunded by MooGold`, order.id,
    );
    await tx.$executeRawUnsafe(
      `UPDATE game_topup_orders SET status='REFUNDED', failure_reason=$2, updated_at=NOW() WHERE id=$1::uuid`,
      order.id, reason.slice(0, 500),
    );
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5000, timeout: 15000 });
}

async function settleOne(order, kind) {
  let detail;
  try {
    detail = await moogold.orderDetail(order.moogoldOrderId);
  } catch {
    // A lookup that fails now is retried on the next pass; the order stays
    // PROCESSING rather than being guessed at in either direction.
    return null;
  }

  const status = String(detail?.order_status || '').toLowerCase();
  if (!moogold.isTerminalStatus(status)) return null;

  if (refundedBy(status)) {
    const reason = `MooGold marked this order ${status}`;
    if (kind === 'shop') {
      await refundShopWallet(order, reason);
    } else {
      await prisma.$executeRawUnsafe(
        `UPDATE game_topup_public_orders SET status='REFUNDED', failure_reason=$2, updated_at=NOW() WHERE id=$1::uuid`,
        order.id, reason,
      );
      // The customer paid over KBZ Pay, which cannot be reversed from here —
      // an admin has to actually send the money back, so they need an active
      // alert, not just a status change nobody is watching for.
      await notifyAdminsOfRefund(order).catch(() => {});
    }
    return { orderNumber: order.orderNumber, status: 'REFUNDED', kind };
  }

  const table = kind === 'shop' ? 'game_topup_orders' : 'game_topup_public_orders';
  await prisma.$executeRawUnsafe(
    `UPDATE ${table} SET status='COMPLETED', updated_at=NOW() WHERE id=$1::uuid`, order.id,
  );
  return { orderNumber: order.orderNumber, status: 'COMPLETED', kind };
}

async function pollGameTopupOrders() {
  if (!moogold.isConfigured()) return [];
  await ensureGameTopupSchema();

  const settled = [];
  for (const order of await pendingShopOrders()) {
    const result = await settleOne(order, 'shop');
    if (result) settled.push(result);
  }
  for (const order of await pendingPublicOrders()) {
    const result = await settleOne(order, 'public');
    if (result) settled.push(result);
  }

  const refunds = settled.filter((item) => item.status === 'REFUNDED');
  if (refunds.length) {
    console.warn('[game-topup] MooGold refunded:', refunds.map((item) => `${item.orderNumber} (${item.kind})`).join(', '));
  }
  return settled;
}

function startGameTopupPoller() {
  if (!moogold.isConfigured()) return null;
  const timer = setInterval(() => {
    pollGameTopupOrders().catch((error) => {
      console.error('[game-topup] poll failed:', error.message);
    });
  }, POLL_INTERVAL_MS);
  timer.unref?.();
  return timer;
}

module.exports = { pollGameTopupOrders, startGameTopupPoller };
