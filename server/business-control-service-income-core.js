const { prisma } = require('./prisma');
const { requireAuth, requireShopUser, requireWritableSubscription } = require('./auth-api');

const SERVICE_PREFIX = '__SERVICE_INCOME__:';

function requireManager(req, res, next) {
  if (req.auth?.role === 'SUPER_ADMIN' || req.auth?.role === 'SHOP_ADMIN') return next();
  return res.status(403).json({ ok: false, message: 'Only a Shop Admin can reopen the business day' });
}

function businessDateFrom(req, payload) {
  return String(payload?.businessDate || req.body?.businessDate || req.body?.incomeDate || req.query?.date || '').slice(0, 10);
}

async function serviceIncomeTotal(shopId, businessDate) {
  if (!shopId || !/^\d{4}-\d{2}-\d{2}$/.test(businessDate)) return 0;
  try {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT COALESCE(SUM(amount),0) AS total
         FROM business_other_income
        WHERE shop_id=$1::uuid AND income_date=$2::date AND source LIKE $3`,
      shopId,
      businessDate,
      `${SERVICE_PREFIX}%`,
    );
    return Number(rows[0]?.total || 0);
  } catch (error) {
    console.warn('Service Income classification unavailable:', error.message);
    return 0;
  }
}

function classifyRecentIncome(rows) {
  return (rows || []).map((row) => {
    const source = String(row.source || '');
    const serviceIncome = source.startsWith(SERVICE_PREFIX);
    return {
      ...row,
      category: serviceIncome ? 'SERVICE_INCOME' : 'OTHER_INCOME',
      source: serviceIncome ? source.slice(SERVICE_PREFIX.length) : source,
    };
  });
}

function attachBusinessControlServiceIncomeCore(app) {
  app.post(
    '/api/business-control/daily-closing/undo',
    requireAuth,
    requireShopUser,
    requireWritableSubscription,
    requireManager,
    async (req, res) => {
      try {
        const businessDate = String(req.body?.businessDate || '').slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(businessDate)) {
          return res.status(400).json({ ok: false, message: 'Business date must use YYYY-MM-DD' });
        }
        const deleted = await prisma.$queryRawUnsafe(
          `DELETE FROM daily_closings
            WHERE shop_id=$1::uuid AND closing_date=$2::date
            RETURNING id`,
          req.auth.shopId,
          businessDate,
        );
        if (!deleted[0]) return res.status(404).json({ ok: false, message: 'Closed business day was not found' });
        await prisma.auditLog.create({
          data: {
            shopId: req.auth.shopId,
            userId: req.auth.userId,
            action: 'BUSINESS_DAY_REOPENED',
            entityType: 'daily_closing',
            entityId: deleted[0].id,
            details: { businessDate },
            ipAddress: req.ip || null,
            userAgent: req.headers['user-agent'] || null,
          },
        }).catch((error) => console.warn('Daily closing reopen audit failed:', error.message));
        return res.json({ ok: true, message: `${businessDate} business day reopened` });
      } catch (error) {
        console.error('Daily closing undo failed:', error);
        return res.status(500).json({ ok: false, message: error.message || 'Daily closing undo failed' });
      }
    },
  );

  app.use('/api/business-control', (req, res, next) => {
    if (req.method === 'POST' && req.path === '/other-income') {
      const category = String(req.body?.category || 'OTHER_INCOME').toUpperCase();
      const source = String(req.body?.source || '').trim();
      if (category === 'SERVICE_INCOME' && source && !source.startsWith(SERVICE_PREFIX)) {
        req.body.source = `${SERVICE_PREFIX}${source}`;
      }
      delete req.body.category;
    }

    const originalJson = res.json.bind(res);
    res.json = async (payload) => {
      try {
        const businessDate = businessDateFrom(req, payload);
        const serviceIncome = await serviceIncomeTotal(req.auth?.shopId, businessDate);
        if (payload?.dashboard) {
          const originalOtherIncome = Number(payload.dashboard.otherIncome || 0);
          payload.dashboard.repairIncome = Number(payload.dashboard.repairIncome || 0) + serviceIncome;
          payload.dashboard.serviceIncome = serviceIncome;
          payload.dashboard.allOtherIncome = originalOtherIncome;
          payload.dashboard.otherIncome = Math.max(0, originalOtherIncome - serviceIncome);
        }
        if (Array.isArray(payload?.recentOtherIncome)) {
          payload.recentOtherIncome = classifyRecentIncome(payload.recentOtherIncome);
        }
        if (req.method === 'POST' && req.path === '/daily-closing' && res.statusCode < 300 && serviceIncome > 0) {
          await prisma.$executeRawUnsafe(
            `UPDATE daily_closings
                SET repair_income_total=repair_income_total+$3,
                    other_income_total=GREATEST(other_income_total-$3,0),
                    updated_at=NOW()
              WHERE shop_id=$1::uuid AND closing_date=$2::date`,
            req.auth.shopId,
            businessDate,
            serviceIncome,
          );
          if (payload?.closing) {
            payload.closing.repairIncomeTotal = Number(payload.closing.repairIncomeTotal || 0) + serviceIncome;
            payload.closing.otherIncomeTotal = Math.max(0, Number(payload.closing.otherIncomeTotal || 0) - serviceIncome);
          }
        }
      } catch (error) {
        console.warn('Business Control response extension failed:', error.message);
      }
      return originalJson(payload);
    };
    next();
  });
}

module.exports = attachBusinessControlServiceIncomeCore;
