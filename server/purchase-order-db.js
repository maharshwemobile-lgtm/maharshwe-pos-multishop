const { prisma } = require('./prisma');
const { ApiError } = require('./purchase-order-core');

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

async function audit(tx, req, action, entityId, details) {
  await tx.auditLog.create({
    data: {
      shopId: req.auth.shopId,
      userId: req.auth.userId,
      action,
      entityType: 'purchase_order',
      entityId,
      details,
      ipAddress: req.ip || null,
      userAgent: req.headers['user-agent'] || null,
    },
  });
}

async function nextOrderNumber(tx, shopId) {
  await tx.$queryRawUnsafe(
    `WITH advisory_lock AS (
       SELECT pg_advisory_xact_lock(hashtext($1))
     )
     SELECT 1::int AS acquired FROM advisory_lock`,
    `phase10:purchase-order:${shopId}`,
  );
  const rows = await tx.$queryRawUnsafe(
    `SELECT COALESCE(MAX(
       CASE WHEN order_number ~ '^PO[0-9]+$'
            THEN substring(order_number FROM 3)::int
            ELSE 0 END
     ),0)::int + 1 AS next_number
       FROM purchase_orders
      WHERE shop_id=$1::uuid`,
    shopId,
  );
  return `PO${String(Number(rows[0]?.next_number || 1)).padStart(6, '0')}`;
}

module.exports = { prisma, assertTablesReady, audit, nextOrderNumber };
