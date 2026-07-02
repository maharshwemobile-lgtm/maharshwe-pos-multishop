const { z } = require('zod');
const { Prisma } = require('@prisma/client');
const { prisma } = require('./prisma');
const {
  requireAuth,
  requireShopUser,
  requirePermission,
  requireWritableSubscription,
} = require('./auth-api');
const { queuePush, sendPushToShop } = require('./push-notifications-api');

const uuid = z.string().uuid();
const text = (max = 160) => z.union([z.string().trim().max(max), z.null()]).optional();
const money = z.coerce.number().finite().min(0);
const qty = z.coerce.number().int().min(0);

const categoryCreate = z.object({
  name: z.string().trim().min(1).max(120),
  kind: text(80),
  active: z.boolean().optional(),
});
const categoryPatch = categoryCreate.partial();

const variantCreate = z.object({
  variantName: z.string().trim().min(1).max(160),
  sku: text(100),
  barcode: text(100),
  unit: text(40),
  ram: text(60),
  storage: text(60),
  color: text(80),
  expiryDate: text(30),
  costPrice: money.optional(),
  standardSellingPrice: money.optional(),
  wholesalePrice: money.optional(),
  minimumSellingPrice: money.optional(),
  active: z.boolean().optional(),
  initialQuantity: qty.optional(),
  minAlertQuantity: qty.optional(),
});
const variantPatch = variantCreate.omit({ initialQuantity: true }).partial();

const productCreate = z.object({
  categoryId: z.union([uuid, z.null()]).optional(),
  groupName: text(120),
  name: z.string().trim().min(1).max(180),
  brand: text(120),
  model: text(120),
  productType: text(80),
  requiresSerial: z.boolean().optional(),
  active: z.boolean().optional(),
  variants: z.array(variantCreate).max(100).optional(),
});
const productPatch = productCreate.omit({ variants: true }).partial();

const movementCreate = z.object({
  productVariantId: uuid,
  type: z.enum(['STOCK_IN', 'SALE_RETURN', 'DAMAGE', 'ADJUSTMENT', 'REPAIR_USAGE']),
  quantityChange: z.coerce.number().int().refine((value) => value !== 0, 'quantityChange cannot be zero'),
  note: text(500),
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
        if (error.code === 'P2002') return res.status(409).json({ ok: false, message: 'Duplicate SKU, barcode, or name' });
        if (error.code === 'P2025') return res.status(404).json({ ok: false, message: 'Record not found' });
      }
      console.error('Catalog/stock API:', error);
      return res.status(500).json({ ok: false, message: error.message || 'Internal server error' });
    }
  };
}

const clean = (value) => {
  if (value === null || value === undefined) return null;
  return String(value).trim() || null;
};
function cleanDate(value) {
  const cleaned = clean(value);
  if (!cleaned) return null;
  const normalized = cleaned.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) throw new ApiError(400, 'Invalid expiry date');
  const date = new Date(`${normalized}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== normalized) {
    throw new ApiError(400, 'Invalid expiry date');
  }
  return date;
}
const number = (value) => Number(value || 0);
const pageInfo = (query) => {
  const page = Math.max(1, Number.parseInt(query.page || '1', 10) || 1);
  const limit = Math.min(100, Math.max(1, Number.parseInt(query.limit || '20', 10) || 20));
  return { page, limit, skip: (page - 1) * limit };
};
const viewCost = (req) => req.auth.role === 'SUPER_ADMIN' || req.auth.permissions?.viewCost === true;

function variantJson(row, includeCost) {
  const item = {
    id: row.id,
    productId: row.productId,
    categoryId: row.categoryId,
    variantName: row.variantName,
    sku: row.sku,
    barcode: row.barcode,
    unit: row.unit,
    ram: row.ram,
    storage: row.storage,
    color: row.color,
    expiryDate: row.expiryDate,
    standardSellingPrice: number(row.standardSellingPrice),
    wholesalePrice: number(row.wholesalePrice),
    active: row.active,
    inventory: row.inventoryBalance || { quantity: 0, minAlertQuantity: 0 },
  };
  if (includeCost) {
    item.costPrice = number(row.costPrice);
    item.minimumSellingPrice = number(row.minimumSellingPrice);
  }
  if (row.product) item.product = row.product;
  if (row.category) item.category = row.category;
  return item;
}

function productJson(row, includeCost) {
  return {
    id: row.id,
    categoryId: row.categoryId,
    groupName: row.groupName,
    name: row.name,
    brand: row.brand,
    model: row.model,
    productType: row.productType,
    requiresSerial: row.requiresSerial,
    active: row.active,
    category: row.category,
    variants: (row.variants || []).map((variant) => variantJson(variant, includeCost)),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function checkCategory(client, shopId, categoryId) {
  if (!categoryId) return;
  const found = await client.category.findFirst({ where: { id: categoryId, shopId } });
  if (!found) throw new ApiError(400, 'Category does not belong to this shop');
}

function checkPrices(data, current = {}) {
  const standard = data.standardSellingPrice ?? number(current.standardSellingPrice);
  const minimum = data.minimumSellingPrice ?? number(current.minimumSellingPrice);
  if (standard > 0 && minimum > standard) {
    throw new ApiError(400, 'Minimum selling price cannot exceed standard selling price');
  }
}

async function addAudit(tx, req, action, entityType, entityId, details = {}) {
  await tx.auditLog.create({
    data: {
      shopId: req.auth.shopId,
      userId: req.auth.userId,
      action,
      entityType,
      entityId,
      details,
      ipAddress: req.ip || null,
      userAgent: req.headers['user-agent'] || null,
    },
  });
}

async function stockTransaction(work) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.$transaction(work, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 5000,
        timeout: 15000,
      });
    } catch (error) {
      if (error.code === 'P2034' && attempt < 2) continue;
      throw error;
    }
  }
}

function attachCatalogStockApi(app) {
  const read = [requireAuth, requireShopUser];
  const inventoryRead = [requireAuth, requireShopUser, requirePermission('inventory')];
  const write = [requireAuth, requireShopUser, requireWritableSubscription, requirePermission('inventory')];

  app.get('/api/categories', ...read, wrap(async (req, res) => {
    const categories = await prisma.category.findMany({
      where: { shopId: req.auth.shopId },
      include: { _count: { select: { products: true, productVariants: true } } },
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
    });
    res.json({ ok: true, categories });
  }));

  app.post('/api/categories', ...write, wrap(async (req, res) => {
    const input = parse(categoryCreate, req.body || {});
    const category = await prisma.$transaction(async (tx) => {
      const created = await tx.category.create({
        data: { shopId: req.auth.shopId, name: input.name, kind: clean(input.kind), active: input.active ?? true },
      });
      await addAudit(tx, req, 'CATEGORY_CREATED', 'category', created.id, { name: created.name });
      return created;
    });
    res.status(201).json({ ok: true, category });
  }));

  app.patch('/api/categories/:id', ...write, wrap(async (req, res) => {
    const id = parse(uuid, req.params.id);
    const input = parse(categoryPatch, req.body || {});
    const current = await prisma.category.findFirst({ where: { id, shopId: req.auth.shopId } });
    if (!current) throw new ApiError(404, 'Category not found');
    const category = await prisma.$transaction(async (tx) => {
      const updated = await tx.category.update({
        where: { id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.kind !== undefined ? { kind: clean(input.kind) } : {}),
          ...(input.active !== undefined ? { active: input.active } : {}),
        },
      });
      await addAudit(tx, req, 'CATEGORY_UPDATED', 'category', id, input);
      return updated;
    });
    res.json({ ok: true, category });
  }));

  app.delete('/api/categories/:id', ...write, wrap(async (req, res) => {
    const id = parse(uuid, req.params.id);
    const current = await prisma.category.findFirst({ where: { id, shopId: req.auth.shopId } });
    if (!current) throw new ApiError(404, 'Category not found');
    await prisma.$transaction(async (tx) => {
      await tx.category.update({ where: { id }, data: { active: false } });
      await addAudit(tx, req, 'CATEGORY_DEACTIVATED', 'category', id, { name: current.name });
    });
    res.json({ ok: true, id, active: false });
  }));

  app.get('/api/products', ...read, wrap(async (req, res) => {
    const { page, limit, skip } = pageInfo(req.query);
    const search = String(req.query.q || '').trim();
    const categoryId = req.query.categoryId ? parse(uuid, req.query.categoryId) : undefined;
    const where = {
      shopId: req.auth.shopId,
      ...(categoryId ? { categoryId } : {}),
      ...(search ? { OR: [
        { name: { contains: search, mode: 'insensitive' } },
        { brand: { contains: search, mode: 'insensitive' } },
        { model: { contains: search, mode: 'insensitive' } },
        { variants: { some: { OR: [
          { variantName: { contains: search, mode: 'insensitive' } },
          { sku: { contains: search, mode: 'insensitive' } },
          { barcode: { contains: search, mode: 'insensitive' } },
        ] } } },
      ] } : {}),
    };
    const [total, rows] = await prisma.$transaction([
      prisma.product.count({ where }),
      prisma.product.findMany({
        where,
        include: {
          category: true,
          variants: { include: { inventoryBalance: true, category: true }, orderBy: { variantName: 'asc' } },
        },
        orderBy: [{ active: 'desc' }, { name: 'asc' }],
        skip,
        take: limit,
      }),
    ]);
    res.json({ ok: true, page, limit, total, totalPages: Math.ceil(total / limit), products: rows.map((row) => productJson(row, viewCost(req))) });
  }));

  app.get('/api/products/:id', ...read, wrap(async (req, res) => {
    const id = parse(uuid, req.params.id);
    const row = await prisma.product.findFirst({
      where: { id, shopId: req.auth.shopId },
      include: { category: true, variants: { include: { inventoryBalance: true, category: true } } },
    });
    if (!row) throw new ApiError(404, 'Product not found');
    res.json({ ok: true, product: productJson(row, viewCost(req)) });
  }));

  app.post('/api/products', ...write, wrap(async (req, res) => {
    const input = parse(productCreate, req.body || {});
    const row = await stockTransaction(async (tx) => {
      await checkCategory(tx, req.auth.shopId, input.categoryId);
      const product = await tx.product.create({
        data: {
          shopId: req.auth.shopId,
          categoryId: input.categoryId || null,
          groupName: clean(input.groupName),
          name: input.name,
          brand: clean(input.brand),
          model: clean(input.model),
          productType: clean(input.productType),
          requiresSerial: input.requiresSerial ?? false,
          active: input.active ?? true,
        },
      });
      for (const item of input.variants || []) {
        checkPrices(item);
        const variant = await tx.productVariant.create({
          data: {
            shopId: req.auth.shopId,
            productId: product.id,
            categoryId: product.categoryId,
            variantName: item.variantName,
            sku: clean(item.sku),
            barcode: clean(item.barcode),
            unit: clean(item.unit),
            ram: clean(item.ram),
            storage: clean(item.storage),
            color: clean(item.color),
            expiryDate: cleanDate(item.expiryDate),
            costPrice: item.costPrice ?? 0,
            standardSellingPrice: item.standardSellingPrice ?? 0,
            wholesalePrice: item.wholesalePrice ?? 0,
            minimumSellingPrice: item.minimumSellingPrice ?? 0,
            active: item.active ?? true,
          },
        });
        const initial = item.initialQuantity ?? 0;
        await tx.inventoryBalance.create({
          data: { shopId: req.auth.shopId, productVariantId: variant.id, quantity: initial, minAlertQuantity: item.minAlertQuantity ?? 0 },
        });
        if (initial > 0) await tx.stockMovement.create({
          data: {
            shopId: req.auth.shopId,
            productVariantId: variant.id,
            type: 'STOCK_IN',
            quantityChange: initial,
            beforeQuantity: 0,
            afterQuantity: initial,
            referenceType: 'OPENING_STOCK',
            userId: req.auth.userId,
            note: 'Initial stock',
          },
        });
      }
      await addAudit(tx, req, 'PRODUCT_CREATED', 'product', product.id, { name: product.name });
      return tx.product.findUnique({
        where: { id: product.id },
        include: { category: true, variants: { include: { inventoryBalance: true, category: true } } },
      });
    });
    res.status(201).json({ ok: true, product: productJson(row, viewCost(req)) });
  }));

  app.patch('/api/products/:id', ...write, wrap(async (req, res) => {
    const id = parse(uuid, req.params.id);
    const input = parse(productPatch, req.body || {});
    const current = await prisma.product.findFirst({ where: { id, shopId: req.auth.shopId } });
    if (!current) throw new ApiError(404, 'Product not found');
    await checkCategory(prisma, req.auth.shopId, input.categoryId);
    const row = await prisma.$transaction(async (tx) => {
      await tx.product.update({
        where: { id },
        data: {
          ...(input.categoryId !== undefined ? { categoryId: input.categoryId } : {}),
          ...(input.groupName !== undefined ? { groupName: clean(input.groupName) } : {}),
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.brand !== undefined ? { brand: clean(input.brand) } : {}),
          ...(input.model !== undefined ? { model: clean(input.model) } : {}),
          ...(input.productType !== undefined ? { productType: clean(input.productType) } : {}),
          ...(input.requiresSerial !== undefined ? { requiresSerial: input.requiresSerial } : {}),
          ...(input.active !== undefined ? { active: input.active } : {}),
        },
      });
      if (input.categoryId !== undefined) await tx.productVariant.updateMany({ where: { shopId: req.auth.shopId, productId: id }, data: { categoryId: input.categoryId } });
      await addAudit(tx, req, 'PRODUCT_UPDATED', 'product', id, input);
      return tx.product.findUnique({ where: { id }, include: { category: true, variants: { include: { inventoryBalance: true, category: true } } } });
    });
    res.json({ ok: true, product: productJson(row, viewCost(req)) });
  }));

  app.delete('/api/products/:id', ...write, wrap(async (req, res) => {
    const id = parse(uuid, req.params.id);
    const current = await prisma.product.findFirst({ where: { id, shopId: req.auth.shopId } });
    if (!current) throw new ApiError(404, 'Product not found');
    await prisma.$transaction(async (tx) => {
      await tx.product.update({ where: { id }, data: { active: false } });
      await tx.productVariant.updateMany({ where: { shopId: req.auth.shopId, productId: id }, data: { active: false } });
      await addAudit(tx, req, 'PRODUCT_DEACTIVATED', 'product', id, { name: current.name });
    });
    res.json({ ok: true, id, active: false });
  }));

  app.post('/api/products/:productId/variants', ...write, wrap(async (req, res) => {
    const productId = parse(uuid, req.params.productId);
    const input = parse(variantCreate, req.body || {});
    checkPrices(input);
    const row = await stockTransaction(async (tx) => {
      const product = await tx.product.findFirst({ where: { id: productId, shopId: req.auth.shopId } });
      if (!product) throw new ApiError(404, 'Product not found');
      const variant = await tx.productVariant.create({
        data: {
          shopId: req.auth.shopId,
          productId,
          categoryId: product.categoryId,
          variantName: input.variantName,
          sku: clean(input.sku),
          barcode: clean(input.barcode),
          unit: clean(input.unit),
          ram: clean(input.ram),
          storage: clean(input.storage),
          color: clean(input.color),
          expiryDate: cleanDate(input.expiryDate),
          costPrice: input.costPrice ?? 0,
          standardSellingPrice: input.standardSellingPrice ?? 0,
          wholesalePrice: input.wholesalePrice ?? 0,
          minimumSellingPrice: input.minimumSellingPrice ?? 0,
          active: input.active ?? true,
        },
      });
      const initial = input.initialQuantity ?? 0;
      await tx.inventoryBalance.create({ data: { shopId: req.auth.shopId, productVariantId: variant.id, quantity: initial, minAlertQuantity: input.minAlertQuantity ?? 0 } });
      if (initial > 0) await tx.stockMovement.create({ data: { shopId: req.auth.shopId, productVariantId: variant.id, type: 'STOCK_IN', quantityChange: initial, beforeQuantity: 0, afterQuantity: initial, referenceType: 'OPENING_STOCK', userId: req.auth.userId, note: 'Initial stock' } });
      await addAudit(tx, req, 'VARIANT_CREATED', 'product_variant', variant.id, { productId });
      return tx.productVariant.findUnique({ where: { id: variant.id }, include: { inventoryBalance: true, product: true, category: true } });
    });
    res.status(201).json({ ok: true, variant: variantJson(row, viewCost(req)) });
  }));

  app.patch('/api/variants/:id', ...write, wrap(async (req, res) => {
    const id = parse(uuid, req.params.id);
    const input = parse(variantPatch, req.body || {});
    const current = await prisma.productVariant.findFirst({ where: { id, shopId: req.auth.shopId } });
    if (!current) throw new ApiError(404, 'Variant not found');
    checkPrices(input, current);
    const row = await prisma.$transaction(async (tx) => {
      await tx.productVariant.update({
        where: { id },
        data: {
          ...(input.variantName !== undefined ? { variantName: input.variantName } : {}),
          ...(input.sku !== undefined ? { sku: clean(input.sku) } : {}),
          ...(input.barcode !== undefined ? { barcode: clean(input.barcode) } : {}),
          ...(input.unit !== undefined ? { unit: clean(input.unit) } : {}),
          ...(input.ram !== undefined ? { ram: clean(input.ram) } : {}),
          ...(input.storage !== undefined ? { storage: clean(input.storage) } : {}),
          ...(input.color !== undefined ? { color: clean(input.color) } : {}),
          ...(input.expiryDate !== undefined ? { expiryDate: cleanDate(input.expiryDate) } : {}),
          ...(input.costPrice !== undefined ? { costPrice: input.costPrice } : {}),
          ...(input.standardSellingPrice !== undefined ? { standardSellingPrice: input.standardSellingPrice } : {}),
          ...(input.wholesalePrice !== undefined ? { wholesalePrice: input.wholesalePrice } : {}),
          ...(input.minimumSellingPrice !== undefined ? { minimumSellingPrice: input.minimumSellingPrice } : {}),
          ...(input.active !== undefined ? { active: input.active } : {}),
        },
      });
      if (input.minAlertQuantity !== undefined) await tx.inventoryBalance.upsert({ where: { productVariantId: id }, update: { minAlertQuantity: input.minAlertQuantity }, create: { shopId: req.auth.shopId, productVariantId: id, quantity: 0, minAlertQuantity: input.minAlertQuantity } });
      await addAudit(tx, req, 'VARIANT_UPDATED', 'product_variant', id, input);
      return tx.productVariant.findUnique({ where: { id }, include: { inventoryBalance: true, product: true, category: true } });
    });
    res.json({ ok: true, variant: variantJson(row, viewCost(req)) });
  }));

  app.delete('/api/variants/:id', ...write, wrap(async (req, res) => {
    const id = parse(uuid, req.params.id);
    const current = await prisma.productVariant.findFirst({ where: { id, shopId: req.auth.shopId } });
    if (!current) throw new ApiError(404, 'Variant not found');
    await prisma.$transaction(async (tx) => {
      await tx.productVariant.update({ where: { id }, data: { active: false } });
      await addAudit(tx, req, 'VARIANT_DEACTIVATED', 'product_variant', id, { variantName: current.variantName });
    });
    res.json({ ok: true, id, active: false });
  }));

  app.get('/api/stock/low', ...inventoryRead, wrap(async (req, res) => {
    const rows = await prisma.inventoryBalance.findMany({
      where: { shopId: req.auth.shopId, minAlertQuantity: { gt: 0 } },
      include: { productVariant: { include: { product: true, category: true, inventoryBalance: true } } },
      orderBy: { quantity: 'asc' },
    });
    const items = rows.filter((row) => row.quantity <= row.minAlertQuantity).map((row) => variantJson(row.productVariant, viewCost(req)));
    res.json({ ok: true, total: items.length, items });
  }));

  app.get('/api/stock/movements', ...inventoryRead, wrap(async (req, res) => {
    const { page, limit, skip } = pageInfo(req.query);
    const productVariantId = req.query.productVariantId ? parse(uuid, req.query.productVariantId) : undefined;
    const where = { shopId: req.auth.shopId, ...(productVariantId ? { productVariantId } : {}) };
    const [total, movements] = await prisma.$transaction([
      prisma.stockMovement.count({ where }),
      prisma.stockMovement.findMany({ where, include: { productVariant: { include: { product: true } }, user: { select: { id: true, name: true, username: true } } }, orderBy: { createdAt: 'desc' }, skip, take: limit }),
    ]);
    res.json({ ok: true, page, limit, total, totalPages: Math.ceil(total / limit), movements });
  }));

  app.get('/api/stock', ...inventoryRead, wrap(async (req, res) => {
    const { page, limit, skip } = pageInfo(req.query);
    const search = String(req.query.q || '').trim();
    const where = { shopId: req.auth.shopId, ...(search ? { OR: [
      { variantName: { contains: search, mode: 'insensitive' } },
      { sku: { contains: search, mode: 'insensitive' } },
      { barcode: { contains: search, mode: 'insensitive' } },
      { product: { name: { contains: search, mode: 'insensitive' } } },
    ] } : {}) };
    const [total, rows] = await prisma.$transaction([
      prisma.productVariant.count({ where }),
      prisma.productVariant.findMany({ where, include: { inventoryBalance: true, product: true, category: true }, orderBy: { variantName: 'asc' }, skip, take: limit }),
    ]);
    res.json({ ok: true, page, limit, total, totalPages: Math.ceil(total / limit), items: rows.map((row) => variantJson(row, viewCost(req))) });
  }));

  app.post('/api/stock/movements', ...write, wrap(async (req, res) => {
    const input = parse(movementCreate, req.body || {});
    let delta = input.quantityChange;
    if (['STOCK_IN', 'SALE_RETURN'].includes(input.type)) delta = Math.abs(delta);
    if (['DAMAGE', 'REPAIR_USAGE'].includes(input.type)) delta = -Math.abs(delta);
    const result = await stockTransaction(async (tx) => {
      const variant = await tx.productVariant.findFirst({ where: { id: input.productVariantId, shopId: req.auth.shopId } });
      if (!variant) throw new ApiError(404, 'Variant not found');
      const settings = await tx.shopSettings.findUnique({ where: { shopId: req.auth.shopId } });
      const current = await tx.inventoryBalance.findUnique({ where: { productVariantId: variant.id } });
      const beforeQuantity = current?.quantity || 0;
      const afterQuantity = beforeQuantity + delta;
      if (afterQuantity < 0 && !settings?.allowNegativeStock) throw new ApiError(409, 'Stock is not enough', { beforeQuantity, quantityChange: delta });
      const balance = await tx.inventoryBalance.upsert({ where: { productVariantId: variant.id }, update: { quantity: afterQuantity }, create: { shopId: req.auth.shopId, productVariantId: variant.id, quantity: afterQuantity, minAlertQuantity: 0 } });
      const movement = await tx.stockMovement.create({ data: { shopId: req.auth.shopId, productVariantId: variant.id, type: input.type, quantityChange: delta, beforeQuantity, afterQuantity, userId: req.auth.userId, note: clean(input.note) } });
      await addAudit(tx, req, 'STOCK_MOVEMENT_CREATED', 'stock_movement', movement.id, { productVariantId: variant.id, type: input.type, quantityChange: delta, beforeQuantity, afterQuantity });
      return { movement, balance };
    });
    const quantity = Number(result.balance?.quantity || 0);
    const minAlertQuantity = Number(result.balance?.minAlertQuantity || 0);
    if (quantity <= 0) {
      queuePush(() => sendPushToShop({
        shopId: req.auth.shopId,
        eventType: 'OUT_OF_STOCK',
        title: 'Out of stock alert',
        body: 'A product is out of stock. Open Mahar POS to review.',
        url: '/stock',
        data: { source: 'stock-movement', movementId: result.movement.id },
      }), 'out of stock push');
    } else if (minAlertQuantity > 0 && quantity <= minAlertQuantity) {
      queuePush(() => sendPushToShop({
        shopId: req.auth.shopId,
        eventType: 'LOW_STOCK',
        title: 'Low stock alert',
        body: 'A product is running low. Open Mahar POS to review.',
        url: '/stock',
        data: { source: 'stock-movement', movementId: result.movement.id },
      }), 'low stock push');
    }
    res.status(201).json({ ok: true, ...result });
  }));
}

module.exports = attachCatalogStockApi;
