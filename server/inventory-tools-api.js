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

const uuid = z.string().uuid();
const nullableText = (max = 180) => z.union([z.string().trim().max(max), z.null()]).optional();
const nonNegativeMoney = z.coerce.number().finite().min(0);
const positiveQty = z.coerce.number().int().positive();

const importRowSchema = z.object({
  productName: nullableText(180),
  name: nullableText(180),
  brand: nullableText(120),
  model: nullableText(120),
  category: nullableText(120),
  productType: nullableText(80),
  variantName: nullableText(160),
  sku: nullableText(100),
  barcode: nullableText(100),
  ram: nullableText(60),
  storage: nullableText(60),
  color: nullableText(80),
  costPrice: nonNegativeMoney.optional(),
  standardSellingPrice: nonNegativeMoney.optional(),
  minimumSellingPrice: nonNegativeMoney.optional(),
  stockQuantity: z.coerce.number().int().min(0).optional(),
  minAlertQuantity: z.coerce.number().int().min(0).optional(),
});

const importSchema = z.object({
  rows: z.array(importRowSchema).min(1).max(5000),
  stockMode: z.enum(['set', 'add']).default('set'),
});

const purchaseSchema = z.object({
  supplierName: z.string().trim().min(1).max(180),
  invoiceNumber: nullableText(120),
  purchaseDate: z.string().trim().min(1).max(40),
  status: z.enum(['PAID', 'PARTIAL', 'CREDIT']).default('PAID'),
  note: nullableText(500),
  items: z.array(z.object({
    productVariantId: uuid,
    quantity: positiveQty,
    unitCost: nonNegativeMoney,
  })).min(1).max(500),
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
  if (!result.success) throw new ApiError(400, 'Invalid request', result.error.flatten().fieldErrors);
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
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2002') return res.status(409).json({ ok: false, message: 'Duplicate SKU or barcode' });
        if (error.code === 'P2025') return res.status(404).json({ ok: false, message: 'Record not found' });
      }
      console.error('Inventory tools API:', error);
      return res.status(500).json({ ok: false, message: error.message || 'Inventory request failed' });
    }
  };
}

const clean = (value) => {
  if (value === null || value === undefined) return null;
  return String(value).trim() || null;
};

const number = (value) => Number(value || 0);

async function stockTransaction(work) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.$transaction(work, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 5000,
        timeout: 30000,
      });
    } catch (error) {
      if (error.code === 'P2034' && attempt < 2) continue;
      throw error;
    }
  }
}

async function ensureCategory(tx, shopId, name) {
  const categoryName = clean(name) || 'Accessories';
  let category = await tx.category.findFirst({
    where: { shopId, name: { equals: categoryName, mode: 'insensitive' } },
  });
  if (!category) {
    category = await tx.category.create({ data: { shopId, name: categoryName, active: true } });
  }
  return category;
}

async function findVariantForImport(tx, shopId, row, productId) {
  const sku = clean(row.sku);
  const barcode = clean(row.barcode);
  if (sku) {
    const bySku = await tx.productVariant.findFirst({ where: { shopId, sku } });
    if (bySku) return bySku;
  }
  if (barcode) {
    const byBarcode = await tx.productVariant.findFirst({ where: { shopId, barcode } });
    if (byBarcode) return byBarcode;
  }
  const variantName = clean(row.variantName) || 'Default';
  return tx.productVariant.findFirst({
    where: { shopId, productId, variantName: { equals: variantName, mode: 'insensitive' } },
  });
}

function attachInventoryToolsApi(app) {
  const read = [requireAuth, requireShopUser, requirePermission('inventory')];
  const write = [requireAuth, requireShopUser, requireWritableSubscription, requirePermission('inventory')];

  app.get('/api/inventory/export', ...read, wrap(async (req, res) => {
    const rows = await prisma.productVariant.findMany({
      where: { shopId: req.auth.shopId },
      include: { product: true, category: true, inventoryBalance: true },
      orderBy: [{ product: { name: 'asc' } }, { variantName: 'asc' }],
    });

    const items = rows.map((variant) => ({
      productName: variant.product?.name || '',
      brand: variant.product?.brand || '',
      model: variant.product?.model || '',
      category: variant.category?.name || variant.product?.categoryId || '',
      productType: variant.product?.productType || '',
      variantName: variant.variantName,
      sku: variant.sku || '',
      barcode: variant.barcode || '',
      ram: variant.ram || '',
      storage: variant.storage || '',
      color: variant.color || '',
      costPrice: number(variant.costPrice),
      standardSellingPrice: number(variant.standardSellingPrice),
      minimumSellingPrice: number(variant.minimumSellingPrice),
      stockQuantity: Number(variant.inventoryBalance?.quantity || 0),
      minAlertQuantity: Number(variant.inventoryBalance?.minAlertQuantity || 0),
      active: variant.active,
    }));

    res.json({ ok: true, total: items.length, rows: items });
  }));

  app.post('/api/inventory/import', ...write, wrap(async (req, res) => {
    const input = parse(importSchema, req.body || {});
    const result = await stockTransaction(async (tx) => {
      const summary = {
        rows: input.rows.length,
        productsCreated: 0,
        variantsCreated: 0,
        variantsUpdated: 0,
        stockAdjusted: 0,
        skipped: 0,
      };

      for (let index = 0; index < input.rows.length; index += 1) {
        const row = input.rows[index];
        const productName = clean(row.productName || row.name || row.model);
        if (!productName) {
          summary.skipped += 1;
          continue;
        }

        const category = await ensureCategory(tx, req.auth.shopId, row.category);
        let product = await tx.product.findFirst({
          where: { shopId: req.auth.shopId, name: { equals: productName, mode: 'insensitive' } },
        });

        if (!product) {
          product = await tx.product.create({
            data: {
              shopId: req.auth.shopId,
              categoryId: category.id,
              name: productName,
              brand: clean(row.brand),
              model: clean(row.model),
              productType: clean(row.productType),
              active: true,
            },
          });
          summary.productsCreated += 1;
        } else {
          product = await tx.product.update({
            where: { id: product.id },
            data: {
              categoryId: category.id,
              ...(row.brand !== undefined ? { brand: clean(row.brand) } : {}),
              ...(row.model !== undefined ? { model: clean(row.model) } : {}),
              ...(row.productType !== undefined ? { productType: clean(row.productType) } : {}),
            },
          });
        }

        let variant = await findVariantForImport(tx, req.auth.shopId, row, product.id);
        const variantData = {
          categoryId: category.id,
          variantName: clean(row.variantName) || 'Default',
          sku: clean(row.sku),
          barcode: clean(row.barcode),
          ram: clean(row.ram),
          storage: clean(row.storage),
          color: clean(row.color),
          costPrice: row.costPrice ?? 0,
          standardSellingPrice: row.standardSellingPrice ?? 0,
          minimumSellingPrice: row.minimumSellingPrice ?? 0,
          active: true,
        };

        if (!variant) {
          variant = await tx.productVariant.create({
            data: {
              shopId: req.auth.shopId,
              productId: product.id,
              ...variantData,
            },
          });
          summary.variantsCreated += 1;
        } else {
          variant = await tx.productVariant.update({
            where: { id: variant.id },
            data: variantData,
          });
          summary.variantsUpdated += 1;
        }

        const balance = await tx.inventoryBalance.findUnique({ where: { productVariantId: variant.id } });
        const beforeQuantity = Number(balance?.quantity || 0);
        const suppliedQuantity = row.stockQuantity;
        const targetQuantity = suppliedQuantity === undefined
          ? beforeQuantity
          : input.stockMode === 'add'
            ? beforeQuantity + suppliedQuantity
            : suppliedQuantity;
        const delta = targetQuantity - beforeQuantity;

        await tx.inventoryBalance.upsert({
          where: { productVariantId: variant.id },
          update: {
            quantity: targetQuantity,
            ...(row.minAlertQuantity !== undefined ? { minAlertQuantity: row.minAlertQuantity } : {}),
          },
          create: {
            shopId: req.auth.shopId,
            productVariantId: variant.id,
            quantity: targetQuantity,
            minAlertQuantity: row.minAlertQuantity ?? 0,
          },
        });

        if (delta !== 0) {
          await tx.stockMovement.create({
            data: {
              shopId: req.auth.shopId,
              productVariantId: variant.id,
              type: delta > 0 ? 'STOCK_IN' : 'ADJUSTMENT',
              quantityChange: delta,
              beforeQuantity,
              afterQuantity: targetQuantity,
              referenceType: 'CSV_IMPORT',
              userId: req.auth.userId,
              note: `[CSV_IMPORT] Row ${index + 2}`,
            },
          });
          summary.stockAdjusted += 1;
        }
      }

      await tx.auditLog.create({
        data: {
          shopId: req.auth.shopId,
          userId: req.auth.userId,
          action: 'INVENTORY_CSV_IMPORTED',
          entityType: 'inventory',
          details: { ...summary, stockMode: input.stockMode },
          ipAddress: req.ip || null,
          userAgent: req.headers['user-agent'] || null,
        },
      });

      return summary;
    });

    res.status(201).json({ ok: true, summary: result });
  }));

  app.get('/api/inventory/purchases', ...read, wrap(async (req, res) => {
    const page = Math.max(1, Number.parseInt(req.query.page || '1', 10) || 1);
    const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit || '20', 10) || 20));
    const where = { shopId: req.auth.shopId, action: 'PURCHASE_STOCK_RECEIVED' };
    const [total, logs] = await prisma.$transaction([
      prisma.auditLog.count({ where }),
      prisma.auditLog.findMany({
        where,
        include: { user: { select: { id: true, name: true, username: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);
    const purchases = logs.map((log) => ({
      id: log.entityId || log.id,
      createdAt: log.createdAt,
      user: log.user,
      ...(log.details || {}),
    }));
    res.json({ ok: true, page, limit, total, totalPages: Math.ceil(total / limit), purchases });
  }));

  app.post('/api/inventory/purchases', ...write, wrap(async (req, res) => {
    const input = parse(purchaseSchema, req.body || {});
    const purchaseId = crypto.randomUUID();
    const result = await stockTransaction(async (tx) => {
      const purchaseItems = [];
      let totalAmount = 0;

      for (const item of input.items) {
        const variant = await tx.productVariant.findFirst({
          where: { id: item.productVariantId, shopId: req.auth.shopId, active: true },
          include: { product: true, inventoryBalance: true },
        });
        if (!variant) throw new ApiError(404, 'One or more product variants were not found');

        const beforeQuantity = Number(variant.inventoryBalance?.quantity || 0);
        const afterQuantity = beforeQuantity + item.quantity;
        const lineTotal = item.quantity * item.unitCost;
        totalAmount += lineTotal;

        await tx.productVariant.update({
          where: { id: variant.id },
          data: { costPrice: item.unitCost },
        });
        await tx.inventoryBalance.upsert({
          where: { productVariantId: variant.id },
          update: { quantity: afterQuantity },
          create: {
            shopId: req.auth.shopId,
            productVariantId: variant.id,
            quantity: afterQuantity,
            minAlertQuantity: 0,
          },
        });
        await tx.stockMovement.create({
          data: {
            shopId: req.auth.shopId,
            productVariantId: variant.id,
            type: 'STOCK_IN',
            quantityChange: item.quantity,
            beforeQuantity,
            afterQuantity,
            referenceType: 'PURCHASE',
            referenceId: purchaseId,
            userId: req.auth.userId,
            note: [input.invoiceNumber, input.supplierName, clean(input.note)].filter(Boolean).join(' · '),
          },
        });

        purchaseItems.push({
          productVariantId: variant.id,
          productName: variant.product?.name || '',
          variantName: variant.variantName,
          sku: variant.sku,
          quantity: item.quantity,
          unitCost: item.unitCost,
          lineTotal,
          beforeQuantity,
          afterQuantity,
        });
      }

      const purchase = {
        purchaseId,
        supplierName: input.supplierName,
        invoiceNumber: clean(input.invoiceNumber),
        purchaseDate: input.purchaseDate,
        status: input.status,
        note: clean(input.note),
        totalAmount,
        itemCount: purchaseItems.length,
        items: purchaseItems,
      };

      await tx.auditLog.create({
        data: {
          shopId: req.auth.shopId,
          userId: req.auth.userId,
          action: 'PURCHASE_STOCK_RECEIVED',
          entityType: 'purchase',
          entityId: purchaseId,
          details: purchase,
          ipAddress: req.ip || null,
          userAgent: req.headers['user-agent'] || null,
        },
      });

      return purchase;
    });

    res.status(201).json({ ok: true, purchase: result });
  }));
}

module.exports = attachInventoryToolsApi;
