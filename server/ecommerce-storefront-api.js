const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { rateLimit } = require('express-rate-limit');
const { z } = require('zod');
const { OAuth2Client } = require('google-auth-library');
const { prisma } = require('./prisma');
const { requireAuth } = require('./auth-api');

const optionalOrderText = (maximum) => z.preprocess((value) => value == null ? '' : String(value), z.string().trim().max(maximum));
const orderInput = z.object({
  customerName: z.preprocess((value) => String(value || '').trim() || 'Guest Customer', z.string().max(120)),
  customerPhone: z.preprocess((value) => value == null ? '' : String(value), z.string().trim().min(3).max(40)),
  deliveryAddress: optionalOrderText(500),
  fulfillmentMethod: z.preprocess((value) => String(value || '').toUpperCase(), z.enum(['COD', 'PICKUP'])),
  note: optionalOrderText(500),
  items: z.array(z.object({
    variantId: z.string().uuid().optional(),
    productVariantId: z.string().uuid().optional(),
    quantity: z.coerce.number().int().min(1).max(100).optional(),
    qty: z.coerce.number().int().min(1).max(100).optional(),
  }).transform((item, context) => {
    const variantId = item.variantId || item.productVariantId;
    const quantity = item.quantity || item.qty;
    if (!variantId) context.addIssue({ code: 'custom', path: ['variantId'], message: 'Product variant is required' });
    if (!quantity) context.addIssue({ code: 'custom', path: ['quantity'], message: 'Quantity is required' });
    return { variantId, quantity };
  })).min(1).max(50),
});
const settingsInput = z.object({
  enabled: z.boolean().optional(), storeName: z.string().trim().max(160).nullable().optional(),
  description: z.string().trim().max(1200).nullable().optional(), contactPhone: z.string().trim().max(40).nullable().optional(),
  telegramUrl: z.union([
    z.string().trim().url().max(500).refine((value) => /^https:\/\/(t\.me|telegram\.me)\//i.test(value), 'Use a valid Telegram link'),
    z.literal(''), z.null(),
  ]).optional().transform((value) => (value === undefined ? undefined : (value || null))),
  mapUrl: z.union([
    z.string().trim().url().max(1000).refine((value) => /^https:\/\/(maps\.app\.goo\.gl|www\.google\.com\/maps|maps\.google\.com)\//i.test(value), 'Use a valid Google Maps link'),
    z.literal(''), z.null(),
  ]).optional().transform((value) => (value === undefined ? undefined : (value || null))),
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

async function notifyMaharStoreOrder(shop, order) {
  if (shop.slug !== 'maharshwemobile') return { configured: false };
  const token = String(process.env.MAIN_BOT_TOKEN || '').trim();
  const chatId = String(process.env.ADMIN_CHAT_ID || '').trim();
  if (!token || !/^-?\d+$/.test(chatId)) return { configured: false };
  const itemLines = (order.items || []).map((item) =>
    `• ${item.productNameSnapshot}${item.variantNameSnapshot ? ` (${item.variantNameSnapshot})` : ''} × ${item.quantity} — ${Number(item.lineTotal).toLocaleString()} Ks`);
  const text = [
    '🛒 Mahar Shwe Online Order',
    `Order No: ${order.orderNumber}`,
    `Customer: ${order.customerName}`,
    `Phone: ${order.customerPhone}`,
    `Method: ${order.fulfillmentMethod}`,
    order.deliveryAddress ? `Address: ${order.deliveryAddress}` : '',
    '',
    ...itemLines,
    '',
    `Subtotal: ${Number(order.subtotal).toLocaleString()} Ks`,
    Number(order.deliveryFee) > 0 ? `Delivery: ${Number(order.deliveryFee).toLocaleString()} Ks` : '',
    `Total: ${Number(order.total).toLocaleString()} Ks`,
    order.note ? `Note: ${order.note}` : '',
  ].filter(Boolean).join('\n');
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error(`Telegram returned HTTP ${response.status}`);
    return { configured: true, sent: true };
  } catch (error) {
    console.error('[ecommerce] Telegram order notification failed:', error.message);
    return { configured: true, sent: false };
  }
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
    if (error?.issues) {
      const first = error.issues[0];
      const field = first?.path?.filter((part) => typeof part !== 'number').join('.') || 'request';
      return res.status(400).json({ ok: false, message: `${field}: ${first?.message || 'Invalid request'}`, issues: error.issues });
    }
    if (!error.status || error.status >= 500) console.error('E-commerce API:', error);
    return res.status(error.status || 500).json({ ok: false, message: error.message || 'E-commerce request failed' });
  } };
}
function notFound(message) { const error = new Error(message); error.status = 404; throw error; }
async function withSerializableRetry(run, attempts = 3) {
  for (let attempt = 1; ; attempt += 1) {
    try { return await run(); } catch (error) {
      if (error?.code !== 'P2034' || attempt >= attempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, 40 * attempt + Math.floor(Math.random() * 60)));
    }
  }
}

const CUSTOMER_COOKIE = 'mahar_store_session';
const GUEST_CART_COOKIE = 'mahar_store_guest';
const SESSION_DAYS = 30;
const CART_RESERVATION_MINUTES = 20;
const DEFAULT_GOOGLE_CLIENT_ID = '648689584934-kbfljosfdkui7phmiq9k9o3dfl9un0ql.apps.googleusercontent.com';
function sha256(value) { return crypto.createHash('sha256').update(String(value)).digest('hex'); }
function parseCookies(req) {
  return String(req.headers.cookie || '').split(';').reduce((result, part) => {
    const index = part.indexOf('=');
    if (index > 0) {
      const raw = part.slice(index + 1).trim();
      try { result[part.slice(0, index).trim()] = decodeURIComponent(raw); }
      catch { result[part.slice(0, index).trim()] = raw; }
    }
    return result;
  }, {});
}
const publicWriteLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false,
  validate: { xForwardedForHeader: false, trustProxy: false },
  message: { ok: false, message: 'Too many requests. Please try again later.' },
});
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, limit: 60, standardHeaders: true, legacyHeaders: false,
  validate: { xForwardedForHeader: false, trustProxy: false },
  message: { ok: false, message: 'Too many login attempts. Please try again later.' },
});
async function notifyStoreCustomer(customer, order) {
  const token = String(process.env.MAIN_BOT_TOKEN || '').trim();
  if (!token || !customer?.notificationConsent || !customer.telegramChatId) return { configured: false };
  const labels = { PENDING: 'အော်ဒါလက်ခံရရှိပါပြီ', CONFIRMED: 'အော်ဒါကို ပြင်ဆင်နေပါပြီ', READY: 'အော်ဒါရယူရန် အသင့်ဖြစ်ပါပြီ', COMPLETED: 'အော်ဒါပြီးဆုံးပါပြီ', CANCELLED: 'အော်ဒါကို ပယ်ဖျက်ထားပါသည်' };
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: customer.telegramChatId, text: `${labels[order.status] || 'အော်ဒါအခြေအနေ ပြောင်းလဲထားပါသည်'}\n${order.orderNumber}` }),
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error(`Telegram returned HTTP ${response.status}`);
    return { configured: true, sent: true };
  } catch (error) {
    console.error('[ecommerce] Customer Telegram notification failed:', error.message);
    return { configured: true, sent: false };
  }
}
function sessionCookie(value, expiresAt) {
  return [
    `${CUSTOMER_COOKIE}=${encodeURIComponent(value)}`,
    'Path=/', 'HttpOnly', 'SameSite=Lax',
    process.env.NODE_ENV === 'production' ? 'Secure' : '',
    expiresAt ? `Expires=${expiresAt.toUTCString()}` : 'Max-Age=0',
  ].filter(Boolean).join('; ');
}
function guestCartCookie(value) {
  return [`${GUEST_CART_COOKIE}=${encodeURIComponent(value)}`, 'Path=/', 'SameSite=Lax', 'Max-Age=2592000', process.env.NODE_ENV === 'production' ? 'Secure' : ''].filter(Boolean).join('; ');
}
function guestSession(req, res, create = false) {
  const existing = String(parseCookies(req)[GUEST_CART_COOKIE] || '');
  if (/^[0-9a-f-]{36}$/i.test(existing)) return existing;
  if (!create) return null;
  const id = crypto.randomUUID(); res.append('Set-Cookie', guestCartCookie(id)); return id;
}
async function cartOwner(req, res, shopId, createGuest = false) {
  const customer = await currentStoreCustomer(req, shopId);
  return customer ? { customer, customerId: customer.id, guestSessionId: null } : { customer: null, customerId: null, guestSessionId: guestSession(req, res, createGuest) };
}
async function currentStoreCustomer(req, shopId) {
  const token = parseCookies(req)[CUSTOMER_COOKIE];
  if (!token) return null;
  const session = await prisma.ecommerceCustomerSession.findUnique({
    where: { sessionTokenHash: sha256(token) },
    include: { customer: true },
  });
  if (!session || session.revokedAt || session.expiresAt <= new Date() || session.customer.shopId !== shopId) return null;
  return session.customer;
}
function safeCustomer(customer) {
  if (!customer) return null;
  return {
    id: customer.id,
    name: customer.displayName || [customer.telegramFirstName, customer.telegramLastName].filter(Boolean).join(' '),
    email: customer.email,
    photoUrl: customer.telegramPhotoUrl,
    provider: customer.googleSubject ? 'GOOGLE' : 'TELEGRAM',
    phone: customer.phone,
    languageCode: customer.languageCode,
  };
}
async function verifyGoogleCustomerCredential(credential) {
  const clientId = String(process.env.GOOGLE_CLIENT_ID || DEFAULT_GOOGLE_CLIENT_ID).trim();
  try {
    const ticket = await new OAuth2Client(clientId).verifyIdToken({ idToken: credential, audience: clientId });
    const payload = ticket.getPayload();
    if (!payload?.sub || !payload.email || payload.email_verified !== true) throw new Error('Unverified Google identity');
    return { subject: payload.sub, email: payload.email.toLowerCase(), name: payload.name || payload.email, photoUrl: payload.picture || null, languageCode: payload.locale || null };
  } catch {
    throw Object.assign(new Error('Google account verification failed'), { status: 401, statusCode: 401 });
  }
}
function verifyTelegramLogin(payload) {
  const token = String(process.env.MAIN_BOT_TOKEN || '').trim();
  if (!token) return false;
  const receivedHash = String(payload.hash || '');
  const data = Object.entries(payload)
    .filter(([key, value]) => key !== 'hash' && value !== undefined && value !== null)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const secret = crypto.createHash('sha256').update(token).digest();
  const expected = crypto.createHmac('sha256', secret).update(data).digest('hex');
  const fresh = Math.abs(Date.now() / 1000 - Number(payload.auth_date || 0)) < 86400;
  return fresh && receivedHash.length === expected.length
    && crypto.timingSafeEqual(Buffer.from(receivedHash), Buffer.from(expected));
}
async function createCustomerSession(res, customerId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400000);
  await prisma.ecommerceCustomerSession.create({ data: { customerId, sessionTokenHash: sha256(token), expiresAt } });
  res.setHeader('Set-Cookie', sessionCookie(token, expiresAt));
}

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
  app.post('/api/ecommerce/telegram/connect-callback', handle(async (req, res) => {
    const expected = String(process.env.TELEGRAM_WEBHOOK_SECRET || '').trim();
    const supplied = String(req.get('x-telegram-webhook-secret') || '').trim();
    if (!expected || supplied.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) {
      return res.status(401).json({ ok: false, message: 'Unauthorized' });
    }
    const input = z.object({ token: z.string().min(20).max(100), chatId: z.union([z.string(), z.number()]), telegramUserId: z.union([z.string(), z.number()]) }).parse(req.body);
    const row = await prisma.ecommerceTelegramConnectionToken.findUnique({ where: { tokenHash: sha256(input.token) } });
    if (!row || row.usedAt || row.expiresAt <= new Date()) return res.status(410).json({ ok: false, message: 'Connection token expired or used' });
    const customer = await prisma.ecommerceCustomer.findFirst({ where: { id: row.customerId, shopId: row.shopId, telegramUserId: String(input.telegramUserId) } });
    if (!customer) return res.status(403).json({ ok: false, message: 'Telegram identity does not match' });
    await prisma.$transaction([
      prisma.ecommerceTelegramConnectionToken.update({ where: { id: row.id }, data: { usedAt: new Date() } }),
      prisma.ecommerceCustomer.update({ where: { id: customer.id }, data: { telegramChatId: String(input.chatId), telegramConnectedAt: new Date(), notificationConsent: true } }),
    ]);
    res.json({ ok: true });
  }));

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
        await tx.ecommerceProductImage.deleteMany({ where: { shopId: req.auth.shopId, productId: product.id, source: { in: ['GOOGLE_DRIVE', 'URL'] } } });
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
    res.json({ ok: true, page, pageSize: take, total, totalPages: Math.max(1, Math.ceil(total / take)), orders });
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
      if (status !== 'COMPLETED' && order.status === 'COMPLETED') {
        for (const item of order.items) {
          const balance = await tx.inventoryBalance.findUnique({ where: { productVariantId: item.productVariantId } });
          if (!balance) continue;
          const after = balance.quantity + item.quantity;
          await tx.inventoryBalance.update({ where: { productVariantId: item.productVariantId }, data: { quantity: after } });
          await tx.stockMovement.create({ data: { shopId: req.auth.shopId, productVariantId: item.productVariantId, type: 'SALE_RETURN', quantityChange: item.quantity, beforeQuantity: balance.quantity, afterQuantity: after, referenceType: 'ECOMMERCE_ORDER', referenceId: order.id, userId: req.auth.userId, note: `${order.orderNumber} reopened` } });
        }
      }
      return tx.ecommerceOrder.update({ where: { id: order.id }, data: { status }, include: { items: true } });
    });
    const customer = updated.customerId ? await prisma.ecommerceCustomer.findFirst({ where: { id: updated.customerId, shopId: req.auth.shopId } }) : null;
    const telegram = await notifyStoreCustomer(customer, updated);
    res.json({ ok: true, order: updated, telegram: { configured: telegram.configured, sent: telegram.sent === true } });
  }));

  app.get('/api/public/store/:slug', handle(async (req, res) => {
    const shop = await prisma.shop.findFirst({ where: { slug: req.params.slug, active: true }, include: { ecommerceSettings: true, subscriptions: { orderBy: { endsAt: 'desc' }, take: 1 } } });
    if (!shop?.ecommerceSettings?.enabled) notFound('Online shop is not available');
    const subscription = shop.subscriptions?.[0] || null;
    const planText = String(subscription?.notes || '').toLowerCase();
    const verified = Boolean(subscription && subscription.status === 'ACTIVE' && subscription.endsAt > new Date() && !planText.includes('trial') && !planText.includes('free'));
    res.set('Cache-Control', 'public, max-age=60');
    const vpnBotName = String(process.env.MAIN_BOT_USERNAME || 'maharshwemobilebot').replace(/^@/, '').trim();
    res.json({ ok: true, store: { slug: shop.slug, name: shop.ecommerceSettings.storeName || shop.name, logoUrl: shop.logoUrl, description: shop.ecommerceSettings.description, phone: shop.ecommerceSettings.contactPhone || shop.phone, telegramUrl: shop.ecommerceSettings.telegramUrl, vpnBotUrl: `https://t.me/${vpnBotName}`, googleClientId: String(process.env.GOOGLE_CLIENT_ID || DEFAULT_GOOGLE_CLIENT_ID), mapUrl: shop.ecommerceSettings.mapUrl, address: shop.address, verified, verificationType: verified ? 'PAID' : null, deliveryEnabled: shop.ecommerceSettings.deliveryEnabled, pickupEnabled: shop.ecommerceSettings.pickupEnabled, deliveryFee: Number(shop.ecommerceSettings.deliveryFee) } });
  }));

  app.get('/api/public/store/:slug/manifest.webmanifest', handle(async (req, res) => {
    const shop = await prisma.shop.findFirst({
      where: { slug: req.params.slug, active: true, ecommerceSettings: { is: { enabled: true } } },
      include: { ecommerceSettings: true },
    });
    if (!shop) notFound('Online shop is not available');
    const name = shop.ecommerceSettings.storeName || shop.name;
    const shopIcon = shop.logoUrl || '/mahar-pos-logo-512.png';
    res.type('application/manifest+json').set('Cache-Control', 'public, max-age=300').json({
      id: `/shop/${shop.slug}`,
      name,
      short_name: name.slice(0, 24),
      description: shop.ecommerceSettings.description || `${name} online shop`,
      start_url: `/shop/${shop.slug}`,
      scope: '/shop/',
      display: 'standalone',
      background_color: '#f7f9fc',
      theme_color: '#0a8f5b',
      icons: [
        { src: shopIcon, sizes: '512x512', purpose: 'any maskable' },
        { src: '/mahar-pos-logo-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: '/mahar-pos-logo-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
      ],
    });
  }));

  app.get('/api/public/store/:slug/customer/me', handle(async (req, res) => {
    const shop = await prisma.shop.findFirst({ where: { slug: req.params.slug, active: true }, select: { id: true } });
    if (!shop) notFound('Online shop is not available');
    const customer = await currentStoreCustomer(req, shop.id);
    res.set('Cache-Control', 'no-store').json({ ok: true, customer: safeCustomer(customer) });
  }));

  app.post('/api/public/store/:slug/customer/google/login', loginLimiter, handle(async (req, res) => {
    const input = z.object({ credential: z.string().trim().min(100).max(10000) }).parse(req.body);
    const identity = await verifyGoogleCustomerCredential(input.credential);
    const shop = await prisma.shop.findFirst({ where: { slug: req.params.slug, active: true, ecommerceSettings: { is: { enabled: true } } }, select: { id: true } });
    if (!shop) notFound('Online shop is not available');
    const existing = await prisma.ecommerceCustomer.findFirst({ where: { shopId: shop.id, googleSubject: identity.subject } });
    const customer = existing
      ? await prisma.ecommerceCustomer.update({ where: { id: existing.id }, data: { email: identity.email, displayName: identity.name, telegramPhotoUrl: identity.photoUrl, languageCode: identity.languageCode, lastLoginAt: new Date() } })
      : await prisma.ecommerceCustomer.create({ data: { shopId: shop.id, googleSubject: identity.subject, email: identity.email, displayName: identity.name, telegramPhotoUrl: identity.photoUrl, languageCode: identity.languageCode } });
    await createCustomerSession(res, customer.id);
    res.json({ ok: true, customer: safeCustomer(customer) });
  }));

  app.post('/api/public/store/:slug/customer/telegram/login', loginLimiter, handle(async (req, res) => {
    const input = z.object({
      id: z.union([z.string(), z.number()]), auth_date: z.union([z.string(), z.number()]), hash: z.string().length(64),
      first_name: z.string().min(1).max(120), last_name: z.string().max(120).optional(), username: z.string().max(120).optional(),
      photo_url: z.string().url().optional(), language_code: z.string().max(10).optional(),
    }).parse(req.body);
    if (!verifyTelegramLogin(input)) return res.status(401).json({ ok: false, message: 'Telegram login verification failed' });
    const shop = await prisma.shop.findFirst({ where: { slug: req.params.slug, active: true, ecommerceSettings: { is: { enabled: true } } }, select: { id: true } });
    if (!shop) notFound('Online shop is not available');
    const customer = await prisma.ecommerceCustomer.upsert({
      where: { shopId_telegramUserId: { shopId: shop.id, telegramUserId: String(input.id) } },
      update: { telegramUsername: input.username || null, telegramFirstName: input.first_name, telegramLastName: input.last_name || null, telegramPhotoUrl: input.photo_url || null, languageCode: input.language_code || null, lastLoginAt: new Date() },
      create: { shopId: shop.id, telegramUserId: String(input.id), telegramUsername: input.username || null, telegramFirstName: input.first_name, telegramLastName: input.last_name || null, telegramPhotoUrl: input.photo_url || null, languageCode: input.language_code || null },
    });
    await createCustomerSession(res, customer.id);
    res.json({ ok: true, customer: safeCustomer(customer) });
  }));

  app.post('/api/public/store/:slug/customer/telegram/login-link', handle(async (req, res) => {
    const shop = await prisma.shop.findFirst({ where: { slug: req.params.slug, active: true }, include: { ecommerceSettings: true } });
    if (!shop?.ecommerceSettings?.enabled) notFound('Online shop is not available');
    const botName = String(process.env.MAIN_BOT_USERNAME || '').replace(/^@/, '').trim();
    const url = botName ? `https://t.me/${botName}?start=shop_login_${shop.slug}` : shop.ecommerceSettings.telegramUrl;
    if (!url) return res.status(503).json({ ok: false, message: 'Telegram bot is not configured' });
    res.json({ ok: true, url });
  }));

  app.post('/api/public/store/:slug/customer/telegram/connect', publicWriteLimiter, handle(async (req, res) => {
    const shop = await prisma.shop.findFirst({ where: { slug: req.params.slug, active: true }, select: { id: true, slug: true } });
    if (!shop) notFound('Online shop is not available');
    const customer = await currentStoreCustomer(req, shop.id);
    if (!customer) return res.status(401).json({ ok: false, message: 'Telegram login is required' });
    const rawToken = crypto.randomBytes(24).toString('base64url');
    await prisma.ecommerceTelegramConnectionToken.create({ data: { customerId: customer.id, shopId: shop.id, tokenHash: sha256(rawToken), expiresAt: new Date(Date.now() + 10 * 60000) } });
    const botName = String(process.env.MAIN_BOT_USERNAME || '').replace(/^@/, '').trim();
    if (!botName) return res.status(503).json({ ok: false, message: 'Telegram bot username is not configured' });
    res.json({ ok: true, url: `https://t.me/${botName}?start=connect_${rawToken}` });
  }));

  app.post('/api/public/store/:slug/customer/logout', handle(async (req, res) => {
    const token = parseCookies(req)[CUSTOMER_COOKIE];
    if (token) await prisma.ecommerceCustomerSession.updateMany({ where: { sessionTokenHash: sha256(token), revokedAt: null }, data: { revokedAt: new Date() } });
    res.setHeader('Set-Cookie', sessionCookie('', null));
    res.json({ ok: true });
  }));

  app.get('/api/public/store/:slug/customer/orders', handle(async (req, res) => {
    const shop = await prisma.shop.findFirst({ where: { slug: req.params.slug, active: true }, select: { id: true } });
    if (!shop) notFound('Online shop is not available');
    const customer = await currentStoreCustomer(req, shop.id);
    if (!customer) return res.status(401).json({ ok: false, message: 'Customer login is required' });
    const orders = await prisma.ecommerceOrder.findMany({ where: { shopId: shop.id, customerId: customer.id }, include: { items: true }, orderBy: { createdAt: 'desc' }, take: 100 });
    res.set('Cache-Control', 'no-store').json({ ok: true, orders });
  }));

  app.get('/api/public/store/:slug/customer/cart', handle(async (req, res) => {
    const shop = await prisma.shop.findFirst({ where: { slug: req.params.slug, active: true }, select: { id: true } });
    if (!shop) notFound('Online shop is not available');
    const owner = await cartOwner(req, res, shop.id, false);
    if (!owner.customerId && !owner.guestSessionId) return res.set('Cache-Control', 'no-store').json({ ok: true, cart: null, reservationMinutes: CART_RESERVATION_MINUTES });
    const cart = await prisma.ecommerceCart.findFirst({ where: { shopId: shop.id, status: 'ACTIVE', ...(owner.customerId ? { customerId: owner.customerId } : { guestSessionId: owner.guestSessionId }) }, include: { items: true }, orderBy: { updatedAt: 'desc' } });
    res.set('Cache-Control', 'no-store').json({ ok: true, cart: cart || null, reservationMinutes: CART_RESERVATION_MINUTES });
  }));

  app.put('/api/public/store/:slug/customer/cart', handle(async (req, res) => {
    const input = z.object({ items: z.array(z.object({ productId: z.string().uuid(), variantId: z.string().uuid(), quantity: z.coerce.number().int().min(1).max(100) })).max(100) }).parse(req.body);
    const shop = await prisma.shop.findFirst({ where: { slug: req.params.slug, active: true }, select: { id: true } });
    if (!shop) notFound('Online shop is not available');
    const owner = await cartOwner(req, res, shop.id, true);
    const grouped = new Map();
    input.items.forEach((item) => grouped.set(item.variantId, { ...item, quantity: Math.min(100, (grouped.get(item.variantId)?.quantity || 0) + item.quantity) }));
    const cart = await prisma.$transaction(async (tx) => {
      let row = await tx.ecommerceCart.findFirst({ where: { shopId: shop.id, status: 'ACTIVE', ...(owner.customerId ? { customerId: owner.customerId } : { guestSessionId: owner.guestSessionId }) }, orderBy: { updatedAt: 'desc' } });
      if (!row) row = await tx.ecommerceCart.create({ data: { shopId: shop.id, customerId: owner.customerId, guestSessionId: owner.guestSessionId } });
      await tx.ecommerceCartItem.deleteMany({ where: { cartId: row.id } });
      for (const item of grouped.values()) {
        const variant = await tx.productVariant.findFirst({ where: { id: item.variantId, productId: item.productId, shopId: shop.id, active: true }, select: { id: true, standardSellingPrice: true, inventoryBalance: { select: { quantity: true } } } });
        if (!variant) continue;
        const reserved = await tx.ecommerceCartItem.aggregate({ where: { productVariantId: variant.id, cartId: { not: row.id }, cart: { shopId: shop.id, status: 'ACTIVE', updatedAt: { gte: new Date(Date.now() - CART_RESERVATION_MINUTES * 60000) } } }, _sum: { quantity: true } });
        const pending = await tx.ecommerceOrderItem.aggregate({ where: { productVariantId: variant.id, order: { shopId: shop.id, status: { in: ['PENDING', 'CONFIRMED', 'READY'] } } }, _sum: { quantity: true } });
        const available = Number(variant.inventoryBalance?.quantity || 0) - Number(reserved._sum.quantity || 0) - Number(pending._sum.quantity || 0);
        if (item.quantity > available) { const error = new Error(`Only ${Math.max(0, available)} item(s) available`); error.status = 409; throw error; }
        await tx.ecommerceCartItem.create({ data: { cartId: row.id, productId: item.productId, productVariantId: variant.id, quantity: item.quantity, unitPriceSnapshot: variant.standardSellingPrice } });
      }
      return tx.ecommerceCart.findUnique({ where: { id: row.id }, include: { items: true } });
    });
    res.json({ ok: true, cart, reservationMinutes: CART_RESERVATION_MINUTES, reservedUntil: new Date(Date.now() + CART_RESERVATION_MINUTES * 60000) });
  }));

  app.get('/api/public/store/:slug/products', handle(async (req, res) => {
    const shop = await prisma.shop.findFirst({ where: { slug: req.params.slug, active: true, ecommerceSettings: { is: { enabled: true } } }, select: { id: true } });
    if (!shop) notFound('Online shop is not available');
    const search = String(req.query.search || '').trim(); const page = Math.max(1, Number(req.query.page) || 1); const take = 10;
    const brand = String(req.query.brand || '').trim(); const categoryId = String(req.query.categoryId || '').trim(); const stockLevel = String(req.query.stockLevel || '').trim().toUpperCase();
    const visibleWhere = { OR: [{ ecommerceDetail: { is: null } }, { ecommerceDetail: { is: { visible: true } } }] };
    const publicInclude = {
      category: true, ecommerceDetail: true, ecommerceImages: { orderBy: { sortOrder: 'asc' } },
      variants: { where: { active: true }, select: { id: true, variantName: true, unit: true, ram: true, storage: true, color: true, standardSellingPrice: true, inventoryBalance: { select: { quantity: true, minAlertQuantity: true } } } },
    };
    const sanitize = (products) => products.map((product) => ({ ...product, variants: (product.variants || []).map(({ inventoryBalance, ...variant }) => ({ ...variant, inventoryBalance: { quantity: Number(inventoryBalance?.quantity || 0) } })) }));
    const baseWhere = { shopId: shop.id, active: true, ecommerceImages: { some: {} }, ...visibleWhere };
    const idsRaw = String(req.query.ids || '').trim();
    if (idsRaw) {
      const ids = [...new Set(idsRaw.split(',').map((value) => value.trim()).filter((value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)))].slice(0, 50);
      const rows = ids.length ? await prisma.product.findMany({ where: { ...baseWhere, id: { in: ids } }, include: publicInclude }) : [];
      return res.set('Cache-Control', 'no-store').json({ ok: true, products: sanitize(rows) });
    }
    const where = { ...baseWhere, ...(search ? { name: { contains: search, mode: 'insensitive' } } : {}), ...(brand ? { brand } : {}), ...(categoryId ? { categoryId } : {}) };
    const [rows, optionRows] = await Promise.all([
      prisma.product.findMany({ where, include: publicInclude, orderBy: [{ ecommerceDetail: { featured: 'desc' } }, { name: 'asc' }] }),
      prisma.product.findMany({ where: baseWhere, select: { brand: true, category: true } }),
    ]);
    const stockTotal = (product) => product.variants.reduce((sum, variant) => sum + Number(variant.inventoryBalance?.quantity || 0), 0);
    const lowStock = (product) => product.variants.some((variant) => { const balance = variant.inventoryBalance; return balance && Number(balance.quantity) > 0 && Number(balance.quantity) <= Number(balance.minAlertQuantity || 0); });
    const filtered = rows.filter((product) => { const quantity = stockTotal(product); if (stockLevel === 'IN_STOCK') return quantity > 0; if (stockLevel === 'LOW_STOCK') return lowStock(product); if (stockLevel === 'OUT_OF_STOCK') return quantity <= 0; return true; });
    const brands = [...new Set(optionRows.map((product) => product.brand).filter(Boolean))].sort();
    const categories = [...new Map(optionRows.filter((product) => product.category).map((product) => [product.category.id, product.category])).values()].sort((a, b) => a.name.localeCompare(b.name));
    res.set('Cache-Control', 'no-store'); res.json({ ok: true, page, pageSize: take, total: filtered.length, totalPages: Math.max(1, Math.ceil(filtered.length / take)), brands, categories, products: sanitize(filtered.slice((page - 1) * take, page * take)) });
  }));

  app.post('/api/public/store/:slug/orders', publicWriteLimiter, handle(async (req, res) => {
    const input = orderInput.parse(req.body);
    const shop = await prisma.shop.findFirst({ where: { slug: req.params.slug, active: true }, include: { ecommerceSettings: true } });
    if (!shop?.ecommerceSettings?.enabled) notFound('Online shop is not available');
    if (input.fulfillmentMethod === 'COD' && !shop.ecommerceSettings.deliveryEnabled) return res.status(400).json({ ok: false, message: 'Delivery is disabled' });
    if (input.fulfillmentMethod === 'PICKUP' && !shop.ecommerceSettings.pickupEnabled) return res.status(400).json({ ok: false, message: 'Pickup is disabled' });
    if (input.fulfillmentMethod === 'COD' && !input.deliveryAddress) return res.status(400).json({ ok: false, message: 'Delivery address is required' });
    const grouped = new Map(); input.items.forEach((item) => grouped.set(item.variantId, (grouped.get(item.variantId) || 0) + item.quantity));
    const idempotencyKey = String(req.get('Idempotency-Key') || '').trim();
    if (idempotencyKey && !/^[a-zA-Z0-9_-]{16,100}$/.test(idempotencyKey)) return res.status(400).json({ ok: false, message: 'Invalid idempotency key' });
    if (idempotencyKey) {
      const existing = await prisma.ecommerceOrder.findFirst({ where: { shopId: shop.id, idempotencyKey }, include: { items: true } });
      if (existing) return res.json({ ok: true, order: existing, duplicate: true });
    }
    const owner = await cartOwner(req, res, shop.id, true);
    const activeCart = await prisma.ecommerceCart.findFirst({
      where: { shopId: shop.id, status: 'ACTIVE', ...(owner.customerId ? { customerId: owner.customerId } : { guestSessionId: owner.guestSessionId }) },
      orderBy: { updatedAt: 'desc' },
    });
    const created = await withSerializableRetry(() => prisma.$transaction(async (tx) => {
      const items = []; let subtotal = 0;
      for (const [variantId, quantity] of grouped) {
        const variant = await tx.productVariant.findFirst({ where: { id: variantId, shopId: shop.id, active: true, product: { active: true, ecommerceImages: { some: {} }, OR: [{ ecommerceDetail: { is: null } }, { ecommerceDetail: { is: { visible: true } } }] } }, include: { product: true, inventoryBalance: true } });
        if (!variant) notFound('Product is not available');
        await tx.$queryRawUnsafe('SELECT id FROM inventory_balances WHERE product_variant_id = $1::uuid FOR UPDATE', variant.id);
        const pending = await tx.ecommerceOrderItem.aggregate({ where: { productVariantId: variant.id, order: { shopId: shop.id, status: { in: ['PENDING', 'CONFIRMED', 'READY'] } } }, _sum: { quantity: true } });
        const otherCarts = await tx.ecommerceCartItem.aggregate({ where: { productVariantId: variant.id, ...(activeCart ? { cartId: { not: activeCart.id } } : {}), cart: { shopId: shop.id, status: 'ACTIVE', updatedAt: { gte: new Date(Date.now() - CART_RESERVATION_MINUTES * 60000) } } }, _sum: { quantity: true } });
        const available = Number(variant.inventoryBalance?.quantity || 0) - Number(pending._sum.quantity || 0) - Number(otherCarts._sum.quantity || 0);
        if (quantity > available) { const error = new Error(`${variant.product.name} has only ${Math.max(0, available)} available`); error.status = 409; throw error; }
        const unitPrice = Number(variant.standardSellingPrice); const lineTotal = unitPrice * quantity; subtotal += lineTotal;
        items.push({ productVariantId: variant.id, productNameSnapshot: variant.product.name, variantNameSnapshot: variant.variantName, unitPrice, quantity, lineTotal });
      }
      const deliveryFee = input.fulfillmentMethod === 'COD' ? Number(shop.ecommerceSettings.deliveryFee) : 0;
      const orderNumber = `WEB-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
      const order = await tx.ecommerceOrder.create({ data: { shopId: shop.id, customerId: owner.customer?.id || null, idempotencyKey: idempotencyKey || null, orderNumber, customerName: input.customerName, customerPhone: input.customerPhone, deliveryAddress: input.deliveryAddress || null, fulfillmentMethod: input.fulfillmentMethod, subtotal, deliveryFee, total: subtotal + deliveryFee, note: input.note || null, items: { create: items } }, include: { items: true } });
      if (activeCart) await tx.ecommerceCart.update({ where: { id: activeCart.id }, data: { status: 'ORDERED' } });
      if (owner.customer) await tx.ecommerceCustomer.update({ where: { id: owner.customer.id }, data: { phone: input.customerPhone, lastOrderAt: new Date() } });
      return order;
    }, { isolationLevel: 'Serializable' }));
    res.status(201).json({ ok: true, order: created });
  }));
}

module.exports = attachEcommerceStorefrontApi;
