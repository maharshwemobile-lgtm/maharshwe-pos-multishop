const crypto = require('crypto');
const { z } = require('zod');
const { Prisma } = require('@prisma/client');
const { prisma } = require('./prisma');
const {
  requireAuth,
  requireShopUser,
  requirePermission,
  requireWritableSubscription,
} = require('./auth-api');

const supplierCreateSchema = z.object({
  supplierCode: z.string().trim().min(1).max(30).optional(),
  name: z.string().trim().min(1).max(180),
  active: z.boolean().default(true),
});

const supplierUpdateSchema = z.object({
  supplierCode: z.string().trim().min(1).max(30).optional(),
  name: z.string().trim().min(1).max(180).optional(),
  active: z.boolean().optional(),
}).refine((value) => Object.keys(value).length > 0, {
  message: 'At least one supplier field is required',
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
  if (!result.success) {
    throw new ApiError(400, 'Invalid supplier request', result.error.flatten().fieldErrors);
  }
  return result.data;
}

function wrap(handler) {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (error) {
      if (error instanceof ApiError) {
        return res.status(error.status).json({ ok: false, message: error.message, details: error.details });
      }
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return res.status(409).json({ ok: false, message: 'Supplier code already exists' });
      }
      if (String(error?.message || '').includes('unique constraint')) {
        return res.status(409).json({ ok: false, message: 'Supplier code already exists' });
      }
      console.error('Supplier purchasing API:', error);
      return res.status(500).json({ ok: false, message: error.message || 'Supplier request failed' });
    }
  };
}

function cleanCode(value) {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 30);
}

async function assertTablesReady() {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT to_regclass('public.suppliers')::text AS suppliers,
            to_regclass('public.purchase_orders')::text AS purchase_orders,
            to_regclass('public.purchase_order_items')::text AS purchase_order_items`,
  );
  if (!rows[0]?.suppliers || !rows[0]?.purchase_orders || !rows[0]?.purchase_order_items) {
    throw new ApiError(503, 'Phase 10 purchasing migration is not deployed');
  }
}

async function audit(tx, req, action, entityType, entityId, details) {
  await tx.auditLog.create({
    data: {
      shopId: req.auth.shopId,
      userId: req.auth.userId,
      action,
      entityType,
      entityId,
      details,
      ipAddress: req.ip || null,
      userAgent: req.headers['user-agent'] || null,
    },
  });
}

async function nextSupplierCode(tx, shopId) {
  await tx.$queryRawUnsafe(
    `WITH advisory_lock AS (
       SELECT pg_advisory_xact_lock(hashtext($1))
     )
     SELECT 1::int AS acquired FROM advisory_lock`,
    `phase10:supplier:${shopId}`,
  );
  const rows = await tx.$queryRawUnsafe(
    `SELECT COALESCE(MAX(
       CASE WHEN supplier_code ~ '^SUP[0-9]+$'
            THEN substring(supplier_code FROM 4)::int
            ELSE 0 END
     ),0)::int + 1 AS next_number
       FROM suppliers
      WHERE shop_id=$1::uuid`,
    shopId,
  );
  return `SUP${String(Number(rows[0]?.next_number || 1)).padStart(4, '0')}`;
}

function attachSupplierPurchasingApi(app) {
  const read = [requireAuth, requireShopUser, requirePermission('inventory')];
  const write = [requireAuth, requireShopUser, requireWritableSubscription, requirePermission('inventory')];

  app.get('/api/purchasing/health', ...read, wrap(async (_req, res) => {
    await assertTablesReady();
    res.json({ ok: true, phase: 10, module: 'suppliers-purchasing' });
  }));

  app.get('/api/purchasing/dashboard', ...read, wrap(async (req, res) => {
    await assertTablesReady();
    const rows = await prisma.$queryRawUnsafe(
      `SELECT
         (SELECT COUNT(*)::int FROM suppliers WHERE shop_id=$1::uuid AND active=TRUE) AS "activeSuppliers",
         (SELECT COUNT(*)::int FROM purchase_orders WHERE shop_id=$1::uuid AND status='DRAFT') AS "draftOrders",
         (SELECT COUNT(*)::int FROM purchase_orders WHERE shop_id=$1::uuid AND status='APPROVED') AS "approvedOrders",
         (SELECT COUNT(*)::int FROM purchase_orders WHERE shop_id=$1::uuid AND status='PARTIALLY_RECEIVED') AS "partiallyReceivedOrders"`,
      req.auth.shopId,
    );
    res.json({ ok: true, dashboard: rows[0] || {} });
  }));

  app.get('/api/purchasing/suppliers', ...read, wrap(async (req, res) => {
    await assertTablesReady();
    const page = Math.max(1, Number.parseInt(req.query.page || '1', 10) || 1);
    const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit || '20', 10) || 20));
    const search = String(req.query.q || '').trim();
    const active = String(req.query.active || '').trim().toLowerCase();
    const params = [req.auth.shopId];
    const filters = ['s.shop_id=$1::uuid'];

    if (search) {
      params.push(`%${search}%`);
      filters.push(`(s.supplier_code ILIKE $${params.length} OR s.name ILIKE $${params.length})`);
    }
    if (active === 'true' || active === 'false') {
      params.push(active === 'true');
      filters.push(`s.active=$${params.length}`);
    }

    const countRows = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS total FROM suppliers s WHERE ${filters.join(' AND ')}`,
      ...params,
    );
    const offset = (page - 1) * limit;
    params.push(limit, offset);
    const rows = await prisma.$queryRawUnsafe(
      `SELECT s.id,s.supplier_code AS "supplierCode",s.name,s.active,
              s.created_at AS "createdAt",s.updated_at AS "updatedAt",
              COUNT(po.id)::int AS "purchaseOrderCount"
         FROM suppliers s
         LEFT JOIN purchase_orders po ON po.supplier_id=s.id AND po.shop_id=s.shop_id
        WHERE ${filters.join(' AND ')}
        GROUP BY s.id
        ORDER BY s.active DESC,s.name ASC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      ...params,
    );
    const total = Number(countRows[0]?.total || 0);
    res.json({ ok: true, page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)), suppliers: rows });
  }));

  app.get('/api/purchasing/suppliers/:id', ...read, wrap(async (req, res) => {
    await assertTablesReady();
    const rows = await prisma.$queryRawUnsafe(
      `SELECT s.id,s.supplier_code AS "supplierCode",s.name,s.active,
              s.created_at AS "createdAt",s.updated_at AS "updatedAt",
              COUNT(po.id)::int AS "purchaseOrderCount"
         FROM suppliers s
         LEFT JOIN purchase_orders po ON po.supplier_id=s.id AND po.shop_id=s.shop_id
        WHERE s.id=$1::uuid AND s.shop_id=$2::uuid
        GROUP BY s.id
        LIMIT 1`,
      req.params.id,
      req.auth.shopId,
    );
    if (!rows[0]) throw new ApiError(404, 'Supplier was not found');
    res.json({ ok: true, supplier: rows[0] });
  }));

  app.post('/api/purchasing/suppliers', ...write, wrap(async (req, res) => {
    await assertTablesReady();
    const input = parse(supplierCreateSchema, req.body || {});
    const supplier = await prisma.$transaction(async (tx) => {
      const code = input.supplierCode ? cleanCode(input.supplierCode) : await nextSupplierCode(tx, req.auth.shopId);
      if (!code) throw new ApiError(400, 'Supplier code is invalid');
      const rows = await tx.$queryRawUnsafe(
        `INSERT INTO suppliers (
           id,shop_id,supplier_code,name,active,created_by_id,updated_by_id,created_at,updated_at
         ) VALUES ($1::uuid,$2::uuid,$3,$4,$5,$6::uuid,$6::uuid,NOW(),NOW())
         RETURNING id,supplier_code AS "supplierCode",name,active,
                   created_at AS "createdAt",updated_at AS "updatedAt"`,
        crypto.randomUUID(),
        req.auth.shopId,
        code,
        input.name,
        input.active,
        req.auth.userId,
      );
      await audit(tx, req, 'SUPPLIER_CREATED', 'supplier', rows[0].id, {
        supplierCode: rows[0].supplierCode,
        name: rows[0].name,
        active: rows[0].active,
      });
      return rows[0];
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5000, timeout: 15000 });
    res.status(201).json({ ok: true, supplier });
  }));

  app.patch('/api/purchasing/suppliers/:id', ...write, wrap(async (req, res) => {
    await assertTablesReady();
    const input = parse(supplierUpdateSchema, req.body || {});
    const currentRows = await prisma.$queryRawUnsafe(
      `SELECT id,supplier_code AS "supplierCode",name,active
         FROM suppliers WHERE id=$1::uuid AND shop_id=$2::uuid LIMIT 1`,
      req.params.id,
      req.auth.shopId,
    );
    if (!currentRows[0]) throw new ApiError(404, 'Supplier was not found');
    const current = currentRows[0];
    const nextCode = input.supplierCode === undefined ? current.supplierCode : cleanCode(input.supplierCode);
    if (!nextCode) throw new ApiError(400, 'Supplier code is invalid');
    const rows = await prisma.$queryRawUnsafe(
      `UPDATE suppliers
          SET supplier_code=$3,name=$4,active=$5,updated_by_id=$6::uuid,updated_at=NOW()
        WHERE id=$1::uuid AND shop_id=$2::uuid
        RETURNING id,supplier_code AS "supplierCode",name,active,
                  created_at AS "createdAt",updated_at AS "updatedAt"`,
      req.params.id,
      req.auth.shopId,
      nextCode,
      input.name === undefined ? current.name : input.name,
      input.active === undefined ? current.active : input.active,
      req.auth.userId,
    );
    await audit(prisma, req, 'SUPPLIER_UPDATED', 'supplier', rows[0].id, {
      before: current,
      after: rows[0],
    });
    res.json({ ok: true, supplier: rows[0] });
  }));

  require('./purchase-order-api')(app);
}

module.exports = attachSupplierPurchasingApi;
