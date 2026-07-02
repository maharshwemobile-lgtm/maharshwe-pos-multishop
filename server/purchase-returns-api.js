const crypto = require('crypto');
const {
  prisma,
  access,
  ApiError,
  parse,
  wrap,
  serializable,
  audit,
  nextNumber,
  assertCompletionTablesReady,
  supplierReturnSchema,
} = require('./purchasing-completion-core');

const number = (value) => Number(value || 0);

async function returnDetail(shopId, id, db = prisma) {
  const rows = await db.$queryRawUnsafe(
    `SELECT pr.id,
            pr.return_number AS "returnNumber",
            pr.return_date AS "returnDate",
            pr.reason,
            pr.total_amount AS "totalAmount",
            pr.created_at AS "createdAt",
            po.id AS "purchaseOrderId",
            po.order_number AS "orderNumber",
            s.id AS "supplierId",
            s.supplier_code AS "supplierCode",
            s.name AS "supplierName"
       FROM purchase_returns pr
       JOIN purchase_orders po ON po.id=pr.purchase_order_id AND po.shop_id=pr.shop_id
       JOIN suppliers s ON s.id=pr.supplier_id AND s.shop_id=pr.shop_id
      WHERE pr.id=$1::uuid AND pr.shop_id=$2::uuid
      LIMIT 1`,
    id,
    shopId,
  );
  if (!rows[0]) throw new ApiError(404, 'Purchase return was not found');
  const items = await db.$queryRawUnsafe(
    `SELECT id,
            purchase_order_item_id AS "purchaseOrderItemId",
            product_variant_id AS "productVariantId",
            product_name_snapshot AS "productName",
            variant_name_snapshot AS "variantName",
            sku_snapshot AS sku,
            quantity,
            unit_cost AS "unitCost",
            line_total AS "lineTotal",
            before_quantity AS "beforeQuantity",
            after_quantity AS "afterQuantity",
            note
       FROM purchase_return_items
      WHERE purchase_return_id=$1::uuid AND shop_id=$2::uuid
      ORDER BY created_at,id`,
    id,
    shopId,
  );
  return { ...rows[0], items };
}

function attachPurchaseReturnsApi(app) {
  app.get('/api/purchasing/returns', ...access.read, wrap(async (req, res) => {
    await assertCompletionTablesReady();
    const page = Math.max(1, Number.parseInt(req.query.page || '1', 10) || 1);
    const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit || '20', 10) || 20));
    const search = String(req.query.q || '').trim();
    const params = [req.auth.shopId];
    const filters = ['pr.shop_id=$1::uuid'];
    if (search) {
      params.push(`%${search}%`);
      filters.push(`(pr.return_number ILIKE $${params.length} OR po.order_number ILIKE $${params.length} OR s.name ILIKE $${params.length})`);
    }
    const countRows = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS total
         FROM purchase_returns pr
         JOIN purchase_orders po ON po.id=pr.purchase_order_id AND po.shop_id=pr.shop_id
         JOIN suppliers s ON s.id=pr.supplier_id AND s.shop_id=pr.shop_id
        WHERE ${filters.join(' AND ')}`,
      ...params,
    );
    const offset = (page - 1) * limit;
    params.push(limit, offset);
    const rows = await prisma.$queryRawUnsafe(
      `SELECT pr.id,
              pr.return_number AS "returnNumber",
              pr.return_date AS "returnDate",
              pr.reason,
              pr.total_amount AS "totalAmount",
              pr.created_at AS "createdAt",
              po.id AS "purchaseOrderId",
              po.order_number AS "orderNumber",
              s.supplier_code AS "supplierCode",
              s.name AS "supplierName",
              (SELECT COALESCE(SUM(quantity),0)::int FROM purchase_return_items i WHERE i.purchase_return_id=pr.id AND i.shop_id=pr.shop_id) AS quantity
         FROM purchase_returns pr
         JOIN purchase_orders po ON po.id=pr.purchase_order_id AND po.shop_id=pr.shop_id
         JOIN suppliers s ON s.id=pr.supplier_id AND s.shop_id=pr.shop_id
        WHERE ${filters.join(' AND ')}
        ORDER BY pr.return_date DESC,pr.created_at DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      ...params,
    );
    const total = Number(countRows[0]?.total || 0);
    res.json({ ok: true, page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)), returns: rows });
  }));

  app.get('/api/purchasing/returns/:id', ...access.read, wrap(async (req, res) => {
    await assertCompletionTablesReady();
    res.json({ ok: true, purchaseReturn: await returnDetail(req.auth.shopId, req.params.id) });
  }));

  app.post('/api/purchasing/returns', ...access.write, wrap(async (req, res) => {
    await assertCompletionTablesReady();
    const input = parse(supplierReturnSchema, req.body || {}, 'Invalid supplier return request');
    const shopId = req.auth.shopId;

    const returnId = await serializable(async (tx) => {
      const orderRows = await tx.$queryRawUnsafe(
        `SELECT po.id,po.order_number AS "orderNumber",po.status,po.supplier_id AS "supplierId",s.name AS "supplierName"
           FROM purchase_orders po
           JOIN suppliers s ON s.id=po.supplier_id AND s.shop_id=po.shop_id
          WHERE po.id=$1::uuid AND po.shop_id=$2::uuid
          LIMIT 1 FOR UPDATE OF po`,
        input.purchaseOrderId,
        shopId,
      );
      const order = orderRows[0];
      if (!order) throw new ApiError(404, 'Purchase order was not found');
      if (!['PARTIALLY_RECEIVED', 'RECEIVED'].includes(order.status)) {
        throw new ApiError(409, 'Only received Purchase Orders can return goods');
      }
      const requestedIds = input.items.map((item) => item.purchaseOrderItemId);
      if (new Set(requestedIds).size !== requestedIds.length) throw new ApiError(400, 'Duplicate return items are not allowed');
      const items = await tx.$queryRawUnsafe(
        `SELECT id,
                product_variant_id AS "productVariantId",
                product_name_snapshot AS "productName",
                variant_name_snapshot AS "variantName",
                sku_snapshot AS sku,
                received_quantity AS "receivedQuantity",
                returned_quantity AS "returnedQuantity",
                unit_cost AS "unitCost"
           FROM purchase_order_items
          WHERE purchase_order_id=$1::uuid AND shop_id=$2::uuid
          FOR UPDATE`,
        order.id,
        shopId,
      );
      const itemMap = new Map(items.map((item) => [item.id, item]));
      const id = crypto.randomUUID();
      const returnNumber = await nextNumber(tx, shopId, 'purchase_returns', 'return_number', 'RT', 6);
      let totalAmount = 0;

      await tx.$executeRawUnsafe(
        `INSERT INTO purchase_returns (
           id,shop_id,supplier_id,purchase_order_id,return_number,return_date,reason,total_amount,created_by_id,created_at
         ) VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6::date,$7,0,$8::uuid,NOW())`,
        id,
        shopId,
        order.supplierId,
        order.id,
        returnNumber,
        input.returnDate,
        input.reason,
        req.auth.userId,
      );

      for (const requested of input.items) {
        const item = itemMap.get(requested.purchaseOrderItemId);
        if (!item) throw new ApiError(404, 'Purchase order item was not found');
        const returnable = Number(item.receivedQuantity) - Number(item.returnedQuantity);
        if (requested.quantity > returnable) {
          throw new ApiError(409, `${item.productName} returnable quantity is ${returnable}`);
        }
        const unitCost = number(item.unitCost);
        const lineTotal = Number(requested.quantity) * unitCost;
        totalAmount += lineTotal;

        const balance = await tx.inventoryBalance.findUnique({ where: { productVariantId: item.productVariantId } });
        if (!balance || balance.shopId !== shopId) throw new ApiError(409, `${item.productName} stock balance was not found`);
        const beforeQuantity = Number(balance.quantity || 0);
        const afterQuantity = beforeQuantity - Number(requested.quantity);
        if (afterQuantity < 0) throw new ApiError(409, `${item.productName} stock is not enough for return`);
        await tx.inventoryBalance.update({ where: { id: balance.id }, data: { quantity: afterQuantity } });
        await tx.$executeRawUnsafe(
          `UPDATE purchase_order_items SET returned_quantity=returned_quantity+$3,updated_at=NOW()
            WHERE id=$1::uuid AND shop_id=$2::uuid`,
          item.id,
          shopId,
          requested.quantity,
        );
        await tx.stockMovement.create({
          data: {
            shopId,
            productVariantId: item.productVariantId,
            type: 'REVERSAL',
            quantityChange: -Number(requested.quantity),
            beforeQuantity,
            afterQuantity,
            referenceType: 'PURCHASE_RETURN',
            referenceId: id,
            userId: req.auth.userId,
            note: `${returnNumber} · ${order.orderNumber} · ${input.reason}`,
          },
        });
        await tx.$executeRawUnsafe(
          `INSERT INTO purchase_return_items (
             id,shop_id,purchase_return_id,purchase_order_item_id,product_variant_id,
             product_name_snapshot,variant_name_snapshot,sku_snapshot,quantity,unit_cost,line_total,
             before_quantity,after_quantity,note,created_at
           ) VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW())`,
          crypto.randomUUID(),
          shopId,
          id,
          item.id,
          item.productVariantId,
          item.productName,
          item.variantName || null,
          item.sku || null,
          requested.quantity,
          unitCost,
          lineTotal,
          beforeQuantity,
          afterQuantity,
          requested.note || null,
        );
      }

      await tx.$executeRawUnsafe(
        `UPDATE purchase_returns SET total_amount=$3 WHERE id=$1::uuid AND shop_id=$2::uuid`,
        id,
        shopId,
        totalAmount,
      );
      await audit(tx, req, 'PURCHASE_RETURN_COMPLETED', 'purchase_return', id, {
        returnNumber,
        orderId: order.id,
        orderNumber: order.orderNumber,
        supplierId: order.supplierId,
        supplierName: order.supplierName,
        totalAmount,
        itemCount: input.items.length,
        stockChanged: true,
      });
      return id;
    }, 45000);

    res.status(201).json({ ok: true, message: 'Supplier return completed and stock reduced', purchaseReturn: await returnDetail(shopId, returnId) });
  }));
}

module.exports = attachPurchaseReturnsApi;
