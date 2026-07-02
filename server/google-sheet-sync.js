const crypto = require('crypto');
const { prisma } = require('./prisma');
const { requireAuth, requireShopUser } = require('./auth-api');

const DATASETS = {
  remittances: { tab: 'Remittances' },
  'sale-history': { tab: 'Sale History' },
  'other-income': { tab: 'Other Income' },
  'service-income': { tab: 'Service Income' },
  expense: { tab: 'Expense' },
  stock: { tab: 'STOCK' },
  'user-audit': { tab: 'User audit' },
};

const SERVICE_PREFIX = '__SERVICE_INCOME__:';
let schemaPromise;
let runner;

function clean(value, max = 500) {
  return String(value ?? '').trim().slice(0, max);
}

function safeSecretEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
}

function sanitize(value, depth = 0) {
  if (depth > 5) return '[truncated]';
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => sanitize(item, depth + 1));
  if (typeof value !== 'object') return typeof value === 'string' ? value.slice(0, 2000) : value;
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    if (/password|passwordhash|token|authorization|secret/i.test(key)) continue;
    result[key] = sanitize(item, depth + 1);
  }
  return result;
}

async function ensureGoogleSheetSyncSchema() {
  if (!schemaPromise) {
    schemaPromise = prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS google_sheet_sync_outbox (
        id UUID PRIMARY KEY,
        shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
        dataset TEXT NOT NULL,
        action TEXT NOT NULL,
        entity_id TEXT,
        payload JSONB NOT NULL DEFAULT '{}'::jsonb,
        status TEXT NOT NULL DEFAULT 'PENDING',
        attempts INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        sent_at TIMESTAMPTZ
      )`);
      await tx.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS google_sheet_sync_outbox_pending_idx ON google_sheet_sync_outbox(status,created_at)');
      await tx.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS google_sheet_sync_outbox_shop_dataset_idx ON google_sheet_sync_outbox(shop_id,dataset,created_at DESC)');
      return true;
    }, { maxWait: 5000, timeout: 20000 }).catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  return schemaPromise;
}

async function queueGoogleSheetSync({ shopId, dataset, action, entityId, payload }) {
  if (!shopId || !DATASETS[dataset]) return null;
  await ensureGoogleSheetSyncSchema();
  const id = crypto.randomUUID();
  await prisma.$executeRawUnsafe(
    `INSERT INTO google_sheet_sync_outbox(id,shop_id,dataset,action,entity_id,payload,status,created_at)
     VALUES($1::uuid,$2::uuid,$3,$4,$5,$6::jsonb,'PENDING',NOW())`,
    id,
    shopId,
    dataset,
    clean(action, 60) || 'UPSERT',
    entityId ? clean(entityId, 120) : null,
    JSON.stringify(sanitize(payload || {})),
  );
  deliverPendingGoogleSheetSync(10).catch((error) => console.warn('Immediate Google Sheet sync failed:', error.message));
  return id;
}

async function deliverOutboxRow(row) {
  const webhookUrl = clean(process.env.GOOGLE_SHEET_WEB_APP_URL, 2000);
  const secret = clean(process.env.GOOGLE_SHEET_SYNC_SECRET, 500);
  if (!webhookUrl || !secret || typeof fetch !== 'function') return false;

  const shopRows = await prisma.$queryRawUnsafe('SELECT slug,name FROM shops WHERE id=$1::uuid LIMIT 1', row.shopId);
  const shop = shopRows[0] || {};
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        secret,
        eventId: row.id,
        dataset: row.dataset,
        tab: DATASETS[row.dataset]?.tab || row.dataset,
        action: row.action,
        entityId: row.entityId,
        shopSlug: shop.slug || '',
        shopName: shop.name || '',
        createdAt: row.createdAt,
        payload: row.payload || {},
      }),
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`Sheet webhook ${response.status}: ${text.slice(0, 300)}`);
    await prisma.$executeRawUnsafe(
      `UPDATE google_sheet_sync_outbox SET status='SENT',attempts=attempts+1,last_error=NULL,sent_at=NOW() WHERE id=$1::uuid`,
      row.id,
    );
    return true;
  } catch (error) {
    await prisma.$executeRawUnsafe(
      `UPDATE google_sheet_sync_outbox SET status='FAILED',attempts=attempts+1,last_error=$2 WHERE id=$1::uuid`,
      row.id,
      clean(error.message, 1000),
    ).catch(() => {});
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

async function deliverPendingGoogleSheetSync(limit = 25) {
  await ensureGoogleSheetSyncSchema();
  if (!process.env.GOOGLE_SHEET_WEB_APP_URL || !process.env.GOOGLE_SHEET_SYNC_SECRET) return { sent: 0, configured: false };
  const rows = await prisma.$queryRawUnsafe(
    `SELECT id,shop_id AS "shopId",dataset,action,entity_id AS "entityId",payload,created_at AS "createdAt"
       FROM google_sheet_sync_outbox
      WHERE status IN ('PENDING','FAILED') AND attempts < 20
      ORDER BY created_at ASC
      LIMIT $1`,
    Math.min(100, Math.max(1, Number(limit || 25))),
  );
  let sent = 0;
  for (const row of rows) if (await deliverOutboxRow(row)) sent += 1;
  return { sent, configured: true, checked: rows.length };
}

function startGoogleSheetSyncRunner() {
  if (runner) return runner;
  runner = setInterval(() => {
    deliverPendingGoogleSheetSync(25).catch((error) => console.warn('Google Sheet sync runner:', error.message));
  }, 30000);
  runner.unref?.();
  return runner;
}

function captureDataset(req) {
  const method = String(req.method || '').toUpperCase();
  const path = String(req.path || req.originalUrl || '');
  if (!['POST', 'PATCH', 'PUT', 'DELETE'].includes(method)) return null;
  if (path.startsWith('/api/remittances')) return null;
  if (path.startsWith('/api/business-control/expenses')) return 'expense';
  if (path.startsWith('/api/business-control/other-income')) {
    const category = String(req.body?.category || '').toUpperCase();
    const source = String(req.body?.source || '');
    return category === 'SERVICE_INCOME' || source.startsWith(SERVICE_PREFIX) ? 'service-income' : 'other-income';
  }
  if (path.startsWith('/api/stock/movements')) return 'stock';
  if (path.startsWith('/api/sales') || path.startsWith('/api/pos/sales')) return 'sale-history';
  if (path.startsWith('/api/users') || path.startsWith('/api/project-settings')) return 'user-audit';
  return null;
}

function attachGoogleSheetSyncCapture(app) {
  app.use((req, res, next) => {
    const dataset = captureDataset(req);
    if (!dataset) return next();
    const originalJson = res.json.bind(res);
    res.json = (body) => {
      if (res.statusCode >= 200 && res.statusCode < 300 && req.auth?.shopId) {
        const entityId = body?.id || body?.sale?.id || body?.user?.id || body?.movement?.id || null;
        queueGoogleSheetSync({
          shopId: req.auth.shopId,
          dataset,
          action: `${req.method} ${req.path}`,
          entityId,
          payload: { request: sanitize(req.body || {}), response: sanitize(body || {}) },
        }).catch((error) => console.warn('Google Sheet capture failed:', error.message));
      }
      return originalJson(body);
    };
    next();
  });
}

function requireSheetSecret(req, res, next) {
  const expected = process.env.GOOGLE_SHEET_SYNC_SECRET;
  const supplied = req.headers['x-google-sheet-secret'] || req.query.key || req.body?.secret;
  if (!expected) return res.status(503).json({ ok: false, message: 'GOOGLE_SHEET_SYNC_SECRET is not configured' });
  if (!safeSecretEqual(supplied, expected)) return res.status(401).json({ ok: false, message: 'Invalid Google Sheet sync secret' });
  next();
}

function datasetKey(value) {
  const key = clean(value, 80).toLowerCase().replaceAll('_', '-').replaceAll(' ', '-');
  if (!DATASETS[key]) throw Object.assign(new Error('Unsupported dataset'), { status: 400 });
  return key;
}

function sinceDate(value) {
  if (!value) return new Date('2000-01-01T00:00:00.000Z');
  const result = new Date(value);
  if (Number.isNaN(result.getTime())) throw Object.assign(new Error('Invalid since date'), { status: 400 });
  return result;
}

async function exportDataset(shopId, dataset, since, limit) {
  const take = Math.min(10000, Math.max(1, Number(limit || 5000)));
  if (dataset === 'remittances') {
    return prisma.$queryRawUnsafe(
      `SELECT t.id,t.transaction_number AS "transactionNumber",t.created_at AS "createdAt",t.type,
              t.service_channel AS channel,t.sender_name AS "senderName",t.sender_phone AS "senderPhone",
              t.receiver_name AS "receiverName",t.receiver_phone AS "receiverPhone",
              t.counterparty_name AS "counterpartyName",t.counterparty_phone AS "counterpartyPhone",
              t.customer_amount AS amount,t.fee_rate AS "feeRate",t.fee_amount AS fee,
              t.customer_pays_amount AS "customerPays",t.customer_receives_amount AS "customerReceives",
              t.service_profit AS profit,t.reference,t.note,u.name AS "staffName",u.username AS "staffUsername"
         FROM money_service_transactions t
         LEFT JOIN users u ON u.id=t.user_id
        WHERE t.shop_id=$1::uuid AND t.type IN ('KPAY_TRANSFER','KPAY_CASH_OUT','WAVE_PAY_TRANSFER','WAVE_PAY_CASH_OUT')
          AND t.created_at >= $2
        ORDER BY t.created_at ASC LIMIT $3`,
      shopId, since, take,
    );
  }
  if (dataset === 'sale-history') {
    return prisma.$queryRawUnsafe(
      `SELECT s.id,s.invoice_number AS "invoiceNumber",s.sold_at AS "soldAt",s.status,
              COALESCE(c.name,'Walk-in Customer') AS "customerName",c.phone AS "customerPhone",
              s.subtotal,s.discount,s.total,s.cost_total AS "costTotal",s.profit_total AS "profitTotal",
              s.payment_status AS "paymentStatus",u.name AS "staffName",u.username AS "staffUsername",
              COALESCE(STRING_AGG(si.product_name_snapshot || COALESCE(' · '||si.variant_name_snapshot,'' ) || ' x' || si.quantity, '; ' ORDER BY si.created_at),'') AS items
         FROM sales s
         LEFT JOIN customers c ON c.id=s.customer_id
         LEFT JOIN users u ON u.id=s.user_id
         LEFT JOIN sale_items si ON si.sale_id=s.id
        WHERE s.shop_id=$1::uuid AND s.updated_at >= $2
        GROUP BY s.id,c.name,c.phone,u.name,u.username
        ORDER BY s.sold_at ASC LIMIT $3`,
      shopId, since, take,
    );
  }
  if (dataset === 'other-income' || dataset === 'service-income') {
    const service = dataset === 'service-income';
    return prisma.$queryRawUnsafe(
      `SELECT i.id,i.income_date AS "businessDate",CASE WHEN i.source LIKE $3 THEN SUBSTRING(i.source FROM $4) ELSE i.source END AS source,
              i.amount,i.method,i.note,i.created_at AS "createdAt",a.name AS "accountName",u.name AS "createdBy"
         FROM business_other_income i
         LEFT JOIN money_accounts a ON a.id=i.money_account_id
         LEFT JOIN users u ON u.id=i.created_by_id
        WHERE i.shop_id=$1::uuid AND i.created_at >= $2
          AND ${service ? 'i.source LIKE $3' : 'i.source NOT LIKE $3'}
        ORDER BY i.created_at ASC LIMIT $5`,
      shopId, since, `${SERVICE_PREFIX}%`, SERVICE_PREFIX.length + 1, take,
    );
  }
  if (dataset === 'expense') {
    return prisma.$queryRawUnsafe(
      `SELECT e.id,e.expense_date AS "businessDate",e.category,e.amount,e.method,e.note,
              e.created_at AS "createdAt",a.name AS "accountName",u.name AS "createdBy"
         FROM business_expenses e
         LEFT JOIN money_accounts a ON a.id=e.money_account_id
         LEFT JOIN users u ON u.id=e.created_by_id
        WHERE e.shop_id=$1::uuid AND e.created_at >= $2
        ORDER BY e.created_at ASC LIMIT $3`,
      shopId, since, take,
    );
  }
  if (dataset === 'stock') {
    return prisma.$queryRawUnsafe(
      `SELECT pv.id,p.name AS "productName",pv.variant_name AS "variantName",pv.sku,pv.barcode,
              c.name AS category,ib.quantity,ib.min_alert_quantity AS "minAlertQuantity",
              pv.cost_price AS "costPrice",pv.standard_selling_price AS "sellingPrice",ib.updated_at AS "updatedAt"
         FROM product_variants pv
         JOIN products p ON p.id=pv.product_id
         LEFT JOIN categories c ON c.id=COALESCE(pv.category_id,p.category_id)
         LEFT JOIN inventory_balances ib ON ib.product_variant_id=pv.id
        WHERE pv.shop_id=$1::uuid AND GREATEST(pv.updated_at,COALESCE(ib.updated_at,pv.updated_at)) >= $2
        ORDER BY GREATEST(pv.updated_at,COALESCE(ib.updated_at,pv.updated_at)) ASC LIMIT $3`,
      shopId, since, take,
    );
  }
  return prisma.$queryRawUnsafe(
    `SELECT a.id,a.created_at AS "createdAt",a.action,a.entity_type AS "entityType",a.entity_id AS "entityId",
            a.details,a.ip_address AS "ipAddress",u.name AS "userName",u.username
       FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id
      WHERE a.shop_id=$1::uuid AND a.created_at >= $2
      ORDER BY a.created_at ASC LIMIT $3`,
    shopId, since, take,
  );
}

async function resolveSyncShop(slug) {
  const value = clean(slug, 120);
  if (!value) throw Object.assign(new Error('shopSlug is required'), { status: 400 });
  const shop = await prisma.shop.findUnique({ where: { slug: value }, select: { id: true, slug: true, name: true } });
  if (!shop) throw Object.assign(new Error('Shop not found'), { status: 404 });
  return shop;
}

function attachGoogleSheetSyncApi(app) {
  const admin = [requireAuth, requireShopUser];

  app.get('/api/google-sheet-sync/status', ...admin, async (req, res) => {
    try {
      await ensureGoogleSheetSyncSchema();
      const rows = await prisma.$queryRawUnsafe(
        `SELECT status,COUNT(*)::int AS count FROM google_sheet_sync_outbox WHERE shop_id=$1::uuid GROUP BY status`,
        req.auth.shopId,
      );
      return res.json({
        ok: true,
        configured: Boolean(process.env.GOOGLE_SHEET_WEB_APP_URL && process.env.GOOGLE_SHEET_SYNC_SECRET),
        datasets: Object.entries(DATASETS).map(([key, value]) => ({ key, tab: value.tab })),
        counts: Object.fromEntries(rows.map((row) => [row.status, Number(row.count || 0)])),
      });
    } catch (error) {
      return res.status(500).json({ ok: false, message: error.message || 'Sync status failed' });
    }
  });

  app.post('/api/google-sheet-sync/retry', ...admin, async (_req, res) => {
    try {
      return res.json({ ok: true, ...(await deliverPendingGoogleSheetSync(100)) });
    } catch (error) {
      return res.status(500).json({ ok: false, message: error.message || 'Sync retry failed' });
    }
  });

  app.get('/api/google-sheet-sync/export/:dataset', requireSheetSecret, async (req, res) => {
    try {
      const dataset = datasetKey(req.params.dataset);
      const shop = await resolveSyncShop(req.query.shopSlug);
      const since = sinceDate(req.query.since);
      const rows = await exportDataset(shop.id, dataset, since, req.query.limit);
      return res.json({ ok: true, dataset, tab: DATASETS[dataset].tab, shop, rows, count: rows.length });
    } catch (error) {
      return res.status(error.status || 500).json({ ok: false, message: error.message || 'Dataset export failed' });
    }
  });

  app.post('/api/google-sheet-sync/export', requireSheetSecret, async (req, res) => {
    try {
      const dataset = datasetKey(req.body?.dataset);
      const shop = await resolveSyncShop(req.body?.shopSlug);
      const since = sinceDate(req.body?.since);
      const rows = await exportDataset(shop.id, dataset, since, req.body?.limit);
      return res.json({ ok: true, dataset, tab: DATASETS[dataset].tab, shop, rows, count: rows.length });
    } catch (error) {
      return res.status(error.status || 500).json({ ok: false, message: error.message || 'Dataset export failed' });
    }
  });
}

module.exports = {
  DATASETS,
  attachGoogleSheetSyncApi,
  attachGoogleSheetSyncCapture,
  deliverPendingGoogleSheetSync,
  ensureGoogleSheetSyncSchema,
  queueGoogleSheetSync,
  startGoogleSheetSyncRunner,
};
