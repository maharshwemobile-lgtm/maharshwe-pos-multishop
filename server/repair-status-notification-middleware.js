const { prisma } = require('./prisma');
const { enqueueRepairNotification } = require('./repair-notification-outbox');

function attachRepairStatusNotificationMiddleware(app) {
  app.use((req, res, next) => {
    const method = String(req.method || '').toUpperCase();
    const pathname = String(req.path || '');
    const statusMatch = pathname.match(/^\/api\/repair-platform\/jobs\/([^/]+)\/(status|sync)$/);
    if (!statusMatch || !['POST', 'PATCH'].includes(method)) return next();

    res.on('finish', () => {
      if (res.statusCode < 200 || res.statusCode >= 300 || !req.auth?.shopId) return;
      const identifier = decodeURIComponent(statusMatch[1]);
      prisma.$queryRawUnsafe(
        `SELECT id,status,updated_at AS "updatedAt"
           FROM repairs
          WHERE shop_id=$1::uuid AND (id::text=$2 OR repair_number=UPPER($2))
          LIMIT 1`,
        req.auth.shopId,
        identifier,
      ).then(async (rows) => {
        const repair = rows[0];
        if (!repair) return;
        await enqueueRepairNotification({
          shopId: req.auth.shopId,
          repairId: repair.id,
          eventType: statusMatch[2] === 'sync' ? 'PROVIDER_STATUS_SYNCED' : 'STATUS_CHANGED',
          status: repair.status,
          nonce: new Date(repair.updatedAt || Date.now()).toISOString(),
        });
      }).catch((error) => console.error('Repair notification enqueue failed:', error.message));
    });
    return next();
  });
}

module.exports = attachRepairStatusNotificationMiddleware;
