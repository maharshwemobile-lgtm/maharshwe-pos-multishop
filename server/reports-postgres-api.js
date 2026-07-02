const { prisma } = require('./prisma');
const {
  ACTIVE_SALE_STATUSES,
  round,
  resolvePeriod,
} = require('./report-utils');

const number = (value) => Number(value || 0);
const isoDate = (value) => new Date(value).toISOString().slice(0, 10);
const {
  buildTrend,
  buildPaymentMix,
  buildProductReports,
  buildStaff,
  buildRepairReports,
  buildSummary,
} = require('./report-builders');
const { requireAuth, requireShopUser } = require('./auth-api');

function requireReportAccess(req, res, next) {
  if (req.auth?.role === 'SUPER_ADMIN' || req.auth?.role === 'SHOP_ADMIN') return next();
  const permissions = req.auth?.permissions || {};
  if (permissions.accounting === true || permissions.history === true || permissions.sale === true) return next();
  return res.status(403).json({ ok: false, message: 'Insufficient reports permission' });
}

function daysUntil(dateValue) {
  if (!dateValue) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const expiry = new Date(dateValue);
  expiry.setHours(0, 0, 0, 0);
  if (Number.isNaN(expiry.getTime())) return null;
  return Math.ceil((expiry - today) / 86400000);
}

function buildMiniMartInventoryReports(inventory) {
  const rows = (inventory || []).map((row) => {
    const variant = row.productVariant || {};
    const product = variant.product || {};
    return {
      id: variant.id,
      name: product.name || '-',
      variant: variant.variantName || '-',
      sku: variant.sku || '',
      barcode: variant.barcode || '',
      category: variant.category?.name || 'Uncategorized',
      unit: variant.unit || '',
      quantity: Number(row.quantity || 0),
      minAlertQuantity: Number(row.minAlertQuantity || 0),
      expiryDate: variant.expiryDate ? isoDate(variant.expiryDate) : null,
      daysUntilExpiry: daysUntil(variant.expiryDate),
      costPrice: round(variant.costPrice),
      sellingPrice: round(variant.standardSellingPrice),
      wholesalePrice: round(variant.wholesalePrice),
    };
  });

  const expiryReport = rows
    .filter((row) => row.expiryDate)
    .sort((a, b) => Number(a.daysUntilExpiry ?? 999999) - Number(b.daysUntilExpiry ?? 999999))
    .slice(0, 20);

  const lowStockReport = rows
    .filter((row) => row.quantity <= row.minAlertQuantity)
    .sort((a, b) => (a.quantity - a.minAlertQuantity) - (b.quantity - b.minAlertQuantity))
    .slice(0, 20);

  return {
    expiryReport,
    lowStockReport,
    expirySummary: {
      expired: rows.filter((row) => row.daysUntilExpiry !== null && row.daysUntilExpiry < 0).length,
      nearExpiry: rows.filter((row) => row.daysUntilExpiry !== null && row.daysUntilExpiry >= 0 && row.daysUntilExpiry <= 30).length,
      tracked: expiryReport.length,
    },
  };
}

function buildMiniMartDailySales(activeSales) {
  const map = new Map();
  for (const sale of activeSales || []) {
    const key = isoDate(sale.soldAt);
    const row = map.get(key) || { date: key, invoices: 0, units: 0, revenue: 0, profit: 0 };
    row.invoices += 1;
    row.units += (sale.items || []).reduce((sum, item) => sum + Number(item.quantity || 0), 0);
    row.revenue += number(sale.total);
    row.profit += number(sale.profitTotal);
    map.set(key, row);
  }
  return [...map.values()]
    .map((row) => ({ ...row, revenue: round(row.revenue), profit: round(row.profit) }))
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 14);
}

async function buildMiniMartSupplierPurchases(shopId, from, to) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT s.id AS "supplierId",
            s.name AS "supplierName",
            s.supplier_code AS "supplierCode",
            COUNT(DISTINCT pr.id)::int AS "receiptCount",
            COALESCE(SUM(pr.total_amount),0) AS amount
       FROM purchase_receipts pr
       JOIN purchase_orders po ON po.id=pr.purchase_order_id AND po.shop_id=pr.shop_id
       JOIN suppliers s ON s.id=po.supplier_id AND s.shop_id=po.shop_id
      WHERE pr.shop_id=$1::uuid
        AND pr.received_date >= $2::date
        AND pr.received_date <= $3::date
      GROUP BY s.id,s.name,s.supplier_code
      ORDER BY amount DESC
      LIMIT 15`,
    shopId,
    isoDate(from),
    isoDate(to),
  ).catch(() => []);

  return rows.map((row) => ({
    supplierId: row.supplierId,
    supplierName: row.supplierName || 'Supplier',
    supplierCode: row.supplierCode || '',
    receiptCount: Number(row.receiptCount || 0),
    amount: round(row.amount),
  }));
}

async function buildMiniMartReports({ shopId, from, to, activeSales, inventory, productReports, summary }) {
  const inventoryReports = buildMiniMartInventoryReports(inventory);
  const supplierPurchaseReport = await buildMiniMartSupplierPurchases(shopId, from, to);
  const revenue = number(summary.revenue);
  const cost = number(summary.salesCost);
  const profit = number(summary.salesProfit);

  return {
    enabled: true,
    dailySales: buildMiniMartDailySales(activeSales),
    expiryReport: inventoryReports.expiryReport,
    expirySummary: inventoryReports.expirySummary,
    lowStockReport: inventoryReports.lowStockReport,
    supplierPurchaseReport,
    profitReport: {
      revenue: round(revenue),
      cost: round(cost),
      profit: round(profit),
      margin: revenue > 0 ? round((profit / revenue) * 100) : 0,
      topProducts: (productReports.topProducts || []).slice(0, 10),
    },
  };
}


function attachReportsPostgresApi(app) {
  const access = [requireAuth, requireShopUser, requireReportAccess];

  app.get('/api/reports/business', ...access, async (req, res) => {
    try {
      const { from, to, days, previousFrom, previousTo } = resolvePeriod(req.query || {});
      const shopId = req.auth.shopId;
      const [
        shop,
        sales,
        previousSales,
        salePayments,
        repairPayments,
        repairs,
        customers,
        inventory,
        accounts,
        serviceTransactions,
      ] = await Promise.all([
        prisma.shop.findUnique({
          where: { id: shopId },
          select: { businessType: true },
        }),
        prisma.sale.findMany({
          where: { shopId, soldAt: { gte: from, lte: to } },
          include: {
            items: true,
            user: { select: { id: true, name: true, username: true } },
            customer: { select: { id: true, name: true, phone: true } },
          },
          orderBy: { soldAt: 'asc' },
          take: 10000,
        }),
        prisma.sale.findMany({
          where: {
            shopId,
            status: { in: ACTIVE_SALE_STATUSES },
            soldAt: { gte: previousFrom, lte: previousTo },
          },
          select: { total: true, profitTotal: true },
          take: 10000,
        }),
        prisma.payment.findMany({
          where: { shopId, status: 'PAID', paidAt: { gte: from, lte: to } },
          select: { method: true, amount: true, paidAt: true },
          take: 20000,
        }),
        prisma.repairPayment.findMany({
          where: { shopId, status: 'PAID', paidAt: { gte: from, lte: to } },
          select: { method: true, amount: true, paidAt: true },
          take: 20000,
        }),
        prisma.repair.findMany({
          where: { shopId, receivedAt: { gte: from, lte: to } },
          select: {
            id: true,
            status: true,
            finalCost: true,
            estimatedCost: true,
            receivedAt: true,
            completedAt: true,
            deliveredAt: true,
            technician: { select: { id: true, name: true, username: true } },
          },
          take: 10000,
        }),
        prisma.customer.findMany({
          where: { shopId },
          select: { id: true, name: true, phone: true, balance: true },
          take: 10000,
        }),
        prisma.inventoryBalance.findMany({
          where: { shopId },
          include: {
            productVariant: {
              select: {
                id: true,
                variantName: true,
                sku: true,
                barcode: true,
                unit: true,
                expiryDate: true,
                costPrice: true,
                standardSellingPrice: true,
                wholesalePrice: true,
                category: { select: { id: true, name: true } },
                product: { select: { id: true, name: true, brand: true } },
              },
            },
          },
          take: 20000,
        }),
        prisma.moneyAccount.findMany({
          where: { shopId, active: true },
          select: { id: true, name: true, type: true, balance: true },
          orderBy: { name: 'asc' },
        }),
        prisma.moneyServiceTransaction.findMany({
          where: { shopId, createdAt: { gte: from, lte: to } },
          select: { serviceProfit: true, createdAt: true, type: true },
          take: 20000,
        }),
      ]);

      const { activeSales, summary } = buildSummary({
        sales,
        previousSales,
        salePayments,
        repairPayments,
        repairs,
        customers,
        inventory,
        serviceTransactions,
      });
      const productReports = buildProductReports(activeSales);
      const repairReports = buildRepairReports(repairs);
      const miniMart = String(shop?.businessType || '').toUpperCase() === 'MINI_MART'
        ? await buildMiniMartReports({ shopId, from, to, activeSales, inventory, productReports, summary })
        : { enabled: false };

      res.json({
        ok: true,
        period: {
          from: from.toISOString(),
          to: to.toISOString(),
          days,
          previousFrom: previousFrom.toISOString(),
          previousTo: previousTo.toISOString(),
        },
        summary,
        trend: buildTrend(from, to, activeSales, salePayments, repairPayments),
        paymentMix: buildPaymentMix(salePayments, repairPayments),
        topProducts: productReports.topProducts,
        categories: productReports.categories,
        staff: buildStaff(activeSales),
        repairStatuses: repairReports.repairStatuses,
        technicians: repairReports.technicians,
        accounts: accounts.map((account) => ({
          id: account.id,
          name: account.name,
          type: account.type,
          balance: round(account.balance),
        })),
        miniMart,
      });
    } catch (error) {
      console.error('Business report failed:', error);
      res.status(error.status || 500).json({ ok: false, message: error.message || 'Business report failed' });
    }
  });
}

module.exports = attachReportsPostgresApi;
