const crypto = require('crypto');
const { prisma } = require('./prisma');
const { exportDataset } = require('./google-sheet-project-export-data-v23');

const DATASETS = {
  remittances: 'Remittances',
  'sale-history': 'Sale History',
  'other-income': 'Other Income',
  'service-income': 'Service Income',
  expense: 'Expense',
  stock: 'STOCK',
  'user-audit': 'User audit',
  'repair-records': 'Repair Records',
};

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function clean(value, max = 500) {
  return String(value ?? '').trim().slice(0, max);
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
}

function datasetKey(value) {
  const key = clean(value, 80).toLowerCase().replaceAll('_', '-').replaceAll(' ', '-');
  if (!DATASETS[key]) throw Object.assign(new Error('Unsupported dataset'), { status: 400 });
  return key;
}

function sinceDate(value) {
  if (!value) return new Date('2000-01-01T00:00:00.000Z');
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw Object.assign(new Error('Invalid since date'), { status: 400 });
  return date;
}

async function resolveShop(slug) {
  const value = clean(slug, 120);
  if (!value) throw Object.assign(new Error('shopSlug is required'), { status: 400 });
  const shop = await prisma.shop.findUnique({ where: { slug: value }, select: { id: true, slug: true, name: true } });
  if (!shop) throw Object.assign(new Error('Shop not found'), { status: 404 });
  return shop;
}

async function configuredSecret(shopId) {
  const row = await prisma.shopSettings.findUnique({ where: { shopId }, select: { settings: true } });
  const settings = object(row?.settings);
  return clean(object(object(settings.api).googleSheets).secret, 500);
}

async function authenticate(req) {
  const shopSlug = req.method === 'GET' ? req.query.shopSlug : req.body?.shopSlug;
  const shop = await resolveShop(shopSlug);
  const expected = await configuredSecret(shop.id);
  if (!expected) throw Object.assign(new Error('Google Sheet Shared Secret is not configured in Project Settings'), { status: 503 });
  const supplied = req.headers['x-google-sheet-secret'] || req.query.key || req.body?.secret;
  if (!safeEqual(supplied, expected)) throw Object.assign(new Error('Invalid Google Sheet sync secret'), { status: 401 });
  return shop;
}


function normalizeRepairStatus(value) {
  const text = clean(value, 120).toLowerCase();
  if (!text) throw Object.assign(new Error('repair status is required'), { status: 400 });
  if (['completed', 'complete', 'done', 'finished', 'ပြင်ပြီး', 'ပြီး', 'repair done'].some((x) => text.includes(x))) return 'COMPLETED';
  if (['delivered', 'picked', 'collected', 'လာယူပြီး', 'ယူပြီး'].some((x) => text.includes(x))) return 'DELIVERED';
  if (['cannot', 'cant', "can't", 'မပြင်နိုင်', 'ပြင်မရ'].some((x) => text.includes(x))) return 'CANNOT_REPAIR';
  if (['waiting', 'part', 'ပစ္စည်းစောင့်', 'ပစ္စည်းစောင့်'].some((x) => text.includes(x))) return 'WAITING_PART';
  if (['progress', 'လုပ်ဆောင်', 'ပြင်နေ'].some((x) => text.includes(x))) return 'IN_PROGRESS';
  if (['checking', 'စစ်ဆေး'].some((x) => text.includes(x))) return 'CHECKING';
  if (['received', 'pending', 'လက်ခံ', 'မပြီး'].some((x) => text.includes(x))) return 'RECEIVED';
  const upper = clean(value, 120).toUpperCase().replaceAll(' ', '_');
  if (['RECEIVED', 'CHECKING', 'IN_PROGRESS', 'WAITING_PART', 'COMPLETED', 'CANNOT_REPAIR', 'DELIVERED'].includes(upper)) return upper;
  throw Object.assign(new Error(`Unsupported repair status: ${value}`), { status: 400 });
}

async function updateRepairStatusFromGoogleSheet(shop, input) {
  const repairKey = clean(input.repairId || input.repairNumber || input.repair_number || input.id || input.entityId || input.ticketNo, 120);
  if (!repairKey) throw Object.assign(new Error('repairId or repairNumber is required'), { status: 400 });
  const status = normalizeRepairStatus(input.status || input.repairStatus || input.repair_status || input.rawStatus);
  const rawStatus = clean(input.rawStatus || input.status || status, 120);
  const rows = await prisma.$queryRawUnsafe(
    `SELECT id,status,repair_number AS "repairNumber"
       FROM repairs
      WHERE shop_id=$1::uuid AND (id::text=$2 OR repair_number=$2)
      LIMIT 1`,
    shop.id,
    repairKey,
  );
  const repair = rows[0];
  if (!repair) throw Object.assign(new Error('Repair record not found'), { status: 404 });

  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(
      `UPDATE repairs SET status=$3::"RepairStatus",
              completed_at=CASE WHEN $3 IN ('COMPLETED','CANNOT_REPAIR') THEN COALESCE(completed_at,NOW()) ELSE completed_at END,
              delivered_at=CASE WHEN $3='DELIVERED' THEN COALESCE(delivered_at,NOW()) ELSE delivered_at END,
              updated_at=NOW()
        WHERE id=$1::uuid AND shop_id=$2::uuid`,
      repair.id,
      shop.id,
      status,
    );

    await tx.$executeRawUnsafe(
      `INSERT INTO repair_status_history (id,shop_id,repair_id,status,changed_by_id,note,created_at)
       VALUES ($1::uuid,$2::uuid,$3::uuid,$4::"RepairStatus",NULL,$5,NOW())`,
      crypto.randomUUID(),
      shop.id,
      repair.id,
      status,
      clean(input.note || `Google Sheet status sync: ${rawStatus}`, 500),
    ).catch(() => {});

    await tx.$executeRawUnsafe(
      `INSERT INTO repair_events (id,shop_id,repair_id,event_type,status,changed_by_id,source,note,payload,occurred_at)
       VALUES ($1::uuid,$2::uuid,$3::uuid,'GOOGLE_SHEET_STATUS_CHANGED',$4::"RepairStatus",NULL,'GOOGLE_SHEET',$5,$6::jsonb,NOW())`,
      crypto.randomUUID(),
      shop.id,
      repair.id,
      status,
      clean(input.note || `Google Sheet status sync: ${rawStatus}`, 500),
      JSON.stringify({ from: repair.status, to: status, rawStatus, repairKey }),
    ).catch(() => {});
  });

  return { repairId: repair.id, repairNumber: repair.repairNumber, status };
}

function attachGoogleSheetProjectExportApi(app) {

  app.post('/api/project-settings/integrations/google-sheet/repair-status', async (req, res) => {
    try {
      const shop = await authenticate(req);
      const result = await updateRepairStatusFromGoogleSheet(shop, req.body || {});
      return res.json({ ok: true, message: 'Repair status synced from Google Sheet', ...result });
    } catch (error) {
      return res.status(error.status || 500).json({ ok: false, message: error.message || 'Repair status sync failed' });
    }
  });

  const handler = async (req, res) => {
    try {
      const shop = await authenticate(req);
      const dataset = datasetKey(req.method === 'GET' ? req.params.dataset : req.body?.dataset);
      const since = sinceDate(req.method === 'GET' ? req.query.since : req.body?.since);
      const limit = req.method === 'GET' ? req.query.limit : req.body?.limit;
      const rows = await exportDataset(shop.id, dataset, since, limit);
      return res.json({ ok: true, dataset, tab: DATASETS[dataset], shop, rows, count: rows.length });
    } catch (error) {
      return res.status(error.status || 500).json({ ok: false, message: error.message || 'Dataset export failed' });
    }
  };

  app.get('/api/project-settings/integrations/google-sheet/export/:dataset', handler);
  app.post('/api/project-settings/integrations/google-sheet/export', handler);
}

module.exports = attachGoogleSheetProjectExportApi;
