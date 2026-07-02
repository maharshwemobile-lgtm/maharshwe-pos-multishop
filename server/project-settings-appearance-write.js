const { prisma } = require('./prisma');
const { requireAuth, requireShopUser } = require('./auth-api');
const { DEFAULTS, object, merge, buildProjectSettingsState } = require('./project-settings-state');

function manager(req, res, next) {
  if (req.auth?.role === 'SUPER_ADMIN' || req.auth?.role === 'SHOP_ADMIN' || req.auth?.permissions?.settings === true) return next();
  return res.status(403).json({ ok: false, message: 'Settings permission is required' });
}

async function writeAudit(req, input) {
  try {
    await prisma.auditLog.create({
      data: {
        shopId: req.auth.shopId,
        userId: req.auth.userId,
        action: 'PROJECT_APPEARANCE_UPDATED',
        entityType: 'project_settings',
        entityId: req.auth.shopId,
        details: { section: 'appearance', language: input.language, theme: input.theme },
        ipAddress: req.ip || null,
        userAgent: req.headers['user-agent'] || null,
      },
    });
  } catch (error) {
    console.warn('Appearance saved but audit logging failed:', error.message);
  }
}

function attachProjectSettingsAppearanceWrite(app) {
  app.put('/api/project-settings/appearance', requireAuth, requireShopUser, manager, async (req, res, next) => {
    try {
      const input = merge(DEFAULTS.appearance, req.body);
      if (!['my', 'en'].includes(input.language)) return res.status(400).json({ ok: false, message: 'Invalid language' });
      if (!['light', 'dark', 'system'].includes(input.theme)) return res.status(400).json({ ok: false, message: 'Invalid theme' });
      if (!['green', 'blue', 'purple', 'orange'].includes(input.accent)) return res.status(400).json({ ok: false, message: 'Invalid accent' });
      if (!['normal', 'large'].includes(input.fontScale)) return res.status(400).json({ ok: false, message: 'Invalid font size' });
      if (!['compact', 'comfortable'].includes(input.tableDensity)) return res.status(400).json({ ok: false, message: 'Invalid table density' });

      await prisma.$transaction(async (tx) => {
        const row = await tx.shopSettings.findUnique({
          where: { shopId: req.auth.shopId },
          select: { settings: true },
        });
        const settings = object(row?.settings);
        const preferences = object(settings.userPreferences);
        preferences[req.auth.userId] = {
          ...merge(DEFAULTS.preferences, preferences[req.auth.userId]),
          language: input.language,
          theme: input.theme,
          tableDensity: input.tableDensity,
        };
        const nextSettings = { ...settings, appearance: input, userPreferences: preferences };
        await tx.shopSettings.upsert({
          where: { shopId: req.auth.shopId },
          create: {
            shopId: req.auth.shopId,
            language: input.language,
            theme: input.theme,
            currency: 'MMK',
            settings: nextSettings,
          },
          update: {
            language: input.language,
            theme: input.theme,
            currency: 'MMK',
            settings: nextSettings,
          },
        });
      });

      await writeAudit(req, input);
      return res.json(await buildProjectSettingsState(req.auth.shopId, req.auth.userId));
    } catch (error) {
      return next(error);
    }
  });
}

module.exports = attachProjectSettingsAppearanceWrite;
