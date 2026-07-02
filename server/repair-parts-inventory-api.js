const crypto = require('crypto');
const {
  prisma, access, ApiError, parse, wrap, serializable, audit,
  assertCompletionTablesReady, repairPartsSchema, reverseRepairPartSchema,
} = require('./purchasing-completion-core');

const number = (value) => Number(value || 0);
const normalizeRepairNumber = (value) => String(value || '').trim().toUpperCase().replace(/\s+/g, '');

async function findRepair(db, shopId, identifier, lock = false) {
  const rows = await db.$queryRawUnsafe(
    `SELECT id,repair_number AS "repairNumber",customer_name AS "customerName",
            device_brand AS "deviceBrand",device_model AS "deviceModel",status,
            parts_cost AS "partsCost"
       FROM repairs
      WHERE shop_id=$1::uuid AND (id::text=$2 OR repair_number=$3)
      LIMIT 1${lock ? ' FOR UPDATE' : ''}`,
    shopId, String(identifier || ''), normalizeRepairNumber(identifier),
  );
  if (!rows[0]) throw new ApiError(404, 'Repair job was not found');
  return rows[0];
}

async function usageList(db, shopId, repairId) {
  return db.$queryRawUnsafe(
    `SELECT rpu.id,rpu.repair_id AS "repairId",rpu.product_variant_id AS "productVariantId",
            p.name AS "productName",pv.variant_name AS "variantName",pv.sku,
            rpu.quantity,rpu.unit_cost AS "unitCost",rpu.total_cost AS "totalCost",
            rpu.before_quantity AS "beforeQuantity",rpu.after_quantity AS "afterQuantity",
            rpu.note,rpu.reversed_at AS "reversedAt",rpu.reversal_reason AS "reversalReason",
            rpu.created_at AS "createdAt"
       FROM repair_part_usages rpu
       JOIN product_variants pv ON pv.id=rpu.product_variant_id AND pv.shop_id=rpu.shop_id
       JOIN products p ON p.id=pv.product_id AND p.shop_id=pv.shop_id
      WHERE rpu.shop_id=$1::uuid AND rpu.repair_id=$2::uuid
      ORDER BY rpu.created_at DESC,rpu.id DESC`,
    shopId, repairId,
  );
}

function attachRepairPartsInventoryApi(app) {
  app.get('/api/purchasing/repair-parts/:repairId', ...access.read, wrap(async (req, res) => {
    await assertCompletionTablesReady();
    const repair = await findRepair(prisma, req.auth.shopId, req.params.repairId);
    const usages = await usageList(prisma, req.auth.shopId, repair.id);
    res.json({ ok: true, repair, usages });
  }));

  app.post('/api/purchasing/repair-parts', ...access.write, wrap(async (req, res) => {
    await assertCompletionTablesReady();
    const input = parse(repairPartsSchema, req.body || {}, 'Invalid repair parts request');
    const shopId = req.auth.shopId;
    const repairId = await serializable(async (tx) => {
      const repair = await findRepair(tx, shopId, input.repairId, true);
      if (['CANNOT_REPAIR', 'DELIVERED'].includes(repair.status)) {
        throw new ApiError(409, `Parts cannot be added while repair status is ${repair.status}`);
      }
      const ids = input.items.map((item) => item.productVariantId);
      if (new Set(ids).size !== ids.length) throw new ApiError(400, 'Duplicate product variants are not allowed');
      const variants = await tx.productVariant.findMany({
        where: { id: { in: ids }, shopId, active: true }, include: { product: true },
      });
      if (variants.length !== ids.length) throw new ApiError(404, 'One or more repair parts were not found');
      const variantMap = new Map(variants.map((variant) => [variant.id, variant]));
      let addedCost = 0;
      const usageIds = [];

      for (const item of input.items) {
        const variant = variantMap.get(item.productVariantId);
        const balance = await tx.inventoryBalance.findUnique({ where: { productVariantId: variant.id } });
        if (!balance || balance.shopId !== shopId) throw new ApiError(409, `${variant.product?.name || 'Part'} stock balance was not found`);
        const beforeQuantity = Number(balance.quantity || 0);
        const afterQuantity = beforeQuantity - Number(item.quantity);
        if (afterQuantity < 0) throw new ApiError(409, `${variant.product?.name || 'Part'} stock is not enough`);
        const unitCost = number(variant.costPrice);
        const totalCost = unitCost * Number(item.quantity);
        const usageId = crypto.randomUUID();
        usageIds.push(usageId);
        addedCost += totalCost;

        await tx.inventoryBalance.update({ where: { id: balance.id }, data: { quantity: afterQuantity } });
        await tx.$executeRawUnsafe(
          `INSERT INTO repair_part_usages (
             id,shop_id,repair_id,product_variant_id,quantity,unit_cost,total_cost,
             before_quantity,after_quantity,note,created_by_id,created_at
           ) VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6,$7,$8,$9,$10,$11::uuid,NOW())`,
          usageId,shopId,repair.id,variant.id,item.quantity,unitCost,totalCost,
          beforeQuantity,afterQuantity,item.note || null,req.auth.userId,
        );
        await tx.stockMovement.create({ data: {
          shopId,productVariantId: variant.id,type: 'REPAIR_USAGE',
          quantityChange: -Number(item.quantity),beforeQuantity,afterQuantity,
          referenceType: 'REPAIR_PART_USAGE',referenceId: usageId,userId: req.auth.userId,
          note: `${repair.repairNumber} · ${variant.product?.name || 'Repair Part'}`,
        }});
      }

      await tx.$executeRawUnsafe(
        `UPDATE repairs SET parts_cost=COALESCE(parts_cost,0)+$3::numeric,updated_at=NOW()
          WHERE id=$1::uuid AND shop_id=$2::uuid`,
        repair.id,shopId,addedCost,
      );
      await audit(tx, req, 'REPAIR_PARTS_USED', 'repair', repair.id, {
        repairNumber: repair.repairNumber, usageIds, itemCount: input.items.length,
        addedCost, stockChanged: true,
      });
      return repair.id;
    }, 45000);

    const repair = await findRepair(prisma, shopId, repairId);
    res.status(201).json({ ok: true, message: 'Repair parts recorded', repair, usages: await usageList(prisma, shopId, repair.id) });
  }));

  app.post('/api/purchasing/repair-parts/usages/:id/reverse', ...access.write, wrap(async (req, res) => {
    await assertCompletionTablesReady();
    const input = parse(reverseRepairPartSchema, req.body || {}, 'Invalid repair part reversal request');
    const shopId = req.auth.shopId;
    const repairId = await serializable(async (tx) => {
      const rows = await tx.$queryRawUnsafe(
        `SELECT id,repair_id AS "repairId",product_variant_id AS "productVariantId",
                quantity,total_cost AS "totalCost",reversed_at AS "reversedAt"
           FROM repair_part_usages WHERE id=$1::uuid AND shop_id=$2::uuid LIMIT 1 FOR UPDATE`,
        req.params.id,shopId,
      );
      const usage = rows[0];
      if (!usage) throw new ApiError(404, 'Repair part usage was not found');
      if (usage.reversedAt) throw new ApiError(409, 'Repair part usage is already reversed');
      const repair = await findRepair(tx, shopId, usage.repairId, true);
      const balance = await tx.inventoryBalance.findUnique({ where: { productVariantId: usage.productVariantId } });
      if (!balance || balance.shopId !== shopId) throw new ApiError(409, 'Part stock balance was not found');
      const beforeQuantity = Number(balance.quantity || 0);
      const afterQuantity = beforeQuantity + Number(usage.quantity || 0);
      await tx.inventoryBalance.update({ where: { id: balance.id }, data: { quantity: afterQuantity } });
      await tx.$executeRawUnsafe(
        `UPDATE repair_part_usages SET reversed_at=NOW(),reversal_reason=$3,reversed_by_id=$4::uuid
          WHERE id=$1::uuid AND shop_id=$2::uuid`,
        usage.id,shopId,input.reason,req.auth.userId,
      );
      await tx.$executeRawUnsafe(
        `UPDATE repairs SET parts_cost=GREATEST(COALESCE(parts_cost,0)-$3::numeric,0),updated_at=NOW()
          WHERE id=$1::uuid AND shop_id=$2::uuid`,
        repair.id,shopId,number(usage.totalCost),
      );
      await tx.stockMovement.create({ data: {
        shopId,productVariantId: usage.productVariantId,type: 'REVERSAL',
        quantityChange: Number(usage.quantity || 0),beforeQuantity,afterQuantity,
        referenceType: 'REPAIR_PART_REVERSAL',referenceId: usage.id,userId: req.auth.userId,
        note: `${repair.repairNumber} · ${input.reason}`,
      }});
      await audit(tx, req, 'REPAIR_PART_USAGE_REVERSED', 'repair_part_usage', usage.id, {
        repairId: repair.id,repairNumber: repair.repairNumber,quantity: Number(usage.quantity || 0),
        totalCost: number(usage.totalCost),reason: input.reason,stockChanged: true,
      });
      return repair.id;
    });

    const repair = await findRepair(prisma, shopId, repairId);
    res.json({ ok: true, message: 'Repair part usage reversed', repair, usages: await usageList(prisma, shopId, repair.id) });
  }));
}

module.exports = attachRepairPartsInventoryApi;
