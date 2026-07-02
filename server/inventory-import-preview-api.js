const { z } = require('zod');
const { prisma } = require('./prisma');
const {
  requireAuth,
  requireShopUser,
  requirePermission,
  requireWritableSubscription,
} = require('./auth-api');

const nullableText = (max = 180) => z.union([z.string().trim().max(max), z.null()]).optional();
const nonNegativeMoney = z.coerce.number().finite().min(0);

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

const previewSchema = z.object({
  rows: z.array(importRowSchema).min(1).max(5000),
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
      console.error('Inventory import preview API:', error);
      return res.status(500).json({ ok: false, message: error.message || 'Import preview failed' });
    }
  };
}

const clean = (value) => {
  if (value === null || value === undefined) return null;
  return String(value).trim() || null;
};

const key = (value) => String(value || '').trim().toLowerCase();

function attachInventoryImportPreviewApi(app) {
  const previewAccess = [
    requireAuth,
    requireShopUser,
    requireWritableSubscription,
    requirePermission('inventory'),
  ];

  app.post('/api/inventory/import/preview', ...previewAccess, wrap(async (req, res) => {
    const input = parse(previewSchema, req.body || {});

    const [categories, products, variants] = await Promise.all([
      prisma.category.findMany({
        where: { shopId: req.auth.shopId },
        select: { id: true, name: true },
      }),
      prisma.product.findMany({
        where: { shopId: req.auth.shopId },
        select: { id: true, name: true },
      }),
      prisma.productVariant.findMany({
        where: { shopId: req.auth.shopId },
        include: {
          product: { select: { id: true, name: true } },
          inventoryBalance: true,
        },
      }),
    ]);

    const categoryNames = new Set(categories.map((item) => key(item.name)));
    const productsByName = new Map(products.map((item) => [key(item.name), item]));
    const variantsBySku = new Map();
    const variantsByBarcode = new Map();
    const variantsByProductAndName = new Map();

    for (const variant of variants) {
      if (variant.sku) variantsBySku.set(key(variant.sku), variant);
      if (variant.barcode) variantsByBarcode.set(key(variant.barcode), variant);
      variantsByProductAndName.set(`${key(variant.product?.name)}|${key(variant.variantName)}`, variant);
    }

    const plannedCategories = new Set();
    const plannedProducts = new Set();
    const plannedVariants = new Set();
    const touchedProducts = new Set();
    const touchedVariants = new Set();
    const seenSkus = new Map();
    const seenBarcodes = new Map();
    const warnings = [];
    const sample = [];

    let validRows = 0;
    let skipped = 0;
    let stockRowsChanged = 0;
    let totalStockIncrease = 0;
    let totalStockDecrease = 0;
    let lowAlertRowsChanged = 0;

    for (let index = 0; index < input.rows.length; index += 1) {
      const row = input.rows[index];
      const rowNumber = index + 2;
      const productName = clean(row.productName || row.name || row.model);
      const categoryName = clean(row.category) || 'Accessories';
      const variantName = clean(row.variantName) || 'Default';
      const sku = clean(row.sku);
      const barcode = clean(row.barcode);

      if (!productName) {
        skipped += 1;
        warnings.push(`Row ${rowNumber}: productName is missing.`);
        continue;
      }

      validRows += 1;

      if (!categoryNames.has(key(categoryName))) plannedCategories.add(key(categoryName));

      const productKey = key(productName);
      const existingProduct = productsByName.get(productKey);
      if (existingProduct) touchedProducts.add(existingProduct.id);
      else plannedProducts.add(productKey);

      if (sku) {
        const skuKey = key(sku);
        if (seenSkus.has(skuKey)) warnings.push(`Rows ${seenSkus.get(skuKey)} and ${rowNumber}: duplicate SKU ${sku}.`);
        else seenSkus.set(skuKey, rowNumber);
      }
      if (barcode) {
        const barcodeKey = key(barcode);
        if (seenBarcodes.has(barcodeKey)) warnings.push(`Rows ${seenBarcodes.get(barcodeKey)} and ${rowNumber}: duplicate barcode ${barcode}.`);
        else seenBarcodes.set(barcodeKey, rowNumber);
      }

      let existingVariant = null;
      if (sku) existingVariant = variantsBySku.get(key(sku)) || null;
      if (!existingVariant && barcode) existingVariant = variantsByBarcode.get(key(barcode)) || null;
      if (!existingVariant) existingVariant = variantsByProductAndName.get(`${productKey}|${key(variantName)}`) || null;

      const plannedVariantKey = sku
        ? `sku:${key(sku)}`
        : barcode
          ? `barcode:${key(barcode)}`
          : `${productKey}|${key(variantName)}`;

      const currentQuantity = Number(existingVariant?.inventoryBalance?.quantity || 0);
      const suppliedQuantity = row.stockQuantity;
      const targetQuantity = suppliedQuantity === undefined
        ? currentQuantity
        : input.stockMode === 'add'
          ? currentQuantity + suppliedQuantity
          : suppliedQuantity;
      const delta = targetQuantity - currentQuantity;

      if (existingVariant) touchedVariants.add(existingVariant.id);
      else plannedVariants.add(plannedVariantKey);

      if (delta !== 0) {
        stockRowsChanged += 1;
        if (delta > 0) totalStockIncrease += delta;
        else totalStockDecrease += Math.abs(delta);
      }

      if (row.minAlertQuantity !== undefined && Number(row.minAlertQuantity) !== Number(existingVariant?.inventoryBalance?.minAlertQuantity || 0)) {
        lowAlertRowsChanged += 1;
      }

      if (sample.length < 12) {
        sample.push({
          rowNumber,
          productName,
          variantName,
          sku,
          barcode,
          action: existingVariant ? 'UPDATE' : 'CREATE',
          currentQuantity,
          targetQuantity,
          quantityChange: delta,
        });
      }
    }

    const overview = {
      rows: input.rows.length,
      validRows,
      skipped,
      categoriesToCreate: plannedCategories.size,
      productsToCreate: plannedProducts.size,
      productsToUpdate: touchedProducts.size,
      variantsToCreate: plannedVariants.size,
      variantsToUpdate: touchedVariants.size,
      stockRowsChanged,
      totalStockIncrease,
      totalStockDecrease,
      lowAlertRowsChanged,
      stockMode: input.stockMode,
      warnings: warnings.slice(0, 50),
      warningCount: warnings.length,
      sample,
      canImport: validRows > 0,
    };

    res.json({ ok: true, overview });
  }));
}

module.exports = attachInventoryImportPreviewApi;
