const { access, ApiError, wrap } = require('./purchase-order-core');
const { prisma, assertTablesReady } = require('./purchase-order-db');
const { getOrderDetail } = require('./purchase-order-query');

const statuses = new Set(['DRAFT', 'APPROVED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED']);

function attachPurchaseOrderReadApi(app) {
  app.get('/api/purchasing/orders', ...access.read, wrap(async (req, res) => {
    await assertTablesReady();
    const page = Math.max(1, Number.parseInt(req.query.page || '1', 10) || 1);
    const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit || '20', 10) || 20));
    const search = String(req.query.q || '').trim();
    const status = String(req.query.status || '').trim().toUpperCase();
    const supplierId = String(req.query.supplierId || '').trim();
    const params = [req.auth.shopId];
    const filters = ['po.shop_id=$1::uuid'];

    if (status && !statuses.has(status)) throw new ApiError(400, 'Invalid purchase order status');
    if (search) {
      params.push(`%${search}%`);
      filters.push(`(po.order_number ILIKE $${params.length} OR s.name ILIKE $${params.length} OR s.supplier_code ILIKE $${params.length})`);
    }
    if (status) {
      params.push(status);
      filters.push(`po.status=$${params.length}`);
    }
    if (supplierId) {
      params.push(supplierId);
      filters.push(`po.supplier_id=$${params.length}::uuid`);
    }

    const countRows = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS total
         FROM purchase_orders po
         JOIN suppliers s ON s.id=po.supplier_id AND s.shop_id=po.shop_id
        WHERE ${filters.join(' AND ')}`,
      ...params,
    );
    const offset = (page - 1) * limit;
    params.push(limit, offset);
    const rows = await prisma.$queryRawUnsafe(
      `SELECT po.id,
              po.order_number AS "orderNumber",
              po.order_date AS "orderDate",
              po.expected_date AS "expectedDate",
              po.status,
              po.notes,
              po.approved_at AS "approvedAt",
              po.created_at AS "createdAt",
              s.id AS "supplierId",
              s.supplier_code AS "supplierCode",
              s.name AS "supplierName",
              (SELECT COALESCE(SUM(i.line_total),0) FROM purchase_order_items i WHERE i.purchase_order_id=po.id AND i.shop_id=po.shop_id) AS "totalAmount",
              (SELECT COALESCE(SUM(i.ordered_quantity),0)::int FROM purchase_order_items i WHERE i.purchase_order_id=po.id AND i.shop_id=po.shop_id) AS "orderedQuantity",
              (SELECT COALESCE(SUM(i.received_quantity),0)::int FROM purchase_order_items i WHERE i.purchase_order_id=po.id AND i.shop_id=po.shop_id) AS "receivedQuantity",
              (SELECT COALESCE(SUM(i.returned_quantity),0)::int FROM purchase_order_items i WHERE i.purchase_order_id=po.id AND i.shop_id=po.shop_id) AS "returnedQuantity",
              (SELECT COALESCE(SUM(i.ordered_quantity-i.received_quantity),0)::int FROM purchase_order_items i WHERE i.purchase_order_id=po.id AND i.shop_id=po.shop_id) AS "remainingQuantity",
              (SELECT COUNT(*)::int FROM purchase_order_items i WHERE i.purchase_order_id=po.id AND i.shop_id=po.shop_id) AS "itemCount"
         FROM purchase_orders po
         JOIN suppliers s ON s.id=po.supplier_id AND s.shop_id=po.shop_id
        WHERE ${filters.join(' AND ')}
        ORDER BY po.order_date DESC,po.created_at DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      ...params,
    );
    const total = Number(countRows[0]?.total || 0);
    res.json({ ok: true, page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)), orders: rows });
  }));

  app.get('/api/purchasing/orders/:id', ...access.read, wrap(async (req, res) => {
    await assertTablesReady();
    const order = await getOrderDetail(req.auth.shopId, req.params.id);
    res.json({ ok: true, order });
  }));
}

module.exports = attachPurchaseOrderReadApi;
