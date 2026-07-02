const { Prisma } = require('@prisma/client');
const { access, ApiError, wrap } = require('./purchase-order-core');
const { prisma, assertTablesReady, audit } = require('./purchase-order-db');
const { getOrderDetail } = require('./purchase-order-query');

function attachPoApproveApi(app) {
  app.post('/api/purchasing/orders/:id/approve', ...access.write, wrap(async (req, res) => {
    await assertTablesReady();

    await prisma.$transaction(async (tx) => {
      const order = await getOrderDetail(req.auth.shopId, req.params.id, tx, true);
      if (order.status === 'APPROVED') return;
      if (order.status !== 'DRAFT') {
        throw new ApiError(409, `Only DRAFT purchase orders can be approved; current status=${order.status}`);
      }
      if (!order.items.length) throw new ApiError(409, 'Purchase order has no items');

      await tx.$executeRawUnsafe(
        `UPDATE purchase_orders
            SET status='APPROVED',
                approved_at=NOW(),
                approved_by_id=$3::uuid,
                updated_by_id=$3::uuid,
                updated_at=NOW()
          WHERE id=$1::uuid AND shop_id=$2::uuid`,
        order.id,
        req.auth.shopId,
        req.auth.userId,
      );

      await audit(tx, req, 'PURCHASE_ORDER_APPROVED', order.id, {
        orderNumber: order.orderNumber,
        supplierId: order.supplierId,
        supplierCode: order.supplierCode,
        itemCount: order.itemCount,
        totalAmount: Number(order.totalAmount || 0),
        stockChanged: false,
      });
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      maxWait: 5000,
      timeout: 20000,
    });

    const order = await getOrderDetail(req.auth.shopId, req.params.id);
    res.json({ ok: true, order });
  }));
}

module.exports = attachPoApproveApi;
