const { Prisma } = require('@prisma/client');
const { prisma } = require('./prisma');

const PROJECT_LOGO_URL = 'https://raw.githubusercontent.com/maharshwemobile-lgtm/maharshwe.shop/main/mahar-pos-logo.png';

function plainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function indexedString(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const keys = Object.keys(value);
  if (!keys.length || !keys.every((key, index) => key === String(index))) return null;
  const chars = keys.map((key) => value[key]);
  return chars.every((char) => typeof char === 'string') ? chars.join('') : null;
}

function clean(value, fallback = '') {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return indexedString(value) ?? fallback;
}

function sanitizeBody(value) {
  if (Array.isArray(value)) return value.map(sanitizeBody);
  if (!value || typeof value !== 'object') return value;
  const recovered = indexedString(value);
  if (recovered !== null) return recovered;
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, sanitizeBody(entry)]));
}

async function saveAppearanceForCurrentUser(req) {
  if (req.method !== 'PUT' || req.path !== '/appearance') return;
  const language = clean(req.body?.language, 'my');
  const theme = clean(req.body?.theme, 'light');
  if (!['my', 'en'].includes(language) || !['light', 'dark', 'system'].includes(theme)) return;

  await prisma.$transaction(async (tx) => {
    const record = await tx.shopSettings.findUnique({ where: { shopId: req.auth.shopId }, select: { settings: true } });
    const settings = plainObject(record?.settings);
    const preferences = plainObject(settings.userPreferences);
    const current = plainObject(preferences[req.auth.userId]);
    preferences[req.auth.userId] = { ...current, language, theme };
    await tx.shopSettings.upsert({
      where: { shopId: req.auth.shopId },
      create: { shopId: req.auth.shopId, settings: { ...settings, userPreferences: preferences } },
      update: { settings: { ...settings, userPreferences: preferences } },
    });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

function attachProjectSettingsRuntimeFixes(app) {
  app.use('/api/project-settings', async (req, res, next) => {
    try {
      req.body = sanitizeBody(req.body || {});

      if (req.method === 'PUT' && req.path === '/business' && !clean(req.body.logoUrl)) {
        req.body.logoUrl = PROJECT_LOGO_URL;
      }

      await saveAppearanceForCurrentUser(req);

      const originalJson = res.json.bind(res);
      res.json = (body) => {
        if (body && typeof body === 'object') {
          body.business = plainObject(body.business);
          body.business.logoUrl = clean(body.business.logoUrl, PROJECT_LOGO_URL) || PROJECT_LOGO_URL;
        }
        return originalJson(body);
      };
      next();
    } catch (error) {
      console.error('Project settings runtime fix:', error);
      res.status(500).json({ ok: false, message: error.message || 'Settings runtime update failed' });
    }
  });
}

module.exports = attachProjectSettingsRuntimeFixes;
