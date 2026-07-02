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
  receiveSchema,
} = require('./purchasing-completion-core');

const number = (value) => Number(value || 0);

async function receiptDetail(shopId, id, db = prisma) {
  const rows = await db.$queryRawUnsafe(
    `SELECT pr.id,
            pr.receipt_number AS "receiptNumber",
            pr.received_date AS "receivedDate",
            pr.total_amount AS "totalAmount",
            pr.note,
            pr.created_at AS "createdAt",
            po.id AS "purchaseOrderId",
            po.order_number AS "orderNumber",
            s.id AS "supplierId",
            s.supplier_code AS "supplierCode",
            s.name AS "supplierName"
       FROM purchase_receipts pr
       JOIN purchase_orders po ON po.id=pr.purchase_order_id AND po.shop_id=pr.shop_id
       JOIN suppliers s ON s.id=po.supplier_id AND s.shop_id=po.shop_id
      WHERE pr.id=$1::uuid AND pr.shop_id=$2::uuid
      LIMIT 1`,
    id,
    shopId,
  );
  if (!rows[0]) throw new ApiError(404, 'Goods receipt was not found');
  const items = await db.$queryRawUnsafe(
    `SELECT pri.id,
            pri.purchase_order_item_id AS "purchaseOrderItemId",
            pri.product_variant_id AS "productVariantId",
            poi.product_name_snapshot AS "productName",
            poi.variant_name_snapshot AS "variantName",
            poi.sku_snapshot AS sku,
            pri.quantity,
            pri.unit_cost AS "unitCost",
            pri.line_total AS "lineTotal",
            pri.before_quantity AS "beforeQuantity",
            pri.after_quantity AS "afterQuantity"
       FROM purchase_receipt_items pri
       JOIN purchase_order_items poi ON poi.id=pri.purchase_order_item_id AND poi.shop_id=pri.shop_id
      WHERE pri.purchase_receipt_id=$1::uuid AND pri.shop_id=$2::uuid
      ORDER BY pri.created_at,pri.id`,
    id,
    shopId,
  );
  return { ...rows[0], items };
}

function attachGoodsReceivingApi(app) {
  app.get('/api/purchasing/receipts', ...access.read, wrap(async (req, res) => {
    await assertCompletionTablesReady();
    const page = Math.max(1, Number.parseInt(req.query.page || '1', 10) || 1);
    const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit || '20', 10) || 20));
    const search = String(req.query.q || '').trim();
    const params = [req.auth.shopId];
    const filters = ['pr.shop_id=$1::uuid'];
    if (search) {
      params.push(`%${search}%`);
      filters.push(`(pr.receipt_number ILIKE $${params.length} OR po.order_number ILIKE $${params.length} OR s.name ILIKE $${params.length})`);
    }
    const count = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS total
         FROM purchase_receipts pr
         JOIN purchase_orders po ON po.id=pr.purchase_order_id AND po.shop_id=pr.shop_id
         JOIN suppliers s ON s.id=po.supplier_id AND s.shop_id=po.shop_id
        WHERE ${filters.join(' AND ')}`,
      ...params,
    );
    const offset = (page - 1) * limit;
    params.push(limit, offset);
    const rows = await prisma.$queryRawUnsafe(
      `SELECT pr.id,
              pr.receipt_number AS "receiptNumber",
              pr.received_date AS "receivedDate",
              pr.total_amount AS "totalAmount",
              pr.created_at AS "createdAt",
              po.id AS "purchaseOrderId",
              po.order_number AS "orderNumber",
              s.supplier_code AS "supplierCode",
              s.name AS "supplierName",
              (SELECT COALESCE(SUM(quantity),0)::int FROM purchase_receipt_items i WHERE i.purchase_receipt_id=pr.id AND i.shop_id=pr.shop_id) AS "receivedQuantity"
         FROM purchase_receipts pr
         JOIN purchase_orders po ON po.id=pr.purchase_order_id AND po.shop_id=pr.shop_id
         JOIN suppliers s ON s.id=po.supplier_id AND s.shop_id=po.shop_id
        WHERE ${filters.join(' AND ')}
        ORDER BY pr.received_date DESC,pr.created_at DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      ...params,
    );
    const total = Number(count[0]?.total || 0);
    res.json({ ok: true, page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)), receipts: rows });
  }));

  app.get('/api/purchasing/receipts/:id', ...access.read, wrap(async (req, res) => {
    await assertCompletionTablesReady();
    res.json({ ok: true, receipt: await receiptDetail(req.auth.shopId, req.params.id) });
  }));

  app.post('/api/purchasing/orders/:id/receive', ...access.write, wrap(async (req, res) => {
    await assertCompletionTablesReady();
    const input = parse(receiveSchema, req.body || {}, 'Invalid goods receiving request');
    const shopId = req.auth.shopId;

    const receiptId = await serializable(async (tx) => {
      const orderRows = await tx.$queryRawUnsafe(
        `SELECT po.id,po.order_number AS "orderNumber",po.status,po.supplier_id AS "supplierId",s.name AS "supplierName"
           FROM purchase_orders po
           JOIN suppliers s ON s.id=po.supplier_id AND s.shop_id=po.shop_id
          WHERE po.id=$1::uuid AND po.shop_id=$2::uuid
          LIMIT 1 FOR UPDATE OF po`,
        req.params.id,
        shopId,
      );
      const order = orderRows[0];
      if (!order) throw new ApiError(404, 'Purchase order was not found');
      if (!['APPROVED', 'PARTIALLY_RECEIVED'].includes(order.status)) {
        throw new ApiError(409, `Only APPROVED or PARTIALLY_RECEIVED orders can receive goods; current status=${order.status}`);
      }

      const requestedIds = input.items.map((item) => item.purchaseOrderItemId);
      if (new Set(requestedIds).size !== requestedIds.length) throw new ApiError(400, 'Duplicate purchase order items are not allowed');
      const items = await tx.$queryRawUnsafe(
        `SELECT id,
                product_variant_id AS "productVariantId",
                product_name_snapshot AS "productName",
                variant_name_snapshot AS "variantName",
                ordered_quantity AS "orderedQuantity",
                received_quantity AS "receivedQuantity",
                unit_cost AS "unitCost"
           FROM purchase_order_items
          WHERE purchase_order_id=$1::uuid AND shop_id=$2::uuid
          FOR UPDATE`,
        order.id,
        shopId,
      );
      const itemMap = new Map(items.map((item) => [item.id, item]));
      const receiptNumber = await nextNumber(tx, shopId, 'purchase_receipts', 'receipt_number', 'GR', 6);
      const id = crypto.randomUUID();
      let totalAmount = 0;

      await tx.$executeRawUnsafe(
        `INSERT INTO purchase_receipts (
           id,shop_id,purchase_order_id,receipt_number,received_date,total_amount,note,created_by_id,created_at
         ) VALUES ($1::uuid,$2::uuid,$3::uuid,$4,$5::date,0,$6,$7::uuid,NOW())`,
        id,
        shopId,
        order.id,
        receiptNumber,
        input.receivedDate,
        input.note || null,
        req.auth.userId,
      );

      for (const requested of input.items) {
        const item = itemMap.get(requested.purchaseOrderItemId);
        if (!item) throw new ApiError(404, 'Purchase order item was not found');
        const remaining = Number(item.orderedQuantity) - Number(item.receivedQuantity);
        if (requested.quantity > remaining) {
          throw new ApiError(409, `${item.productName} remaining quantity is ${remaining}`);
        }
        const unitCost = requested.unitCost === undefined ? number(item.unitCost) : Number(requested.unitCost);
        const lineTotal = Number(requested.quantity) * unitCost;
        totalAmount += lineTotal;

        const variant = await tx.productVariant.findFirst({ where: { id: item.productVariantId, shopId, active: true } });
        if (!variant) throw new ApiError(404, `${item.productName} product variant was not found`);
        const balance = await tx.inventoryBalance.findUnique({ where: { productVariantId: item.productVariantId } });
        if (balance && balance.shopId !== shopId) throw new ApiError(409, 'Inventory tenant mismatch');
        const beforeQuantity = Number(balance?.quantity || 0);
        const afterQuantity = beforeQuantity + Number(requested.quantity);
        const oldCost = number(variant.costPrice);
        const weightedCost = afterQuantity > 0
          ? ((beforeQuantity * oldCost) + (Number(requested.quantity) * unitCost)) / afterQuantity
          : unitCost;

        if (balance) {
          await tx.inventoryBalance.update({ where: { id: balance.id }, data: { quantity: afterQuantity } });
        } else {
          await tx.inventoryBalance.create({ data: { shopId, productVariantId: item.productVariantId, quantity: afterQuantity, minAlertQuantity: 0 } });
        }
        await tx.productVariant.update({ where: { id: item.productVariantId }, data: { costPrice: Number(weightedCost.toFixed(2)) } });
        await tx.$executeRawUnsafe(
          `UPDATE purchase_order_items SET received_quantity=received_quantity+$3,updated_at=NOW()
            WHERE id=$1::uuid AND shop_id=$2::uuid`,
          item.id,
          shopId,
          requested.quantity,
        );
        await tx.stockMovement.create({
          data: {
            shopId,
            productVariantId: item.productVariantId,
            type: 'STOCK_IN',
            quantityChange: Number(requested.quantity),
            beforeQuantity,
            afterQuantity,
            referenceType: 'PURCHASE_RECEIPT',
            referenceId: id,
            userId: req.auth.userId,
            note: `${receiptNumber} · ${order.orderNumber}`,
          },
        });
        await tx.$executeRawUnsafe(
          `INSERT INTO purchase_receipt_items (
             id,shop_id,purchase_receipt_id,purchase_order_item_id,product_variant_id,
             quantity,unit_cost,line_total,before_quantity,after_quantity,created_at
           ) VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6,$7,$8,$9,$10,NOW())`,
          crypto.randomUUID(),
          shopId,
          id,
          item.id,
          item.productVariantId,
          requested.quantity,
          unitCost,
          lineTotal,
          beforeQuantity,
          afterQuantity,
        );
      }

      await tx.$executeRawUnsafe(
        `UPDATE purchase_receipts SET total_amount=$3 WHERE id=$1::uuid AND shop_id=$2::uuid`,
        id,
        shopId,
        totalAmount,
      );

      const totals = await tx.$queryRawUnsafe(
        `SELECT COALESCE(SUM(ordered_quantity),0)::int AS ordered,
                COALESCE(SUM(received_quantity),0)::int AS received
           FROM purchase_order_items
          WHERE purchase_order_id=$1::uuid AND shop_id=$2::uuid`,
        order.id,
        shopId,
      );
      const nextStatus = Number(totals[0]?.received || 0) >= Number(totals[0]?.ordered || 0) ? 'RECEIVED' : 'PARTIALLY_RECEIVED';
      await tx.$executeRawUnsafe(
        `UPDATE purchase_orders SET status=$3,updated_by_id=$4::uuid,updated_at=NOW()
          WHERE id=$1::uuid AND shop_id=$2::uuid`,
        order.id,
        shopId,
        nextStatus,
        req.auth.userId,
      );
      await audit(tx, req, 'GOODS_RECEIVED', 'purchase_receipt', id, {
        receiptNumber,
        orderId: order.id,
        orderNumber: order.orderNumber,
        supplierId: order.supplierId,
        supplierName: order.supplierName,
        totalAmount,
        status: nextStatus,
        itemCount: input.items.length,
        stockChanged: true,
      });
      return id;
    }, 45000);

    const receipt = await receiptDetail(shopId, receiptId);
    res.status(201).json({ ok: true, message: 'Goods received and stock increased', receipt });
  }));
}

module.exports = attachGoodsReceivingApi;
