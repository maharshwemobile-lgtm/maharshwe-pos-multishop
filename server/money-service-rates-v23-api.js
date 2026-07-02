const { z } = require('zod');
const { prisma } = require('./prisma');
const { requireAuth, requireShopUser, requireWritableSubscription } = require('./auth-api');

const schema = z.object({
  rates: z.record(z.string().max(120), z.coerce.number().min(0).max(100)),
  minimumFee: z.coerce.number().min(0).max(10000000),
  roundTo: z.coerce.number().int().min(1).max(1000000),
});

function requireManager(req, res, next) {
  if (req.auth?.role === 'SUPER_ADMIN' || req.auth?.role === 'SHOP_ADMIN') return next();
  return res.status(403).json({ ok: false, message: 'Shop Admin permission is required' });
}

function cleanRates(value) {
  const output = {};
  for (const [key, rate] of Object.entries(value || {})) {
    const safe = String(key).toUpperCase().replace(/[^A-Z0-9_]/g, '').slice(0, 120);
    if (!safe || (!safe.endsWith('_TRANSFER') && !safe.endsWith('_CASH_OUT'))) continue;
    output[safe] = Number(rate || 0);
  }
  return output;
}

function attachMoneyServiceRatesV23Api(app) {
  app.put('/api/money-service/settings/rates', requireAuth, requireShopUser, requireWritableSubscription, requireManager, async (req, res) => {
    try {
      const parsed = schema.safeParse(req.body || {});
      if (!parsed.success) return res.status(400).json({ ok: false, message: 'Invalid fee settings', details: parsed.error.flatten().fieldErrors });
      const current = await prisma.shopSettings.findUnique({ where: { shopId: req.auth.shopId }, select: { moneyServiceRates: true } });
      const stored = current?.moneyServiceRates && typeof current.moneyServiceRates === 'object' ? current.moneyServiceRates : {};
      const rates = { ...stored, ...cleanRates(parsed.data.rates), minimumFee: parsed.data.minimumFee, roundTo: parsed.data.roundTo };
      await prisma.shopSettings.upsert({ where: { shopId: req.auth.shopId }, create: { shopId: req.auth.shopId, moneyServiceRates: rates }, update: { moneyServiceRates: rates } });
      await prisma.auditLog.create({ data: { shopId: req.auth.shopId, userId: req.auth.userId, action: 'MONEY_SERVICE_DYNAMIC_RATES_UPDATED', entityType: 'shop_settings', entityId: req.auth.shopId, details: rates, ipAddress: req.ip || null, userAgent: req.headers['user-agent'] || null } }).catch(() => {});
      return res.json({ ok: true, rates, message: 'Money Service fees updated' });
    } catch (error) {
      return res.status(500).json({ ok: false, message: error.message || 'Fee settings update failed' });
    }
  });
}

module.exports = attachMoneyServiceRatesV23Api;
