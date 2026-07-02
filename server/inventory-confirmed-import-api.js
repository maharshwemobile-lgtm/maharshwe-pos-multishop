const { z } = require('zod');
const { Prisma } = require('@prisma/client');
const { prisma } = require('./prisma');
const {
  requireAuth,
  requireShopUser,
  requirePermission,
  requireWritableSubscription,
} = require('./auth-api');

const nullableText = (max = 180) => z.union([z.string().trim().max(max), z.null()]).optional();
const nonNegativeMoney = z.coerce.number().finite().min(0);

const rowSchema = z.object({
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
  confirmed: z.literal(true),
  rows: z.array(rowSchema).min(1).max(5000),
  stockMode: z.enum(['set', 'add']).default('set'),
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
  if (!result.success) throw new ApiError(400, 'Import confirmation is required', result.error.flatten().fieldErrors);
  return result.data;
}

function wrap(handler) {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (error) {
      if (error instanceof ApiError) return res.status(error.status).json({ ok: false, message: error.message, details: error.details });
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2002') return res.status(409).json({ ok: false, message: 'Duplicate SKU or barcode' });
      }
      console.error('Confirmed inventory import:', error);
      return res.status(500).json({ ok: false, message: error.message || 'Inventory import failed' });
    }
  };
}

const clean = (value) => {
  if (value === null || value === undefined) return null;
  return String(value).trim() || null;
};

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
  let category = await tx.category.findFirst({ where: { shopId, name: { equals: categoryName, mode: 'insensitive' } } });
  if (!category) category = await tx.category.create({ data: { shopId, name: categoryName, active: true } });
  return category;
}

async function findVariant(tx, shopId, row, productId) {
  if (clean(row.sku)) {
    const item = await tx.productVariant.findFirst({ where: { shopId, sku: clean(row.sku) } });
    if (item) return item;
  }
  if (clean(row.barcode)) {
    const item = await tx.productVariant.findFirst({ where: { shopId, barcode: clean(row.barcode) } });
    if (item) return item;
  }
  return tx.productVariant.findFirst({
    where: {
      shopId,
      productId,
      variantName: { equals: clean(row.variantName) || 'Default', mode: 'insensitive' },
    },
  });
}

function attachInventoryConfirmedImportApi(app) {
  const access = [requireAuth, requireShopUser, requireWritableSubscription, requirePermission('inventory')];

  app.post('/api/inventory/import', ...access, wrap(async (req, res) => {
    const input = parse(importSchema, req.body || {});

    const summary = await stockTransaction(async (tx) => {
      const result = {
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
          result.skipped += 1;
          continue;
        }

        const category = await ensureCategory(tx, req.auth.shopId, row.category);
        let product = await tx.product.findFirst({ where: { shopId: req.auth.shopId, name: { equals: productName, mode: 'insensitive' } } });
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
          result.productsCreated += 1;
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

        let variant = await findVariant(tx, req.auth.shopId, row, product.id);
        if (!variant) {
          const standard = row.standardSellingPrice ?? 0;
          const minimum = row.minimumSellingPrice ?? 0;
          if (standard > 0 && minimum > standard) throw new ApiError(400, `Row ${index + 2}: minimum price exceeds standard price`);
          variant = await tx.productVariant.create({
            data: {
              shopId: req.auth.shopId,
              productId: product.id,
              categoryId: category.id,
              variantName: clean(row.variantName) || 'Default',
              sku: clean(row.sku),
              barcode: clean(row.barcode),
              ram: clean(row.ram),
              storage: clean(row.storage),
              color: clean(row.color),
              costPrice: row.costPrice ?? 0,
              standardSellingPrice: standard,
              minimumSellingPrice: minimum,
              active: true,
            },
          });
          result.variantsCreated += 1;
        } else {
          const standard = row.standardSellingPrice ?? Number(variant.standardSellingPrice || 0);
          const minimum = row.minimumSellingPrice ?? Number(variant.minimumSellingPrice || 0);
          if (standard > 0 && minimum > standard) throw new ApiError(400, `Row ${index + 2}: minimum price exceeds standard price`);
          variant = await tx.productVariant.update({
            where: { id: variant.id },
            data: {
              categoryId: category.id,
              ...(row.variantName !== undefined ? { variantName: clean(row.variantName) || 'Default' } : {}),
              ...(row.sku !== undefined ? { sku: clean(row.sku) } : {}),
              ...(row.barcode !== undefined ? { barcode: clean(row.barcode) } : {}),
              ...(row.ram !== undefined ? { ram: clean(row.ram) } : {}),
              ...(row.storage !== undefined ? { storage: clean(row.storage) } : {}),
              ...(row.color !== undefined ? { color: clean(row.color) } : {}),
              ...(row.costPrice !== undefined ? { costPrice: row.costPrice } : {}),
              ...(row.standardSellingPrice !== undefined ? { standardSellingPrice: row.standardSellingPrice } : {}),
              ...(row.minimumSellingPrice !== undefined ? { minimumSellingPrice: row.minimumSellingPrice } : {}),
              active: true,
            },
          });
          result.variantsUpdated += 1;
        }

        const balance = await tx.inventoryBalance.findUnique({ where: { productVariantId: variant.id } });
        const beforeQuantity = Number(balance?.quantity || 0);
        const targetQuantity = row.stockQuantity === undefined
          ? beforeQuantity
          : input.stockMode === 'add'
            ? beforeQuantity + row.stockQuantity
            : row.stockQuantity;
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
              note: `[CONFIRMED_CSV_IMPORT] Row ${index + 2}`,
            },
          });
          result.stockAdjusted += 1;
        }
      }

      await tx.auditLog.create({
        data: {
          shopId: req.auth.shopId,
          userId: req.auth.userId,
          action: 'INVENTORY_CSV_IMPORTED_CONFIRMED',
          entityType: 'inventory',
          details: { ...result, stockMode: input.stockMode, confirmed: true },
          ipAddress: req.ip || null,
          userAgent: req.headers['user-agent'] || null,
        },
      });

      return result;
    });

    res.status(201).json({ ok: true, summary });
  }));
}

module.exports = attachInventoryConfirmedImportApi;
