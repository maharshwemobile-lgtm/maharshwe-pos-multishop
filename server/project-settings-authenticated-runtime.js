const { Prisma } = require('@prisma/client');
const { prisma } = require('./prisma');
const { requireAuth, requireShopUser } = require('./auth-api');

const DEFAULT_LOGO = 'https://raw.githubusercontent.com/maharshwemobile-lgtm/maharshwe.shop/main/mahar-pos-logo.png';

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

async function syncUserAppearance(req) {
  if (req.method !== 'PUT' || req.path !== '/appearance') return;
  const language = req.body?.language;
  const theme = req.body?.theme;
  if (!['my', 'en'].includes(language) || !['light', 'dark', 'system'].includes(theme)) return;

  await prisma.$transaction(async (tx) => {
    const row = await tx.shopSettings.findUnique({ where: { shopId: req.auth.shopId }, select: { settings: true } });
    const settings = object(row?.settings);
    const allPreferences = object(settings.userPreferences);
    allPreferences[req.auth.userId] = {
      ...object(allPreferences[req.auth.userId]),
      language,
      theme,
    };
    await tx.shopSettings.upsert({
      where: { shopId: req.auth.shopId },
      create: { shopId: req.auth.shopId, settings: { ...settings, userPreferences: allPreferences } },
      update: { settings: { ...settings, userPreferences: allPreferences } },
    });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

function attachProjectSettingsAuthenticatedRuntime(app) {
  app.use('/api/project-settings', requireAuth, requireShopUser, async (req, res, next) => {
    try {
      if (req.method === 'PUT' && req.path === '/business' && !String(req.body?.logoUrl || '').trim()) {
        req.body.logoUrl = DEFAULT_LOGO;
      }
      await syncUserAppearance(req);
      const originalJson = res.json.bind(res);
      res.json = (payload) => {
        if (payload?.business && !String(payload.business.logoUrl || '').trim()) {
          payload.business.logoUrl = DEFAULT_LOGO;
        }
        return originalJson(payload);
      };
      next();
    } catch (error) {
      next(error);
    }
  });
}

module.exports = attachProjectSettingsAuthenticatedRuntime;
