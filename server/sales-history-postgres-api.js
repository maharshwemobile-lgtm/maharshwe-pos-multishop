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
const voidSchema = z.object({
  reason: z.string().trim().min(1).max(500),
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
      if (error instanceof ApiError) return res.status(error.status).json({ ok: false, message: error.message, details: error.details });
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2025') return res.status(404).json({ ok: false, message: 'Sale not found' });
      }
      console.error('PostgreSQL sales history API:', error);
      return res.status(500).json({ ok: false, message: error.message || 'Sales history request failed' });
    }
  };
}

const number = (value) => Number(value || 0);
const paymentName = (method) => String(method || 'OTHER').replaceAll('_', ' ');
const statusName = (status) => status === 'VOIDED' ? 'Voided' : status === 'RETURNED' ? 'Returned' : status === 'PARTIAL_RETURN' ? 'Partial Return' : 'Completed';

function saleListJson(row) {
  return {
    id: row.id,
    invoice: row.invoiceNumber,
    invoiceNumber: row.invoiceNumber,
    dateTime: row.soldAt,
    date: row.soldAt,
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
  };
}

function saleDetailJson(row) {
  return {
    ...saleListJson(row),
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
      minimumPrice: number(item.minimumPrice),
      discount: number(item.discount),
      profit: number(item.profit),
    })),
    raw: {
      invoiceNumber: row.invoiceNumber,
      customer: row.customer,
      items: row.items,
      payments: row.payments,
      cashier: row.user,
      subtotal: number(row.subtotal),
      discount: number(row.discount),
      total: number(row.total),
      costTotal: number(row.costTotal),
      profitTotal: number(row.profitTotal),
      paymentStatus: row.paymentStatus,
      status: row.status,
      soldAt: row.soldAt,
      voidedAt: row.voidedAt,
      voidReason: row.voidReason,
    },
  };
}

const includeSale = {
  customer: true,
  user: { select: { id: true, name: true, username: true } },
  items: { orderBy: { createdAt: 'asc' } },
  payments: { orderBy: { paidAt: 'asc' } },
};

async function findSale(id, shopId) {
  const parsed = uuid.safeParse(id);
  return prisma.sale.findFirst({
    where: {
      shopId,
      ...(parsed.success ? { OR: [{ id: parsed.data }, { invoiceNumber: id }] } : { invoiceNumber: id }),
    },
    include: includeSale,
  });
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

function attachSalesHistoryPostgresApi(app) {
  const historyRead = [requireAuth, requireShopUser, requirePermission('history')];
  const voidAccess = [requireAuth, requireShopUser, requireWritableSubscription, requirePermission('deleteSale')];

  app.get('/api/sales', ...historyRead, wrap(async (req, res) => {
    const page = Math.max(1, Number.parseInt(req.query.page || '1', 10) || 1);
    const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit || '10', 10) || 10));
    const search = String(req.query.q || '').trim();
    const where = {
      shopId: req.auth.shopId,
      ...(search ? {
        OR: [
          { invoiceNumber: { contains: search, mode: 'insensitive' } },
          { customer: { name: { contains: search, mode: 'insensitive' } } },
          { customer: { phone: { contains: search, mode: 'insensitive' } } },
          { items: { some: { productNameSnapshot: { contains: search, mode: 'insensitive' } } } },
        ],
      } : {}),
    };

    const [total, rows] = await prisma.$transaction([
      prisma.sale.count({ where }),
      prisma.sale.findMany({
        where,
        include: includeSale,
        orderBy: { soldAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    res.json({
      ok: true,
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      sales: rows.map(saleListJson),
    });
  }));

  app.get('/api/sales/:id', ...historyRead, wrap(async (req, res) => {
    const row = await findSale(req.params.id, req.auth.shopId);
    if (!row) throw new ApiError(404, 'Sale not found');
    res.json({ ok: true, sale: saleDetailJson(row) });
  }));

  app.post('/api/sales/:id/void', ...voidAccess, wrap(async (req, res) => {
    const input = parse(voidSchema, req.body || {});
    const saleIdentifier = req.params.id;

    const result = await serializable(async (tx) => {
      const parsed = uuid.safeParse(saleIdentifier);
      const sale = await tx.sale.findFirst({
        where: {
          shopId: req.auth.shopId,
          ...(parsed.success ? { OR: [{ id: parsed.data }, { invoiceNumber: saleIdentifier }] } : { invoiceNumber: saleIdentifier }),
        },
        include: { items: true, payments: true, customer: true },
      });
      if (!sale) throw new ApiError(404, 'Sale not found');
      if (sale.status === 'VOIDED') throw new ApiError(409, 'Sale is already voided');

      for (const item of sale.items) {
        if (!item.productVariantId) continue;
        const balance = await tx.inventoryBalance.findUnique({ where: { productVariantId: item.productVariantId } });
        const beforeQuantity = Number(balance?.quantity || 0);
        const afterQuantity = beforeQuantity + item.quantity;
        await tx.inventoryBalance.upsert({
          where: { productVariantId: item.productVariantId },
          update: { quantity: afterQuantity },
          create: {
            shopId: req.auth.shopId,
            productVariantId: item.productVariantId,
            quantity: afterQuantity,
            minAlertQuantity: 0,
          },
        });
        await tx.stockMovement.create({
          data: {
            shopId: req.auth.shopId,
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
        await tx.customer.update({
          where: { id: sale.customerId },
          data: { balance: { decrement: sale.total } },
        });
      }
      await tx.payment.updateMany({
        where: { shopId: req.auth.shopId, saleId: sale.id },
        data: { status: 'VOIDED' },
      });
      await tx.sale.update({
        where: { id: sale.id },
        data: {
          status: 'VOIDED',
          paymentStatus: 'VOIDED',
          voidedAt: new Date(),
          voidReason: input.reason,
        },
      });
      await tx.auditLog.create({
        data: {
          shopId: req.auth.shopId,
          userId: req.auth.userId,
          action: 'SALE_VOIDED',
          entityType: 'sale',
          entityId: sale.id,
          details: { invoiceNumber: sale.invoiceNumber, reason: input.reason, total: number(sale.total) },
          ipAddress: req.ip || null,
          userAgent: req.headers['user-agent'] || null,
        },
      });

      return { id: sale.id, invoice: sale.invoiceNumber, status: 'Voided', reason: input.reason };
    });

    res.json({ ok: true, message: 'Sale voided and stock restored', sale: result });
  }));
}

module.exports = attachSalesHistoryPostgresApi;
