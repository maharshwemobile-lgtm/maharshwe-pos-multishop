const { prisma } = require('./prisma');

async function pendingRepairCount(shopId) {
  if (!shopId) return 0;
  const rows = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS count
       FROM repairs
      WHERE shop_id=$1::uuid
        AND status='WAITING_PART'
        AND completed_at IS NULL
        AND delivered_at IS NULL`,
    shopId,
  );
  return Number(rows[0]?.count || 0);
}

function attachBusinessAlertsPendingFix(app) {
  app.use('/api/business-control', (req, res, next) => {
    const originalJson = res.json.bind(res);
    res.json = async (payload) => {
      try {
        if (payload?.dashboard) {
          payload.dashboard.pendingRepairs = await pendingRepairCount(req.auth?.shopId);
        }
      } catch (error) {
        console.warn('Business Alerts pending count failed:', error.message);
      }
      return originalJson(payload);
    };
    next();
  });
}

module.exports = attachBusinessAlertsPendingFix;
