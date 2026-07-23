const crypto = require('crypto');
const { prisma } = require('./prisma');

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

function toPlainNumber(value, fallback = 0) {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'object' && typeof value.toNumber === 'function') return Number(value.toNumber()) || fallback;
  if (typeof value === 'object' && typeof value.toString === 'function' && value.toString() !== '[object Object]') {
    const parsed = Number(value.toString());
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  const parsed = Number(String(value).replace(/,/g, '').trim());
  return Number.isFinite(parsed) ? parsed : fallback;
}

function firstText(...values) {
  for (const value of values) {
    const text = clean(value, 2000);
    if (text) return text;
  }
  return '';
}

function isoDate(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function sanitize(value, depth = 0) {
  if (depth > 5) return '[truncated]';
  if (value === null || value === undefined) return value;
  if (value instanceof Date) return isoDate(value);
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => sanitize(item, depth + 1));
  if (typeof value !== 'object') return typeof value === 'string' ? value.slice(0, 2000) : value;
  if (typeof value.toNumber === 'function') return toPlainNumber(value);
  if (typeof value.toString === 'function' && value.toString() !== '[object Object]') return clean(value.toString(), 2000);
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
    const error = new Error('Enter a valid Google Apps Script /exec URL.');
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

function saleSheetItems(items) {
  return (Array.isArray(items) ? items : []).map((item) => ({
    id: item.id || null,
    productName: firstText(item.productNameSnapshot, item.productName),
    variantName: firstText(item.variantNameSnapshot, item.variantName),
    quantity: toPlainNumber(item.quantity),
    unitPrice: toPlainNumber(item.actualSoldPrice ?? item.unitPrice),
    discount: toPlainNumber(item.discount),
    imeiSerial: item.imeiSerial || null,
  }));
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
  const items = saleSheetItems(sale.items);
  const total = toPlainNumber(sale.total ?? existingSale.total ?? existingSale.amount);
  const paidAmount = (Array.isArray(sale.payments) ? sale.payments : []).reduce((sum, row) => sum + toPlainNumber(row.amount), 0);
  const quantity = items.reduce((sum, item) => sum + toPlainNumber(item.quantity), 0);
  const staffName = firstText(sale.user?.name, sale.user?.username, existingSale.staffName, existingSale.cashier);

  return {
    ...(payload || {}),
    response: {
      ...response,
      sale: {
        ...existingSale,
        id: sale.id,
        invoiceNumber: firstText(sale.invoiceNumber, existingSale.invoiceNumber, existingSale.invoice),
        invoice: firstText(sale.invoiceNumber, existingSale.invoice),
        customerName: firstText(sale.customer?.name, existingSale.customerName, existingSale.customer, 'Walk-in Customer'),
        customer: firstText(sale.customer?.name, existingSale.customer, 'Walk-in Customer'),
        customerPhone: firstText(sale.customer?.phone, existingSale.customerPhone),
        items,
        quantity,
        subtotal: toPlainNumber(sale.subtotal ?? existingSale.subtotal),
        discount: toPlainNumber(sale.discount ?? existingSale.discount),
        total,
        amount: total,
        paidAmount,
        balance: Math.max(0, total - paidAmount),
        profitTotal: toPlainNumber(sale.profitTotal ?? existingSale.profitTotal),
        profit: toPlainNumber(sale.profitTotal ?? existingSale.profit),
        paymentMethod: firstText(existingSale.paymentMethod, sale.payments?.[0]?.method),
        paymentStatus: firstText(sale.paymentStatus, existingSale.paymentStatus),
        status: firstText(sale.status, existingSale.status),
        staffName,
        staffUsername: firstText(sale.user?.username, existingSale.staffUsername),
        cashier: staffName,
        soldAt: isoDate(sale.soldAt),
        createdAt: isoDate(sale.createdAt),
        updatedAt: isoDate(sale.updatedAt),
      },
    },
  };
}

async function enrichRepairPayloadForSheet(shopId, entityId, payload) {
  if (!shopId || !entityId) return payload || {};
  const repair = await prisma.repair.findFirst({
    where: { id: entityId, shopId },
    include: { technician: { select: { username: true, name: true } } },
  }).catch(() => null);
  if (!repair) return payload || {};

  const response = safeObject(payload?.response);
  const existingRepair = safeObject(response.repair);

  const repairCost = toPlainNumber(repair.finalCost ?? existingRepair.repairCost ?? existingRepair.cost);
  const customerPrice = toPlainNumber(repair.estimatedCost ?? existingRepair.customerPrice ?? existingRepair.price);
  const deposit = toPlainNumber(repair.deposit ?? existingRepair.deposit);
  const profit = customerPrice > 0 ? customerPrice - repairCost : 0;
  const phoneModel = firstText(
    [repair.deviceBrand, repair.deviceModel].filter(Boolean).join(' '),
    existingRepair.phoneModel,
    existingRepair.model,
  );
  const technicianName = firstText(repair.technician?.name, repair.technician?.username, existingRepair.technicianName);
  const deliveryStatus = repair.deliveredAt || repair.status === 'DELIVERED' ? 'DELIVERED' : 'PENDING_PICKUP';

  return {
    ...(payload || {}),
    response: {
      ...response,
      repair: {
        ...existingRepair,
        id: repair.id,
        voucherNo: firstText(repair.repairNumber, existingRepair.voucherNo),
        repairNo: firstText(repair.repairNumber, existingRepair.repairNo),
        repairNumber: firstText(repair.repairNumber, existingRepair.repairNumber),
        customerName: firstText(repair.customerName, existingRepair.customerName),
        customerPhone: firstText(repair.customerPhone, existingRepair.customerPhone, existingRepair.phone),
        phoneModel,
        model: phoneModel,
        deviceBrand: firstText(repair.deviceBrand, existingRepair.deviceBrand),
        deviceModel: firstText(repair.deviceModel, existingRepair.deviceModel),
        issue: firstText(repair.problem, existingRepair.issue),
        repairPart: firstText(repair.problem, existingRepair.repairPart),
        problem: firstText(repair.problem, existingRepair.problem),
        cost: repairCost,
        repairCost,
        estimatedCost: repairCost,
        customerPrice,
        price: customerPrice,
        finalCost: customerPrice,
        deposit,
        balanceDue: Math.max(0, customerPrice - deposit),
        profit,
        status: firstText(repair.status, existingRepair.status),
        deliveryStatus,
        paymentStatus: firstText(repair.paymentStatus, existingRepair.paymentStatus),
        technicianName,
        technicianUsername: firstText(repair.technician?.username, existingRepair.technicianUsername),
        note: firstText(repair.notes, existingRepair.note),
        receivedAt: isoDate(repair.receivedAt),
        completedAt: isoDate(repair.completedAt),
        deliveredAt: isoDate(repair.deliveredAt),
        createdAt: isoDate(repair.createdAt),
        updatedAt: isoDate(repair.updatedAt),
      },
    },
  };
}

async function enrichPayloadForSheet({ shopId, dataset, entityId, payload }) {
  if (dataset === 'sale') return enrichSalePayloadForSheet(shopId, entityId, payload || {});
  if (dataset === 'repair') return enrichRepairPayloadForSheet(shopId, entityId, payload || {});
  return payload || {};
}

async function queueTenantGoogleSheetSync({ shopId, dataset, action, entityId, payload }) {
  if (!shopId || !DATASETS[dataset]) return null;
  const integration = await readActiveIntegration(shopId, dataset);
  if (!integration) return null;
  const enrichedPayload = await enrichPayloadForSheet({ shopId, dataset, entityId, payload });
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
    JSON.stringify(sanitize(enrichedPayload || {})),
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

async function deliverPendingTenantGoogleSheetSync(limit = 25) {
  await ensureSchema();
  const rows = await prisma.$queryRawUnsafe(
    `SELECT id,shop_id AS "shopId",dataset,action,entity_id AS "entityId",payload,created_at AS "createdAt"
       FROM tenant_google_sheet_outbox
      WHERE status IN ('PENDING','FAILED') AND attempts < 20
      ORDER BY created_at ASC
      LIMIT $1`,
    Math.min(100, Math.max(1, Number(limit || 25))),
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

function entityIdFromResponse(body) {
  return body?.id || body?.sale?.id || body?.repair?.id || body?.movement?.id || body?.transaction?.id || null;
}

function attachTenantGoogleSheetWebhookCapture(app) {
  app.use((req, res, next) => {
    const dataset = datasetFromRequest(req);
    if (!dataset) return next();
    const originalJson = res.json.bind(res);
    res.json = (body) => {
      if (res.statusCode >= 200 && res.statusCode < 300 && req.auth?.shopId) {
        queueTenantGoogleSheetSync({
          shopId: req.auth.shopId,
          dataset,
          action: `${req.method} ${req.path}`,
          entityId: entityIdFromResponse(body),
          payload: { request: sanitize(req.body || {}), response: sanitize(body || {}) },
        }).catch((error) => console.warn('Tenant Google Sheet capture failed:', error.message));
      }
      return originalJson(body);
    };
    return next();
  });
}

function attachTenantGoogleSheetIntegrationApi(app) {
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
      if (!isValidWebhookUrl(webhookUrl)) return res.status(400).json({ ok: false, message: 'Enter a valid Google Apps Script /exec URL.' });
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
