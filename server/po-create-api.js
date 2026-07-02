const crypto = require('crypto');
const { Prisma } = require('@prisma/client');
const { access, ApiError, createOrderSchema, parse, wrap } = require('./purchase-order-core');
const { prisma, assertTablesReady, audit, nextOrderNumber } = require('./purchase-order-db');
const { getOrderDetail } = require('./purchase-order-query');

function attachPoCreateApi(app) {
  app.post('/api/purchasing/orders', ...access.write, wrap(async (req, res) => {
    await assertTablesReady();
    const input = parse(createOrderSchema, req.body || {});

    const orderId = await prisma.$transaction(async (tx) => {
      const supplierRows = await tx.$queryRawUnsafe(
        `SELECT id,supplier_code AS "supplierCode",name
           FROM suppliers
          WHERE id=$1::uuid AND shop_id=$2::uuid AND active=TRUE
          LIMIT 1`,
        input.supplierId,
        req.auth.shopId,
      );
      const supplier = supplierRows[0];
      if (!supplier) throw new ApiError(404, 'Active supplier was not found');

      const variantIds = input.items.map((item) => item.productVariantId);
      const variants = await tx.productVariant.findMany({
        where: { id: { in: variantIds }, shopId: req.auth.shopId, active: true },
        include: { product: true },
      });
      if (variants.length !== variantIds.length) {
        throw new ApiError(404, 'One or more product variants were not found');
      }
      const variantMap = new Map(variants.map((variant) => [variant.id, variant]));
      const id = crypto.randomUUID();
      const orderNumber = await nextOrderNumber(tx, req.auth.shopId);

      await tx.$executeRawUnsafe(
        `INSERT INTO purchase_orders (
           id,shop_id,supplier_id,order_number,order_date,expected_date,status,notes,
           created_by_id,updated_by_id,created_at,updated_at
         ) VALUES ($1::uuid,$2::uuid,$3::uuid,$4,$5::date,$6::date,'DRAFT',$7,$8::uuid,$8::uuid,NOW(),NOW())`,
        id,
        req.auth.shopId,
        input.supplierId,
        orderNumber,
        input.orderDate,
        input.expectedDate || null,
        input.notes || null,
        req.auth.userId,
      );

      let totalAmount = 0;
      for (const item of input.items) {
        const variant = variantMap.get(item.productVariantId);
        const lineTotal = Number(item.quantity) * Number(item.unitCost);
        totalAmount += lineTotal;
        await tx.$executeRawUnsafe(
          `INSERT INTO purchase_order_items (
             id,shop_id,purchase_order_id,product_variant_id,
             product_name_snapshot,variant_name_snapshot,sku_snapshot,
             ordered_quantity,received_quantity,unit_cost,line_total,note,created_at,updated_at
           ) VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6,$7,$8,0,$9,$10,$11,NOW(),NOW())`,
          crypto.randomUUID(),
          req.auth.shopId,
          id,
          variant.id,
          variant.product?.name || 'Unknown Product',
          variant.variantName || null,
          variant.sku || null,
          item.quantity,
          item.unitCost,
          lineTotal,
          item.note || null,
        );
      }

      await audit(tx, req, 'PURCHASE_ORDER_DRAFT_CREATED', id, {
        orderNumber,
        supplierId: supplier.id,
        supplierCode: supplier.supplierCode,
        supplierName: supplier.name,
        itemCount: input.items.length,
        totalAmount,
        stockChanged: false,
      });
      return id;
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      maxWait: 5000,
      timeout: 30000,
    });

    const order = await getOrderDetail(req.auth.shopId, orderId);
    res.status(201).json({ ok: true, order });
  }));
}

module.exports = attachPoCreateApi;
