const crypto = require('crypto');
const { prisma } = require('./prisma');
const { requireAuth, requireShopUser, requireWritableSubscription } = require('./auth-api');

const DEFAULT_EVENTS = ['repair', 'sale', 'income-expense', 'product-stock', 'money-service', 'debt'];
const DATASETS = {
  repair: { tab: 'Repair' },
  sale: { tab: 'Sale' },
  'income-expense': { tab: 'IncomeExpense' },
  'product-stock': { tab: 'ProductStock' },
  'money-service': { tab: 'MoneyService' },
  debt: { tab: 'Debt' },
  test: { tab: 'Test' },
};

let schemaPromise;
let runner;

function clean(value, max = 2000) {
  return String(value ?? '').trim().slice(0, max);
}

function safeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function sanitize(value, depth = 0) {
  if (depth > 5) return '[truncated]';
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => sanitize(item, depth + 1));
  if (typeof value !== 'object') return typeof value === 'string' ? value.slice(0, 2000) : value;
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (/password|passwordhash|token|authorization|secret/i.test(key)) continue;
    out[key] = sanitize(item, depth + 1);
  }
  return out;
}

function isValidWebhookUrl(value) {
  const url = clean(value, 2000);
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && ['script.google.com', 'script.googleusercontent.com'].includes(parsed.hostname);
  } catch (_error) {
    return false;
  }
}

function platformFromSettings(settings) {
  return safeObject(safeObject(settings).platform);
}

function googleSheetFromSettings(settings) {
  const root = safeObject(settings);
  const integrations = safeObject(root.integrations);
  const current = safeObject(integrations.googleSheet);
  return {
    enabled: current.enabled === true,
    webhookUrl: clean(current.webhookUrl, 2000),
    events: Array.isArray(current.events) && current.events.length ? current.events.map((item) => clean(item, 80)).filter(Boolean) : DEFAULT_EVENTS,
    lastTestAt: current.lastTestAt || null,
    lastTestStatus: current.lastTestStatus || 'NOT_TESTED',
    lastTestMessage: current.lastTestMessage || '',
    updatedAt: current.updatedAt || null,
    updatedBy: current.updatedBy || null,
  };
}

function isShopBlocked(shop) {
  if (!shop || shop.active === false) return true;
  const settings = shop.settings?.settings || shop.settings || {};
  const platform = platformFromSettings(settings);
  const status = String(platform.tenantPortalStatus || platform.shopStatus || '').toUpperCase();
  return ['SUSPENDED', 'DELETED', 'CANCELLED'].includes(status) || Boolean(platform.deletedAt);
}

function datasetEnabled(config, dataset) {
  if (!config.enabled || !config.webhookUrl) return false;
  if (!config.events?.length) return true;
  const tab = DATASETS[dataset]?.tab || dataset;
  return config.events.includes(dataset) || config.events.includes(tab) || config.events.includes(String(tab).toLowerCase());
}

async function ensureSchema() {
  if (!schemaPromise) {
    schemaPromise = prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS tenant_google_sheet_outbox (
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
      await tx.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS tenant_google_sheet_outbox_pending_idx ON tenant_google_sheet_outbox(status,created_at)');
      await tx.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS tenant_google_sheet_outbox_shop_idx ON tenant_google_sheet_outbox(shop_id,dataset,created_at DESC)');
      return true;
    }).catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  return schemaPromise;
}

async function readShop(shopId) {
  return prisma.shop.findUnique({ where: { id: shopId }, include: { settings: true } });
}

async function readActiveIntegration(shopId, dataset) {
  const shop = await readShop(shopId);
  if (isShopBlocked(shop)) return null;
  const config = googleSheetFromSettings(shop.settings?.settings);
  if (!datasetEnabled(config, dataset)) return null;
  return { shop, config };
}

async function saveIntegration(shopId, input, userId) {
  const row = await prisma.shopSettings.upsert({ where: { shopId }, update: {}, create: { shopId } });
  const settings = safeObject(row.settings);
  const integrations = safeObject(settings.integrations);
  const previous = googleSheetFromSettings(settings);
  const webhookUrl = input.webhookUrl !== undefined ? clean(input.webhookUrl, 2000) : previous.webhookUrl;
  if (webhookUrl && !isValidWebhookUrl(webhookUrl)) {
    const error = new Error('Google Apps Script Web App URL /exec link ထည့်ပါ');
    error.status = 400;
    throw error;
  }
  const events = Array.isArray(input.events) && input.events.length ? input.events.map((item) => clean(item, 80)).filter(Boolean) : previous.events;
  const next = {
    ...previous,
    enabled: input.enabled !== undefined ? input.enabled === true : Boolean(webhookUrl),
    webhookUrl,
    events,
    updatedAt: new Date().toISOString(),
    updatedBy: userId || null,
  };
  await prisma.shopSettings.update({
    where: { shopId },
    data: { settings: { ...settings, integrations: { ...integrations, googleSheet: next } } },
  });
  return next;
}

async function testWebhook(shop, webhookUrl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        eventType: 'test.connection',
        dataset: 'test',
        tab: 'Test',
        action: 'TEST_CONNECTION',
        syncId: `test-${Date.now()}`,
        eventId: `test-${Date.now()}`,
        tenantId: shop.code || shop.slug || shop.id,
        shopId: shop.id,
        shopSlug: shop.slug || '',
        shopName: shop.name || '',
        createdAt: new Date().toISOString(),
        data: { message: 'Mahar POS Google Sheet connection test' },
        payload: { message: 'Mahar POS Google Sheet connection test' },
      }),
    });
    const text = await response.text();
    if (!response.ok) return { ok: false, status: response.status, message: text.slice(0, 500) };
    let parsed = null;
    try { parsed = JSON.parse(text); } catch (_error) {}
    return { ok: true, status: response.status, message: parsed?.message || text.slice(0, 500) || 'CONNECTED' };
  } catch (error) {
    return { ok: false, status: 0, message: error.message || 'TEST_FAILED' };
  } finally {
    clearTimeout(timer);
  }
}


function toPlainNumber(value) {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'object' && typeof value.toNumber === 'function') return Number(value.toNumber()) || 0;
  if (typeof value === 'object' && typeof value.toString === 'function') return Number(value.toString()) || 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function formatSaleItemsForSheet(items) {
  return (Array.isArray(items) ? items : [])
    .map((item) => {
      const name = [item.productNameSnapshot, item.variantNameSnapshot]
        .filter(Boolean)
        .join(' - ');
      const qty = Number(item.quantity || 0);
      const price = toPlainNumber(item.actualSoldPrice);
      return `${name || 'Item'} x${qty}${price ? ` @${price}` : ''}`;
    })
    .join('; ');
}

async function enrichSalePayloadForSheet(shopId, entityId, payload) {
  if (!shopId || !entityId) return payload || {};

  const sale = await prisma.sale.findFirst({
    where: { id: entityId, shopId },
    include: {
      customer: true,
      user: { select: { username: true, name: true } },
      items: true,
      payments: true,
    },
  }).catch(() => null);

  if (!sale) return payload || {};

  const response = safeObject(payload?.response);
  const existingSale = safeObject(response.sale);
  const items = Array.isArray(sale.items) ? sale.items : [];
  const payments = Array.isArray(sale.payments) ? sale.payments : [];
  const paidAmount = payments.reduce((sum, row) => sum + toPlainNumber(row.amount), 0);
  const total = toPlainNumber(sale.total ?? existingSale.total ?? existingSale.amount);
  const quantity = items.reduce((sum, row) => sum + Number(row.quantity || 0), 0);

  const enrichedSale = {
    ...existingSale,
    id: sale.id,
    invoiceNumber: sale.invoiceNumber || existingSale.invoiceNumber || existingSale.invoice || '',
    customerName: sale.customer?.name || existingSale.customerName || existingSale.customer || 'Walk-in Customer',
    customer: sale.customer?.name || existingSale.customer || 'Walk-in Customer',
    customerPhone: sale.customer?.phone || existingSale.customerPhone || '',
    items: formatSaleItemsForSheet(items) || existingSale.items || '',
    quantity,
    total,
    amount: total,
    paidAmount,
    balance: total - paidAmount,
    profitTotal: toPlainNumber(sale.profitTotal),
    paymentMethod: existingSale.paymentMethod || payments[0]?.method || '',
    paymentStatus: sale.paymentStatus || existingSale.paymentStatus || '',
    status: sale.status || existingSale.status || '',
    staffName: sale.user?.name || sale.user?.username || existingSale.staffName || '',
    staffUsername: sale.user?.username || existingSale.staffUsername || '',
  };

  return {
    ...(payload || {}),
    response: {
      ...response,
      sale: enrichedSale,
    },
  };
}


async function enrichRepairPayloadForSheet(shopId, entityId, payload) {
  if (!shopId || !entityId) return payload || {};

  const repair = await prisma.repair.findFirst({
    where: { id: entityId, shopId },
    include: {
      technician: { select: { username: true, name: true } },
    },
  }).catch(() => null);

  if (!repair) return payload || {};

  const response = safeObject(payload?.response);
  const existingRepair = safeObject(response.repair);

  const repairCost = toPlainNumber(repair.finalCost ?? existingRepair.cost ?? existingRepair.repairCost);
  const customerPrice = toPlainNumber(repair.estimatedCost ?? existingRepair.customerPrice ?? existingRepair.price);
  const deposit = toPlainNumber(repair.deposit ?? existingRepair.deposit);
  const repairProfit = customerPrice > 0 ? customerPrice - repairCost : 0;
  const phoneModel = [repair.deviceBrand, repair.deviceModel].filter(Boolean).join(' ') || existingRepair.phoneModel || existingRepair.model || '';
  const deliveryStatus = repair.deliveredAt || repair.status === 'DELIVERED' ? 'ယူပြီး' : 'မယူရသေး';

  const enrichedRepair = {
    ...existingRepair,
    id: repair.id,

    voucherNo: repair.repairNumber || existingRepair.voucherNo || '',
    repairNo: repair.repairNumber || existingRepair.repairNo || '',
    repairNumber: repair.repairNumber || existingRepair.repairNumber || '',

    customerName: repair.customerName || existingRepair.customerName || '',
    customerPhone: repair.customerPhone || existingRepair.customerPhone || '',

    phoneModel,
    model: phoneModel,
    deviceBrand: repair.deviceBrand || '',
    deviceModel: repair.deviceModel || '',

    issue: repair.problem || existingRepair.issue || '',
    repairPart: repair.problem || existingRepair.repairPart || '',
    problem: repair.problem || '',

    status: repair.status || existingRepair.status || '',
    cost: repairCost,
    repairCost,
    estimatedCost: repairCost,
    finalCost: customerPrice,
    customerPrice,
    price: customerPrice,
    deposit,
    balanceDue: Math.max(0, customerPrice - deposit),
    profit: repairProfit,

    technicianName: repair.technician?.name || repair.technician?.username || existingRepair.technicianName || '',
    deliveredAt: repair.deliveredAt || '',
    deliveryStatus,
    paymentStatus: repair.paymentStatus || existingRepair.paymentStatus || '',
    note: repair.notes || existingRepair.note || '',
  };

  return {
    ...(payload || {}),
    response: {
      ...response,
      repair: enrichedRepair,
    },
  };
}


async function enrichPayloadForSheet({ shopId, dataset, entityId, payload }) {
  if (dataset === 'sale') {
    return enrichSalePayloadForSheet(shopId, entityId, payload || {});
  }
  if (dataset === 'repair') {
    return enrichRepairPayloadForSheet(shopId, entityId, payload || {});
  }
  return payload || {};
}

async function queueTenantGoogleSheetSync({ shopId, dataset, action, entityId, payload }) {
  if (!shopId || !DATASETS[dataset]) return null;
  const integration = await readActiveIntegration(shopId, dataset);
  if (!integration) return null;
  payload = await enrichPayloadForSheet({ shopId, dataset, entityId, payload });
  await ensureSchema();
  const id = crypto.randomUUID();
  await prisma.$executeRawUnsafe(
    `INSERT INTO tenant_google_sheet_outbox(id,shop_id,dataset,action,entity_id,payload,status,created_at)
     VALUES($1::uuid,$2::uuid,$3,$4,$5,$6::jsonb,'PENDING',NOW())`,
    id,
    shopId,
    dataset,
    clean(action, 80) || 'UPSERT',
    entityId ? clean(entityId, 120) : null,
    JSON.stringify(sanitize(payload || {})),
  );
  deliverPendingTenantGoogleSheetSync(10).catch((error) => console.warn('Tenant Google Sheet sync failed:', error.message));
  return id;
}

async function deliverOutboxRow(row) {
  const integration = await readActiveIntegration(row.shopId, row.dataset);
  if (!integration || typeof fetch !== 'function') return false;
  const { shop, config } = integration;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(config.webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        eventType: row.dataset,
        dataset: row.dataset,
        tab: DATASETS[row.dataset]?.tab || row.dataset,
        action: row.action,
        syncId: row.id,
        eventId: row.id,
        entityId: row.entityId,
        tenantId: shop.code || shop.slug || shop.id,
        shopId: shop.id,
        shopSlug: shop.slug || '',
        shopName: shop.name || '',
        createdAt: row.createdAt,
        data: row.payload || {},
        payload: row.payload || {},
      }),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`Sheet webhook ${response.status}: ${text.slice(0, 300)}`);
    await prisma.$executeRawUnsafe(
      `UPDATE tenant_google_sheet_outbox SET status='SENT',attempts=attempts+1,last_error=NULL,sent_at=NOW() WHERE id=$1::uuid`,
      row.id,
    );
    return true;
  } catch (error) {
    await prisma.$executeRawUnsafe(
      `UPDATE tenant_google_sheet_outbox SET status='FAILED',attempts=attempts+1,last_error=$2 WHERE id=$1::uuid`,
      row.id,
      clean(error.message, 1000),
    ).catch(() => {});
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function deliverPendingTenantGoogleSheetSync(limit = 25, shopId = null) {
  await ensureSchema();
  const take = Math.min(100, Math.max(1, Number(limit || 25)));
  const rows = shopId
    ? await prisma.$queryRawUnsafe(
      `SELECT id,shop_id AS "shopId",dataset,action,entity_id AS "entityId",payload,created_at AS "createdAt"
         FROM tenant_google_sheet_outbox
        WHERE shop_id=$1::uuid AND status IN ('PENDING','FAILED') AND attempts < 20
        ORDER BY created_at ASC
        LIMIT $2`,
      shopId,
      take,
    )
    : await prisma.$queryRawUnsafe(
      `SELECT id,shop_id AS "shopId",dataset,action,entity_id AS "entityId",payload,created_at AS "createdAt"
         FROM tenant_google_sheet_outbox
        WHERE status IN ('PENDING','FAILED') AND attempts < 20
        ORDER BY created_at ASC
        LIMIT $1`,
      take,
    );

  let sent = 0;
  for (const row of rows) if (await deliverOutboxRow(row)) sent += 1;
  return { ok: true, sent, checked: rows.length };
}

function datasetFromRequest(req) {
  const method = String(req.method || '').toUpperCase();
  const path = String(req.path || req.originalUrl || '').toLowerCase();
  if (!['POST', 'PATCH', 'PUT', 'DELETE'].includes(method)) return null;
  if (path.startsWith('/api/grand-admin') || path.startsWith('/api/google-sheet-sync')) return null;
  if (path.includes('/repair') || path.startsWith('/api/repairs')) return 'repair';
  if (path.startsWith('/api/sales') || path.startsWith('/api/pos/sales')) return 'sale';
  if (path.startsWith('/api/business-control/expenses') || path.startsWith('/api/business-control/other-income')) return 'income-expense';
  if (path.startsWith('/api/stock') || path.startsWith('/api/catalog') || path.startsWith('/api/products') || path.startsWith('/api/product')) return 'product-stock';
  if (path.startsWith('/api/money-service') || path.startsWith('/api/remittances')) return 'money-service';
  if (path.startsWith('/api/customer-credit') || path.includes('/credit') || path.includes('/debt')) return 'debt';
  return null;
}

function attachTenantGoogleSheetWebhookCapture(app) {
  app.use((req, res, next) => {
    const dataset = datasetFromRequest(req);
    if (!dataset) return next();
    const originalJson = res.json.bind(res);
    res.json = (body) => {
      if (res.statusCode >= 200 && res.statusCode < 300 && req.auth?.shopId) {
        const entityId = body?.id || body?.sale?.id || body?.repair?.id || body?.movement?.id || body?.transaction?.id || null;
        queueTenantGoogleSheetSync({
          shopId: req.auth.shopId,
          dataset,
          action: `${req.method} ${req.path}`,
          entityId,
          payload: { request: sanitize(req.body || {}), response: sanitize(body || {}) },
        }).catch((error) => console.warn('Tenant Google Sheet capture failed:', error.message));
      }
      return originalJson(body);
    };
    return next();
  });
}


function requireManager(req, res, next) {
  if (req.auth?.role === 'SUPER_ADMIN' || req.auth?.role === 'SHOP_ADMIN' || req.auth?.permissions?.settings === true) return next();
  return res.status(403).json({ ok: false, message: 'Settings permission is required' });
}

async function tenantGoogleSheetCounts(shopId) {
  await ensureSchema();
  const rows = await prisma.$queryRawUnsafe(
    `SELECT status,COUNT(*)::int AS count
       FROM tenant_google_sheet_outbox
      WHERE shop_id=$1::uuid
      GROUP BY status`,
    shopId,
  );
  return Object.fromEntries(rows.map((row) => [row.status, Number(row.count || 0)]));
}

function publicTenantIntegration(config) {
  return {
    enabled: config.enabled === true,
    webhookUrl: config.webhookUrl || '',
    events: Array.isArray(config.events) && config.events.length ? config.events : DEFAULT_EVENTS,
    lastTestAt: config.lastTestAt || null,
    lastTestStatus: config.lastTestStatus || 'NOT_TESTED',
    lastTestMessage: config.lastTestMessage || '',
    updatedAt: config.updatedAt || null,
  };
}

async function tenantIntegrationPayload(shopId) {
  const shop = await readShop(shopId);
  if (!shop) return null;
  return {
    ok: true,
    shop: { id: shop.id, name: shop.name, code: shop.code, slug: shop.slug },
    integration: publicTenantIntegration(googleSheetFromSettings(shop.settings?.settings)),
    counts: await tenantGoogleSheetCounts(shopId),
    events: DEFAULT_EVENTS,
    tabs: Object.values(DATASETS).map((item) => item.tab),
  };
}

async function persistTenantWebhookTestResult(shopId, webhookUrl, result) {
  const row = await prisma.shopSettings.upsert({ where: { shopId }, update: {}, create: { shopId } });
  const settings = safeObject(row.settings);
  const integrations = safeObject(settings.integrations);
  const current = googleSheetFromSettings(settings);
  const next = {
    ...current,
    webhookUrl: webhookUrl || current.webhookUrl,
    lastTestAt: new Date().toISOString(),
    lastTestStatus: result.ok ? 'CONNECTED' : 'FAILED',
    lastTestMessage: result.message || '',
  };
  await prisma.shopSettings.update({
    where: { shopId },
    data: { settings: { ...settings, integrations: { ...integrations, googleSheet: next } } },
  });
  return next;
}


function attachTenantGoogleSheetIntegrationApi(app) {
  const read = [requireAuth, requireShopUser];
  const write = [requireAuth, requireShopUser, requireWritableSubscription, requireManager];

  app.get('/api/google-sheet-webhook/integration', ...read, async (req, res) => {
    try {
      const payload = await tenantIntegrationPayload(req.auth.shopId);
      if (!payload) return res.status(404).json({ ok: false, message: 'Shop not found' });
      return res.json(payload);
    } catch (error) {
      return res.status(500).json({ ok: false, message: error.message || 'Google Sheet integration load failed' });
    }
  });

  app.put('/api/google-sheet-webhook/integration', ...write, async (req, res) => {
    try {
      const integration = await saveIntegration(req.auth.shopId, {
        enabled: req.body?.enabled === true,
        webhookUrl: req.body?.webhookUrl || '',
        events: Array.isArray(req.body?.events) ? req.body.events : DEFAULT_EVENTS,
      }, req.auth.userId);
      return res.json({
        ok: true,
        integration: publicTenantIntegration(integration),
        counts: await tenantGoogleSheetCounts(req.auth.shopId),
        message: 'Google Sheet webhook integration saved',
      });
    } catch (error) {
      return res.status(error.status || 500).json({ ok: false, message: error.message || 'Google Sheet integration save failed' });
    }
  });

  app.post('/api/google-sheet-webhook/integration/test', ...write, async (req, res) => {
    try {
      const shop = await readShop(req.auth.shopId);
      if (!shop) return res.status(404).json({ ok: false, message: 'Shop not found' });
      const current = googleSheetFromSettings(shop.settings?.settings);
      const webhookUrl = clean(req.body?.webhookUrl || current.webhookUrl, 2000);
      if (!isValidWebhookUrl(webhookUrl)) return res.status(400).json({ ok: false, message: 'Google Apps Script Web App URL /exec link ထည့်ပါ' });
      const result = await testWebhook(shop, webhookUrl);
      const integration = await persistTenantWebhookTestResult(req.auth.shopId, webhookUrl, result);
      return res.status(result.ok ? 200 : 400).json({ ok: result.ok, result, integration: publicTenantIntegration(integration) });
    } catch (error) {
      return res.status(error.status || 500).json({ ok: false, message: error.message || 'Google Sheet test failed' });
    }
  });

  app.post('/api/google-sheet-webhook/integration/retry', ...write, async (req, res) => {
    try {
      return res.json(await deliverPendingTenantGoogleSheetSync(100, req.auth.shopId));
    } catch (error) {
      return res.status(500).json({ ok: false, message: error.message || 'Google Sheet retry failed' });
    }
  });

  app.get('/api/grand-admin/shops/:shopId/google-sheet-integration', async (req, res) => {
    try {
      const shop = await readShop(req.params.shopId);
      if (!shop) return res.status(404).json({ ok: false, message: 'Shop not found' });
      return res.json({ ok: true, shop: { id: shop.id, name: shop.name, code: shop.code, slug: shop.slug }, integration: googleSheetFromSettings(shop.settings?.settings) });
    } catch (error) {
      return res.status(500).json({ ok: false, message: error.message || 'Google Sheet integration read failed' });
    }
  });

  app.patch('/api/grand-admin/shops/:shopId/google-sheet-integration', async (req, res) => {
    try {
      const shop = await readShop(req.params.shopId);
      if (!shop) return res.status(404).json({ ok: false, message: 'Shop not found' });
      const integration = await saveIntegration(req.params.shopId, req.body || {}, req.auth?.userId);
      return res.json({ ok: true, integration });
    } catch (error) {
      return res.status(error.status || 500).json({ ok: false, message: error.message || 'Google Sheet integration save failed' });
    }
  });

  app.post('/api/grand-admin/shops/:shopId/google-sheet-integration/test', async (req, res) => {
    try {
      const shop = await readShop(req.params.shopId);
      if (!shop) return res.status(404).json({ ok: false, message: 'Shop not found' });
      const current = googleSheetFromSettings(shop.settings?.settings);
      const webhookUrl = clean(req.body?.webhookUrl || current.webhookUrl, 2000);
      if (!isValidWebhookUrl(webhookUrl)) return res.status(400).json({ ok: false, message: 'Google Apps Script Web App URL /exec link ထည့်ပါ' });
      const result = await testWebhook(shop, webhookUrl);
      const row = await prisma.shopSettings.upsert({ where: { shopId: shop.id }, update: {}, create: { shopId: shop.id } });
      const settings = safeObject(row.settings);
      const integrations = safeObject(settings.integrations);
      const next = { ...googleSheetFromSettings(settings), webhookUrl, lastTestAt: new Date().toISOString(), lastTestStatus: result.ok ? 'CONNECTED' : 'FAILED', lastTestMessage: result.message || '' };
      await prisma.shopSettings.update({ where: { shopId: shop.id }, data: { settings: { ...settings, integrations: { ...integrations, googleSheet: next } } } });
      return res.status(result.ok ? 200 : 400).json({ ok: result.ok, result, integration: next });
    } catch (error) {
      return res.status(500).json({ ok: false, message: error.message || 'Google Sheet test failed' });
    }
  });

  app.post('/api/grand-admin/google-sheet-integration/retry', async (_req, res) => {
    try {
      return res.json(await deliverPendingTenantGoogleSheetSync(100));
    } catch (error) {
      return res.status(500).json({ ok: false, message: error.message || 'Google Sheet retry failed' });
    }
  });
}

function startTenantGoogleSheetWebhookRunner() {
  if (runner) return runner;
  runner = setInterval(() => {
    deliverPendingTenantGoogleSheetSync(25).catch((error) => console.warn('Tenant Google Sheet runner:', error.message));
  }, 30000);
  runner.unref?.();
  return runner;
}

module.exports = {
  attachTenantGoogleSheetIntegrationApi,
  attachTenantGoogleSheetWebhookCapture,
  startTenantGoogleSheetWebhookRunner,
  queueTenantGoogleSheetSync,
};
