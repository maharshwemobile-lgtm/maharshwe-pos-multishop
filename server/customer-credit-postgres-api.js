const { z } = require('zod');
const { Prisma } = require('@prisma/client');
const { prisma } = require('./prisma');
const {
  requireAuth,
  requireShopUser,
  requireWritableSubscription,
} = require('./auth-api');
const { queuePush, sendPushToShop } = require('./push-notifications-api');

const uuid = z.string().uuid();
const text = (max = 180) => z.string().trim().max(max).optional().nullable();
const money = z.coerce.number().finite().positive();

const customerSchema = z.object({
  name: z.string().trim().min(1).max(180),
  phone: text(60),
  address: text(300),
});

const collectionSchema = z.object({
  amount: money,
  method: z.enum(['CASH', 'KPAY', 'WAVE_PAY', 'OTHER']).default('CASH'),
  reference: text(180),
  note: text(300),
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
  if (!result.success) throw new ApiError(400, 'Invalid customer request', result.error.flatten().fieldErrors);
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
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        return res.status(404).json({ ok: false, message: 'Customer not found' });
      }
      console.error('Customer credit API:', error);
      return res.status(500).json({ ok: false, message: error.message || 'Customer request failed' });
    }
  };
}

const number = (value) => Number(value || 0);
const clean = (value) => String(value || '').trim() || null;

function requireCustomerAccess(req, res, next) {
  if (req.auth?.role === 'SUPER_ADMIN' || req.auth?.role === 'SHOP_ADMIN') return next();
  const permissions = req.auth?.permissions || {};
  if (permissions.history === true || permissions.accounting === true || permissions.sale === true) return next();
  return res.status(403).json({ ok: false, message: 'Insufficient customer permission' });
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

function saleJson(sale) {
  const paid = (sale.payments || [])
    .filter((payment) => payment.status === 'PAID')
    .reduce((sum, payment) => sum + number(payment.amount), 0);
  const total = number(sale.total);
  return {
    id: sale.id,
    invoice: sale.invoiceNumber,
    soldAt: sale.soldAt,
    status: sale.status,
    paymentStatus: sale.paymentStatus,
    total,
    paid,
    outstanding: Math.max(0, total - paid),
    cashier: sale.user?.name || sale.user?.username || '-',
    itemCount: (sale.items || []).reduce((sum, item) => sum + Number(item.quantity || 0), 0),
    items: (sale.items || []).map((item) => ({
      id: item.id,
      name: [item.productNameSnapshot, item.variantNameSnapshot].filter(Boolean).join(' — '),
      quantity: item.quantity,
      unitPrice: number(item.actualSoldPrice),
    })),
    payments: (sale.payments || []).map((payment) => ({
      id: payment.id,
      method: payment.method,
      amount: number(payment.amount),
      status: payment.status,
      reference: payment.reference,
      paidAt: payment.paidAt,
    })),
  };
}

function attachCustomerCreditPostgresApi(app) {
  const read = [requireAuth, requireShopUser, requireCustomerAccess];
  const write = [requireAuth, requireShopUser, requireWritableSubscription, requireCustomerAccess];

  app.get('/api/customers', ...read, wrap(async (req, res) => {
    const page = Math.max(1, Number.parseInt(req.query.page || '1', 10) || 1);
    const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit || '20', 10) || 20));
    const search = String(req.query.q || '').trim();
    const balance = String(req.query.balance || '').trim();
    const where = {
      shopId: req.auth.shopId,
      ...(balance === 'owing' ? { balance: { gt: 0 } } : {}),
      ...(balance === 'clear' ? { balance: { lte: 0 } } : {}),
      ...(search ? {
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { phone: { contains: search, mode: 'insensitive' } },
          { address: { contains: search, mode: 'insensitive' } },
        ],
      } : {}),
    };

    const [total, rows, totals, owingCustomers] = await prisma.$transaction([
      prisma.customer.count({ where }),
      prisma.customer.findMany({
        where,
        select: {
          id: true,
          name: true,
          phone: true,
          address: true,
          balance: true,
          createdAt: true,
          updatedAt: true,
          _count: { select: { sales: true, repairs: true } },
        },
        orderBy: [{ balance: 'desc' }, { updatedAt: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.customer.aggregate({
        where: { shopId: req.auth.shopId },
        _count: { id: true },
        _sum: { balance: true },
      }),
      prisma.customer.count({ where: { shopId: req.auth.shopId, balance: { gt: 0 } } }),
    ]);

    res.json({
      ok: true,
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      summary: {
        totalCustomers: Number(totals._count?.id || 0),
        receivable: number(totals._sum?.balance),
        owingCustomers,
        clearCustomers: Math.max(0, Number(totals._count?.id || 0) - owingCustomers),
      },
      customers: rows.map((row) => ({
        id: row.id,
        name: row.name,
        phone: row.phone,
        address: row.address,
        balance: number(row.balance),
        saleCount: row._count.sales,
        repairCount: row._count.repairs,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      })),
    });
  }));

  app.get('/api/customers/:id', ...read, wrap(async (req, res) => {
    const id = parse(uuid, req.params.id);
    const customer = await prisma.customer.findFirst({
      where: { id, shopId: req.auth.shopId },
      include: {
        sales: {
          orderBy: { soldAt: 'desc' },
          take: 50,
          include: {
            user: { select: { name: true, username: true } },
            items: { orderBy: { createdAt: 'asc' } },
            payments: { orderBy: { paidAt: 'desc' } },
          },
        },
      },
    });
    if (!customer) throw new ApiError(404, 'Customer not found');

    res.json({
      ok: true,
      customer: {
        id: customer.id,
        name: customer.name,
        phone: customer.phone,
        address: customer.address,
        balance: number(customer.balance),
        createdAt: customer.createdAt,
        updatedAt: customer.updatedAt,
        sales: customer.sales.map(saleJson),
      },
    });
  }));

  app.post('/api/customers', ...write, wrap(async (req, res) => {
    const input = parse(customerSchema, req.body || {});
    const customer = await prisma.customer.create({
      data: {
        shopId: req.auth.shopId,
        name: input.name,
        phone: clean(input.phone),
        address: clean(input.address),
      },
    });
    res.status(201).json({ ok: true, customer: { ...customer, balance: number(customer.balance) } });
  }));

  app.patch('/api/customers/:id', ...write, wrap(async (req, res) => {
    const id = parse(uuid, req.params.id);
    const input = parse(customerSchema, req.body || {});
    const existing = await prisma.customer.findFirst({ where: { id, shopId: req.auth.shopId } });
    if (!existing) throw new ApiError(404, 'Customer not found');
    const customer = await prisma.customer.update({
      where: { id },
      data: {
        name: input.name,
        phone: clean(input.phone),
        address: clean(input.address),
      },
    });
    res.json({ ok: true, customer: { ...customer, balance: number(customer.balance) } });
  }));

  app.post('/api/customers/:id/collect', ...write, wrap(async (req, res) => {
    const customerId = parse(uuid, req.params.id);
    const input = parse(collectionSchema, req.body || {});

    const result = await serializable(async (tx) => {
      const customer = await tx.customer.findFirst({
        where: { id: customerId, shopId: req.auth.shopId },
      });
      if (!customer) throw new ApiError(404, 'Customer not found');

      const balanceBefore = number(customer.balance);
      if (balanceBefore <= 0) throw new ApiError(409, 'Customer has no outstanding balance');
      if (input.amount > balanceBefore) {
        throw new ApiError(409, 'Collection amount is greater than customer balance', {
          balance: balanceBefore,
          amount: input.amount,
        });
      }

      const pendingSales = await tx.sale.findMany({
        where: {
          shopId: req.auth.shopId,
          customerId,
          status: 'COMPLETED',
          paymentStatus: { in: ['PENDING', 'PARTIAL'] },
        },
        include: { payments: true },
        orderBy: { soldAt: 'asc' },
      });
      if (!pendingSales.length) throw new ApiError(409, 'No pending credit sale found for this customer');

      let remaining = input.amount;
      const allocations = [];
      for (const sale of pendingSales) {
        if (remaining <= 0) break;
        const alreadyPaid = (sale.payments || [])
          .filter((payment) => payment.status === 'PAID')
          .reduce((sum, payment) => sum + number(payment.amount), 0);
        const outstanding = Math.max(0, number(sale.total) - alreadyPaid);
        if (outstanding <= 0) continue;

        const allocated = Math.min(remaining, outstanding);
        const reference = [clean(input.reference), clean(input.note)].filter(Boolean).join(' · ') || null;
        await tx.payment.create({
          data: {
            shopId: req.auth.shopId,
            saleId: sale.id,
            method: input.method,
            amount: allocated,
            status: 'PAID',
            reference,
          },
        });
        const fullyPaid = alreadyPaid + allocated >= number(sale.total) - 0.005;
        await tx.sale.update({
          where: { id: sale.id },
          data: { paymentStatus: fullyPaid ? 'PAID' : 'PARTIAL' },
        });
        allocations.push({ saleId: sale.id, invoice: sale.invoiceNumber, amount: allocated });
        remaining -= allocated;
      }

      if (remaining > 0.005) {
        throw new ApiError(409, 'Collection could not be fully allocated to pending sales', { remaining });
      }

      const updated = await tx.customer.update({
        where: { id: customerId },
        data: { balance: { decrement: input.amount } },
      });

      await tx.auditLog.create({
        data: {
          shopId: req.auth.shopId,
          userId: req.auth.userId,
          action: 'CUSTOMER_CREDIT_COLLECTED',
          entityType: 'customer',
          entityId: customerId,
          details: {
            customerName: customer.name,
            amount: input.amount,
            method: input.method,
            reference: clean(input.reference),
            note: clean(input.note),
            balanceBefore,
            balanceAfter: number(updated.balance),
            allocations,
          },
          ipAddress: req.ip || null,
          userAgent: req.headers['user-agent'] || null,
        },
      });

      return {
        customerId,
        amount: input.amount,
        method: input.method,
        balanceBefore,
        balanceAfter: number(updated.balance),
        allocations,
      };
    });

    queuePush(() => sendPushToShop({
      shopId: req.auth.shopId,
      eventType: 'CREDIT_REPAYMENT_RECEIVED',
      title: 'Credit repayment received',
      body: 'A customer credit repayment was received. Open Mahar POS to review.',
      url: '/customers',
      data: { source: 'customer-credit', customerId: result.customerId },
    }), 'credit repayment push');

    res.json({ ok: true, message: 'Credit payment collected', collection: result });
  }));
}

module.exports = attachCustomerCreditPostgresApi;
