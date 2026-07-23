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
        todayBillerSales,
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
        prisma.$queryRawUnsafe(
          `SELECT
              COALESCE((
                SELECT SUM(service_profit)
                  FROM money_service_transactions
                 WHERE shop_id=$1::uuid AND created_at >= $2 AND created_at < $3
              ),0)
              + COALESCE((
                SELECT SUM(fee_amount)
                  FROM money_service_transactions_v2
                 WHERE shop_id=$1::uuid
                   AND created_at >= $2 AND created_at < $3
                   AND voided_at IS NULL
              ),0) AS "serviceProfit"`,
          shopId,
          today,
          tomorrow,
        ),
        prisma.$queryRawUnsafe(
          `SELECT COALESCE(SUM(amount),0) AS "soldVolume",
                  COALESCE(SUM(profit_amount),0) AS profit,
                  COUNT(*)::int AS count
             FROM biller_transactions
            WHERE shop_id=$1::uuid
              AND transaction_type='SOLD'
              AND transaction_date >= $2
              AND transaction_date < $3
              AND voided_at IS NULL`,
          shopId,
          today,
          tomorrow,
        ),
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
      const moneyProfit = number(todayMoneyProfit[0]?.serviceProfit);
      const billEloadSoldVolume = number(todayBillerSales[0]?.soldVolume);
      const billEloadProfit = number(todayBillerSales[0]?.profit);
      const stockBalance = stockRows.reduce(
        (sum, row) => sum + number(row.costPrice) * Number(row.inventoryBalance?.quantity || 0),
        0,
      );

      res.json({
        ok: true,
        dashboard: {
          todayTotalIncome: todaySaleIncome + repairIncome + moneyProfit + billEloadSoldVolume,
          todaySaleIncome,
          todayProfit: number(todaySales._sum.profitTotal) + moneyProfit + billEloadProfit,
          billEloadSoldVolume,
          billEloadProfit,
          billEloadCount: Number(todayBillerSales[0]?.count || 0),
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
