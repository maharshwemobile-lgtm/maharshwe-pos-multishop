const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { z } = require('zod');
const { prisma } = require('./prisma');
const { requireAuth } = require('./auth-api');

const orderInput = z.object({
  customerName: z.string().trim().min(1).max(120),
  customerPhone: z.string().trim().min(5).max(40),
  deliveryAddress: z.string().trim().max(500).optional().default(''),
  fulfillmentMethod: z.enum(['COD', 'PICKUP']),
  note: z.string().trim().max(500).optional().default(''),
  items: z.array(z.object({ variantId: z.string().uuid(), quantity: z.coerce.number().int().min(1).max(100) })).min(1).max(50),
});
const settingsInput = z.object({
  enabled: z.boolean().optional(), storeName: z.string().trim().max(160).nullable().optional(),
  description: z.string().trim().max(1200).nullable().optional(), contactPhone: z.string().trim().max(40).nullable().optional(),
  deliveryEnabled: z.boolean().optional(), pickupEnabled: z.boolean().optional(), deliveryFee: z.coerce.number().min(0).max(10000000).optional(),
});
const productInput = z.object({
  visible: z.boolean().optional(), featured: z.boolean().optional(), description: z.string().trim().max(3000).nullable().optional(),
  imageUrls: z.array(z.string().trim().url().refine((url) => url.startsWith('https://'), 'HTTPS image URL required')).max(100).optional(),
});

function cleanFilePart(value) { return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80); }
function uploadRoot() {
  return process.env.ECOMMERCE_UPLOAD_DIR || (process.env.NODE_ENV === 'production'
    ? '/var/www/maharshwe.shop/uploads/storefront'
    : path.join(__dirname, '..', 'public', 'uploads', 'storefront'));
}
function publicImageUrl(shopId, filename) {
  const base = String(process.env.PUBLIC_LANDING_URL || 'https://maharshwe.shop').replace(/\/+$/, '');
  return `${base}/uploads/storefront/${cleanFilePart(shopId)}/${filename}`;
}
function driveImageUrl(value) {
  const url = new URL(value);
  if (url.hostname === 'drive.google.com') {
    const match = url.pathname.match(/\/file\/d\/([^/]+)/) || url.searchParams.get('id') && [null, url.searchParams.get('id')];
    if (match?.[1]) return `https://drive.google.com/uc?export=view&id=${encodeURIComponent(match[1])}`;
  }
  return url.toString();
}
function handle(handler) {
  return async (req, res) => { try { await handler(req, res); } catch (error) {
    if (error?.issues) return res.status(400).json({ ok: false, message: 'Invalid request', issues: error.issues });
    if (!error.status || error.status >= 500) console.error('E-commerce API:', error);
    return res.status(error.status || 500).json({ ok: false, message: error.message || 'E-commerce request failed' });
  } };
}
function notFound(message) { const error = new Error(message); error.status = 404; throw error; }

const storage = multer.diskStorage({
  destination(req, _file, callback) {
    const dir = path.join(uploadRoot(), cleanFilePart(req.auth.shopId));
    fs.mkdirSync(dir, { recursive: true }); callback(null, dir);
  },
  filename(_req, file, callback) {
    const extension = ({ 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' })[file.mimetype] || '';
    callback(null, `${Date.now()}-${crypto.randomUUID()}${extension}`);
  },
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024, files: 3 }, fileFilter(_req, file, callback) {
  callback(null, ['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.mimetype));
} });

function attachEcommerceStorefrontApi(app) {
  app.get('/api/ecommerce/settings', requireAuth, handle(async (req, res) => {
    const [shop, settings] = await Promise.all([
      prisma.shop.findFirst({ where: { id: req.auth.shopId }, select: { slug: true, name: true, logoUrl: true } }),
      prisma.ecommerceStoreSettings.findUnique({ where: { shopId: req.auth.shopId } }),
    ]);
    res.json({ ok: true, shop, settings: settings || { enabled: false, deliveryEnabled: true, pickupEnabled: true, deliveryFee: 0 }, storeUrl: `${process.env.PUBLIC_LANDING_URL || 'https://maharshwe.shop'}/shop/${shop.slug}` });
  }));

  app.put('/api/ecommerce/settings', requireAuth, handle(async (req, res) => {
    const input = settingsInput.parse(req.body);
    const settings = await prisma.ecommerceStoreSettings.upsert({ where: { shopId: req.auth.shopId }, update: input, create: { shopId: req.auth.shopId, ...input } });
    res.json({ ok: true, settings });
  }));

  app.get('/api/ecommerce/products', requireAuth, handle(async (req, res) => {
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const pageSize = 10;
    const brand = String(req.query.brand || '').trim();
    const categoryId = String(req.query.categoryId || '').trim();
    const stockLevel = String(req.query.stockLevel || '').trim().toUpperCase();
    const [rows, optionRows, onlineTotal] = await Promise.all([
      prisma.product.findMany({
        where: { shopId: req.auth.shopId, active: true, ...(brand ? { brand } : {}), ...(categoryId ? { categoryId } : {}) },
        include: { category: true, ecommerceDetail: true, ecommerceImages: { orderBy: { sortOrder: 'asc' } }, variants: { where: { active: true }, include: { inventoryBalance: true } } },
        orderBy: { name: 'asc' },
      }),
      prisma.product.findMany({ where: { shopId: req.auth.shopId, active: true }, select: { brand: true, category: true } }),
      prisma.product.count({ where: { shopId: req.auth.shopId, active: true, OR: [{ ecommerceDetail: { is: null } }, { ecommerceDetail: { is: { visible: true } } }] } }),
    ]);
    const stockTotal = (product) => product.variants.reduce((sum, variant) => sum + Number(variant.inventoryBalance?.quantity || 0), 0);
    const lowStock = (product) => product.variants.some((variant) => {
      const balance = variant.inventoryBalance;
      return balance && Number(balance.quantity) > 0 && Number(balance.quantity) <= Number(balance.minAlertQuantity || 0);
    });
    const filtered = rows.filter((product) => {
      const quantity = stockTotal(product);
      if (stockLevel === 'IN_STOCK') return quantity > 0;
      if (stockLevel === 'LOW_STOCK') return lowStock(product);
      if (stockLevel === 'OUT_OF_STOCK') return quantity <= 0;
      return true;
    });
    const brands = [...new Set(optionRows.map((product) => product.brand).filter(Boolean))].sort();
    const categories = [...new Map(optionRows.filter((product) => product.category).map((product) => [product.category.id, product.category])).values()].sort((a, b) => a.name.localeCompare(b.name));
    res.json({ ok: true, page, pageSize, total: filtered.length, onlineTotal, totalPages: Math.max(1, Math.ceil(filtered.length / pageSize)), brands, categories, products: filtered.slice((page - 1) * pageSize, page * pageSize) });
  }));

  app.put('/api/ecommerce/products/:productId', requireAuth, handle(async (req, res) => {
    const input = productInput.parse(req.body);
    const product = await prisma.product.findFirst({ where: { id: req.params.productId, shopId: req.auth.shopId } });
    if (!product) notFound('Product not found');
    const detailData = { visible: input.visible, featured: input.featured, description: input.description };
    Object.keys(detailData).forEach((key) => detailData[key] === undefined && delete detailData[key]);
    const result = await prisma.$transaction(async (tx) => {
      const detail = await tx.ecommerceProductDetail.upsert({ where: { productId: product.id }, update: detailData, create: { shopId: req.auth.shopId, productId: product.id, ...detailData } });
      if (input.imageUrls) {
        await tx.ecommerceProductImage.deleteMany({ where: { shopId: req.auth.shopId, productId: product.id, source: 'GOOGLE_DRIVE' } });
        if (input.imageUrls.length) await tx.ecommerceProductImage.createMany({ data: input.imageUrls.map((url, index) => ({ shopId: req.auth.shopId, productId: product.id, url: driveImageUrl(url), source: url.includes('drive.google.com') ? 'GOOGLE_DRIVE' : 'URL', sortOrder: 100 + index })) });
      }
      return detail;
    });
    res.json({ ok: true, detail: result });
  }));

  app.post('/api/ecommerce/products/:productId/images', requireAuth, upload.array('images', 3), handle(async (req, res) => {
    const product = await prisma.product.findFirst({ where: { id: req.params.productId, shopId: req.auth.shopId } });
    if (!product) notFound('Product not found');
    const existing = await prisma.ecommerceProductImage.count({ where: { shopId: req.auth.shopId, productId: product.id, source: 'UPLOAD' } });
    if (existing + req.files.length > 3) { req.files.forEach((file) => fs.rmSync(file.path, { force: true })); return res.status(400).json({ ok: false, message: 'Maximum 3 uploaded images per product' }); }
    const rows = await prisma.$transaction(async (tx) => {
      const images = await Promise.all(req.files.map((file, index) => tx.ecommerceProductImage.create({ data: { shopId: req.auth.shopId, productId: product.id, url: publicImageUrl(req.auth.shopId, file.filename), source: 'UPLOAD', sortOrder: existing + index } })));
      await tx.ecommerceProductDetail.upsert({ where: { productId: product.id }, update: { visible: true }, create: { shopId: req.auth.shopId, productId: product.id, visible: true } });
      return images;
    });
    res.status(201).json({ ok: true, images: rows });
  }));

  app.delete('/api/ecommerce/images/:id', requireAuth, handle(async (req, res) => {
    const image = await prisma.ecommerceProductImage.findFirst({ where: { id: req.params.id, shopId: req.auth.shopId } });
    if (!image) notFound('Image not found');
    await prisma.ecommerceProductImage.delete({ where: { id: image.id } });
    if (image.source === 'UPLOAD') { const filename = path.basename(new URL(image.url).pathname); fs.rmSync(path.join(uploadRoot(), cleanFilePart(req.auth.shopId), filename), { force: true }); }
    res.json({ ok: true });
  }));

  app.patch('/api/ecommerce/images/:id/primary', requireAuth, handle(async (req, res) => {
    const image = await prisma.ecommerceProductImage.findFirst({ where: { id: req.params.id, shopId: req.auth.shopId } });
    if (!image) notFound('Image not found');
    await prisma.$transaction([
      prisma.ecommerceProductImage.updateMany({ where: { shopId: req.auth.shopId, productId: image.productId }, data: { sortOrder: { increment: 1 } } }),
      prisma.ecommerceProductImage.update({ where: { id: image.id }, data: { sortOrder: 0 } }),
    ]);
    res.json({ ok: true });
  }));

  app.get('/api/ecommerce/orders', requireAuth, handle(async (req, res) => {
    const page = Math.max(1, Number(req.query.page) || 1); const take = 10;
    const where = { shopId: req.auth.shopId, ...(req.query.status ? { status: String(req.query.status) } : {}) };
    const [total, orders] = await Promise.all([prisma.ecommerceOrder.count({ where }), prisma.ecommerceOrder.findMany({ where, include: { items: true }, orderBy: { createdAt: 'desc' }, skip: (page - 1) * take, take })]);
    res.json({ ok: true, page, pageSize: take, total, orders });
  }));

  app.patch('/api/ecommerce/orders/:id/status', requireAuth, handle(async (req, res) => {
    const status = z.enum(['PENDING', 'CONFIRMED', 'READY', 'COMPLETED', 'CANCELLED']).parse(req.body.status);
    const order = await prisma.ecommerceOrder.findFirst({ where: { id: req.params.id, shopId: req.auth.shopId }, include: { items: true } });
    if (!order) notFound('Order not found');
    const updated = await prisma.$transaction(async (tx) => {
      if (status === 'COMPLETED' && order.status !== 'COMPLETED') {
        for (const item of order.items) {
          const balance = await tx.inventoryBalance.findUnique({ where: { productVariantId: item.productVariantId } });
          if (!balance || balance.quantity < item.quantity) { const error = new Error(`Stock is not enough for ${item.productNameSnapshot}`); error.status = 409; throw error; }
          const after = balance.quantity - item.quantity;
          await tx.inventoryBalance.update({ where: { productVariantId: item.productVariantId }, data: { quantity: after } });
          await tx.stockMovement.create({ data: { shopId: req.auth.shopId, productVariantId: item.productVariantId, type: 'SALE', quantityChange: -item.quantity, beforeQuantity: balance.quantity, afterQuantity: after, referenceType: 'ECOMMERCE_ORDER', referenceId: order.id, userId: req.auth.userId, note: order.orderNumber } });
        }
      }
      return tx.ecommerceOrder.update({ where: { id: order.id }, data: { status }, include: { items: true } });
    });
    res.json({ ok: true, order: updated });
  }));

  app.get('/api/public/store/:slug', handle(async (req, res) => {
    const shop = await prisma.shop.findFirst({ where: { slug: req.params.slug, active: true }, include: { ecommerceSettings: true } });
    if (!shop?.ecommerceSettings?.enabled) notFound('Online shop is not available');
    res.set('Cache-Control', 'public, max-age=60');
    res.json({ ok: true, store: { slug: shop.slug, name: shop.ecommerceSettings.storeName || shop.name, logoUrl: shop.logoUrl, description: shop.ecommerceSettings.description, phone: shop.ecommerceSettings.contactPhone || shop.phone, address: shop.address, deliveryEnabled: shop.ecommerceSettings.deliveryEnabled, pickupEnabled: shop.ecommerceSettings.pickupEnabled, deliveryFee: Number(shop.ecommerceSettings.deliveryFee) } });
  }));

  app.get('/api/public/store/:slug/products', handle(async (req, res) => {
    const shop = await prisma.shop.findFirst({ where: { slug: req.params.slug, active: true, ecommerceSettings: { is: { enabled: true } } }, select: { id: true } });
    if (!shop) notFound('Online shop is not available');
    const search = String(req.query.search || '').trim(); const page = Math.max(1, Number(req.query.page) || 1); const take = 1000;
    const brand = String(req.query.brand || '').trim(); const categoryId = String(req.query.categoryId || '').trim(); const stockLevel = String(req.query.stockLevel || '').trim().toUpperCase();
    const visibleWhere = { OR: [{ ecommerceDetail: { is: null } }, { ecommerceDetail: { is: { visible: true } } }] };
    const where = { shopId: shop.id, active: true, ecommerceImages: { some: {} }, ...visibleWhere, ...(search ? { name: { contains: search, mode: 'insensitive' } } : {}), ...(brand ? { brand } : {}), ...(categoryId ? { categoryId } : {}) };
    const [rows, optionRows] = await Promise.all([
      prisma.product.findMany({ where, include: { category: true, ecommerceDetail: true, ecommerceImages: { orderBy: { sortOrder: 'asc' } }, variants: { where: { active: true }, include: { inventoryBalance: true } } }, orderBy: [{ ecommerceDetail: { featured: 'desc' } }, { name: 'asc' }] }),
      prisma.product.findMany({ where: { shopId: shop.id, active: true, ecommerceImages: { some: {} }, ...visibleWhere }, select: { brand: true, category: true } }),
    ]);
    const stockTotal = (product) => product.variants.reduce((sum, variant) => sum + Number(variant.inventoryBalance?.quantity || 0), 0);
    const lowStock = (product) => product.variants.some((variant) => { const balance = variant.inventoryBalance; return balance && Number(balance.quantity) > 0 && Number(balance.quantity) <= Number(balance.minAlertQuantity || 0); });
    const filtered = rows.filter((product) => { const quantity = stockTotal(product); if (stockLevel === 'IN_STOCK') return quantity > 0; if (stockLevel === 'LOW_STOCK') return lowStock(product); if (stockLevel === 'OUT_OF_STOCK') return quantity <= 0; return true; });
    const brands = [...new Set(optionRows.map((product) => product.brand).filter(Boolean))].sort();
    const categories = [...new Map(optionRows.filter((product) => product.category).map((product) => [product.category.id, product.category])).values()].sort((a, b) => a.name.localeCompare(b.name));
    res.set('Cache-Control', 'no-store'); res.json({ ok: true, page, pageSize: take, total: filtered.length, totalPages: Math.max(1, Math.ceil(filtered.length / take)), brands, categories, products: filtered.slice((page - 1) * take, page * take) });
  }));

  app.post('/api/public/store/:slug/orders', handle(async (req, res) => {
    const input = orderInput.parse(req.body);
    const shop = await prisma.shop.findFirst({ where: { slug: req.params.slug, active: true }, include: { ecommerceSettings: true } });
    if (!shop?.ecommerceSettings?.enabled) notFound('Online shop is not available');
    if (input.fulfillmentMethod === 'COD' && !shop.ecommerceSettings.deliveryEnabled) return res.status(400).json({ ok: false, message: 'Delivery is disabled' });
    if (input.fulfillmentMethod === 'PICKUP' && !shop.ecommerceSettings.pickupEnabled) return res.status(400).json({ ok: false, message: 'Pickup is disabled' });
    if (input.fulfillmentMethod === 'COD' && !input.deliveryAddress) return res.status(400).json({ ok: false, message: 'Delivery address is required' });
    const grouped = new Map(); input.items.forEach((item) => grouped.set(item.variantId, (grouped.get(item.variantId) || 0) + item.quantity));
    const created = await prisma.$transaction(async (tx) => {
      const items = []; let subtotal = 0;
      for (const [variantId, quantity] of grouped) {
        const variant = await tx.productVariant.findFirst({ where: { id: variantId, shopId: shop.id, active: true, product: { active: true, ecommerceImages: { some: {} }, OR: [{ ecommerceDetail: { is: null } }, { ecommerceDetail: { is: { visible: true } } }] } }, include: { product: true, inventoryBalance: true } });
        if (!variant) notFound('Product is not available');
        await tx.$queryRawUnsafe('SELECT id FROM inventory_balances WHERE product_variant_id = $1::uuid FOR UPDATE', variant.id);
        const reserved = await tx.ecommerceOrderItem.aggregate({ where: { productVariantId: variant.id, order: { status: { in: ['PENDING', 'CONFIRMED', 'READY'] } } }, _sum: { quantity: true } });
        const available = Number(variant.inventoryBalance?.quantity || 0) - Number(reserved._sum.quantity || 0);
        if (quantity > available) { const error = new Error(`${variant.product.name} has only ${Math.max(0, available)} available`); error.status = 409; throw error; }
        const unitPrice = Number(variant.standardSellingPrice); const lineTotal = unitPrice * quantity; subtotal += lineTotal;
        items.push({ productVariantId: variant.id, productNameSnapshot: variant.product.name, variantNameSnapshot: variant.variantName, unitPrice, quantity, lineTotal });
      }
      const deliveryFee = input.fulfillmentMethod === 'COD' ? Number(shop.ecommerceSettings.deliveryFee) : 0;
      const orderNumber = `WEB-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
      return tx.ecommerceOrder.create({ data: { shopId: shop.id, orderNumber, customerName: input.customerName, customerPhone: input.customerPhone, deliveryAddress: input.deliveryAddress || null, fulfillmentMethod: input.fulfillmentMethod, subtotal, deliveryFee, total: subtotal + deliveryFee, note: input.note || null, items: { create: items } }, include: { items: true } });
    }, { isolationLevel: 'Serializable' });
    res.status(201).json({ ok: true, order: created });
  }));
}

module.exports = attachEcommerceStorefrontApi;
