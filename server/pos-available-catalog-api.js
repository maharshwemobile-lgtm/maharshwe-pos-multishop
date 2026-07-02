const { z } = require('zod');
const { prisma } = require('./prisma');
const {
  requireAuth,
  requireShopUser,
  requirePermission,
} = require('./auth-api');

const uuid = z.string().uuid();
const number = (value) => Number(value || 0);
const canViewCost = (req) => req.auth.role === 'SUPER_ADMIN' || req.auth.permissions?.viewCost === true;

function wrap(handler) {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (error) {
      console.error('Available POS catalog:', error);
      res.status(500).json({ ok: false, message: error.message || 'POS catalog failed' });
    }
  };
}

function catalogItem(row, includeCost) {
  const item = {
    id: row.id,
    productId: row.productId,
    productName: row.product?.name || '',
    brand: row.product?.brand || '',
    model: row.product?.model || '',
    category: row.category?.name || '',
    categoryId: row.categoryId || row.product?.categoryId || null,
    variantName: row.variantName,
    sku: row.sku,
    barcode: row.barcode,
    color: row.color,
    ram: row.ram,
    storage: row.storage,
    requiresSerial: row.product?.requiresSerial === true,
    standardSellingPrice: number(row.standardSellingPrice),
    minimumSellingPrice: number(row.minimumSellingPrice),
    stockQuantity: Number(row.inventoryBalance?.quantity || 0),
    minAlertQuantity: Number(row.inventoryBalance?.minAlertQuantity || 0),
    active: row.active && row.product?.active !== false,
  };
  if (includeCost) item.costPrice = number(row.costPrice);
  return item;
}

function attachAvailablePosCatalogApi(app) {
  const access = [requireAuth, requireShopUser, requirePermission('sale')];

  app.get('/api/pos/catalog', ...access, wrap(async (req, res) => {
    const page = Math.max(1, Number.parseInt(req.query.page || '1', 10) || 1);
    const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit || '40', 10) || 40));
    const search = String(req.query.q || '').trim();
    const categoryResult = req.query.categoryId ? uuid.safeParse(req.query.categoryId) : null;
    if (categoryResult && !categoryResult.success) {
      return res.status(400).json({ ok: false, message: 'Invalid category' });
    }

    const where = {
      shopId: req.auth.shopId,
      active: true,
      product: { active: true },
      inventoryBalance: { quantity: { gt: 0 } },
      ...(categoryResult?.success ? { categoryId: categoryResult.data } : {}),
      ...(search ? {
        OR: [
          { variantName: { contains: search, mode: 'insensitive' } },
          { sku: { contains: search, mode: 'insensitive' } },
          { barcode: { contains: search, mode: 'insensitive' } },
          { product: { name: { contains: search, mode: 'insensitive' } } },
          { product: { brand: { contains: search, mode: 'insensitive' } } },
          { product: { model: { contains: search, mode: 'insensitive' } } },
        ],
      } : {}),
    };

    const [total, rows] = await prisma.$transaction([
      prisma.productVariant.count({ where }),
      prisma.productVariant.findMany({
        where,
        include: { product: true, category: true, inventoryBalance: true },
        orderBy: [{ product: { name: 'asc' } }, { variantName: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    res.json({
      ok: true,
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      items: rows.map((row) => catalogItem(row, canViewCost(req))),
    });
  }));
}

module.exports = attachAvailablePosCatalogApi;
