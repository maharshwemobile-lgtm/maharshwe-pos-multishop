const { prisma } = require('./prisma');
const { requireAuth, requireShopUser } = require('./auth-api');

const number = (value) => Number(value || 0);

function dayStart(date = new Date()) {
  const value = new Date(date);
  value.setHours(0, 0, 0, 0);
  return value;
}

module.exports = function attachDashboardPostgresApi(app) {
  app.get('/api/dashboard', requireAuth, requireShopUser, async (req, res) => {
    try {
      const shopId = req.auth.shopId;
      const today = dayStart();
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
      const sevenDaysAgo = new Date(today);
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);

      const activeSaleWhere = {
        shopId,
        status: { not: 'VOIDED' },
      };
      const todaySaleWhere = {
        ...activeSaleWhere,
        soldAt: { gte: today, lt: tomorrow },
      };
      const weekSaleWhere = {
        ...activeSaleWhere,
        soldAt: { gte: sevenDaysAgo, lt: tomorrow },
      };

      const [
        todaySales,
        weekSales,
        todayRepairPayments,
        todayMoneyProfit,
        customerDebt,
        accounts,
        stockRows,
      ] = await prisma.$transaction([
        prisma.sale.aggregate({
          where: todaySaleWhere,
          _sum: { total: true, profitTotal: true },
          _count: { _all: true },
        }),
        prisma.sale.aggregate({
          where: weekSaleWhere,
          _sum: { total: true },
          _count: { _all: true },
        }),
        prisma.repairPayment.aggregate({
          where: {
            shopId,
            status: 'PAID',
            paidAt: { gte: today, lt: tomorrow },
          },
          _sum: { amount: true },
        }),
        prisma.moneyServiceTransaction.aggregate({
          where: {
            shopId,
            createdAt: { gte: today, lt: tomorrow },
          },
          _sum: { serviceProfit: true },
        }),
        prisma.customer.aggregate({
          where: { shopId, balance: { gt: 0 } },
          _sum: { balance: true },
        }),
        prisma.moneyAccount.aggregate({
          where: { shopId, active: true },
          _sum: { balance: true },
        }),
        prisma.productVariant.findMany({
          where: { shopId, active: true },
          select: {
            costPrice: true,
            inventoryBalance: { select: { quantity: true } },
          },
        }),
      ]);

      const todaySaleIncome = number(todaySales._sum.total);
      const repairIncome = number(todayRepairPayments._sum.amount);
      const moneyProfit = number(todayMoneyProfit._sum.serviceProfit);
      const stockBalance = stockRows.reduce(
        (sum, row) => sum + number(row.costPrice) * Number(row.inventoryBalance?.quantity || 0),
        0,
      );

      res.json({
        ok: true,
        dashboard: {
          todayTotalIncome: todaySaleIncome + repairIncome + moneyProfit,
          todaySaleIncome,
          todayProfit: number(todaySales._sum.profitTotal) + moneyProfit,
          todayExpense: 0,
          receivable: number(customerDebt._sum.balance),
          payable: 0,
          accountBalance: number(accounts._sum.balance),
          stockBalance,
          last7DaysSales: number(weekSales._sum.total),
          last7DaysOrders: Number(weekSales._count._all || 0),
          todayOrders: Number(todaySales._count._all || 0),
        },
      });
    } catch (error) {
      console.error('PostgreSQL dashboard:', error);
      res.status(500).json({ ok: false, message: error.message || 'Dashboard request failed' });
    }
  });
};
