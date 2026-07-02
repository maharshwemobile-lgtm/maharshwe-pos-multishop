const crypto = require('crypto');
const { prisma } = require('./prisma');
const { requireAuth, requireShopUser } = require('./auth-api');
const { PROJECT_LOGO_URL, object, buildProjectSettingsState } = require('./project-settings-state');

function manager(req, res, next) {
  if (req.auth?.role === 'SUPER_ADMIN' || req.auth?.role === 'SHOP_ADMIN' || req.auth?.permissions?.settings === true) return next();
  return res.status(403).json({ ok: false, message: 'Settings permission is required' });
}

function text(value) {
  return value === null || value === undefined ? '' : String(value).trim();
}

function logoUrl(value) {
  const candidate = text(value) || PROJECT_LOGO_URL;
  try {
    const parsed = new URL(candidate);
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('unsupported protocol');
    return parsed.toString();
  } catch {
    const error = new Error('Logo URL must be a valid HTTP or HTTPS address');
    error.status = 400;
    throw error;
  }
}

function repairPrefix(value) {
  const normalized = text(value).toUpperCase().replace(/[^A-Z]/g, '');
  if (!normalized) return '';
  if (normalized.length <= 8) return normalized;
  const error = new Error('Repair Prefix must be 1 to 8 letters');
  error.status = 400;
  throw error;
}

async function writeAudit(req, name) {
  try {
    await prisma.auditLog.create({
      data: {
        shopId: req.auth.shopId,
        userId: req.auth.userId,
        action: 'PROJECT_BUSINESS_PROFILE_UPDATED',
        entityType: 'project_settings',
        entityId: req.auth.shopId,
        details: { section: 'business', shopName: name },
        ipAddress: req.ip || null,
        userAgent: req.headers['user-agent'] || null,
      },
    });
  } catch (error) {
    console.warn('Business profile saved but audit logging failed:', error.message);
  }
}

function attachProjectSettingsBusinessWrite(app) {
  app.put('/api/project-settings/business', requireAuth, requireShopUser, manager, async (req, res, next) => {
    try {
      const name = text(req.body?.name);
      if (!name) return res.status(400).json({ ok: false, message: 'Business Name is required' });
      const selectedLogo = logoUrl(req.body?.logoUrl);
      const selectedRepairPrefix = repairPrefix(req.body?.repairPrefix);

      await prisma.$transaction(async (tx) => {
        const row = await tx.shopSettings.findUnique({
          where: { shopId: req.auth.shopId },
          select: { settings: true },
        });
        const settings = object(row?.settings);
        const previousBusiness = object(settings.business);
        const business = {
          ...previousBusiness,
          subtitle: text(req.body?.subtitle),
          secondaryPhone: text(req.body?.secondaryPhone),
          townshipRegion: text(req.body?.townshipRegion),
          website: text(req.body?.website),
          googleMapUrl: text(req.body?.googleMapUrl),
          kbzPayNumber: text(req.body?.kbzPayNumber),
          wavePayNumber: text(req.body?.wavePayNumber),
          repairPrefix: selectedRepairPrefix,
        };

        await tx.shop.update({
          where: { id: req.auth.shopId },
          data: {
            name,
            phone: text(req.body?.phone) || null,
            address: text(req.body?.address) || null,
            logoUrl: selectedLogo,
          },
        });
        await tx.shopSettings.upsert({
          where: { shopId: req.auth.shopId },
          create: { id: crypto.randomUUID(), shopId: req.auth.shopId, repairPrefix: selectedRepairPrefix || undefined, settings: { ...settings, business } },
          update: { repairPrefix: selectedRepairPrefix || '', settings: { ...settings, business } },
        });
      });

      await writeAudit(req, name);
      return res.json(await buildProjectSettingsState(req.auth.shopId, req.auth.userId));
    } catch (error) {
      if (error.status === 400) return res.status(400).json({ ok: false, message: error.message });
      return next(error);
    }
  });
}

module.exports = attachProjectSettingsBusinessWrite;
