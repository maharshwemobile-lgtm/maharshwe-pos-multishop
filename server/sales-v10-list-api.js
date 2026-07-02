const { prisma } = require('./prisma');
const { requireAuth, requireShopUser, requirePermission } = require('./auth-api');

const number = (value) => Number(value || 0);
const paymentLabel = (value) => String(value || 'OTHER').replaceAll('_', ' ');
const statusLabel = (value) => value === 'VOIDED' ? 'Voided' : value === 'RETURNED' ? 'Returned' : value === 'PARTIAL_RETURN' ? 'Partial Return' : 'Completed';

function parseDay(value, end) {
  if (!value) return null;
  const date = new Date(`${value}T${end ? '23:59:59.999' : '00:00:00.000'}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function rowJson(row) {
  return {
    id: row.id,
    invoice: row.invoiceNumber,
    dateTime: row.soldAt,
    customer: row.customer?.name || 'Walk-in Customer',
    customerPhone: row.customer?.phone || null,
    itemCount: (row.items || []).reduce((sum, item) => sum + Number(item.quantity || 0), 0),
    items: (row.items || []).map((item) => `${item.productNameSnapshot}${item.variantNameSnapshot ? ` ${item.variantNameSnapshot}` : ''} x${item.quantity}`).join(', '),
    amount: number(row.total),
    subtotal: number(row.subtotal),
    discount: number(row.discount),
    profit: number(row.profitTotal),
    payment: row.paymentStatus === 'PENDING' ? 'Credit' : paymentLabel(row.payments?.[0]?.method),
    status: statusLabel(row.status),
    cashier: row.user?.name || row.user?.username || '-',
  };
}

module.exports = function attachSalesV10ListApi(app) {
  const access = [requireAuth, requireShopUser, requirePermission('history')];

  app.get('/api/sales', ...access, async (req, res) => {
    try {
      const shopId = req.auth.shopId;
      const page = Math.max(1, Number.parseInt(req.query.page || '1', 10) || 1);
      const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit || '15', 10) || 15));
      const search = String(req.query.q || '').trim();
      const cashier = String(req.query.cashier || '').trim();
      const status = String(req.query.status || '').trim().toUpperCase();
      const paymentMethod = String(req.query.paymentMethod || '').trim().toUpperCase();
      const from = parseDay(req.query.from, false);
      const to = parseDay(req.query.to, true);
      const where = {
        shopId,
        ...((from || to) ? { soldAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
        ...(status ? { status } : {}),
        ...(paymentMethod === 'CREDIT' ? { paymentStatus: 'PENDING' } : paymentMethod ? { payments: { some: { shopId, method: paymentMethod } } } : {}),
        ...(cashier ? {
          user: {
            is: {
              shopId,
              OR: [
                { name: { contains: cashier, mode: 'insensitive' } },
                { username: { contains: cashier, mode: 'insensitive' } },
              ],
            },
          },
        } : {}),
        ...(search ? { OR: [
          { invoiceNumber: { contains: search, mode: 'insensitive' } },
          { customer: { is: { shopId, name: { contains: search, mode: 'insensitive' } } } },
          { customer: { is: { shopId, phone: { contains: search, mode: 'insensitive' } } } },
          { items: { some: { shopId, productNameSnapshot: { contains: search, mode: 'insensitive' } } } },
          { items: { some: { shopId, variantNameSnapshot: { contains: search, mode: 'insensitive' } } } },
          { items: { some: { shopId, imeiSerial: { contains: search, mode: 'insensitive' } } } },
        ] } : {}),
      };
      const include = {
        customer: { select: { name: true, phone: true } },
        user: { select: { name: true, username: true } },
        items: true,
        payments: { orderBy: { paidAt: 'asc' } },
      };
      const summaryWhere = status ? where : { ...where, status: { not: 'VOIDED' } };
      const [total, rows, sums, count] = await prisma.$transaction([
        prisma.sale.count({ where }),
        prisma.sale.findMany({ where, include, orderBy: { soldAt: 'desc' }, skip: (page - 1) * limit, take: limit }),
        prisma.sale.aggregate({ where: summaryWhere, _sum: { total: true, discount: true, profitTotal: true } }),
        prisma.sale.count({ where: summaryWhere }),
      ]);
      res.json({
        ok: true,
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
        summary: { saleCount: count, netSales: number(sums._sum.total), discount: number(sums._sum.discount), profit: number(sums._sum.profitTotal) },
        sales: rows.map(rowJson),
      });
    } catch (error) {
      console.error('Phase 10 sales list:', error);
      res.status(500).json({ ok: false, message: error.message || 'Unable to load sales' });
    }
  });
};
