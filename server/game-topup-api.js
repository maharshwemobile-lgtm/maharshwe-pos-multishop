// Game Top-up — shop-facing API.
//
// The platform (Super Admin) buys wholesale from MooGold and holds one set of
// credentials. Each shop carries a prepaid wallet with the platform instead
// of talking to MooGold directly — same shape as a phone shop's Bill/Eload
// biller float, except the float is shared infrastructure, not something
// each shop configures for itself.
//
// A sale only touches money once MooGold has actually confirmed the order:
// the wallet debit, the shop's own cash/wallet credit and the order row are
// all written in one transaction that only runs after MooGold's API call
// succeeds. If MooGold fails or times out, nothing moves — the shop sees the
// error and can retry or fix the Player ID, same as a failed card swipe.
const crypto = require('crypto');
const { z } = require('zod');
const { Prisma } = require('@prisma/client');
const { prisma } = require('./prisma');
const { requireAuth, requireShopUser, requireWritableSubscription } = require('./auth-api');
const { ensureGameTopupSchema } = require('./game-topup-schema');
const moogold = require('./moogold-client');

class ApiError extends Error {
  constructor(status, message, details) { super(message); this.status = status; this.details = details; }
}

function parse(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) throw new ApiError(400, 'Invalid Game Top-up request', result.error.flatten().fieldErrors);
  return result.data;
}

const number = (value) => Number(value || 0);
const round = (value) => Math.round((number(value) + Number.EPSILON) * 100) / 100;
const clean = (value, max = 200) => String(value ?? '').trim().slice(0, max) || null;

// It moves a prepaid wallet balance, not shop stock, so it is gated like
// Bill/Eload rather than plain Sale POS: any non-cashier role, or a cashier
// specifically granted the accounting permission.
function requireGameTopup(req, res, next) {
  if (req.auth?.role !== 'CASHIER' || req.auth?.permissions?.accounting === true) return next();
  return res.status(403).json({ ok: false, message: 'Game Top-up permission is required' });
}
function canSeeCost(auth) {
  return auth?.role === 'SUPER_ADMIN' || auth?.role === 'SHOP_ADMIN' || auth?.permissions?.accounting === true || auth?.permissions?.viewCost === true;
}

async function ensureWallet(client, shopId) {
  await client.$executeRawUnsafe(
    `INSERT INTO game_topup_wallets(shop_id, balance, updated_at) VALUES($1::uuid, 0, NOW()) ON CONFLICT (shop_id) DO NOTHING`,
    shopId,
  );
}

async function getWallet(client, shopId) {
  await ensureWallet(client, shopId);
  const rows = await client.$queryRawUnsafe(
    `SELECT shop_id AS "shopId", balance, updated_at AS "updatedAt" FROM game_topup_wallets WHERE shop_id = $1::uuid`,
    shopId,
  );
  return rows[0];
}

async function lockWalletForUpdate(tx, shopId) {
  await ensureWallet(tx, shopId);
  const rows = await tx.$queryRawUnsafe(
    `SELECT shop_id AS "shopId", balance FROM game_topup_wallets WHERE shop_id = $1::uuid FOR UPDATE`,
    shopId,
  );
  return rows[0];
}

// Duplicated from money-service-v23-api.js on purpose — this codebase keeps
// small per-file helpers rather than a shared module (see round()/number()
// above), and this one needs a plain Prisma client, not a raw pool client.
async function applyPaymentAccountChange(tx, shopId, accountId, delta) {
  if (!accountId || Math.abs(delta) <= 0.005) return null;
  const account = await tx.moneyAccount.findFirst({ where: { id: accountId, shopId, active: true } });
  if (!account) throw new ApiError(404, 'Payment account not found');
  const after = number(account.balance) + delta;
  if (after < -0.005) throw new ApiError(409, `${account.name} balance is not enough`);
  await tx.moneyAccount.update({ where: { id: account.id }, data: { balance: after } });
  return { id: account.id, name: account.name, before: number(account.balance), after };
}

async function loadActiveCatalog() {
  const products = await prisma.$queryRawUnsafe(
    `SELECT id, moogold_category_id AS "moogoldCategoryId", moogold_product_id AS "moogoldProductId",
            name, image_url AS "imageUrl", requires_player_id AS "requiresPlayerId", requires_server AS "requiresServer"
       FROM game_topup_products WHERE active = TRUE ORDER BY sort_order ASC, name ASC`,
  );
  if (!products.length) return [];
  const variations = await prisma.$queryRawUnsafe(
    `SELECT id, product_id AS "productId", moogold_variation_id AS "moogoldVariationId", name,
            shop_cost AS "shopCost", suggested_retail AS "suggestedRetail"
       FROM game_topup_variations WHERE active = TRUE AND product_id = ANY($1::uuid[]) ORDER BY shop_cost ASC`,
    products.map((product) => product.id),
  );
  const byProduct = new Map();
  variations.forEach((variation) => {
    const list = byProduct.get(variation.productId) || [];
    list.push({ ...variation, shopCost: round(variation.shopCost), suggestedRetail: round(variation.suggestedRetail) });
    byProduct.set(variation.productId, list);
  });
  return products
    .map((product) => ({ ...product, variations: byProduct.get(product.id) || [] }))
    .filter((product) => product.variations.length > 0);
}

async function loadVariationWithProduct(variationId) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT v.id, v.product_id AS "productId", v.moogold_variation_id AS "moogoldVariationId", v.name AS "variationName",
            v.shop_cost AS "shopCost", v.suggested_retail AS "suggestedRetail", v.active AS "variationActive",
            p.moogold_category_id AS "moogoldCategoryId", p.moogold_product_id AS "moogoldProductId",
            p.name AS "productName", p.requires_player_id AS "requiresPlayerId", p.requires_server AS "requiresServer",
            p.active AS "productActive"
       FROM game_topup_variations v JOIN game_topup_products p ON p.id = v.product_id
      WHERE v.id = $1::uuid`,
    variationId,
  );
  return rows[0] || null;
}

const orderSchema = z.object({
  variationId: z.string().uuid(),
  quantity: z.coerce.number().int().min(1).max(50).default(1),
  playerId: z.string().trim().max(80).optional().nullable(),
  server: z.string().trim().max(80).optional().nullable(),
  customerName: z.string().trim().max(120).optional().nullable(),
  customerPhone: z.string().trim().max(40).optional().nullable(),
  retailPrice: z.coerce.number().min(0).optional(),
  paymentAccountId: z.string().uuid().optional().nullable(),
});

async function generateOrderNumber(shopId) {
  const count = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS count FROM game_topup_orders WHERE shop_id = $1::uuid`,
    shopId,
  );
  const next = number(count[0]?.count) + 1;
  return `GT${String(next).padStart(5, '0')}`;
}

async function audit(req, action, entityId, details) {
  await prisma.auditLog.create({
    data: { shopId: req.auth.shopId, userId: req.auth.userId, action, entityType: 'game_topup_order', entityId, details, ipAddress: req.ip || null, userAgent: req.headers['user-agent'] || null },
  }).catch(() => {});
}

function orderRow(row) {
  return {
    id: row.id,
    orderNumber: row.orderNumber,
    quantity: row.quantity,
    playerId: row.playerId,
    serverId: row.serverId,
    customerName: row.customerName,
    customerPhone: row.customerPhone,
    shopCost: round(row.shopCost),
    retailPrice: round(row.retailPrice),
    profit: round(row.profit),
    status: row.status,
    moogoldOrderId: row.moogoldOrderId,
    failureReason: row.failureReason,
    createdAt: row.createdAt,
    productName: row.productName,
    variationName: row.variationName,
  };
}

function attachGameTopupApi(app) {
  const read = [requireAuth, requireShopUser, requireGameTopup];
  const write = [requireAuth, requireShopUser, requireWritableSubscription, requireGameTopup];

  app.get('/api/game-topup/settings', ...read, async (req, res) => {
    try {
      await ensureGameTopupSchema();
      const [wallet, products, accounts] = await Promise.all([
        getWallet(prisma, req.auth.shopId),
        loadActiveCatalog(),
        prisma.moneyAccount.findMany({ where: { shopId: req.auth.shopId, active: true }, select: { id: true, name: true, type: true, balance: true }, orderBy: [{ type: 'asc' }, { name: 'asc' }] }),
      ]);
      const showCost = canSeeCost(req.auth);
      res.json({
        ok: true,
        configured: moogold.isConfigured(),
        wallet: { balance: round(wallet.balance) },
        products: products.map((product) => ({
          ...product,
          variations: product.variations.map((variation) => (showCost ? variation : { id: variation.id, name: variation.name, suggestedRetail: variation.suggestedRetail })),
        })),
        accounts,
      });
    } catch (error) {
      res.status(error.status || 500).json({ ok: false, message: error.message || 'Game Top-up settings load failed' });
    }
  });

  app.get('/api/game-topup/orders', ...read, async (req, res) => {
    try {
      await ensureGameTopupSchema();
      const page = Math.max(1, Number(req.query.page || 1));
      const limit = Math.min(50, Math.max(1, Number(req.query.limit || 20)));
      const offset = (page - 1) * limit;
      const [rows, totalRows] = await Promise.all([
        prisma.$queryRawUnsafe(
          `SELECT o.id, o.order_number AS "orderNumber", o.quantity, o.player_id AS "playerId", o.server_id AS "serverId",
                  o.customer_name AS "customerName", o.customer_phone AS "customerPhone", o.shop_cost AS "shopCost",
                  o.retail_price AS "retailPrice", o.profit, o.status, o.moogold_order_id AS "moogoldOrderId",
                  o.failure_reason AS "failureReason", o.created_at AS "createdAt",
                  p.name AS "productName", v.name AS "variationName"
             FROM game_topup_orders o
             JOIN game_topup_variations v ON v.id = o.variation_id
             JOIN game_topup_products p ON p.id = v.product_id
            WHERE o.shop_id = $1::uuid
            ORDER BY o.created_at DESC
            LIMIT $2 OFFSET $3`,
          req.auth.shopId, limit, offset,
        ),
        prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS count FROM game_topup_orders WHERE shop_id = $1::uuid`, req.auth.shopId),
      ]);
      const total = number(totalRows[0]?.count);
      res.json({ ok: true, orders: rows.map(orderRow), total, totalPages: Math.max(1, Math.ceil(total / limit)), page });
    } catch (error) {
      res.status(error.status || 500).json({ ok: false, message: error.message || 'Order history load failed' });
    }
  });

  app.post('/api/game-topup/orders', ...write, async (req, res) => {
    try {
      await ensureGameTopupSchema();
      const input = parse(orderSchema, req.body || {});
      const variation = await loadVariationWithProduct(input.variationId);
      if (!variation || !variation.variationActive || !variation.productActive) throw new ApiError(404, 'Product variation not found or inactive');
      if (variation.requiresPlayerId && !input.playerId) throw new ApiError(400, 'Player ID ထည့်ပါ');
      if (variation.requiresServer && !input.server) throw new ApiError(400, 'Server ရွေးပါ');

      const quantity = input.quantity;
      const shopCost = round(number(variation.shopCost) * quantity);
      const retailPrice = round(input.retailPrice ?? number(variation.suggestedRetail) * quantity);

      const wallet = await getWallet(prisma, req.auth.shopId);
      if (number(wallet.balance) < shopCost) {
        throw new ApiError(409, `Wallet balance မလုံလောက်ပါ — လက်ကျန် ${round(wallet.balance)}, လိုအပ်ချက် ${shopCost}`);
      }

      const orderId = crypto.randomUUID();
      const orderNumber = await generateOrderNumber(req.auth.shopId);

      // The external call happens outside any DB transaction — an HTTP round
      // trip has no business holding a Postgres lock open.
      let moogoldResult;
      try {
        moogoldResult = await moogold.createOrder({
          category: variation.moogoldCategoryId,
          // MooGold's create_order takes the specific package being bought, which
          // is the variation's WooCommerce post id, not the parent product id —
          // confirm against a real order once MOOGOLD_PARTNER_ID/SECRET are set.
          productId: variation.moogoldVariationId,
          quantity,
          playerId: input.playerId,
          server: input.server,
          partnerOrderId: orderNumber,
        });
      } catch (error) {
        await prisma.$executeRawUnsafe(
          `INSERT INTO game_topup_orders(id, order_number, shop_id, variation_id, quantity, player_id, server_id, customer_name, customer_phone, shop_cost, retail_price, profit, payment_account_id, status, failure_reason, created_by_id, created_at, updated_at)
           VALUES($1::uuid,$2,$3::uuid,$4::uuid,$5,$6,$7,$8,$9,$10,$11,$12,$13::uuid,'FAILED',$14,$15::uuid,NOW(),NOW())`,
          orderId, orderNumber, req.auth.shopId, variation.id, quantity, clean(input.playerId, 80), clean(input.server, 80),
          clean(input.customerName), clean(input.customerPhone, 40), shopCost, retailPrice, round(retailPrice - shopCost),
          input.paymentAccountId || null, clean(error.message, 500), req.auth.userId,
        ).catch(() => {});
        throw new ApiError(502, error.message || 'MooGold order failed', { code: error.code });
      }

      const result = await prisma.$transaction(async (tx) => {
        const lockedWallet = await lockWalletForUpdate(tx, req.auth.shopId);
        const closing = number(lockedWallet.balance) - shopCost;
        if (closing < -0.005) throw new ApiError(409, 'Wallet balance changed and is no longer enough — MooGold order was already placed, contact the platform admin');
        await tx.$executeRawUnsafe(`UPDATE game_topup_wallets SET balance = $2, updated_at = NOW() WHERE shop_id = $1::uuid`, req.auth.shopId, closing);
        const ledgerId = crypto.randomUUID();
        await tx.$executeRawUnsafe(
          `INSERT INTO game_topup_wallet_ledger(id, shop_id, type, amount, balance_after, note, reference_id, created_by_id, created_at)
           VALUES($1::uuid,$2::uuid,'ORDER_DEBIT',$3,$4,$5,$6::uuid,$7::uuid,NOW())`,
          ledgerId, req.auth.shopId, -shopCost, closing, `${variation.productName} · ${variation.variationName} × ${quantity}`, orderId, req.auth.userId,
        );
        const account = await applyPaymentAccountChange(tx, req.auth.shopId, input.paymentAccountId, retailPrice);
        const accountDetails = moogoldResult?.account_details || {};
        await tx.$executeRawUnsafe(
          `INSERT INTO game_topup_orders(id, order_number, shop_id, variation_id, quantity, player_id, server_id, customer_name, customer_phone, shop_cost, retail_price, profit, payment_account_id, status, moogold_order_id, moogold_response, created_by_id, created_at, updated_at)
           VALUES($1::uuid,$2,$3::uuid,$4::uuid,$5,$6,$7,$8,$9,$10,$11,$12,$13::uuid,'COMPLETED',$14,$15::jsonb,$16::uuid,NOW(),NOW())`,
          orderId, orderNumber, req.auth.shopId, variation.id, quantity, clean(input.playerId, 80), clean(input.server, 80),
          clean(input.customerName), clean(input.customerPhone, 40), shopCost, retailPrice, round(retailPrice - shopCost),
          input.paymentAccountId || null, accountDetails.order_id ? String(accountDetails.order_id) : null, JSON.stringify(moogoldResult || {}), req.auth.userId,
        );
        return { walletBalance: closing, account };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5000, timeout: 15000 });

      await audit(req, 'GAME_TOPUP_ORDER_COMPLETED', orderId, { orderNumber, shopCost, retailPrice, quantity });
      res.status(201).json({
        ok: true,
        message: 'Order ပြီးပါပြီ',
        order: { id: orderId, orderNumber, status: 'COMPLETED', shopCost, retailPrice, profit: round(retailPrice - shopCost), moogold: moogoldResult },
        walletBalance: round(result.walletBalance),
      });
    } catch (error) {
      res.status(error.status || 500).json({ ok: false, message: error.message || 'Game Top-up order failed', details: error.details });
    }
  });

  app.get('/api/game-topup/orders/:id', ...read, async (req, res) => {
    try {
      await ensureGameTopupSchema();
      const rows = await prisma.$queryRawUnsafe(
        `SELECT o.id, o.order_number AS "orderNumber", o.quantity, o.player_id AS "playerId", o.server_id AS "serverId",
                o.customer_name AS "customerName", o.customer_phone AS "customerPhone", o.shop_cost AS "shopCost",
                o.retail_price AS "retailPrice", o.profit, o.status, o.moogold_order_id AS "moogoldOrderId",
                o.moogold_response AS "moogoldResponse", o.failure_reason AS "failureReason", o.created_at AS "createdAt",
                p.name AS "productName", v.name AS "variationName"
           FROM game_topup_orders o
           JOIN game_topup_variations v ON v.id = o.variation_id
           JOIN game_topup_products p ON p.id = v.product_id
          WHERE o.id = $1::uuid AND o.shop_id = $2::uuid`,
        req.params.id, req.auth.shopId,
      );
      if (!rows[0]) return res.status(404).json({ ok: false, message: 'Order not found' });
      res.json({ ok: true, order: { ...orderRow(rows[0]), moogoldResponse: rows[0].moogoldResponse } });
    } catch (error) {
      res.status(error.status || 500).json({ ok: false, message: error.message || 'Order load failed' });
    }
  });
}

module.exports = { attachGameTopupApi };
