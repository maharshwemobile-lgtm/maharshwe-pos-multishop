const { prisma } = require('./prisma');
const { requireAuth, requireShopUser } = require('./auth-api');
const { DEFAULTS, object, merge, buildProjectSettingsState } = require('./project-settings-state');

const OPENING_PAGES = new Set([
  'Dashboard', 'Sale POS', 'Sales History', 'Repairs', 'Products', 'Stock',
  'Purchases', 'Customers', 'Accounting', 'Reports', 'Settings',
]);

async function writeAudit(req) {
  try {
    await prisma.auditLog.create({
      data: {
        shopId: req.auth.shopId,
        userId: req.auth.userId,
        action: 'PROJECT_PREFERENCES_UPDATED',
        entityType: 'project_settings',
        entityId: req.auth.shopId,
        details: { section: 'preferences' },
        ipAddress: req.ip || null,
        userAgent: req.headers['user-agent'] || null,
      },
    });
  } catch (error) {
    console.warn('Preferences saved but audit logging failed:', error.message);
  }
}

module.exports = function attachProjectSettingsPreferencesWrite(app) {
  app.put('/api/project-settings/preferences', requireAuth, requireShopUser, async (req, res, next) => {
    try {
      const input = merge(DEFAULTS.preferences, req.body);
      if (!['my', 'en'].includes(input.language)) return res.status(400).json({ ok: false, message: 'Invalid language' });
      if (!['light', 'dark', 'system'].includes(input.theme)) return res.status(400).json({ ok: false, message: 'Invalid theme' });
      if (!OPENING_PAGES.has(input.openingPage)) return res.status(400).json({ ok: false, message: 'Invalid opening page' });
      if (!['expanded', 'compact'].includes(input.sidebarMode)) return res.status(400).json({ ok: false, message: 'Invalid sidebar mode' });
      if (!['comfortable', 'compact'].includes(input.tableDensity)) return res.status(400).json({ ok: false, message: 'Invalid table density' });
      input.pageSize = Number(input.pageSize);
      if (![10, 20, 50, 100].includes(input.pageSize)) return res.status(400).json({ ok: false, message: 'Invalid page size' });

      await prisma.$transaction(async (tx) => {
        const row = await tx.shopSettings.findUnique({
          where: { shopId: req.auth.shopId },
          select: { settings: true },
        });
        const settings = object(row?.settings);
        const preferences = object(settings.userPreferences);
        preferences[req.auth.userId] = input;
        await tx.shopSettings.upsert({
          where: { shopId: req.auth.shopId },
          create: { shopId: req.auth.shopId, settings: { ...settings, userPreferences: preferences } },
          update: { settings: { ...settings, userPreferences: preferences } },
        });
      });

      await writeAudit(req);
      return res.json(await buildProjectSettingsState(req.auth.shopId, req.auth.userId));
    } catch (error) {
      return next(error);
    }
  });
};
