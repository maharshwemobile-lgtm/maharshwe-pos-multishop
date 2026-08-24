// Game Top-up — public consumer storefront API (no auth).
//
// A stranger on the internet can reach every route in this file, so: never
// return wholesale cost, never trust a client-supplied price, cap quantity
// low, and never let payment status be self-declared — every order starts
// PENDING_APPROVAL and a human has to look at it (see game-topup-telegram.js)
// before MooGold is ever called.
const crypto = require('crypto');
const { z } = require('zod');
const { prisma } = require('./prisma');
const { ensureGameTopupSchema } = require('./game-topup-schema');
const { notifyAdminsForApproval, isConfigured: telegramConfigured } = require('./game-topup-telegram');
const moogold = require('./moogold-client');
const { landingUrl } = require('./public-urls');

class ApiError extends Error {
  constructor(status, message, details) { super(message); this.status = status; this.details = details; }
}
function parse(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) throw new ApiError(400, 'Invalid request', result.error.flatten().fieldErrors);
  return result.data;
}
const number = (value) => Number(value || 0);
const round = (value) => Math.round((number(value) + Number.EPSILON) * 100) / 100;
const clean = (value, max = 200) => String(value ?? '').trim().slice(0, max) || null;

// The share key is never stored in the clear — only its hash, so reading the
// DB never hands out a working status-check link. Same shape as the repair
// portal's share key.
function hmac(value) {
  const secret = String(process.env.JWT_SECRET || 'change-this-secret');
  return crypto.createHmac('sha256', secret).update(`public-game-topup:${value}`).digest('hex');
}

async function loadPublicCatalog() {
  const products = await prisma.$queryRawUnsafe(
    `SELECT id, name, image_url AS "imageUrl", requires_player_id AS "requiresPlayerId", requires_server AS "requiresServer"
       FROM game_topup_products WHERE active = TRUE ORDER BY sort_order ASC, name ASC`,
  );
  if (!products.length) return [];
  const variations = await prisma.$queryRawUnsafe(
    `SELECT id, product_id AS "productId", name, suggested_retail AS "suggestedRetail"
       FROM game_topup_variations WHERE active = TRUE AND product_id = ANY($1::uuid[]) ORDER BY suggested_retail ASC`,
    products.map((product) => product.id),
  );
  const byProduct = new Map();
  variations.forEach((variation) => {
    const list = byProduct.get(variation.productId) || [];
    list.push({ id: variation.id, name: variation.name, retailPrice: round(variation.suggestedRetail) });
    byProduct.set(variation.productId, list);
  });
  return products
    .map((product) => ({ ...product, variations: byProduct.get(product.id) || [] }))
    .filter((product) => product.variations.length > 0);
}

async function loadVariationForPublicOrder(variationId) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT v.id, v.name AS "variationName", v.suggested_retail AS "suggestedRetail", v.active AS "variationActive",
            p.id AS "productId", p.name AS "productName", p.requires_player_id AS "requiresPlayerId",
            p.requires_server AS "requiresServer", p.active AS "productActive",
            p.moogold_product_id AS "moogoldProductId",
            p.player_field AS "playerField", p.server_field AS "serverField"
       FROM game_topup_variations v JOIN game_topup_products p ON p.id = v.product_id
      WHERE v.id = $1::uuid`,
    variationId,
  );
  return rows[0] || null;
}

async function generatePublicOrderNumber() {
  const count = await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS count FROM game_topup_public_orders`);
  return `PT${String(number(count[0]?.count) + 1).padStart(5, '0')}`;
}

const orderSchema = z.object({
  variationId: z.string().uuid(),
  quantity: z.coerce.number().int().min(1).max(10).default(1),
  playerId: z.string().trim().max(80).optional().nullable(),
  server: z.string().trim().max(80).optional().nullable(),
  customerName: z.string().trim().max(120).optional().nullable(),
  customerPhone: z.string().trim().min(7).max(20),
  // KBZ Pay users quote the last 4 digits of the transaction, not the full
  // reference. That is only a lookup hint for the admin checking the real KBZ
  // Pay history — it is never treated as proof on its own.
  paymentTransactionId: z.string().trim().regex(/^\d{4,20}$/, 'Transaction ID must be 4-20 digits'),
});

function orderRow(row) {
  return {
    orderNumber: row.orderNumber,
    status: row.status,
    customerName: row.customerName,
    productName: row.productName,
    variationName: row.variationName,
    quantity: row.quantity,
    playerId: row.playerId,
    serverId: row.serverId,
    retailPrice: round(row.retailPrice),
    rejectReason: row.rejectReason,
    failureReason: row.failureReason,
    moogoldResponse: row.status === 'COMPLETED' ? row.moogoldResponse : undefined,
    createdAt: row.createdAt,
    reviewedAt: row.reviewedAt,
  };
}

function attachGameTopupPublicApi(app) {
  const validateHits = new Map();
  function validateAllowed(ip) {
    const now = Date.now();
    const window = 60 * 1000;
    const hits = (validateHits.get(ip) || []).filter((at) => now - at < window);
    if (hits.length >= 10) return false;
    hits.push(now);
    validateHits.set(ip, hits);
    if (validateHits.size > 5000) validateHits.clear();
    return true;
  }

  const validateSchema = z.object({
    variationId: z.string().uuid(),
    playerId: z.string().trim().min(1).max(80),
    server: z.string().trim().max(80).optional().nullable(),
  });

  // Confirms the account before the customer pays, so they can see whose account
  // the top-up is going to. A mistyped id is otherwise unrecoverable.
  app.post('/api/public/game-topup/validate', async (req, res) => {
    try {
      await ensureGameTopupSchema();
      const ip = String(req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim();
      if (!validateAllowed(ip)) throw new ApiError(429, 'ခဏစောင့်ပြီး ပြန်ကြိုးစားပါ');

      const input = parse(validateSchema, req.body || {});
      const variation = await loadVariationForPublicOrder(input.variationId);
      if (!variation || !variation.variationActive || !variation.productActive) throw new ApiError(404, 'Product not found');
      if (variation.requiresServer && !input.server) throw new ApiError(400, 'Server ထည့်ပါ');
      if (!moogold.isConfigured()) throw new ApiError(503, 'Validation is unavailable right now');

      const result = await moogold.validateAccount({
        productId: variation.moogoldProductId,
        playerId: input.playerId,
        server: input.server,
        playerField: variation.playerField,
        serverField: variation.serverField,
      });

      res.json({
        ok: true,
        valid: result.valid,
        username: result.username,
        country: result.country,
        message: result.valid ? null : (result.message || 'Account not found'),
      });
    } catch (error) {
      res.status(error.status || 500).json({ ok: false, message: error.message || 'Validation failed' });
    }
  });

  app.get('/api/public/game-topup/catalog', async (_req, res) => {
    try {
      await ensureGameTopupSchema();
      res.json({ ok: true, products: await loadPublicCatalog() });
    } catch (error) {
      res.status(error.status || 500).json({ ok: false, message: error.message || 'Catalog load failed' });
    }
  });

  app.get('/api/public/game-topup/payment-info', async (_req, res) => {
    const name = clean(process.env.GAME_TOPUP_KBZ_PAY_NAME, 120);
    const phone = clean(process.env.GAME_TOPUP_KBZ_PAY_PHONE, 40);
    const qrUrl = clean(process.env.GAME_TOPUP_KBZ_PAY_QR_URL, 500);
    res.json({
      ok: true,
      configured: Boolean(name && phone),
      moogoldConfigured: moogold.isConfigured(),
      telegramConfigured: telegramConfigured(),
      payment: { method: 'KBZ_PAY', name, phone, qrUrl },
    });
  });

  app.post('/api/public/game-topup/orders', async (req, res) => {
    try {
      await ensureGameTopupSchema();
      const input = parse(orderSchema, req.body || {});
      const variation = await loadVariationForPublicOrder(input.variationId);
      if (!variation || !variation.variationActive || !variation.productActive) throw new ApiError(404, 'Product not found or inactive');
      if (variation.requiresPlayerId && !input.playerId) throw new ApiError(400, 'Player ID ထည့်ပါ');
      if (variation.requiresServer && !input.server) throw new ApiError(400, 'Server ထည့်ပါ');

      const duplicate = await prisma.$queryRawUnsafe(
        `SELECT COUNT(*)::int AS count FROM game_topup_public_orders WHERE payment_transaction_id = $1`,
        input.paymentTransactionId,
      );
      const duplicateWarning = number(duplicate[0]?.count) > 0;

      const retailPrice = round(number(variation.suggestedRetail) * input.quantity);
      const orderId = crypto.randomUUID();
      const orderNumber = await generatePublicOrderNumber();
      const shareKey = crypto.randomBytes(24).toString('base64url');

      await prisma.$executeRawUnsafe(
        `INSERT INTO game_topup_public_orders(id, order_number, variation_id, quantity, player_id, server_id, customer_name, customer_phone, retail_price, payment_method, payment_transaction_id, status, share_key_hash, created_at, updated_at)
         VALUES($1::uuid,$2,$3::uuid,$4,$5,$6,$7,$8,$9,'KBZ_PAY',$10,'PENDING_APPROVAL',$11,NOW(),NOW())`,
        orderId, orderNumber, variation.id, input.quantity, clean(input.playerId, 80), clean(input.server, 80),
        clean(input.customerName), clean(input.customerPhone, 40), retailPrice, clean(input.paymentTransactionId, 100), hmac(shareKey),
      );

      notifyAdminsForApproval({
        id: orderId,
        orderNumber,
        productName: variation.productName,
        variationName: variation.variationName,
        quantity: input.quantity,
        retailPrice,
        playerId: input.playerId,
        serverId: input.server,
        customerName: input.customerName,
        customerPhone: input.customerPhone,
        paymentMethod: 'KBZ Pay',
        paymentTransactionId: input.paymentTransactionId,
        duplicateWarning,
      }).catch(() => {});

      // The customer bought this on the Digital Products storefront, which
      // lives on the landing domain — send them back there to check on it
      // rather than across to the shop-facing app subdomain.
      const statusUrl = `${landingUrl()}/digital/?view=status&order=${encodeURIComponent(orderNumber)}&key=${encodeURIComponent(shareKey)}`;
      res.status(201).json({
        ok: true,
        message: 'အော်ဒါ တင်ပြီးပါပြီ — အတည်ပြုပြီးရင် ချက်ချင်း ရောက်ပါမယ်',
        orderNumber,
        statusUrl,
      });
    } catch (error) {
      res.status(error.status || 500).json({ ok: false, message: error.message || 'Order failed', details: error.details });
    }
  });

  app.get('/api/public/game-topup/orders/status', async (req, res) => {
    try {
      await ensureGameTopupSchema();
      const orderNumber = clean(req.query.order, 40);
      const shareKey = clean(req.query.key, 200);
      if (!orderNumber || !shareKey) throw new ApiError(400, 'Missing order or key');

      const rows = await prisma.$queryRawUnsafe(
        `SELECT o.order_number AS "orderNumber", o.status, o.quantity, o.player_id AS "playerId", o.server_id AS "serverId",
                o.customer_name AS "customerName",
                o.retail_price AS "retailPrice", o.reject_reason AS "rejectReason", o.failure_reason AS "failureReason",
                o.moogold_response AS "moogoldResponse", o.created_at AS "createdAt", o.reviewed_at AS "reviewedAt",
                p.name AS "productName", v.name AS "variationName"
           FROM game_topup_public_orders o
           JOIN game_topup_variations v ON v.id = o.variation_id
           JOIN game_topup_products p ON p.id = v.product_id
          WHERE o.order_number = $1 AND o.share_key_hash = $2`,
        orderNumber, hmac(shareKey),
      );
      if (!rows[0]) return res.status(404).json({ ok: false, message: 'Order not found' });
      res.json({ ok: true, order: orderRow(rows[0]) });
    } catch (error) {
      res.status(error.status || 500).json({ ok: false, message: error.message || 'Status lookup failed' });
    }
  });
}

module.exports = { attachGameTopupPublicApi };
