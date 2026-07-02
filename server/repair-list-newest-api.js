const { prisma } = require('./prisma');
const { requireAuth, requireShopUser } = require('./auth-api');
const { ensureRepairPlatformSchema } = require('./repair-platform-schema');

const STATUSES = ['RECEIVED', 'CHECKING', 'IN_PROGRESS', 'WAITING_PART', 'COMPLETED', 'CANNOT_REPAIR', 'DELIVERED'];

function requireRepairAccess(req, res, next) {
  if (req.auth?.role === 'SUPER_ADMIN' || req.auth?.role === 'SHOP_ADMIN') return next();
  if (req.auth?.permissions?.repairs === true) return next();
  return res.status(403).json({ ok: false, message: 'Insufficient repair permission' });
}

function maskLast4(value) {
  const text = String(value || '').replace(/[^A-Za-z0-9]/g, '');
  if (!text) return null;
  return text.length <= 4 ? text : `${'*'.repeat(Math.min(10, text.length - 4))}${text.slice(-4)}`;
}

function mapRepair(row) {
  return {
    ...row,
    estimatedCost: Number(row.estimatedCost || 0),
    finalCost: Number(row.finalCost || 0),
    deposit: Number(row.deposit || 0),
    balanceDue: Math.max(0, Number(row.finalCost || 0) - Number(row.deposit || 0)),
    identityMasked: maskLast4(row.identityValue || row.imeiSerial),
    providerLinked: row.sourceProvider === 'MAHAR_SHWE_API' && Boolean(row.providerRepairId || row.externalRepairId),
  };
}

function attachRepairListNewestApi(app) {
  app.get('/api/repair-platform/jobs', requireAuth, requireShopUser, requireRepairAccess, async (req, res) => {
    try {
      await ensureRepairPlatformSchema();
      const shopId = req.auth.shopId;
      const page = Math.max(1, Number.parseInt(req.query.page || '1', 10) || 1);
      const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit || '20', 10) || 20));
      const query = String(req.query.q || '').trim();
      const status = STATUSES.includes(String(req.query.status || '')) ? String(req.query.status) : '';
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
        `SELECT r.id,
                r.repair_number AS "repairNumber",
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
                r.source_type AS "sourceType",
                r.source_provider AS "sourceProvider",
                r.source_shop_name AS "sourceShopName",
                r.external_repair_id AS "externalRepairId",
                r.provider_repair_id AS "providerRepairId",
                r.priority,
                r.created_at AS "createdAt",
                r.updated_at AS "updatedAt",
                d.identity_value AS "identityValue"
           FROM repairs r
           LEFT JOIN repair_devices d ON d.id=r.device_id AND d.shop_id=r.shop_id
          WHERE ${where}
          ORDER BY r.created_at DESC, r.received_at DESC, r.id DESC
          LIMIT $${params.length - 1} OFFSET $${params.length}`,
        ...params,
      );
      const summaryRows = await prisma.$queryRawUnsafe(
        `SELECT COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE status IN ('RECEIVED','CHECKING','IN_PROGRESS','WAITING_PART'))::int AS pending,
                COUNT(*) FILTER (WHERE status='COMPLETED')::int AS completed,
                COUNT(*) FILTER (WHERE status='CANNOT_REPAIR')::int AS "cannotRepair",
                COUNT(*) FILTER (WHERE status='DELIVERED')::int AS delivered,
                COUNT(*) FILTER (WHERE source_type<>'LOCAL')::int AS imported
           FROM repairs
          WHERE shop_id=$1::uuid`,
        shopId,
      );
      const total = Number(countRows[0]?.count || 0);
      return res.json({
        ok: true,
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
        summary: summaryRows[0] || {},
        jobs: rows.map(mapRepair),
      });
    } catch (error) {
      console.error('Newest repair list:', error);
      return res.status(500).json({ ok: false, message: error.message || 'Repair list failed' });
    }
  });
}

module.exports = attachRepairListNewestApi;
