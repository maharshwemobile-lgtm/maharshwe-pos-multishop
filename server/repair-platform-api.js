const crypto = require('crypto');
const { z } = require('zod');
const { Prisma } = require('@prisma/client');
const { prisma } = require('./prisma');
const {
  requireAuth,
  requireShopUser,
  requireWritableSubscription,
} = require('./auth-api');
const { ensureRepairPlatformSchema } = require('./repair-platform-schema');

const REPAIR_STATUSES = ['RECEIVED', 'CHECKING', 'IN_PROGRESS', 'WAITING_PART', 'COMPLETED', 'CANNOT_REPAIR', 'DELIVERED'];
const PAYMENT_STATUSES = ['PENDING', 'PARTIAL', 'PAID', 'REFUNDED', 'VOIDED'];
const PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'];
const REPAIR_ID_PATTERN = /^[A-Z]{1,8}\d+$/i;
const uuidSchema = z.string().uuid();

const intakeSchema = z.object({
  customerName: z.string().trim().min(1).max(180),
  customerPhone: z.string().trim().max(80).optional().nullable(),
  deviceBrand: z.string().trim().max(120).optional().nullable(),
  deviceModel: z.string().trim().min(1).max(180),
  imeiSerial: z.string().trim().max(180).optional().nullable(),
  problem: z.string().trim().min(1).max(2000),
  estimatedCost: z.coerce.number().min(0).default(0),
  deposit: z.coerce.number().min(0).default(0),
  priority: z.enum(PRIORITIES).default('NORMAL'),
  intakeCondition: z.string().trim().max(1000).optional().nullable(),
  accessories: z.array(z.string().trim().min(1).max(120)).max(30).default([]),
  notes: z.string().trim().max(2000).optional().nullable(),
  diagnosis: z.string().trim().max(2000).optional().nullable(),
});

const repairIdSchema = z.object({
  repairId: z.string().trim().min(2).max(40),
});

const statusSchema = z.object({
  status: z.enum(REPAIR_STATUSES),
  note: z.string().trim().max(1000).optional().nullable(),
  diagnosis: z.string().trim().max(2000).optional().nullable(),
  resolution: z.string().trim().max(2000).optional().nullable(),
  finalCost: z.coerce.number().min(0).optional(),
  warrantyUntil: z.string().trim().optional().nullable(),
});

const deviceSchema = z.object({
  imeiSerial: z.string().trim().min(6).max(180),
  deviceBrand: z.string().trim().max(120).optional().nullable(),
  deviceModel: z.string().trim().max(180).optional().nullable(),
  color: z.string().trim().max(80).optional().nullable(),
});

class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

function parse(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) throw new ApiError(400, 'Invalid repair request', result.error.flatten().fieldErrors);
  return result.data;
}

function wrap(handler) {
  return async (req, res) => {
    try {
      await ensureRepairPlatformSchema();
      await handler(req, res);
    } catch (error) {
      if (error instanceof ApiError) {
        return res.status(error.status).json({ ok: false, message: error.message, details: error.details });
      }
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return res.status(409).json({ ok: false, message: 'Duplicate repair record' });
      }
      console.error('Repair platform API:', error);
      return res.status(500).json({ ok: false, message: error.message || 'Repair request failed' });
    }
  };
}

function requireRepairAccess(req, res, next) {
  if (req.auth?.role === 'SUPER_ADMIN' || req.auth?.role === 'SHOP_ADMIN') return next();
  if (req.auth?.permissions?.repairs === true) return next();
  return res.status(403).json({ ok: false, message: 'Insufficient repair permission' });
}

function normalizeRepairId(value) {
  return String(value || '').trim().toUpperCase().replace(/\s+/g, '');
}

function assertExistingRepairId(value) {
  const repairId = normalizeRepairId(value);
  if (!REPAIR_ID_PATTERN.test(repairId)) {
    throw new ApiError(400, 'Repair ID format must be prefix + number, for example MS0551 or AC0001');
  }
  return repairId;
}

function normalizeIdentifier(value) {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function identityHash(value) {
  return crypto.createHash('sha256').update(normalizeIdentifier(value)).digest('hex');
}

function identityType(value) {
  const normalized = normalizeIdentifier(value);
  return /^\d{14,17}$/.test(normalized) ? 'IMEI' : 'SERIAL';
}

function maskIdentifier(value) {
  const normalized = normalizeIdentifier(value);
  if (!normalized) return null;
  if (normalized.length <= 4) return normalized;
  return `${'*'.repeat(Math.min(10, normalized.length - 4))}${normalized.slice(-4)}`;
}

function money(value) {
  return Number(value || 0);
}

function mapExternalStatus(value, pickupValue = '') {
  const pickup = String(pickupValue || '').trim().toLowerCase();
  if (/✅|delivered|collected|picked|ယူပြီး|လာယူပြီး/.test(pickup)) return 'DELIVERED';
  if (/မယူ|မလာယူ|not\s*picked|pending\s*pickup/.test(pickup)) {
    // Keep the repair status below; pickup is still pending.
  }
  const text = String(value || '').trim().toLowerCase();
  if (/delivered|collected|picked|ယူပြီး|လာယူပြီး/.test(text)) return 'DELIVERED';
  if (/❌|cannot|unrepair|ပြင်မရ/.test(text)) return 'CANNOT_REPAIR';
  if (/✅|completed|complete|done|finished|ပြင်ပြီး/.test(text)) return 'COMPLETED';
  if (/waiting.*part|part.*wait|ပစ္စည်းစောင့်/.test(text)) return 'WAITING_PART';
  if (/⏳|progress|repairing|ပြင်နေ|ပြင်ရန်/.test(text)) return 'IN_PROGRESS';
  if (/check|diagnos|စစ်ဆေး/.test(text)) return 'CHECKING';
  return 'RECEIVED';
}

function mapExternalPaymentStatus(value, finalCost = 0, deposit = 0) {
  const text = String(value || '').trim().toLowerCase();
  // Grand Report sheets use blank payment status as "မရှင်းရသေး" for partner settlement.
  if (!text) return 'PENDING';
  if (/refund|refunded|ပြန်အမ်း/.test(text)) return 'REFUNDED';
  if (/void|cancel|cancelled|ဖျက်/.test(text)) return 'VOIDED';
  if (/partial|partly|တစ်စိတ်|တဝက်|အချို့/.test(text)) return 'PARTIAL';
  if (/⏳|မ\s*ရှင်း|မရှင်း|unpaid|not\s*paid|pending|open|မပေး/.test(text)) return 'PENDING';
  if (/✅|ရှင်းပြီး|paid|settled|cleared|clear/.test(text)) return 'PAID';
  return paymentStatus(finalCost, deposit);
}

function externalValue(data, keys, fallback = null) {
  for (const key of keys) {
    if (data?.[key] !== undefined && data?.[key] !== null && String(data[key]).trim() !== '') return data[key];
  }
  return fallback;
}

function normalizeExternalRepair(data, requestedId) {
  const payload = data?.data && typeof data.data === 'object' ? data.data : data;
  const found = payload?.found !== false && payload?.ok !== false && !/not found/i.test(String(payload?.message || ''));
  if (!found) throw new ApiError(404, 'Repair ID not found in Mahar Shwe API');
  const externalRepairId = assertExistingRepairId(externalValue(payload, ['voucher', 'repairId', 'repair_id', 'id'], requestedId));
  const repairStatusRaw = externalValue(payload, ['status', 'repairStatus', 'repair_status', 'ပြင်ဆင်မှုအခြေအနေ']);
  const pickupStatusRaw = externalValue(payload, ['pickupStatus', 'pickup_status', 'pickup', 'collectedStatus', 'ယူပြီး ခြေနေ']);
  const paymentStatusRaw = externalValue(payload, ['paymentStatus', 'payment_status', 'paidStatus', 'settlementStatus', 'ငွေရှင်း status']);
  const finalCost = money(externalValue(payload, ['repairFee', 'fee', 'cost', 'amount', 'finalCost', 'ကုန်ကျစရိတ်'], 0));
  const deposit = money(externalValue(payload, ['deposit', 'paidAmount', 'paid_amount'], 0));
  return {
    externalRepairId,
    customerName: String(externalValue(payload, ['customerName', 'customer', 'name'], 'Unknown Customer')).trim(),
    customerPhone: externalValue(payload, ['customerPhone', 'phone', 'mobile']),
    deviceBrand: externalValue(payload, ['brand', 'deviceBrand']),
    deviceModel: String(externalValue(payload, ['model', 'deviceModel', 'device'], 'Unknown Device')).trim(),
    imeiSerial: externalValue(payload, ['imeiSerial', 'imei', 'serial', 'serialNumber']),
    problem: String(externalValue(payload, ['issue', 'problem', 'error'], 'Repair service')).trim(),
    status: mapExternalStatus(repairStatusRaw, pickupStatusRaw),
    finalCost,
    deposit,
    paymentStatus: mapExternalPaymentStatus(paymentStatusRaw, finalCost, deposit),
    sourceShopName: String(externalValue(payload, ['shop', 'shopName'], 'Mahar Shwe Mobile')).trim(),
    staffId: externalValue(payload, ['staffId', 'technician', 'staff']),
    pickupStatusRaw: pickupStatusRaw || '',
    paymentStatusRaw: paymentStatusRaw || '',
    raw: payload,
  };
}

async function fetchExternalRepair(repairId) {
  const endpoint = process.env.REPAIR_TRACKING_WEB_APP_URL;
  if (!endpoint) throw new ApiError(503, 'REPAIR_TRACKING_WEB_APP_URL is not configured');
  const url = new URL(endpoint);
  url.searchParams.set('voucher', repairId);
  url.searchParams.set('id', repairId);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number(process.env.REPAIR_API_TIMEOUT_MS || 12000));
  try {
    const headers = { Accept: 'application/json' };
    if (process.env.REPAIR_TRACKING_API_KEY) headers['X-API-Key'] = process.env.REPAIR_TRACKING_API_KEY;
    const response = await fetch(url, { headers, signal: controller.signal });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new ApiError(502, data.message || `Repair API failed (${response.status})`);
    return normalizeExternalRepair(data, repairId);
  } catch (error) {
    if (error.name === 'AbortError') throw new ApiError(504, 'Repair API timed out');
    if (error instanceof ApiError) throw error;
    throw new ApiError(502, error.message || 'Repair API connection failed');
  } finally {
    clearTimeout(timer);
  }
}

async function shopContext(db, shopId) {
  const rows = await db.$queryRawUnsafe(
    `SELECT s.id, s.slug, s.code, s.name,
            COALESCE(ss.repair_prefix, '') AS "repairPrefix"
       FROM shops s
       LEFT JOIN shop_settings ss ON ss.shop_id = s.id
      WHERE s.id = $1::uuid
      LIMIT 1`,
    shopId,
  );
  if (!rows[0]) throw new ApiError(404, 'Shop tenant not found');
  return rows[0];
}

async function maharShweApiAccess(db, shopId) {
  const shopRows = await db.$queryRawUnsafe(
    `SELECT s.id,s.slug,s.code,s.name,COALESCE(ss.repair_prefix,'') AS "repairPrefix"
       FROM shops s
       LEFT JOIN shop_settings ss ON ss.shop_id=s.id
      WHERE s.id=$1::uuid
      LIMIT 1`,
    shopId,
  );
  const shop = shopRows[0];
  if (!shop) throw new ApiError(404, 'Shop tenant not found');

  const currentPrefix = String(shop.repairPrefix || '').toUpperCase().replace(/[^A-Z]/g, '');
  const currentIdentity = `${shop.slug || ''} ${shop.code || ''} ${shop.name || ''}`.toUpperCase();
  if (currentPrefix === 'MS' || /MAHAR\s*SHWE|MAHARSHWE|\bMSM\b/.test(currentIdentity)) {
    return {
      allowed: true,
      mode: 'PROVIDER',
      providerShopId: shop.id,
      providerShopName: shop.name,
      message: 'Mahar Shwe provider shop',
    };
  }

  const linkRows = await db.$queryRawUnsafe(
    `SELECT l.id,
            l.provider_shop_id AS "providerShopId",
            provider.name AS "providerShopName",
            provider.slug AS "providerSlug",
            COALESCE(provider_settings.repair_prefix,'') AS "providerRepairPrefix"
       FROM partner_shop_links l
       JOIN shops provider ON provider.id=l.provider_shop_id
       LEFT JOIN shop_settings provider_settings ON provider_settings.shop_id=provider.id
      WHERE l.partner_shop_id=$1::uuid
        AND l.active=TRUE
        AND (
          UPPER(COALESCE(provider_settings.repair_prefix,''))='MS'
          OR provider.slug ILIKE '%maharshwe%'
          OR provider.name ILIKE '%Mahar Shwe%'
        )
      ORDER BY l.updated_at DESC,l.created_at DESC
      LIMIT 1`,
    shopId,
  );
  const link = linkRows[0];
  if (link) {
    return {
      allowed: true,
      mode: 'PARTNER',
      partnerLinkId: link.id,
      providerShopId: link.providerShopId,
      providerShopName: link.providerShopName,
      message: 'Mahar Shwe provider linked this tenant as a partner shop',
    };
  }

  return {
    allowed: false,
    mode: 'LOCKED',
    message: 'Mahar Shwe API access requires Mahar Shwe provider to Add Partner Shop first',
  };
}

async function assertMaharShweApiAccess(db, shopId) {
  const access = await maharShweApiAccess(db, shopId);
  if (!access.allowed) {
    throw new ApiError(403, 'Mahar Shwe API access is locked. Ask Mahar Shwe provider admin to Add Partner Shop first.');
  }
  return access;
}

function resolveRepairPrefix(shop) {
  const configured = String(shop.repairPrefix || '').toUpperCase().replace(/[^A-Z]/g, '');
  if (configured) return configured.slice(0, 8);

  const codePrefix = String(shop.code || '').toUpperCase().replace(/[^A-Z]/g, '');
  if (codePrefix) return codePrefix.slice(0, 8);

  const slugTokens = String(shop.slug || '')
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter(Boolean);
  const slugPrefix = slugTokens.map((item) => item.replace(/[^A-Z]/g, '')[0] || '').join('').replace(/[^A-Z]/g, '');
  if (slugPrefix) return slugPrefix.slice(0, 8);

  const compactName = String(shop.name || '').toUpperCase().replace(/[^A-Z]/g, '');
  if (compactName) return compactName.slice(0, 8);

  return 'RP';
}

async function ensureRepairPrefix(db, shop) {
  const prefix = resolveRepairPrefix(shop);
  const configured = String(shop.repairPrefix || '').toUpperCase().replace(/[^A-Z]/g, '');
  if (configured === prefix) return prefix;
  await db.$executeRawUnsafe(
    `INSERT INTO shop_settings(id,shop_id,repair_prefix,created_at,updated_at)
     VALUES($1::uuid,$2::uuid,$3,NOW(),NOW())
     ON CONFLICT (shop_id)
     DO UPDATE SET repair_prefix=EXCLUDED.repair_prefix,updated_at=NOW()`,
    crypto.randomUUID(),
    shop.id,
    prefix,
  );
  return prefix;
}

async function generateRepairNumber(db, shopId) {
  const shop = await shopContext(db, shopId);
  const prefix = await ensureRepairPrefix(db, shop);
  const regex = `^${prefix}[0-9]+$`;

  await db.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', `${shopId}:${prefix}`);
  const maxRows = await db.$queryRawUnsafe(
    `SELECT COALESCE(MAX(CAST(SUBSTRING(repair_number FROM LENGTH($2) + 1) AS INTEGER)), 0)::int AS max
       FROM repairs
      WHERE shop_id = $1::uuid AND repair_number ~ $3`,
    shopId,
    prefix,
    regex,
  );
  const existingMax = Number(maxRows[0]?.max || 0);
  const sequenceRows = await db.$queryRawUnsafe(
    `INSERT INTO repair_sequences (shop_id, period, last_value, updated_at)
     VALUES ($1::uuid, $2, $3, NOW())
     ON CONFLICT (shop_id, period)
     DO UPDATE SET last_value = GREATEST(repair_sequences.last_value + 1, EXCLUDED.last_value), updated_at = NOW()
     RETURNING last_value`,
    shopId,
    prefix,
    existingMax + 1,
  );
  return `${prefix}${String(sequenceRows[0].last_value).padStart(4, '0')}`;
}

async function upsertDevice(db, shopId, input) {
  const normalized = normalizeIdentifier(input.imeiSerial);
  if (!normalized) return null;
  if (normalized.length < 6) throw new ApiError(400, 'IMEI or serial number is too short');
  const id = crypto.randomUUID();
  const hash = identityHash(normalized);
  const rows = await db.$queryRawUnsafe(
    `INSERT INTO repair_devices (
       id, shop_id, identity_type, identity_value, identity_hash, identity_last4,
       brand, model, color, updated_at
     ) VALUES (
       $1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9, NOW()
     )
     ON CONFLICT (shop_id, identity_hash)
     DO UPDATE SET
       brand = COALESCE(NULLIF(EXCLUDED.brand, ''), repair_devices.brand),
       model = COALESCE(NULLIF(EXCLUDED.model, ''), repair_devices.model),
       color = COALESCE(NULLIF(EXCLUDED.color, ''), repair_devices.color),
       updated_at = NOW()
     RETURNING id, identity_type AS "identityType", identity_value AS "identityValue",
               identity_last4 AS "identityLast4", brand, model, color`,
    id,
    shopId,
    identityType(normalized),
    normalized,
    hash,
    normalized.slice(-4),
    input.deviceBrand || null,
    input.deviceModel || null,
    input.color || null,
  );
  return rows[0];
}

async function addEvent(db, { shopId, repairId, eventType, status, userId, source = 'LOCAL', note, payload = {} }) {
  await db.$executeRawUnsafe(
    `INSERT INTO repair_events (
       id, shop_id, repair_id, event_type, status, changed_by_id, source, note, payload, occurred_at
     ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6::uuid, $7, $8, $9::jsonb, NOW())`,
    crypto.randomUUID(),
    shopId,
    repairId,
    eventType,
    status || null,
    userId || null,
    source,
    note || null,
    JSON.stringify(payload || {}),
  );
}

async function addStatusHistory(db, { shopId, repairId, status, userId, note }) {
  await db.$executeRawUnsafe(
    `INSERT INTO repair_status_history (id, shop_id, repair_id, status, changed_by_id, note, created_at)
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4::"RepairStatus", $5::uuid, $6, NOW())`,
    crypto.randomUUID(), shopId, repairId, status, userId || null, note || null,
  );
}

function paymentStatus(finalCost, deposit) {
  if (finalCost > 0 && deposit >= finalCost) return 'PAID';
  if (deposit > 0) return 'PARTIAL';
  return 'PENDING';
}

async function createRepair(db, shopId, userId, input) {
  const id = crypto.randomUUID();
  const repairNumber = input.repairNumber || await generateRepairNumber(db, shopId);
  const device = await upsertDevice(db, shopId, input);
  const finalCost = money(input.finalCost || 0);
  const deposit = money(input.deposit || 0);
  const normalizedPaymentStatus = PAYMENT_STATUSES.includes(input.paymentStatus) ? input.paymentStatus : paymentStatus(finalCost, deposit);
  const rows = await db.$queryRawUnsafe(
    `INSERT INTO repairs (
       id, shop_id, repair_number, customer_name, customer_phone,
       device_brand, device_model, imei_serial, problem, technician_id,
       estimated_cost, final_cost, deposit, payment_status, status,
       received_at, notes, device_id, source_type, source_provider,
       source_shop_name, external_repair_id, provider_repair_id, external_payload,
       last_synced_at, priority, intake_condition, accessories, diagnosis,
       resolution, warranty_until, created_at, updated_at
     ) VALUES (
       $1::uuid, $2::uuid, $3, $4, $5,
       $6, $7, $8, $9, $10::uuid,
       $11, $12, $13, $14::"PaymentStatus", $15::"RepairStatus",
       NOW(), $16, $17::uuid, $18, $19,
       $20, $21, $22, $23::jsonb,
       $24::timestamptz, $25, $26, $27::jsonb, $28,
       $29, $30::date, NOW(), NOW()
     ) RETURNING id`,
    id,
    shopId,
    repairNumber,
    input.customerName,
    input.customerPhone || null,
    input.deviceBrand || null,
    input.deviceModel || null,
    input.imeiSerial ? normalizeIdentifier(input.imeiSerial) : null,
    input.problem,
    input.technicianId || userId || null,
    money(input.estimatedCost),
    finalCost,
    deposit,
    normalizedPaymentStatus,
    input.status || 'RECEIVED',
    input.notes || null,
    device?.id || null,
    input.sourceType || 'LOCAL',
    input.sourceProvider || null,
    input.sourceShopName || null,
    input.externalRepairId || null,
    input.providerRepairId || null,
    JSON.stringify(input.externalPayload || {}),
    input.lastSyncedAt || null,
    input.priority || 'NORMAL',
    input.intakeCondition || null,
    JSON.stringify(input.accessories || []),
    input.diagnosis || null,
    input.resolution || null,
    input.warrantyUntil || null,
  );
  await addStatusHistory(db, { shopId, repairId: id, status: input.status || 'RECEIVED', userId, note: input.notes || 'Repair received' });
  await addEvent(db, {
    shopId,
    repairId: id,
    eventType: input.sourceType && input.sourceType !== 'LOCAL' ? 'IMPORTED' : 'CREATED',
    status: input.status || 'RECEIVED',
    userId,
    source: input.sourceProvider || input.sourceType || 'LOCAL',
    note: input.notes || 'Repair job created',
    payload: { repairNumber, sourceType: input.sourceType || 'LOCAL' },
  });
  return rows[0].id;
}

const selectRepair = `
  SELECT r.id,
         r.shop_id AS "shopId",
         r.repair_number AS "repairNumber",
         r.customer_id AS "customerId",
         r.customer_name AS "customerName",
         r.customer_phone AS "customerPhone",
         r.device_brand AS "deviceBrand",
         r.device_model AS "deviceModel",
         r.imei_serial AS "imeiSerial",
         r.problem,
         r.estimated_cost AS "estimatedCost",
         r.final_cost AS "finalCost",
         r.deposit,
         r.payment_status AS "paymentStatus",
         r.status,
         r.received_at AS "receivedAt",
         r.completed_at AS "completedAt",
         r.delivered_at AS "deliveredAt",
         r.notes,
         r.source_type AS "sourceType",
         r.source_provider AS "sourceProvider",
         r.source_shop_name AS "sourceShopName",
         r.external_repair_id AS "externalRepairId",
         r.provider_repair_id AS "providerRepairId",
         r.last_synced_at AS "lastSyncedAt",
         r.priority,
         r.intake_condition AS "intakeCondition",
         r.accessories,
         r.diagnosis,
         r.resolution,
         r.warranty_until AS "warrantyUntil",
         r.created_at AS "createdAt",
         r.updated_at AS "updatedAt",
         d.id AS "deviceId",
         d.identity_type AS "identityType",
         d.identity_value AS "identityValue",
         d.identity_last4 AS "identityLast4",
         u.name AS "technicianName",
         u.username AS "technicianUsername"
    FROM repairs r
    LEFT JOIN repair_devices d ON d.id = r.device_id AND d.shop_id = r.shop_id
    LEFT JOIN users u ON u.id = r.technician_id AND (u.shop_id = r.shop_id OR u.shop_id IS NULL)`;

function repairJson(row) {
  if (!row) return null;
  return {
    ...row,
    estimatedCost: money(row.estimatedCost),
    finalCost: money(row.finalCost),
    deposit: money(row.deposit),
    accessories: Array.isArray(row.accessories) ? row.accessories : [],
    identityMasked: maskIdentifier(row.identityValue || row.imeiSerial),
    balanceDue: Math.max(0, money(row.finalCost) - money(row.deposit)),
    providerLinked: row.sourceProvider === 'MAHAR_SHWE_API' && Boolean(row.providerRepairId || row.externalRepairId),
  };
}

async function getRepair(db, shopId, identifier) {
  const isUuid = uuidSchema.safeParse(identifier).success;
  const rows = await db.$queryRawUnsafe(
    `${selectRepair}
      WHERE r.shop_id = $1::uuid
        AND ${isUuid ? 'r.id = $2::uuid' : 'r.repair_number = $2'}
      LIMIT 1`,
    shopId,
    normalizeRepairId(identifier),
  );
  return repairJson(rows[0]);
}

async function timeline(db, shopId, repairId) {
  return db.$queryRawUnsafe(
    `SELECT e.id, e.event_type AS "eventType", e.status, e.source, e.note,
            e.payload, e.occurred_at AS "occurredAt",
            u.name AS "changedByName", u.username AS "changedByUsername"
       FROM repair_events e
       LEFT JOIN users u ON u.id = e.changed_by_id
      WHERE e.shop_id = $1::uuid AND e.repair_id = $2::uuid
      ORDER BY e.occurred_at DESC, e.id DESC`,
    shopId,
    repairId,
  );
}

async function syncExternalIntoRepair(db, shopId, userId, repair, external, eventType) {
  await db.$executeRawUnsafe(
    `UPDATE repairs
        SET customer_name = COALESCE(NULLIF($3, ''), customer_name),
            customer_phone = COALESCE(NULLIF($4, ''), customer_phone),
            device_brand = COALESCE(NULLIF($5, ''), device_brand),
            device_model = COALESCE(NULLIF($6, ''), device_model),
            problem = COALESCE(NULLIF($7, ''), problem),
            final_cost = CASE WHEN $8::numeric > 0 THEN $8::numeric ELSE final_cost END,
            deposit = CASE WHEN $13::numeric > 0 THEN $13::numeric ELSE deposit END,
            status = $9::"RepairStatus",
            payment_status = $14::"PaymentStatus",
            source_provider = 'MAHAR_SHWE_API',
            source_shop_name = $10,
            external_repair_id = COALESCE(external_repair_id, $11),
            provider_repair_id = COALESCE(provider_repair_id, $11),
            external_payload = $12::jsonb,
            last_synced_at = NOW(),
            updated_at = NOW(),
            completed_at = CASE WHEN $9 IN ('COMPLETED','CANNOT_REPAIR') THEN COALESCE(completed_at, NOW()) ELSE completed_at END,
            delivered_at = CASE WHEN $9 = 'DELIVERED' THEN COALESCE(delivered_at, NOW()) ELSE delivered_at END
      WHERE id = $1::uuid AND shop_id = $2::uuid`,
    repair.id,
    shopId,
    external.customerName,
    external.customerPhone || null,
    external.deviceBrand || null,
    external.deviceModel,
    external.problem,
    external.finalCost,
    external.status,
    external.sourceShopName,
    external.externalRepairId,
    JSON.stringify(external.raw),
    external.deposit || 0,
    external.paymentStatus || 'PENDING',
  );
  if (external.imeiSerial) {
    const device = await upsertDevice(db, shopId, {
      imeiSerial: external.imeiSerial,
      deviceBrand: external.deviceBrand,
      deviceModel: external.deviceModel,
    });
    await db.$executeRawUnsafe(
      `UPDATE repairs SET device_id = $3::uuid, imei_serial = $4, updated_at = NOW()
        WHERE id = $1::uuid AND shop_id = $2::uuid`,
      repair.id, shopId, device.id, normalizeIdentifier(external.imeiSerial),
    );
  }
  await addStatusHistory(db, { shopId, repairId: repair.id, status: external.status, userId, note: `Synced from ${external.sourceShopName}` });
  await addEvent(db, {
    shopId,
    repairId: repair.id,
    eventType,
    status: external.status,
    userId,
    source: 'MAHAR_SHWE_API',
    note: `Repair status synced from ${external.sourceShopName}`,
    payload: { staffId: external.staffId || null },
  });
}

function attachRepairPlatformApi(app) {
  const read = [requireAuth, requireShopUser, requireRepairAccess];
  const write = [requireAuth, requireShopUser, requireWritableSubscription, requireRepairAccess];

  app.get('/api/repair-platform/mahar-shwe-access', ...read, wrap(async (req, res) => {
    res.json({ ok: true, access: await maharShweApiAccess(prisma, req.auth.shopId) });
  }));

  app.get('/api/repair-platform/jobs', ...read, wrap(async (req, res) => {
    const shopId = req.auth.shopId;
    const page = Math.max(1, Number.parseInt(req.query.page || '1', 10) || 1);
    const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit || '20', 10) || 20));
    const query = String(req.query.q || '').trim();
    const status = REPAIR_STATUSES.includes(String(req.query.status || '')) ? String(req.query.status) : '';
    const sourceType = String(req.query.sourceType || '').trim();
    const params = [shopId];
    const filters = ['r.shop_id = $1::uuid'];
    if (query) {
      params.push(`%${query.toLowerCase()}%`);
      filters.push(`LOWER(CONCAT_WS(' ', r.repair_number, r.customer_name, r.customer_phone, r.device_brand, r.device_model, r.imei_serial, r.problem)) LIKE $${params.length}`);
    }
    if (status) {
      params.push(status);
      filters.push(`r.status = $${params.length}::"RepairStatus"`);
    }
    if (sourceType) {
      params.push(sourceType);
      filters.push(`r.source_type = $${params.length}`);
    }
    const where = filters.join(' AND ');
    const countRows = await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS count FROM repairs r WHERE ${where}`, ...params);
    params.push(limit, (page - 1) * limit);
    const rows = await prisma.$queryRawUnsafe(
      `${selectRepair} WHERE ${where} ORDER BY r.received_at DESC, r.id DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      ...params,
    );
    const summaryRows = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE status IN ('RECEIVED','CHECKING','IN_PROGRESS','WAITING_PART'))::int AS pending,
              COUNT(*) FILTER (WHERE status = 'COMPLETED')::int AS completed,
              COUNT(*) FILTER (WHERE status = 'CANNOT_REPAIR')::int AS "cannotRepair",
              COUNT(*) FILTER (WHERE status = 'DELIVERED')::int AS delivered,
              COUNT(*) FILTER (WHERE source_type <> 'LOCAL')::int AS imported
         FROM repairs WHERE shop_id = $1::uuid`,
      shopId,
    );
    const access = await maharShweApiAccess(prisma, shopId);
    const total = Number(countRows[0]?.count || 0);
    res.json({
      ok: true,
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      summary: summaryRows[0] || {},
      maharShweApiAccess: access,
      jobs: rows.map(repairJson),
    });
  }));

  app.get('/api/repair-platform/jobs/:id', ...read, wrap(async (req, res) => {
    const repair = await getRepair(prisma, req.auth.shopId, req.params.id);
    if (!repair) throw new ApiError(404, 'Repair job not found');
    res.json({ ok: true, repair, timeline: await timeline(prisma, req.auth.shopId, repair.id) });
  }));

  app.post('/api/repair-platform/intake', ...write, wrap(async (req, res) => {
    const input = parse(intakeSchema, req.body || {});
    const repairId = await prisma.$transaction(
      (tx) => createRepair(tx, req.auth.shopId, req.auth.userId, input),
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5000, timeout: 20000 },
    );
    res.status(201).json({ ok: true, message: 'Repair ID generated', repair: await getRepair(prisma, req.auth.shopId, repairId) });
  }));

  app.post('/api/repair-platform/import', ...write, wrap(async (req, res) => {
    await assertMaharShweApiAccess(prisma, req.auth.shopId);
    const input = parse(repairIdSchema, req.body || {});
    const requestedRepairId = assertExistingRepairId(input.repairId);
    const external = await fetchExternalRepair(requestedRepairId);
    const shop = await shopContext(prisma, req.auth.shopId);
    const isMaharShwe = resolveRepairPrefix(shop) === 'MS';

    const existingRows = await prisma.$queryRawUnsafe(
      `SELECT id FROM repairs
        WHERE shop_id = $1::uuid
          AND (repair_number = $2 OR (source_provider = 'MAHAR_SHWE_API' AND external_repair_id = $2))
        LIMIT 1`,
      req.auth.shopId,
      external.externalRepairId,
    );

    let repairId = existingRows[0]?.id;
    if (repairId) {
      const current = await getRepair(prisma, req.auth.shopId, repairId);
      await prisma.$transaction((tx) => syncExternalIntoRepair(tx, req.auth.shopId, req.auth.userId, current, external, 'EXTERNAL_SYNCED'));
    } else {
      repairId = await prisma.$transaction(
        async (tx) => createRepair(tx, req.auth.shopId, req.auth.userId, {
          repairNumber: isMaharShwe ? external.externalRepairId : await generateRepairNumber(tx, req.auth.shopId),
          customerName: external.customerName,
          customerPhone: external.customerPhone,
          deviceBrand: external.deviceBrand,
          deviceModel: external.deviceModel,
          imeiSerial: external.imeiSerial,
          problem: external.problem,
          finalCost: external.finalCost,
          deposit: external.deposit || 0,
          paymentStatus: external.paymentStatus,
          status: external.status,
          sourceType: isMaharShwe ? 'MAHAR_SHWE_IMPORT' : 'PROVIDER_IMPORT',
          sourceProvider: 'MAHAR_SHWE_API',
          sourceShopName: external.sourceShopName,
          externalRepairId: external.externalRepairId,
          providerRepairId: isMaharShwe ? null : external.externalRepairId,
          externalPayload: external.raw,
          lastSyncedAt: new Date(),
          priority: 'NORMAL',
          notes: external.staffId ? `External staff: ${external.staffId}` : null,
        }),
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5000, timeout: 20000 },
      );
    }

    res.status(existingRows[0] ? 200 : 201).json({
      ok: true,
      message: existingRows[0] ? 'Repair synced' : 'Repair imported',
      repair: await getRepair(prisma, req.auth.shopId, repairId),
    });
  }));

  app.post('/api/repair-platform/jobs/:id/link-provider', ...write, wrap(async (req, res) => {
    await assertMaharShweApiAccess(prisma, req.auth.shopId);
    const input = parse(repairIdSchema, req.body || {});
    const providerRepairId = assertExistingRepairId(input.repairId);
    const repair = await getRepair(prisma, req.auth.shopId, req.params.id);
    if (!repair) throw new ApiError(404, 'Repair job not found');

    const duplicate = await prisma.$queryRawUnsafe(
      `SELECT id, repair_number AS "repairNumber" FROM repairs
        WHERE shop_id = $1::uuid AND source_provider = 'MAHAR_SHWE_API'
          AND provider_repair_id = $2 AND id <> $3::uuid LIMIT 1`,
      req.auth.shopId, providerRepairId, repair.id,
    );
    if (duplicate[0]) throw new ApiError(409, 'This Mahar Shwe Repair ID is already linked', duplicate[0]);

    const external = await fetchExternalRepair(providerRepairId);
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `UPDATE repairs SET source_type = 'PARTNER_HANDOFF', source_provider = 'MAHAR_SHWE_API',
                source_shop_name = $3, provider_repair_id = $4,
                external_repair_id = COALESCE(external_repair_id, $4),
                external_payload = $5::jsonb, last_synced_at = NOW(), updated_at = NOW()
          WHERE id = $1::uuid AND shop_id = $2::uuid`,
        repair.id, req.auth.shopId, external.sourceShopName, external.externalRepairId, JSON.stringify(external.raw),
      );
      await syncExternalIntoRepair(tx, req.auth.shopId, req.auth.userId, repair, external, 'PROVIDER_LINKED');
    });

    res.json({ ok: true, message: 'Mahar Shwe data linked', repair: await getRepair(prisma, req.auth.shopId, repair.id) });
  }));

  app.post('/api/repair-platform/jobs/:id/sync', ...write, wrap(async (req, res) => {
    await assertMaharShweApiAccess(prisma, req.auth.shopId);
    const repair = await getRepair(prisma, req.auth.shopId, req.params.id);
    if (!repair) throw new ApiError(404, 'Repair job not found');
    const externalId = repair.providerRepairId || repair.externalRepairId;
    if (!externalId || repair.sourceProvider !== 'MAHAR_SHWE_API') throw new ApiError(409, 'Repair is not linked to Mahar Shwe API');
    const external = await fetchExternalRepair(externalId);
    await prisma.$transaction((tx) => syncExternalIntoRepair(tx, req.auth.shopId, req.auth.userId, repair, external, 'EXTERNAL_SYNCED'));
    res.json({ ok: true, message: 'Repair status synced', repair: await getRepair(prisma, req.auth.shopId, repair.id) });
  }));

  app.patch('/api/repair-platform/jobs/:id/status', ...write, wrap(async (req, res) => {
    const input = parse(statusSchema, req.body || {});
    const repair = await getRepair(prisma, req.auth.shopId, req.params.id);
    if (!repair) throw new ApiError(404, 'Repair job not found');
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `UPDATE repairs SET status = $3::"RepairStatus",
                diagnosis = COALESCE($4, diagnosis), resolution = COALESCE($5, resolution),
                final_cost = COALESCE($6::numeric, final_cost), warranty_until = COALESCE($7::date, warranty_until),
                payment_status = CASE
                  WHEN COALESCE($6::numeric, final_cost) > 0 AND deposit >= COALESCE($6::numeric, final_cost) THEN 'PAID'::"PaymentStatus"
                  WHEN deposit > 0 THEN 'PARTIAL'::"PaymentStatus" ELSE payment_status END,
                completed_at = CASE WHEN $3 IN ('COMPLETED','CANNOT_REPAIR') THEN COALESCE(completed_at, NOW()) ELSE completed_at END,
                delivered_at = CASE WHEN $3 = 'DELIVERED' THEN COALESCE(delivered_at, NOW()) ELSE delivered_at END,
                updated_at = NOW()
          WHERE id = $1::uuid AND shop_id = $2::uuid`,
        repair.id, req.auth.shopId, input.status, input.diagnosis || null, input.resolution || null,
        input.finalCost === undefined ? null : input.finalCost, input.warrantyUntil || null,
      );
      await addStatusHistory(tx, { shopId: req.auth.shopId, repairId: repair.id, status: input.status, userId: req.auth.userId, note: input.note });
      await addEvent(tx, {
        shopId: req.auth.shopId,
        repairId: repair.id,
        eventType: 'STATUS_CHANGED',
        status: input.status,
        userId: req.auth.userId,
        note: input.note,
        payload: { from: repair.status, to: input.status, finalCost: input.finalCost, warrantyUntil: input.warrantyUntil || null },
      });
    });
    res.json({ ok: true, message: 'Repair status updated', repair: await getRepair(prisma, req.auth.shopId, repair.id) });
  }));

  app.post('/api/repair-platform/jobs/:id/device', ...write, wrap(async (req, res) => {
    const input = parse(deviceSchema, req.body || {});
    const repair = await getRepair(prisma, req.auth.shopId, req.params.id);
    if (!repair) throw new ApiError(404, 'Repair job not found');
    await prisma.$transaction(async (tx) => {
      const device = await upsertDevice(tx, req.auth.shopId, input);
      await tx.$executeRawUnsafe(
        `UPDATE repairs SET device_id = $3::uuid, imei_serial = $4,
                device_brand = COALESCE(NULLIF($5, ''), device_brand),
                device_model = COALESCE(NULLIF($6, ''), device_model), updated_at = NOW()
          WHERE id = $1::uuid AND shop_id = $2::uuid`,
        repair.id, req.auth.shopId, device.id, normalizeIdentifier(input.imeiSerial), input.deviceBrand || null, input.deviceModel || null,
      );
      await addEvent(tx, {
        shopId: req.auth.shopId,
        repairId: repair.id,
        eventType: 'DEVICE_LINKED',
        status: repair.status,
        userId: req.auth.userId,
        note: `${device.identityType} ending ${device.identityLast4} linked`,
        payload: { deviceId: device.id, identityType: device.identityType, identityLast4: device.identityLast4 },
      });
    });
    res.json({ ok: true, message: 'Device identity linked', repair: await getRepair(prisma, req.auth.shopId, repair.id) });
  }));

  app.get('/api/repair-platform/device-history', ...read, wrap(async (req, res) => {
    const identifier = normalizeIdentifier(req.query.identifier);
    if (identifier.length < 6) throw new ApiError(400, 'Enter a valid IMEI or serial number');
    const hash = identityHash(identifier);
    const deviceRows = await prisma.$queryRawUnsafe(
      `SELECT id, identity_type AS "identityType", identity_value AS "identityValue",
              identity_last4 AS "identityLast4", brand, model, color, created_at AS "createdAt"
         FROM repair_devices WHERE shop_id = $1::uuid AND identity_hash = $2 LIMIT 1`,
      req.auth.shopId, hash,
    );
    let device = deviceRows[0];
    if (!device) {
      const legacyRows = await prisma.$queryRawUnsafe(
        `SELECT id, device_brand AS "deviceBrand", device_model AS "deviceModel"
           FROM repairs
          WHERE shop_id = $1::uuid
            AND REGEXP_REPLACE(UPPER(COALESCE(imei_serial, '')), '[^A-Z0-9]', '', 'g') = $2
          ORDER BY received_at DESC LIMIT 1`,
        req.auth.shopId, identifier,
      );
      if (legacyRows[0]) {
        device = await prisma.$transaction(async (tx) => {
          const created = await upsertDevice(tx, req.auth.shopId, {
            imeiSerial: identifier,
            deviceBrand: legacyRows[0].deviceBrand,
            deviceModel: legacyRows[0].deviceModel,
          });
          await tx.$executeRawUnsafe(
            `UPDATE repairs SET device_id = $3::uuid
              WHERE shop_id = $1::uuid
                AND REGEXP_REPLACE(UPPER(COALESCE(imei_serial, '')), '[^A-Z0-9]', '', 'g') = $2`,
            req.auth.shopId, identifier, created.id,
          );
          return created;
        });
      }
    }
    if (!device) return res.json({ ok: true, found: false, history: [] });
    const rows = await prisma.$queryRawUnsafe(
      `${selectRepair} WHERE r.shop_id = $1::uuid AND r.device_id = $2::uuid ORDER BY r.received_at DESC`,
      req.auth.shopId, device.id,
    );
    res.json({
      ok: true,
      found: true,
      device: { ...device, identityMasked: maskIdentifier(device.identityValue) },
      totalRepairs: rows.length,
      history: rows.map(repairJson),
    });
  }));
}

module.exports = attachRepairPlatformApi;
