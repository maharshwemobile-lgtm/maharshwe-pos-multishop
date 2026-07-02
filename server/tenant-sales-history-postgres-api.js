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
const voidSchema = z.object({ reason: z.string().trim().min(1).max(500) });

class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

function wrap(handler) {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (error) {
      if (error instanceof ApiError) return res.status(error.status).json({ ok: false, message: error.message, details: error.details });
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        return res.status(404).json({ ok: false, message: 'Sale not found' });
      }
      console.error('Tenant Sale History API:', error);
      return res.status(500).json({ ok: false, message: error.message || 'Sale History request failed' });
    }
  };
}

const number = (value) => Number(value || 0);
const paymentName = (method) => String(method || 'OTHER').replaceAll('_', ' ');
const statusName = (status) => status === 'VOIDED' ? 'Voided' : status === 'RETURNED' ? 'Returned' : status === 'PARTIAL_RETURN' ? 'Partial Return' : 'Completed';

function parse(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) throw new ApiError(400, 'Invalid request', result.error.flatten().fieldErrors);
  return result.data;
}

function integrityError(entity, id, expectedShopId, actualShopId) {
  throw new ApiError(409, 'Tenant integrity violation detected', { entity, id, expectedShopId, actualShopId });
}

function assertTenantGraph(sale, shopId) {
  if (!sale) return;
  if (sale.shopId !== shopId) integrityError('sale', sale.id, shopId, sale.shopId);
  if (sale.user && sale.user.shopId !== shopId) integrityError('user', sale.user.id, shopId, sale.user.shopId);
  if (sale.customer && sale.customer.shopId !== shopId) integrityError('customer', sale.customer.id, shopId, sale.customer.shopId);
  for (const item of sale.items || []) {
    if (item.shopId !== shopId || item.saleId !== sale.id) integrityError('sale_item', item.id, shopId, item.shopId);
    if (item.productVariant && item.productVariant.shopId !== shopId) integrityError('product_variant', item.productVariantId, shopId, item.productVariant.shopId);
  }
  for (const payment of sale.payments || []) {
    if (payment.shopId !== shopId || payment.saleId !== sale.id) integrityError('payment', payment.id, shopId, payment.shopId);
  }
}

const includeSale = {
  customer: { select: { id: true, shopId: true, name: true, phone: true, address: true } },
  user: { select: { id: true, shopId: true, name: true, username: true, role: true, active: true } },
  items: {
    orderBy: { createdAt: 'asc' },
    include: {
      productVariant: { select: { shopId: true, unit: true, expiryDate: true, wholesalePrice: true } },
    },
  },
  payments: { orderBy: { paidAt: 'asc' } },
};

function listRow(row) {
  return {
    id: row.id,
    invoice: row.invoiceNumber,
    invoiceNumber: row.invoiceNumber,
    dateTime: row.soldAt,
    date: row.soldAt,
    customerId: row.customer?.id || null,
    customer: row.customer?.name || 'Walk-in Customer',
    customerPhone: row.customer?.phone || null,
    items: (row.items || []).map((item) => `${item.productNameSnapshot}${item.variantNameSnapshot ? ` ${item.variantNameSnapshot}` : ''} x${item.quantity}`).join(', '),
    itemCount: (row.items || []).reduce((sum, item) => sum + Number(item.quantity || 0), 0),
    amount: number(row.total),
    subtotal: number(row.subtotal),
    discount: number(row.discount),
    profit: number(row.profitTotal),
    payment: row.paymentStatus === 'PENDING' ? 'Credit' : paymentName(row.payments?.[0]?.method),
    paymentStatus: row.paymentStatus,
    status: statusName(row.status),
    cashier: row.user?.name || row.user?.username || '-',
    cashierUserId: row.user?.id || row.userId,
    cashierUsername: row.user?.username || null,
    cashierRole: row.user?.role || null,
    cashierActive: row.user?.active !== false,
  };
}

function detailRow(row) {
  return {
    ...listRow(row),
    costTotal: number(row.costTotal),
    voidedAt: row.voidedAt,
    voidReason: row.voidReason,
    payments: (row.payments || []).map((payment) => ({
      id: payment.id,
      method: paymentName(payment.method),
      amount: number(payment.amount),
      status: payment.status,
      reference: payment.reference,
      paidAt: payment.paidAt,
    })),
    itemRows: (row.items || []).map((item) => ({
      id: item.id,
      productVariantId: item.productVariantId,
      productName: item.productNameSnapshot,
      variantName: item.variantNameSnapshot,
      categoryName: item.categoryNameSnapshot,
      imeiSerial: item.imeiSerial,
      quantity: item.quantity,
      unitPrice: number(item.actualSoldPrice),
      standardPrice: number(item.standardPrice),
      unit: item.productVariant?.unit || '',
      expiryDate: item.productVariant?.expiryDate ? item.productVariant.expiryDate.toISOString().slice(0, 10) : null,
      wholesalePrice: number(item.productVariant?.wholesalePrice),
      minimumPrice: number(item.minimumPrice),
      discount: number(item.discount),
      profit: number(item.profit),
    })),
    raw: {
      invoiceNumber: row.invoiceNumber,
      customer: row.customer ? { id: row.customer.id, name: row.customer.name, phone: row.customer.phone } : null,
      cashier: row.user ? { id: row.user.id, name: row.user.name, username: row.user.username, role: row.user.role, active: row.user.active } : null,
      subtotal: number(row.subtotal),
      discount: number(row.discount),
      total: number(row.total),
      paymentStatus: row.paymentStatus,
      status: row.status,
      soldAt: row.soldAt,
    },
  };
}

async function findSale(db, identifier, shopId) {
  const parsed = uuid.safeParse(identifier);
  const sale = await db.sale.findFirst({
    where: {
      shopId,
      ...(parsed.success ? { OR: [{ id: parsed.data }, { invoiceNumber: identifier }] } : { invoiceNumber: identifier }),
    },
    include: includeSale,
  });
  assertTenantGraph(sale, shopId);
  return sale;
}

async function serializable(work) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.$transaction(work, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 5000,
        timeout: 20000,
      });
    } catch (error) {
      if (error.code === 'P2034' && attempt < 2) continue;
      throw error;
    }
  }
}

function requireVoidPermission(req, res, next) {
  if (req.auth?.role === 'SUPER_ADMIN' || req.auth?.role === 'SHOP_ADMIN' || req.auth?.permissions?.deleteSale === true) {
    return next();
  }
  return res.status(403).json({ ok: false, message: 'Void Sale permission is required' });
}

function attachTenantSalesHistoryPostgresApi(app) {
  const historyRead = [requireAuth, requireShopUser, requirePermission('history')];
  const voidAccess = [requireAuth, requireShopUser, requireWritableSubscription, requireVoidPermission];

  app.get('/api/sales', ...historyRead, wrap(async (req, res) => {
    const page = Math.max(1, Number.parseInt(req.query.page || '1', 10) || 1);
    const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit || '10', 10) || 10));
    const search = String(req.query.q || '').trim();
    const shopId = req.auth.shopId;
    const where = {
      shopId,
      ...(search ? {
        OR: [
          { invoiceNumber: { contains: search, mode: 'insensitive' } },
          { customer: { is: { shopId, name: { contains: search, mode: 'insensitive' } } } },
          { customer: { is: { shopId, phone: { contains: search, mode: 'insensitive' } } } },
          { items: { some: { shopId, productNameSnapshot: { contains: search, mode: 'insensitive' } } } },
        ],
      } : {}),
    };

    const [total, rows] = await prisma.$transaction([
      prisma.sale.count({ where }),
      prisma.sale.findMany({ where, include: includeSale, orderBy: { soldAt: 'desc' }, skip: (page - 1) * limit, take: limit }),
    ]);
    rows.forEach((row) => assertTenantGraph(row, shopId));

    res.json({
      ok: true,
      tenant: { shopId },
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      sales: rows.map(listRow),
    });
  }));

  app.get('/api/sales/:id', ...historyRead, wrap(async (req, res) => {
    const sale = await findSale(prisma, req.params.id, req.auth.shopId);
    if (!sale) throw new ApiError(404, 'Sale not found');
    res.json({ ok: true, tenant: { shopId: req.auth.shopId }, sale: detailRow(sale) });
  }));

  app.post('/api/sales/:id/void', ...voidAccess, wrap(async (req, res) => {
    const input = parse(voidSchema, req.body || {});
    const shopId = req.auth.shopId;

    const result = await serializable(async (tx) => {
      const sale = await findSale(tx, req.params.id, shopId);
      if (!sale) throw new ApiError(404, 'Sale not found');
      if (sale.status === 'VOIDED') throw new ApiError(409, 'Sale is already voided');
      if (sale.status !== 'COMPLETED') throw new ApiError(409, `Only completed sales can be voided. Current status: ${statusName(sale.status)}`);

      const existingReversal = await tx.stockMovement.findFirst({
        where: { shopId, referenceType: 'SALE_VOID', referenceId: sale.id },
        select: { id: true },
      });
      if (existingReversal) throw new ApiError(409, 'This sale already has a stock reversal');

      for (const item of sale.items) {
        if (!item.productVariantId) continue;
        const variant = await tx.productVariant.findFirst({ where: { id: item.productVariantId, shopId } });
        if (!variant) integrityError('product_variant', item.productVariantId, shopId, null);
        const balance = await tx.inventoryBalance.findUnique({ where: { productVariantId: item.productVariantId } });
        if (balance && balance.shopId !== shopId) integrityError('inventory_balance', balance.id, shopId, balance.shopId);
        const beforeQuantity = Number(balance?.quantity || 0);
        const afterQuantity = beforeQuantity + item.quantity;
        if (balance) await tx.inventoryBalance.update({ where: { id: balance.id }, data: { quantity: afterQuantity } });
        else await tx.inventoryBalance.create({ data: { shopId, productVariantId: item.productVariantId, quantity: afterQuantity, minAlertQuantity: 0 } });
        await tx.stockMovement.create({
          data: {
            shopId,
            productVariantId: item.productVariantId,
            type: 'REVERSAL',
            quantityChange: item.quantity,
            beforeQuantity,
            afterQuantity,
            referenceType: 'SALE_VOID',
            referenceId: sale.id,
            userId: req.auth.userId,
            note: `${sale.invoiceNumber} · ${input.reason}`,
          },
        });
      }

      if (sale.paymentStatus === 'PENDING' && sale.customerId) {
        const customerResult = await tx.customer.updateMany({
          where: { id: sale.customerId, shopId },
          data: { balance: { decrement: sale.total } },
        });
        if (customerResult.count !== 1) integrityError('customer', sale.customerId, shopId, sale.customer?.shopId || null);
      }

      await tx.payment.updateMany({
        where: { shopId, saleId: sale.id, status: { not: 'VOIDED' } },
        data: { status: 'VOIDED' },
      });

      const saleResult = await tx.sale.updateMany({
        where: { id: sale.id, shopId, status: 'COMPLETED' },
        data: { status: 'VOIDED', paymentStatus: 'VOIDED', voidedAt: new Date(), voidReason: input.reason },
      });
      if (saleResult.count !== 1) throw new ApiError(409, 'Sale status changed before Void completed. Refresh and try again.');

      await tx.auditLog.create({
        data: {
          shopId,
          userId: req.auth.userId,
          action: 'SALE_VOIDED',
          entityType: 'sale',
          entityId: sale.id,
          details: { invoiceNumber: sale.invoiceNumber, reason: input.reason, total: number(sale.total), tenantShopId: shopId },
          ipAddress: req.ip || null,
          userAgent: req.headers['user-agent'] || null,
        },
      });

      return { id: sale.id, invoice: sale.invoiceNumber, status: 'Voided', reason: input.reason };
    });

    queuePush(() => sendPushToShop({
      shopId,
      eventType: 'SALE_VOIDED',
      title: 'Sale voided',
      body: 'A sale was voided. Open Mahar POS to review.',
      url: '/sales-history',
      data: { source: 'sale-void', saleId: result.id },
    }), 'sale voided push');

    res.json({ ok: true, tenant: { shopId }, message: 'Sale voided and stock restored', sale: result });
  }));
}

module.exports = attachTenantSalesHistoryPostgresApi;
