// Game Top-up — Grand Admin (platform) API.
//
// Mounted under /api/grand-admin/game-topup/*, which api-connected-pr23-v2.js
// already gates with `app.use('/api/grand-admin', requireAuth, requireGrandAdmin)`
// before this file is required — no route here repeats that check, matching
// every other grand-admin-*-api.js file.
//
// Two jobs live here: keep the shared catalog in sync with what MooGold
// actually sells, and manage each shop's prepaid wallet — crediting it is a
// manual step because the shop pays the Super Admin off-platform (KBZ Pay),
// the same way the VPN reseller flow works.
const crypto = require('crypto');
const { z } = require('zod');
const { Prisma } = require('@prisma/client');
const { prisma } = require('./prisma');
const { ensureGameTopupSchema } = require('./game-topup-schema');
const moogold = require('./moogold-client');
const gtTelegram = require('./game-topup-telegram');

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
const clean = (value, max = 300) => String(value ?? '').trim().slice(0, max) || null;

// MooGold prices every package in USD; the platform sells in MMK. This rate
// converts one to the other and lives in the database (game_topup_settings)
// rather than an env var, so a Grand Admin can change it without a deploy —
// exactly the knob the exchange rate needs, since USD/MMK does not sit still.
async function getUsdToMmkRate() {
  const rows = await prisma.$queryRawUnsafe(`SELECT usd_to_mmk_rate AS rate FROM game_topup_settings WHERE id = TRUE`);
  return number(rows[0]?.rate) || 4500;
}

// MooGold's product_detail lists the extra fields a purchase needs as free
// text (e.g. "Server", "Zone ID") rather than a fixed enum, so this is a
// best-effort read — admins can still flip requiresServer by hand afterward.
function packageName(raw, fallback) {
  const name = String(raw || '').trim();
  if (!name) return String(fallback);
  return name.replace(/\s*\(#\d+\)\s*$/, '').trim() || String(fallback);
}

function fieldNames(fields) {
  const names = (fields || []).map((entry) => String(entry?.field || entry || '').trim()).filter(Boolean);
  // MooGold labels these per game: "User ID" + "Server ID" for Mobile Legends,
  // "Zone ID" elsewhere, and some games ask for no server at all.
  const server = names.find((name) => /server|zone/i.test(name)) || null;
  const player = names.find((name) => name !== server) || 'User ID';
  return { player, server };
}

async function upsertProductFromMoogold(categoryId, productId, fallbackName) {
  let detail = null;
  try {
    detail = await moogold.productDetail(productId);
  } catch {
    // Some products 404 on product_detail even though list_product returned
    // them (delisted mid-sync); keep the row with just the name so admin can
    // see it exists, rather than losing the whole sync over one bad product.
  }

  const name = detail?.Product_Name || fallbackName || productId;
  const imageUrl = detail?.Image_URL || null;
  const { player: playerField, server: serverField } = fieldNames(detail?.fields);
  const requiresServer = Boolean(serverField);

  const existing = await prisma.$queryRawUnsafe(
    `SELECT id FROM game_topup_products WHERE moogold_product_id = $1`, productId,
  );
  const productDbId = existing[0]?.id || crypto.randomUUID();

  await prisma.$executeRawUnsafe(
    `INSERT INTO game_topup_products(id, moogold_product_id, moogold_category_id, name, image_url, requires_player_id, requires_server, player_field, server_field, created_at, updated_at)
     VALUES($1::uuid, $2, $3, $4, $5, TRUE, $6, $7, $8, NOW(), NOW())
     ON CONFLICT (moogold_product_id) DO UPDATE SET
       moogold_category_id = EXCLUDED.moogold_category_id,
       name = EXCLUDED.name,
       image_url = COALESCE(EXCLUDED.image_url, game_topup_products.image_url),
       requires_server = EXCLUDED.requires_server,
       player_field = EXCLUDED.player_field,
       server_field = EXCLUDED.server_field,
       updated_at = NOW()`,
    productDbId, productId, categoryId, name, imageUrl, requiresServer, playerField, serverField || 'Server ID',
  );

  // MooGold prices in USD; a brand-new package's cost/retail default to the
  // converted MMK amount rather than the raw USD number, or a $0.24 package
  // would default to a 0.24 Ks price.
  const rate = await getUsdToMmkRate();

  let variationsAdded = 0;
  let variationsUpdated = 0;
  for (const variation of detail?.Variation || []) {
    const variationId = String(variation.variation_id);
    const price = number(variation.variation_price);
    const already = await prisma.$queryRawUnsafe(
      `SELECT id FROM game_topup_variations WHERE product_id = $1::uuid AND moogold_variation_id = $2`,
      productDbId, variationId,
    );
    if (already[0]) {
      // Only the live MooGold price refreshes automatically — shop_cost and
      // suggested_retail are the admin's own pricing decision and must not
      // be silently overwritten by a resync.
      await prisma.$executeRawUnsafe(
        `UPDATE game_topup_variations SET name = $3, moogold_price = $4, updated_at = NOW() WHERE id = $1::uuid AND product_id = $2::uuid`,
        already[0].id, productDbId, packageName(variation.variation_name, variationId), price,
      );
      variationsUpdated += 1;
    } else {
      // No margin guess beyond "same as MooGold's converted price" — a 0%
      // margin is a visible, obviously-wrong default that forces the admin to
      // set a real one, instead of a made-up percentage quietly under-pricing
      // sales.
      const mmk = round(price * rate);
      await prisma.$executeRawUnsafe(
        `INSERT INTO game_topup_variations(id, product_id, moogold_variation_id, name, moogold_price, shop_cost, suggested_retail, created_at, updated_at)
         VALUES($1::uuid, $2::uuid, $3, $4, $5, $6, $6, NOW(), NOW())`,
        crypto.randomUUID(), productDbId, variationId, packageName(variation.variation_name, variationId), price, mmk,
      );
      variationsAdded += 1;
    }
  }
  return { added: !existing[0], variationsAdded, variationsUpdated };
}

const syncCategorySchema = z.object({ categoryId: z.string().trim().min(1).max(80) });
const syncProductSchema = z.object({ productId: z.string().trim().min(1).max(80), categoryId: z.string().trim().min(1).max(80).optional() });
const productPatchSchema = z.object({
  active: z.boolean().optional(),
  requiresPlayerId: z.boolean().optional(),
  requiresServer: z.boolean().optional(),
  sortOrder: z.coerce.number().int().optional(),
  name: z.string().trim().min(1).max(200).optional(),
});
const variationPatchSchema = z.object({
  active: z.boolean().optional(),
  shopCost: z.coerce.number().min(0).optional(),
  suggestedRetail: z.coerce.number().min(0).optional(),
  name: z.string().trim().min(1).max(200).optional(),
});
const walletAdjustSchema = z.object({
  amount: z.coerce.number().refine((value) => Math.abs(value) > 0.005, 'Amount must not be zero'),
  note: z.string().trim().min(3).max(300),
});
const settingsPatchSchema = z.object({
  usdToMmkRate: z.coerce.number().min(1).max(100000),
});

function attachGameTopupAdminApi(app) {
  // The USD/MMK rate used to price a newly-synced package. Changing it only
  // affects packages synced after the change — same rule as shop_cost and
  // suggested_retail generally: once a price exists, only the admin edits it.
  app.get('/api/grand-admin/game-topup/settings', async (_req, res) => {
    try {
      await ensureGameTopupSchema();
      res.json({ ok: true, usdToMmkRate: await getUsdToMmkRate() });
    } catch (error) {
      res.status(error.status || 500).json({ ok: false, message: error.message || 'Settings load failed' });
    }
  });

  app.patch('/api/grand-admin/game-topup/settings', async (req, res) => {
    try {
      await ensureGameTopupSchema();
      const input = parse(settingsPatchSchema, req.body || {});
      await prisma.$executeRawUnsafe(
        `UPDATE game_topup_settings SET usd_to_mmk_rate = $1, updated_at = NOW() WHERE id = TRUE`,
        input.usdToMmkRate,
      );
      res.json({ ok: true, usdToMmkRate: input.usdToMmkRate });
    } catch (error) {
      res.status(error.status || 500).json({ ok: false, message: error.message || 'Settings update failed' });
    }
  });

  app.get('/api/grand-admin/game-topup/moogold-balance', async (_req, res) => {
    try {
      await ensureGameTopupSchema();
      if (!moogold.isConfigured()) return res.json({ ok: true, configured: false });
      const result = await moogold.balance();
      res.json({ ok: true, configured: true, currency: result.currency, balance: number(result.balance) });
    } catch (error) {
      res.status(error.status || 500).json({ ok: false, message: error.message || 'MooGold balance check failed' });
    }
  });

  // Sales count per product, combined across the shop-facing and the public
  // storefront order tables. This is what "top" means: real completed sales,
  // not a manually-set flag — a product nobody has ever sold sorts to the
  // bottom, and one the shop is actually moving rises to the top on its own.
  const SALES_COUNT_SQL = `(
    SELECT COUNT(*) FROM game_topup_orders o JOIN game_topup_variations v ON v.id = o.variation_id
     WHERE v.product_id = p.id AND o.status = 'COMPLETED'
  ) + (
    SELECT COUNT(*) FROM game_topup_public_orders o JOIN game_topup_variations v ON v.id = o.variation_id
     WHERE v.product_id = p.id AND o.status = 'COMPLETED'
  )`;

  // A catalog this size (500+ games, thousands of packages) is too heavy to
  // hand over in one response, so this is paged and searchable rather than
  // returning everything — the admin finds a product by name instead of
  // scrolling past hundreds it does not need right now.
  const catalogQuerySchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(50).default(5),
    search: z.string().trim().max(120).optional().default(''),
  });

  app.get('/api/grand-admin/game-topup/catalog', async (req, res) => {
    try {
      await ensureGameTopupSchema();
      const input = parse(catalogQuerySchema, req.query || {});
      const search = `%${input.search}%`;
      const where = input.search
        ? `WHERE p.name ILIKE $1 OR p.moogold_product_id = $2`
        : '';
      const searchArgs = input.search ? [search, input.search] : [];

      const totalRows = await prisma.$queryRawUnsafe(
        `SELECT COUNT(*)::int AS n FROM game_topup_products p ${where}`,
        ...searchArgs,
      );
      const total = totalRows[0]?.n || 0;

      const offset = (input.page - 1) * input.pageSize;
      const products = await prisma.$queryRawUnsafe(
        `SELECT p.id, p.moogold_category_id AS "moogoldCategoryId", p.moogold_product_id AS "moogoldProductId", p.name,
                p.image_url AS "imageUrl", p.requires_player_id AS "requiresPlayerId", p.requires_server AS "requiresServer",
                p.active, p.sort_order AS "sortOrder", p.updated_at AS "updatedAt",
                (${SALES_COUNT_SQL})::int AS "salesCount"
           FROM game_topup_products p ${where}
          ORDER BY "salesCount" DESC, p.sort_order ASC, p.name ASC
          LIMIT $${searchArgs.length + 1} OFFSET $${searchArgs.length + 2}`,
        ...searchArgs, input.pageSize, offset,
      );

      const variations = products.length
        ? await prisma.$queryRawUnsafe(
            `SELECT id, product_id AS "productId", moogold_variation_id AS "moogoldVariationId", name,
                    moogold_price AS "moogoldPrice", shop_cost AS "shopCost", suggested_retail AS "suggestedRetail",
                    active, updated_at AS "updatedAt"
               FROM game_topup_variations WHERE product_id = ANY($1::uuid[]) ORDER BY shop_cost ASC`,
            products.map((product) => product.id),
          )
        : [];
      const byProduct = new Map();
      variations.forEach((variation) => {
        const list = byProduct.get(variation.productId) || [];
        list.push({ ...variation, moogoldPrice: round(variation.moogoldPrice), shopCost: round(variation.shopCost), suggestedRetail: round(variation.suggestedRetail) });
        byProduct.set(variation.productId, list);
      });
      res.json({
        ok: true,
        configured: moogold.isConfigured(),
        page: input.page,
        pageSize: input.pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / input.pageSize)),
        products: products.map((product) => ({ ...product, variations: byProduct.get(product.id) || [] })),
      });
    } catch (error) {
      res.status(error.status || 500).json({ ok: false, message: error.message || 'Catalog load failed' });
    }
  });

  app.post('/api/grand-admin/game-topup/sync-category', async (req, res) => {
    try {
      await ensureGameTopupSchema();
      if (!moogold.isConfigured()) throw new ApiError(409, 'MOOGOLD_PARTNER_ID / MOOGOLD_SECRET are not set on the server yet');
      const input = parse(syncCategorySchema, req.body || {});
      const products = await moogold.listProduct(input.categoryId);
      if (!Array.isArray(products) || !products.length) {
        return res.json({ ok: true, summary: { productsSeen: 0, productsAdded: 0, variationsAdded: 0, variationsUpdated: 0 } });
      }
      let productsAdded = 0, variationsAdded = 0, variationsUpdated = 0;
      for (const product of products) {
        const result = await upsertProductFromMoogold(input.categoryId, String(product.ID), product.post_title);
        if (result.added) productsAdded += 1;
        variationsAdded += result.variationsAdded;
        variationsUpdated += result.variationsUpdated;
      }
      res.json({ ok: true, summary: { productsSeen: products.length, productsAdded, variationsAdded, variationsUpdated } });
    } catch (error) {
      res.status(error.status || 500).json({ ok: false, message: error.message || 'Category sync failed' });
    }
  });

  app.post('/api/grand-admin/game-topup/sync-product', async (req, res) => {
    try {
      await ensureGameTopupSchema();
      if (!moogold.isConfigured()) throw new ApiError(409, 'MOOGOLD_PARTNER_ID / MOOGOLD_SECRET are not set on the server yet');
      const input = parse(syncProductSchema, req.body || {});
      let categoryId = input.categoryId;
      if (!categoryId) {
        const existing = await prisma.$queryRawUnsafe(`SELECT moogold_category_id AS "categoryId" FROM game_topup_products WHERE moogold_product_id = $1`, input.productId);
        categoryId = existing[0]?.categoryId;
        if (!categoryId) throw new ApiError(400, 'categoryId is required the first time a product is added');
      }
      const result = await upsertProductFromMoogold(categoryId, input.productId, null);
      res.json({ ok: true, ...result });
    } catch (error) {
      res.status(error.status || 500).json({ ok: false, message: error.message || 'Product sync failed' });
    }
  });

  app.patch('/api/grand-admin/game-topup/products/:id', async (req, res) => {
    try {
      await ensureGameTopupSchema();
      const input = parse(productPatchSchema, req.body || {});
      const fields = [];
      const values = [req.params.id];
      let index = 2;
      if (input.active !== undefined) { fields.push(`active = $${index++}`); values.push(input.active); }
      if (input.requiresPlayerId !== undefined) { fields.push(`requires_player_id = $${index++}`); values.push(input.requiresPlayerId); }
      if (input.requiresServer !== undefined) { fields.push(`requires_server = $${index++}`); values.push(input.requiresServer); }
      if (input.sortOrder !== undefined) { fields.push(`sort_order = $${index++}`); values.push(input.sortOrder); }
      if (input.name !== undefined) { fields.push(`name = $${index++}`); values.push(clean(input.name, 200)); }
      if (!fields.length) return res.json({ ok: true, message: 'Nothing to update' });
      fields.push('updated_at = NOW()');
      await prisma.$executeRawUnsafe(`UPDATE game_topup_products SET ${fields.join(', ')} WHERE id = $1::uuid`, ...values);
      res.json({ ok: true, message: 'Product updated' });
    } catch (error) {
      res.status(error.status || 500).json({ ok: false, message: error.message || 'Product update failed' });
    }
  });

  app.patch('/api/grand-admin/game-topup/variations/:id', async (req, res) => {
    try {
      await ensureGameTopupSchema();
      const input = parse(variationPatchSchema, req.body || {});
      const fields = [];
      const values = [req.params.id];
      let index = 2;
      if (input.active !== undefined) { fields.push(`active = $${index++}`); values.push(input.active); }
      if (input.shopCost !== undefined) { fields.push(`shop_cost = $${index++}`); values.push(input.shopCost); }
      if (input.suggestedRetail !== undefined) { fields.push(`suggested_retail = $${index++}`); values.push(input.suggestedRetail); }
      if (input.name !== undefined) { fields.push(`name = $${index++}`); values.push(clean(input.name, 200)); }
      if (!fields.length) return res.json({ ok: true, message: 'Nothing to update' });
      fields.push('updated_at = NOW()');
      await prisma.$executeRawUnsafe(`UPDATE game_topup_variations SET ${fields.join(', ')} WHERE id = $1::uuid`, ...values);
      res.json({ ok: true, message: 'Variation updated' });
    } catch (error) {
      res.status(error.status || 500).json({ ok: false, message: error.message || 'Variation update failed' });
    }
  });

  app.get('/api/grand-admin/game-topup/wallets', async (req, res) => {
    try {
      await ensureGameTopupSchema();
      const search = clean(req.query.q, 120);
      const rows = await prisma.$queryRawUnsafe(
        `SELECT s.id AS "shopId", s.name AS "shopName", s.slug, COALESCE(w.balance, 0) AS balance, w.updated_at AS "updatedAt"
           FROM shops s LEFT JOIN game_topup_wallets w ON w.shop_id = s.id
          WHERE s.active = TRUE ${search ? 'AND (s.name ILIKE $1 OR s.slug ILIKE $1)' : ''}
          ORDER BY s.name ASC
          LIMIT 200`,
        ...(search ? [`%${search}%`] : []),
      );
      res.json({ ok: true, wallets: rows.map((row) => ({ ...row, balance: round(row.balance) })) });
    } catch (error) {
      res.status(error.status || 500).json({ ok: false, message: error.message || 'Wallet list failed' });
    }
  });

  app.get('/api/grand-admin/game-topup/wallets/:shopId/ledger', async (req, res) => {
    try {
      await ensureGameTopupSchema();
      const rows = await prisma.$queryRawUnsafe(
        `SELECT l.id, l.type, l.amount, l.balance_after AS "balanceAfter", l.note, l.reference_id AS "referenceId",
                l.created_at AS "createdAt", u.name AS "createdByName"
           FROM game_topup_wallet_ledger l LEFT JOIN users u ON u.id = l.created_by_id
          WHERE l.shop_id = $1::uuid ORDER BY l.created_at DESC LIMIT 100`,
        req.params.shopId,
      );
      res.json({ ok: true, ledger: rows.map((row) => ({ ...row, amount: round(row.amount), balanceAfter: round(row.balanceAfter) })) });
    } catch (error) {
      res.status(error.status || 500).json({ ok: false, message: error.message || 'Ledger load failed' });
    }
  });

  app.post('/api/grand-admin/game-topup/wallets/:shopId/adjust', async (req, res) => {
    try {
      await ensureGameTopupSchema();
      const input = parse(walletAdjustSchema, req.body || {});
      const shop = await prisma.shop.findUnique({ where: { id: req.params.shopId }, select: { id: true, name: true } });
      if (!shop) throw new ApiError(404, 'Shop not found');

      const result = await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`INSERT INTO game_topup_wallets(shop_id, balance, updated_at) VALUES($1::uuid, 0, NOW()) ON CONFLICT (shop_id) DO NOTHING`, shop.id);
        const rows = await tx.$queryRawUnsafe(`SELECT balance FROM game_topup_wallets WHERE shop_id = $1::uuid FOR UPDATE`, shop.id);
        const closing = round(number(rows[0].balance) + input.amount);
        if (closing < -0.005) throw new ApiError(409, 'This adjustment would make the wallet negative');
        await tx.$executeRawUnsafe(`UPDATE game_topup_wallets SET balance = $2, updated_at = NOW() WHERE shop_id = $1::uuid`, shop.id, closing);
        const ledgerId = crypto.randomUUID();
        await tx.$executeRawUnsafe(
          `INSERT INTO game_topup_wallet_ledger(id, shop_id, type, amount, balance_after, note, created_by_id, created_at)
           VALUES($1::uuid,$2::uuid,'ADJUSTMENT',$3,$4,$5,$6::uuid,NOW())`,
          ledgerId, shop.id, input.amount, closing, clean(input.note, 300), req.auth.userId,
        );
        return closing;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5000, timeout: 10000 });

      await prisma.auditLog.create({
        data: { shopId: null, userId: req.auth.userId, action: 'GAME_TOPUP_WALLET_ADJUSTED', entityType: 'game_topup_wallet', entityId: shop.id, details: { shopName: shop.name, amount: input.amount, note: input.note, balanceAfter: result }, ipAddress: req.ip || null, userAgent: req.headers['user-agent'] || null },
      }).catch(() => {});

      res.json({ ok: true, message: `${shop.name} wallet ${input.amount > 0 ? 'credited' : 'debited'}`, balance: result });
    } catch (error) {
      res.status(error.status || 500).json({ ok: false, message: error.message || 'Wallet adjustment failed' });
    }
  });

  app.get('/api/grand-admin/game-topup/orders', async (req, res) => {
    try {
      await ensureGameTopupSchema();
      const limit = Math.min(100, Math.max(1, Number(req.query.limit || 40)));
      const rows = await prisma.$queryRawUnsafe(
        `SELECT o.id, o.order_number AS "orderNumber", o.status, o.quantity, o.shop_cost AS "shopCost",
                o.retail_price AS "retailPrice", o.profit, o.failure_reason AS "failureReason", o.created_at AS "createdAt",
                s.name AS "shopName", p.name AS "productName", v.name AS "variationName"
           FROM game_topup_orders o
           JOIN shops s ON s.id = o.shop_id
           JOIN game_topup_variations v ON v.id = o.variation_id
           JOIN game_topup_products p ON p.id = v.product_id
          ORDER BY o.created_at DESC LIMIT $1`,
        limit,
      );
      res.json({ ok: true, orders: rows.map((row) => ({ ...row, shopCost: round(row.shopCost), retailPrice: round(row.retailPrice), profit: round(row.profit) })) });
    } catch (error) {
      res.status(error.status || 500).json({ ok: false, message: error.message || 'Order feed failed' });
    }
  });

  // Public storefront orders. Telegram is the fast path for approving these,
  // but it needs a bot token and a chat id that may not be set up — so the
  // same approve/reject calls are exposed here, on the portal the admin is
  // already logged into.
  app.get('/api/grand-admin/game-topup/public-orders', async (req, res) => {
    try {
      await ensureGameTopupSchema();
      const status = clean(req.query.status, 40);
      const limit = Math.min(100, Math.max(1, Number(req.query.limit || 40)));
      const rows = await prisma.$queryRawUnsafe(
        `SELECT o.id, o.order_number AS "orderNumber", o.status, o.quantity, o.player_id AS "playerId",
                o.server_id AS "serverId", o.customer_name AS "customerName", o.customer_phone AS "customerPhone",
                o.retail_price AS "retailPrice", o.payment_transaction_id AS "paymentTransactionId",
                o.reject_reason AS "rejectReason", o.failure_reason AS "failureReason",
                o.moogold_order_id AS "moogoldOrderId", o.created_at AS "createdAt", o.reviewed_at AS "reviewedAt",
                o.refund_sent_at AS "refundSentAt",
                p.name AS "productName", v.name AS "variationName",
                (SELECT COUNT(*)::int FROM game_topup_public_orders d WHERE d.payment_transaction_id = o.payment_transaction_id) AS "sameTxnCount"
           FROM game_topup_public_orders o
           JOIN game_topup_variations v ON v.id = o.variation_id
           JOIN game_topup_products p ON p.id = v.product_id
          ${status ? 'WHERE o.status = $2' : ''}
          ORDER BY o.created_at DESC LIMIT $1`,
        ...(status ? [limit, status] : [limit]),
      );
      res.json({
        ok: true,
        telegramConfigured: gtTelegram.isConfigured(),
        orders: rows.map((row) => ({ ...row, retailPrice: round(row.retailPrice) })),
      });
    } catch (error) {
      res.status(error.status || 500).json({ ok: false, message: error.message || 'Public order feed failed' });
    }
  });

  app.post('/api/grand-admin/game-topup/public-orders/:id/approve', async (req, res) => {
    try {
      const order = await gtTelegram.approvePublicOrder(req.params.id, req.auth.userId);
      await prisma.auditLog.create({
        data: { shopId: null, userId: req.auth.userId, action: 'GAME_TOPUP_PUBLIC_ORDER_APPROVED', entityType: 'game_topup_public_order', entityId: req.params.id, details: { orderNumber: order.orderNumber, retailPrice: number(order.retailPrice) }, ipAddress: req.ip || null, userAgent: req.headers['user-agent'] || null },
      }).catch(() => {});
      res.json({ ok: true, message: `${order.orderNumber} approved and delivered`, order });
    } catch (error) {
      res.status(error.status || 500).json({ ok: false, message: error.message || 'Approve failed' });
    }
  });

  app.post('/api/grand-admin/game-topup/public-orders/:id/reject', async (req, res) => {
    try {
      const reason = clean(req.body?.reason, 300) || 'Payment not verified';
      const order = await gtTelegram.rejectPublicOrder(req.params.id, req.auth.userId, reason);
      await prisma.auditLog.create({
        data: { shopId: null, userId: req.auth.userId, action: 'GAME_TOPUP_PUBLIC_ORDER_REJECTED', entityType: 'game_topup_public_order', entityId: req.params.id, details: { orderNumber: order.orderNumber, reason }, ipAddress: req.ip || null, userAgent: req.headers['user-agent'] || null },
      }).catch(() => {});
      res.json({ ok: true, message: `${order.orderNumber} rejected`, order });
    } catch (error) {
      res.status(error.status || 500).json({ ok: false, message: error.message || 'Reject failed' });
    }
  });

  // Records that a human actually sent the KBZ Pay refund for a REFUNDED
  // order — the money movement itself happens outside this system, so this
  // is only the confirmation that it was done, not a payment action.
  app.post('/api/grand-admin/game-topup/public-orders/:id/refund-sent', async (req, res) => {
    try {
      await ensureGameTopupSchema();
      const rows = await prisma.$queryRawUnsafe(
        `SELECT id, order_number AS "orderNumber", status, refund_sent_at AS "refundSentAt" FROM game_topup_public_orders WHERE id = $1::uuid`,
        req.params.id,
      );
      const order = rows[0];
      if (!order) throw new ApiError(404, 'Order not found');
      if (order.status !== 'REFUNDED') throw new ApiError(409, 'ဒီ Order က REFUNDED မဟုတ်ပါ');
      if (order.refundSentAt) throw new ApiError(409, 'ပြန်ပေးပြီးသား Order ပါ');
      await prisma.$executeRawUnsafe(
        `UPDATE game_topup_public_orders SET refund_sent_at = NOW(), refund_sent_by_id = $2::uuid WHERE id = $1::uuid`,
        order.id, req.auth.userId,
      );
      await prisma.auditLog.create({
        data: { shopId: null, userId: req.auth.userId, action: 'GAME_TOPUP_PUBLIC_ORDER_REFUND_SENT', entityType: 'game_topup_public_order', entityId: order.id, details: { orderNumber: order.orderNumber }, ipAddress: req.ip || null, userAgent: req.headers['user-agent'] || null },
      }).catch(() => {});
      res.json({ ok: true, message: `${order.orderNumber} ငွေပြန်ပေးပြီးကြောင်း မှတ်တမ်းတင်ပြီးပါပြီ` });
    } catch (error) {
      res.status(error.status || 500).json({ ok: false, message: error.message || 'Update failed' });
    }
  });

  app.post('/api/grand-admin/game-topup/telegram/set-webhook', async (_req, res) => {
    try {
      const result = await gtTelegram.setGameTopupWebhook();
      res.json({ ok: true, message: 'Telegram webhook registered', ...result });
    } catch (error) {
      res.status(error.status || 500).json({ ok: false, message: error.message || 'setWebhook failed' });
    }
  });
}

module.exports = { attachGameTopupAdminApi };
