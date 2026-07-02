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
const money = z.coerce.number().finite().min(0);
const quantity = z.coerce.number().int().positive();
const text = (max = 180) => z.union([z.string().trim().max(max), z.null()]).optional();

const saleCreateSchema = z.object({
  customerName: text(180),
  customerPhone: text(60),
  discount: money.optional(),
  paymentMethod: z.enum(['CASH', 'KPAY', 'WAVE_PAY', 'MIXED', 'OTHER', 'CREDIT']).default('CASH'),
  paymentReference: text(180),
  cashReceived: money.optional(),
  payments: z.array(z.object({
    method: z.enum(['CASH', 'KPAY', 'WAVE_PAY', 'OTHER']).default('OTHER'),
    amount: money,
    reference: text(180),
  })).optional(),
  items: z.array(z.object({
    productVariantId: uuid,
    quantity,
    unitPrice: money,
    imeiSerial: text(180),
  })).min(1).max(200),
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
  if (!result.success) throw new ApiError(400, 'Invalid sale request', result.error.flatten().fieldErrors);
  return result.data;
}

function wrap(handler) {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (error) {
      if (error instanceof ApiError) return res.status(error.status).json({ ok: false, message: error.message, details: error.details });
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2002') return res.status(409).json({ ok: false, message: 'Duplicate invoice or serial number' });
        if (error.code === 'P2025') return res.status(404).json({ ok: false, message: 'Sale record not found' });
      }
      console.error('PostgreSQL sales API:', error);
      return res.status(500).json({ ok: false, message: error.message || 'Sale request failed' });
    }
  };
}

const clean = (value) => {
  if (value === null || value === undefined) return null;
  return String(value).trim() || null;
};

const number = (value) => Number(value || 0);
const canDiscount = (req) => req.auth.role === 'SUPER_ADMIN' || req.auth.role === 'SHOP_ADMIN' || req.auth.permissions?.discount === true;
const canViewCost = (req) => req.auth.role === 'SUPER_ADMIN' || req.auth.permissions?.viewCost === true;

async function serializable(work) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.$transaction(work, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 5000,
        timeout: 20000,
      });
    } catch (error) {
      if ((error.code === 'P2034' || error.code === 'P2002') && attempt < 2) continue;
      throw error;
    }
  }
}

function cashierPrefix(user, fallback = 'M') {
  const candidates = [user?.name, user?.username, fallback, 'M'];
  for (const candidate of candidates) {
    const match = String(candidate || '').normalize('NFKD').toUpperCase().match(/[A-Z0-9]/);
    if (match) return match[0];
  }
  return 'M';
}

async function nextCashierInvoice(tx, shopId, userId, fallbackPrefix) {
  const cashier = await tx.user.findFirst({
    where: { id: userId, shopId, active: true },
    select: { name: true, username: true },
  });
  if (!cashier) throw new ApiError(403, 'Active cashier account is required');

  const prefix = cashierPrefix(cashier, fallbackPrefix);
  const pattern = new RegExp(`^${prefix}(\\d{4})$`);
  const recent = await tx.sale.findMany({
    where: { shopId, invoiceNumber: { startsWith: prefix } },
    select: { invoiceNumber: true },
    orderBy: { createdAt: 'desc' },
    take: 500,
  });

  let highest = 0;
  for (const row of recent) {
    const match = pattern.exec(row.invoiceNumber);
    if (match) highest = Math.max(highest, Number(match[1]));
  }

  const next = highest + 1;
  if (next > 9999) throw new ApiError(409, `Cashier ${prefix} invoice sequence reached 9999`);
  return `${prefix}${String(next).padStart(4, '0')}`;
}

async function resolveCustomer(tx, shopId, name, phone) {
  const customerName = clean(name);
  const customerPhone = clean(phone);
  if (!customerName && !customerPhone) return null;

  let customer = customerPhone
    ? await tx.customer.findFirst({ where: { shopId, phone: customerPhone } })
    : null;
  if (!customer && customerName) {
    customer = await tx.customer.findFirst({ where: { shopId, name: { equals: customerName, mode: 'insensitive' } } });
  }
  if (!customer) {
    customer = await tx.customer.create({
      data: {
        shopId,
        name: customerName || customerPhone || 'Customer',
        phone: customerPhone,
      },
    });
  } else if (customerName || customerPhone) {
    customer = await tx.customer.update({
      where: { id: customer.id },
      data: {
        ...(customerName ? { name: customerName } : {}),
        ...(customerPhone ? { phone: customerPhone } : {}),
      },
    });
  }
  return customer;
}

function catalogItem(row, includeCost) {
  const item = {
    id: row.id,
    productId: row.productId,
    productName: row.product?.name || '',
    brand: row.product?.brand || '',
    model: row.product?.model || '',
    category: row.category?.name || '',
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

function attachSalesPostgresApi(app) {
  const read = [requireAuth, requireShopUser, requirePermission('sale')];
  const write = [requireAuth, requireShopUser, requireWritableSubscription, requirePermission('sale')];

  app.get('/api/pos/catalog', ...read, wrap(async (req, res) => {
    const page = Math.max(1, Number.parseInt(req.query.page || '1', 10) || 1);
    const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit || '40', 10) || 40));
    const search = String(req.query.q || '').trim();
    const categoryId = req.query.categoryId ? parse(uuid, req.query.categoryId) : undefined;
    const where = {
      shopId: req.auth.shopId,
      active: true,
      product: { active: true },
      ...(categoryId ? { categoryId } : {}),
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
      totalPages: Math.ceil(total / limit),
      items: rows.map((row) => catalogItem(row, canViewCost(req))),
    });
  }));

  app.post('/api/sales', ...write, wrap(async (req, res) => {
    const input = parse(saleCreateSchema, req.body || {});
    const result = await serializable(async (tx) => {
      const settings = await tx.shopSettings.findUnique({ where: { shopId: req.auth.shopId } });
      const customer = await resolveCustomer(tx, req.auth.shopId, input.customerName, input.customerPhone);
      const prepared = [];
      let subtotal = 0;
      let costTotal = 0;

      for (const requested of input.items) {
        const variant = await tx.productVariant.findFirst({
          where: { id: requested.productVariantId, shopId: req.auth.shopId, active: true },
          include: { product: true, category: true, inventoryBalance: true },
        });
        if (!variant || variant.product?.active === false) throw new ApiError(404, 'One or more product variants are unavailable');

        const currentStock = Number(variant.inventoryBalance?.quantity || 0);
        const afterStock = currentStock - requested.quantity;
        if (afterStock < 0 && !settings?.allowNegativeStock) {
          throw new ApiError(409, `${variant.product?.name || variant.variantName} stock မလုံလောက်ပါ`, {
            productVariantId: variant.id,
            available: currentStock,
            requested: requested.quantity,
          });
        }

        const standardPrice = number(variant.standardSellingPrice);
        const minimumPrice = number(variant.minimumSellingPrice);
        const unitPrice = number(requested.unitPrice);
        if (unitPrice < minimumPrice) {
          throw new ApiError(409, `${variant.product?.name || variant.variantName} price is below minimum selling price`, {
            minimumPrice,
            unitPrice,
          });
        }
        if (unitPrice < standardPrice && !canDiscount(req)) {
          throw new ApiError(403, 'Discount permission is required to sell below standard price');
        }
        if (variant.product?.requiresSerial && requested.quantity !== 1) {
          throw new ApiError(400, `${variant.product?.name || variant.variantName} requires one serial per sale line`);
        }
        if (variant.product?.requiresSerial && !clean(requested.imeiSerial)) {
          throw new ApiError(400, `IMEI / Serial is required for ${variant.product?.name || variant.variantName}`);
        }

        const lineSubtotal = unitPrice * requested.quantity;
        const lineCost = number(variant.costPrice) * requested.quantity;
        subtotal += lineSubtotal;
        costTotal += lineCost;
        prepared.push({
          variant,
          quantity: requested.quantity,
          unitPrice,
          imeiSerial: clean(requested.imeiSerial),
          currentStock,
          afterStock,
          minAlertQuantity: Number(variant.inventoryBalance?.minAlertQuantity || 0),
          lineSubtotal,
          lineCost,
        });
      }

      const discount = Math.min(subtotal, number(input.discount));
      if (discount > 0 && !canDiscount(req)) throw new ApiError(403, 'Discount permission is required');
      const total = subtotal - discount;
      const requestedPayments = Array.isArray(input.payments)
        ? input.payments.filter((row) => number(row.amount) > 0)
        : [];
      const usingSplitPayment = requestedPayments.length > 0;
      const paymentMethod = usingSplitPayment ? 'MIXED' : input.paymentMethod;
      const isCredit = !usingSplitPayment && paymentMethod === 'CREDIT';
      if (isCredit && !customer) throw new ApiError(400, 'Customer name or phone is required for credit sale');

      let paymentRows = [];
      let tenderedAmount = 0;
      let paidAmount = 0;
      let cashReceived = 0;
      let change = 0;

      if (usingSplitPayment) {
        for (const row of requestedPayments) {
          const method = ['CASH', 'KPAY', 'WAVE_PAY', 'OTHER'].includes(row.method) ? row.method : 'OTHER';
          const amount = number(row.amount);
          if (amount <= 0) continue;
          tenderedAmount += amount;
          paymentRows.push({ method, amount, reference: clean(row.reference) });
        }

        if (total > 0 && !paymentRows.length) throw new ApiError(400, 'Split payment amount is required');
        if (tenderedAmount < total) throw new ApiError(400, 'Split payment total is less than sale total');

        change = Math.max(0, tenderedAmount - total);
        let overpay = change;
        for (let index = paymentRows.length - 1; index >= 0 && overpay > 0; index -= 1) {
          const removable = Math.min(paymentRows[index].amount, overpay);
          paymentRows[index].amount -= removable;
          overpay -= removable;
        }
        paymentRows = paymentRows.filter((row) => row.amount > 0);
        paidAmount = paymentRows.reduce((sum, row) => sum + row.amount, 0);
        cashReceived = tenderedAmount;
      } else {
        paidAmount = isCredit ? 0 : total;
        cashReceived = paymentMethod === 'CASH' ? number(input.cashReceived || total) : paidAmount;
        if (paymentMethod === 'CASH' && cashReceived < total) throw new ApiError(400, 'Cash received is less than total');
        change = paymentMethod === 'CASH' ? cashReceived - total : 0;
        if (!isCredit && total > 0) {
          paymentRows.push({
            method: ['CASH', 'KPAY', 'WAVE_PAY', 'OTHER', 'MIXED'].includes(paymentMethod) ? paymentMethod : 'OTHER',
            amount: total,
            reference: clean(input.paymentReference),
          });
        }
      }

      const paymentStatus = isCredit ? 'PENDING' : 'PAID';
      const invoice = await nextCashierInvoice(
        tx,
        req.auth.shopId,
        req.auth.userId,
        settings?.invoicePrefix || 'M',
      );

      const sale = await tx.sale.create({
        data: {
          shopId: req.auth.shopId,
          invoiceNumber: invoice,
          customerId: customer?.id || null,
          userId: req.auth.userId,
          subtotal,
          discount,
          total,
          costTotal,
          profitTotal: total - costTotal,
          paymentStatus,
        },
      });

      const itemRows = [];
      for (const item of prepared) {
        const proportionalDiscount = subtotal > 0 ? discount * (item.lineSubtotal / subtotal) : 0;
        const lineProfit = item.lineSubtotal - proportionalDiscount - item.lineCost;
        const saleItem = await tx.saleItem.create({
          data: {
            shopId: req.auth.shopId,
            saleId: sale.id,
            productVariantId: item.variant.id,
            productNameSnapshot: item.variant.product?.name || item.variant.variantName,
            variantNameSnapshot: item.variant.variantName,
            categoryNameSnapshot: item.variant.category?.name || null,
            imeiSerial: item.imeiSerial,
            costPrice: item.variant.costPrice,
            standardPrice: item.variant.standardSellingPrice,
            minimumPrice: item.variant.minimumSellingPrice,
            actualSoldPrice: item.unitPrice,
            quantity: item.quantity,
            discount: proportionalDiscount,
            profit: lineProfit,
            requiresApproval: false,
          },
        });

        await tx.inventoryBalance.upsert({
          where: { productVariantId: item.variant.id },
          update: { quantity: item.afterStock },
          create: {
            shopId: req.auth.shopId,
            productVariantId: item.variant.id,
            quantity: item.afterStock,
            minAlertQuantity: 0,
          },
        });
        await tx.stockMovement.create({
          data: {
            shopId: req.auth.shopId,
            productVariantId: item.variant.id,
            type: 'SALE',
            quantityChange: -item.quantity,
            beforeQuantity: item.currentStock,
            afterQuantity: item.afterStock,
            referenceType: 'SALE',
            referenceId: sale.id,
            userId: req.auth.userId,
            note: sale.invoiceNumber,
          },
        });
        itemRows.push(saleItem);
      }

      for (const row of paymentRows) {
        await tx.payment.create({
          data: {
            shopId: req.auth.shopId,
            saleId: sale.id,
            method: row.method,
            amount: row.amount,
            status: 'PAID',
            reference: row.reference,
          },
        });
      }
      if (isCredit && customer) {
        await tx.customer.update({
          where: { id: customer.id },
          data: { balance: { increment: total } },
        });
      }

      await tx.auditLog.create({
        data: {
          shopId: req.auth.shopId,
          userId: req.auth.userId,
          action: 'SALE_COMPLETED',
          entityType: 'sale',
          entityId: sale.id,
          details: {
            invoiceNumber: sale.invoiceNumber,
            total,
            discount,
            paymentMethod,
            paidAmount,
            cashReceived,
            change,
            splitPayment: usingSplitPayment,
            payments: paymentRows.map((row) => ({ method: row.method, amount: row.amount, reference: row.reference })),
            itemCount: itemRows.length,
          },
          ipAddress: req.ip || null,
          userAgent: req.headers['user-agent'] || null,
        },
      });

      const outOfStockCount = prepared.filter((item) => item.afterStock <= 0).length;
      const lowStockCount = prepared.filter((item) => (
        item.afterStock > 0
        && item.minAlertQuantity > 0
        && item.afterStock <= item.minAlertQuantity
      )).length;

      return {
        id: sale.id,
        invoice: sale.invoiceNumber,
        invoiceNumber: sale.invoiceNumber,
        dateTime: sale.soldAt,
        customer: customer?.name || 'Walk-in Customer',
        customerPhone: customer?.phone || null,
        subtotal,
        discount,
        amount: total,
        total,
        payment: isCredit ? 'Credit' : (usingSplitPayment ? 'Mixed' : paymentMethod.replace('_', ' ')),
        paymentMethod,
        paymentStatus,
        cashReceived,
        change,
        paidAmount,
        payments: paymentRows.map((row) => ({ method: row.method, amount: row.amount, reference: row.reference })),
        status: 'Completed',
        stockAlert: {
          outOfStockCount,
          lowStockCount,
        },
        items: itemRows.map((row) => ({
          id: row.id,
          productName: row.productNameSnapshot,
          variantName: row.variantNameSnapshot,
          quantity: row.quantity,
          unitPrice: number(row.actualSoldPrice),
          discount: number(row.discount),
          imeiSerial: row.imeiSerial,
        })),
      };
    });

    queuePush(() => sendPushToShop({
      shopId: req.auth.shopId,
      eventType: 'SALE_COMPLETED',
      title: 'Sale completed',
      body: 'A sale was completed. Open Mahar POS to review.',
      url: '/sales-history',
      data: { source: 'sale', saleId: result.id },
    }), 'sale completed push');

    if (result.paymentMethod === 'CREDIT') {
      queuePush(() => sendPushToShop({
        shopId: req.auth.shopId,
        eventType: 'CUSTOMER_CREDIT_CREATED',
        title: 'Customer credit created',
        body: 'A customer credit sale was created. Open Mahar POS to review.',
        url: '/customers',
        data: { source: 'sale-credit', saleId: result.id },
      }), 'customer credit push');
    }

    if (result.stockAlert?.outOfStockCount > 0) {
      queuePush(() => sendPushToShop({
        shopId: req.auth.shopId,
        eventType: 'OUT_OF_STOCK',
        title: 'Out of stock alert',
        body: 'A product is out of stock. Open Mahar POS to review.',
        url: '/stock',
        data: { source: 'sale-stock', count: result.stockAlert.outOfStockCount },
      }), 'out of stock push');
    } else if (result.stockAlert?.lowStockCount > 0) {
      queuePush(() => sendPushToShop({
        shopId: req.auth.shopId,
        eventType: 'LOW_STOCK',
        title: 'Low stock alert',
        body: 'A product is running low. Open Mahar POS to review.',
        url: '/stock',
        data: { source: 'sale-stock', count: result.stockAlert.lowStockCount },
      }), 'low stock push');
    }

    res.status(201).json({ ok: true, message: 'Sale completed', sale: result });
  }));
}

module.exports = attachSalesPostgresApi;
