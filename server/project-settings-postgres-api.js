const { z } = require('zod');
const { Prisma } = require('@prisma/client');
const { prisma } = require('./prisma');
const {
  requireAuth,
  requireShopUser,
  requireWritableSubscription,
} = require('./auth-api');

const SETTINGS_VERSION = 1;
const GOOGLE_SHEET_HOSTS = new Set([
  'script.google.com',
  'script.googleusercontent.com',
  'sheets.googleapis.com',
]);

const cleanText = (max = 500) => z.union([z.string().trim().max(max), z.literal(''), z.null()]).optional();
const httpUrl = z.union([
  z.string().trim().url().refine((value) => /^https?:\/\//i.test(value), 'URL must use http or https'),
  z.literal(''),
  z.null(),
]).optional();

const businessSchema = z.object({
  name: z.string().trim().min(1).max(180),
  subtitle: cleanText(220),
  phone: cleanText(100),
  secondaryPhone: cleanText(100),
  address: cleanText(500),
  townshipRegion: cleanText(220),
  website: httpUrl,
  googleMapUrl: httpUrl,
  kbzPayNumber: cleanText(100),
  wavePayNumber: cleanText(100),
  logoUrl: httpUrl,
});

const preferencesSchema = z.object({
  language: z.enum(['my', 'en']).default('my'),
  theme: z.enum(['light', 'dark', 'system']).default('light'),
  openingPage: z.enum([
    'Dashboard',
    'Sale POS',
    'Sales History',
    'Repairs',
    'Products',
    'Stock',
    'Purchases',
    'Customers',
    'Accounting',
    'Reports',
    'Settings',
  ]).default('Dashboard'),
  sidebarMode: z.enum(['expanded', 'compact']).default('expanded'),
  tableDensity: z.enum(['compact', 'comfortable']).default('comfortable'),
  dateFormat: z.enum(['DD/MM/YYYY', 'YYYY-MM-DD', 'MM/DD/YYYY']).default('DD/MM/YYYY'),
  timeFormat: z.enum(['12h', '24h']).default('12h'),
  pageSize: z.coerce.number().int().refine((value) => [10, 20, 50, 100].includes(value)).default(20),
});

const appearanceSchema = z.object({
  language: z.enum(['my', 'en']).default('my'),
  theme: z.enum(['light', 'dark', 'system']).default('light'),
  accent: z.enum(['green', 'blue', 'purple', 'orange']).default('green'),
  fontScale: z.enum(['normal', 'large']).default('normal'),
  tableDensity: z.enum(['compact', 'comfortable']).default('comfortable'),
  currency: z.literal('MMK').default('MMK'),
  timezone: z.string().trim().min(1).max(80).default('Asia/Yangon'),
  dateFormat: z.enum(['DD/MM/YYYY', 'YYYY-MM-DD', 'MM/DD/YYYY']).default('DD/MM/YYYY'),
  timeFormat: z.enum(['12h', '24h']).default('12h'),
});

const slipSchema = z.object({
  showLogo: z.boolean().default(true),
  saleHeader: cleanText(1000),
  saleFooter: cleanText(1000),
  footerTag: cleanText(500),
  warrantyText: cleanText(2000),
  salePaperSize: z.enum(['58mm', '80mm']).default('80mm'),
  showCustomerPhone: z.boolean().default(true),
  showPaymentType: z.boolean().default(true),
  showCashierName: z.boolean().default(true),
  repairVoucherHeader: cleanText(1000),
  repairVoucherFooter: cleanText(1000),
  repairPaperSize: z.enum(['58mm', '80mm']).default('80mm'),
});

const googleSheetsSchema = z.object({
  enabled: z.boolean().default(false),
  getUrl: httpUrl,
  postUrl: httpUrl,
  timeoutMs: z.coerce.number().int().min(1000).max(60000).default(10000),
});

const apiSchema = z.object({
  googleSheets: googleSheetsSchema,
});

const systemSchema = z.object({
  defaultPageSize: z.coerce.number().int().refine((value) => [10, 20, 50, 100].includes(value)).default(20),
  sessionTimeoutMinutes: z.coerce.number().int().min(15).max(1440).default(720),
  maintenanceMode: z.boolean().default(false),
  timezone: z.string().trim().min(1).max(80).default('Asia/Yangon'),
});

const testSchema = z.object({
  method: z.enum(['GET', 'POST']),
});

const DEFAULTS = Object.freeze({
  business: {
    subtitle: 'Mobile Software & Hardware Expert',
    secondaryPhone: '',
    townshipRegion: '',
    website: '',
    googleMapUrl: '',
    kbzPayNumber: '',
    wavePayNumber: '',
  },
  preferences: {
    language: 'my',
    theme: 'light',
    openingPage: 'Dashboard',
    sidebarMode: 'expanded',
    tableDensity: 'comfortable',
    dateFormat: 'DD/MM/YYYY',
    timeFormat: '12h',
    pageSize: 20,
  },
  appearance: {
    language: 'my',
    theme: 'light',
    accent: 'green',
    fontScale: 'normal',
    tableDensity: 'comfortable',
    currency: 'MMK',
    timezone: 'Asia/Yangon',
    dateFormat: 'DD/MM/YYYY',
    timeFormat: '12h',
  },
  slip: {
    showLogo: true,
    saleHeader: '',
    saleFooter: '',
    footerTag: '',
    warrantyText: '',
    salePaperSize: '80mm',
    showCustomerPhone: true,
    showPaymentType: true,
    showCashierName: true,
    repairVoucherHeader: '',
    repairVoucherFooter: '',
    repairPaperSize: '80mm',
  },
  api: {
    googleSheets: {
      enabled: false,
      getUrl: '',
      postUrl: '',
      timeoutMs: 10000,
      lastTest: null,
    },
  },
  system: {
    defaultPageSize: 20,
    sessionTimeoutMinutes: 720,
    maintenanceMode: false,
    timezone: 'Asia/Yangon',
    settingsVersion: SETTINGS_VERSION,
  },
  userPreferences: {},
});

class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

function parse(schema, value, message = 'Invalid settings request') {
  const result = schema.safeParse(value);
  if (!result.success) throw new ApiError(400, message, result.error.flatten().fieldErrors);
  return result.data;
}

function wrap(handler) {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (error) {
      if (error instanceof ApiError) {
        return res.status(error.status).json({ ok: false, message: error.message, details: error.details });
      }
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return res.status(409).json({ ok: false, message: 'Settings conflict' });
      }
      console.error('Project settings API:', error);
      return res.status(500).json({ ok: false, message: error.message || 'Settings request failed' });
    }
  };
}

function plainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function merge(defaults, saved) {
  const source = plainObject(saved);
  const result = { ...defaults };
  for (const key of Object.keys(source)) {
    const defaultValue = defaults?.[key];
    const savedValue = source[key];
    result[key] = plainObject(defaultValue) && plainObject(savedValue)
      ? { ...defaultValue, ...savedValue }
      : savedValue;
  }
  return result;
}

function nullable(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
}

function requireSettingsManager(req, res, next) {
  if (req.auth?.role === 'SUPER_ADMIN' || req.auth?.role === 'SHOP_ADMIN') return next();
  if (req.auth?.permissions?.settings === true) return next();
  return res.status(403).json({ ok: false, message: 'Settings permission is required' });
}

function subscriptionStatus(subscription) {
  if (!subscription) {
    return {
      status: 'NOT_CONFIGURED',
      rawStatus: null,
      startsAt: null,
      endsAt: null,
      renewedAt: null,
      setupFee: 0,
      monthlyFee: 0,
      totalDays: 0,
      usedDays: 0,
      remainingDays: 0,
      usedPercent: 0,
      expired: false,
    };
  }

  const now = Date.now();
  const startsAt = new Date(subscription.startsAt).getTime();
  const endsAt = new Date(subscription.endsAt).getTime();
  const day = 24 * 60 * 60 * 1000;
  const totalDays = Math.max(1, Math.ceil((endsAt - startsAt) / day));
  const usedDays = Math.min(totalDays, Math.max(0, Math.floor((now - startsAt) / day)));
  const remainingDays = Math.max(0, Math.ceil((endsAt - now) / day));
  const expired = now > endsAt;
  const status = expired && subscription.status !== 'SUSPENDED' ? 'EXPIRED' : subscription.status;

  return {
    id: subscription.id,
    status,
    rawStatus: subscription.status,
    startsAt: subscription.startsAt,
    endsAt: subscription.endsAt,
    renewedAt: subscription.renewedAt,
    setupFee: Number(subscription.setupFee || 0),
    monthlyFee: Number(subscription.monthlyFee || 0),
    totalDays,
    usedDays,
    remainingDays,
    usedPercent: Math.min(100, Math.max(0, Math.round((usedDays / totalDays) * 100))),
    expired,
    notes: subscription.notes || null,
  };
}

async function loadRecord(shopId) {
  const [shop, settings, subscription, users] = await Promise.all([
    prisma.shop.findUnique({
      where: { id: shopId },
      select: { id: true, slug: true, code: true, name: true, phone: true, address: true, logoUrl: true, active: true, createdAt: true, updatedAt: true },
    }),
    prisma.shopSettings.findUnique({ where: { shopId } }),
    prisma.subscription.findFirst({ where: { shopId }, orderBy: [{ endsAt: 'desc' }, { createdAt: 'desc' }] }),
    prisma.user.findMany({ where: { shopId }, select: { active: true, role: true } }),
  ]);
  if (!shop) throw new ApiError(404, 'Shop was not found');
  return { shop, settings, subscription, users };
}

function composePayload(record, userId, canManage) {
  const rawSettings = plainObject(record.settings?.settings);
  const business = merge(DEFAULTS.business, rawSettings.business);
  const appearance = merge(DEFAULTS.appearance, rawSettings.appearance);
  const slip = merge(DEFAULTS.slip, rawSettings.slip);
  const api = merge(DEFAULTS.api, rawSettings.api);
  api.googleSheets = merge(DEFAULTS.api.googleSheets, plainObject(api.googleSheets));
  const system = merge(DEFAULTS.system, rawSettings.system);
  const userPreferences = plainObject(rawSettings.userPreferences);
  const preferences = merge(DEFAULTS.preferences, userPreferences[userId]);

  return {
    ok: true,
    canManage,
    settingsVersion: Number(system.settingsVersion || SETTINGS_VERSION),
    business: {
      id: record.shop.id,
      slug: record.shop.slug,
      code: record.shop.code || '',
      name: record.shop.name,
      phone: record.shop.phone || '',
      address: record.shop.address || '',
      logoUrl: record.shop.logoUrl || '',
      active: record.shop.active,
      createdAt: record.shop.createdAt,
      updatedAt: record.shop.updatedAt,
      ...business,
    },
    license: subscriptionStatus(record.subscription),
    preferences,
    appearance: {
      ...appearance,
      language: record.settings?.language || appearance.language,
      theme: record.settings?.theme || appearance.theme,
      currency: record.settings?.currency || appearance.currency,
    },
    slip: {
      ...slip,
      saleHeader: record.settings?.receiptHeader ?? slip.saleHeader,
      saleFooter: record.settings?.receiptFooter ?? slip.saleFooter,
      warrantyText: record.settings?.warrantyText ?? slip.warrantyText,
    },
    api,
    system,
    userSummary: {
      total: record.users.length,
      active: record.users.filter((user) => user.active).length,
      admins: record.users.filter((user) => user.active && user.role === 'SHOP_ADMIN').length,
      cashiers: record.users.filter((user) => user.active && user.role === 'CASHIER').length,
    },
    database: {
      provider: 'PostgreSQL',
      connected: true,
      tenantScoped: true,
      shopId: record.shop.id,
      shopSlug: record.shop.slug,
    },
  };
}

async function saveRawSettings(tx, shopId, rawSettings, typed = {}) {
  return tx.shopSettings.upsert({
    where: { shopId },
    create: {
      shopId,
      settings: rawSettings,
      ...typed,
    },
    update: {
      settings: rawSettings,
      ...typed,
    },
  });
}

async function audit(tx, req, action, details) {
  await tx.auditLog.create({
    data: {
      shopId: req.auth.shopId,
      userId: req.auth.userId,
      action,
      entityType: 'project_settings',
      entityId: req.auth.shopId,
      details,
      ipAddress: req.ip || null,
      userAgent: req.headers['user-agent'] || null,
    },
  });
}

async function currentRawSettings(tx, shopId) {
  const settings = await tx.shopSettings.findUnique({ where: { shopId }, select: { settings: true } });
  return plainObject(settings?.settings);
}

function validateGoogleUrl(value) {
  const text = nullable(value);
  if (!text) return null;
  let url;
  try {
    url = new URL(text);
  } catch {
    throw new ApiError(400, 'Google Sheet URL is invalid');
  }
  if (url.protocol !== 'https:') throw new ApiError(400, 'Google Sheet URL must use HTTPS');
  if (!GOOGLE_SHEET_HOSTS.has(url.hostname.toLowerCase())) {
    throw new ApiError(400, 'Only Google Apps Script or Google Sheets API URLs are allowed');
  }
  return url.toString();
}

function attachProjectSettingsPostgresApi(app) {
  const read = [requireAuth, requireShopUser];
  const write = [requireAuth, requireShopUser, requireWritableSubscription, requireSettingsManager];

  app.get('/api/project-settings', ...read, wrap(async (req, res) => {
    const record = await loadRecord(req.auth.shopId);
    res.json(composePayload(record, req.auth.userId, req.auth.role === 'SUPER_ADMIN' || req.auth.role === 'SHOP_ADMIN' || req.auth.permissions?.settings === true));
  }));

  app.put('/api/project-settings/preferences', ...read, wrap(async (req, res) => {
    const input = parse(preferencesSchema, req.body || {}, 'Invalid personal preferences');
    await prisma.$transaction(async (tx) => {
      const raw = await currentRawSettings(tx, req.auth.shopId);
      const userPreferences = plainObject(raw.userPreferences);
      userPreferences[req.auth.userId] = input;
      await saveRawSettings(tx, req.auth.shopId, {
        ...raw,
        userPreferences,
        system: { ...merge(DEFAULTS.system, raw.system), settingsVersion: SETTINGS_VERSION },
      });
      await audit(tx, req, 'PROJECT_PREFERENCES_UPDATED', { section: 'preferences' });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    const record = await loadRecord(req.auth.shopId);
    res.json(composePayload(record, req.auth.userId, true));
  }));

  app.put('/api/project-settings/business', ...write, wrap(async (req, res) => {
    const input = parse(businessSchema, req.body || {}, 'Invalid business profile');
    await prisma.$transaction(async (tx) => {
      const raw = await currentRawSettings(tx, req.auth.shopId);
      await tx.shop.update({
        where: { id: req.auth.shopId },
        data: {
          name: input.name,
          phone: nullable(input.phone),
          address: nullable(input.address),
          logoUrl: nullable(input.logoUrl),
        },
      });
      await saveRawSettings(tx, req.auth.shopId, {
        ...raw,
        business: {
          subtitle: nullable(input.subtitle) || '',
          secondaryPhone: nullable(input.secondaryPhone) || '',
          townshipRegion: nullable(input.townshipRegion) || '',
          website: nullable(input.website) || '',
          googleMapUrl: nullable(input.googleMapUrl) || '',
          kbzPayNumber: nullable(input.kbzPayNumber) || '',
          wavePayNumber: nullable(input.wavePayNumber) || '',
        },
        system: { ...merge(DEFAULTS.system, raw.system), settingsVersion: SETTINGS_VERSION },
      });
      await audit(tx, req, 'PROJECT_BUSINESS_PROFILE_UPDATED', { section: 'business', shopName: input.name });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    const record = await loadRecord(req.auth.shopId);
    res.json(composePayload(record, req.auth.userId, true));
  }));

  app.put('/api/project-settings/appearance', ...write, wrap(async (req, res) => {
    const input = parse(appearanceSchema, req.body || {}, 'Invalid appearance settings');
    await prisma.$transaction(async (tx) => {
      const raw = await currentRawSettings(tx, req.auth.shopId);
      await saveRawSettings(tx, req.auth.shopId, {
        ...raw,
        appearance: input,
        system: { ...merge(DEFAULTS.system, raw.system), settingsVersion: SETTINGS_VERSION },
      }, {
        language: input.language,
        theme: input.theme,
        currency: input.currency,
      });
      await audit(tx, req, 'PROJECT_APPEARANCE_UPDATED', { section: 'appearance', language: input.language, theme: input.theme });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    const record = await loadRecord(req.auth.shopId);
    res.json(composePayload(record, req.auth.userId, true));
  }));

  app.put('/api/project-settings/slip', ...write, wrap(async (req, res) => {
    const input = parse(slipSchema, req.body || {}, 'Invalid slip settings');
    await prisma.$transaction(async (tx) => {
      const raw = await currentRawSettings(tx, req.auth.shopId);
      await saveRawSettings(tx, req.auth.shopId, {
        ...raw,
        slip: input,
        system: { ...merge(DEFAULTS.system, raw.system), settingsVersion: SETTINGS_VERSION },
      }, {
        receiptHeader: nullable(input.saleHeader),
        receiptFooter: nullable(input.saleFooter),
        warrantyText: nullable(input.warrantyText),
      });
      await audit(tx, req, 'PROJECT_SLIP_SETTINGS_UPDATED', { section: 'slip', showLogo: input.showLogo, salePaperSize: input.salePaperSize, repairPaperSize: input.repairPaperSize });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    const record = await loadRecord(req.auth.shopId);
    res.json(composePayload(record, req.auth.userId, true));
  }));

  app.put('/api/project-settings/api', ...write, wrap(async (req, res) => {
    const input = parse(apiSchema, req.body || {}, 'Invalid API settings');
    const googleSheets = {
      ...input.googleSheets,
      getUrl: validateGoogleUrl(input.googleSheets.getUrl) || '',
      postUrl: validateGoogleUrl(input.googleSheets.postUrl) || '',
    };
    await prisma.$transaction(async (tx) => {
      const raw = await currentRawSettings(tx, req.auth.shopId);
      const previous = merge(DEFAULTS.api.googleSheets, plainObject(plainObject(raw.api).googleSheets));
      await saveRawSettings(tx, req.auth.shopId, {
        ...raw,
        api: {
          googleSheets: {
            ...googleSheets,
            lastTest: previous.lastTest || null,
          },
        },
        system: { ...merge(DEFAULTS.system, raw.system), settingsVersion: SETTINGS_VERSION },
      });
      await audit(tx, req, 'PROJECT_API_CONFIGURATION_UPDATED', { section: 'api', googleSheetsEnabled: googleSheets.enabled, hasGetUrl: Boolean(googleSheets.getUrl), hasPostUrl: Boolean(googleSheets.postUrl) });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    const record = await loadRecord(req.auth.shopId);
    res.json(composePayload(record, req.auth.userId, true));
  }));

  app.post('/api/project-settings/api/google-sheet/test', ...write, wrap(async (req, res) => {
    const input = parse(testSchema, req.body || {}, 'Invalid API test request');
    const record = await loadRecord(req.auth.shopId);
    const raw = plainObject(record.settings?.settings);
    const googleSheets = merge(DEFAULTS.api.googleSheets, plainObject(plainObject(raw.api).googleSheets));
    const target = validateGoogleUrl(input.method === 'GET' ? googleSheets.getUrl : googleSheets.postUrl);
    if (!target) throw new ApiError(400, `${input.method} URL is not configured`);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Number(googleSheets.timeoutMs || 10000));
    let response;
    let preview = '';
    try {
      response = await fetch(target, {
        method: input.method,
        signal: controller.signal,
        headers: input.method === 'POST' ? { 'Content-Type': 'application/json', Accept: 'application/json,text/plain,*/*' } : { Accept: 'application/json,text/plain,*/*' },
        ...(input.method === 'POST' ? { body: JSON.stringify({ source: 'Mahar POS Settings Test', shopId: req.auth.shopId, testedAt: new Date().toISOString() }) } : {}),
      });
      preview = (await response.text()).slice(0, 1000);
    } catch (error) {
      preview = error.name === 'AbortError' ? 'Request timeout' : error.message;
    } finally {
      clearTimeout(timeout);
    }

    const lastTest = {
      method: input.method,
      ok: Boolean(response?.ok),
      status: response?.status || 0,
      testedAt: new Date().toISOString(),
      responsePreview: preview,
    };

    await prisma.$transaction(async (tx) => {
      const current = await currentRawSettings(tx, req.auth.shopId);
      const currentApi = plainObject(current.api);
      const currentGoogle = merge(DEFAULTS.api.googleSheets, plainObject(currentApi.googleSheets));
      await saveRawSettings(tx, req.auth.shopId, {
        ...current,
        api: { ...currentApi, googleSheets: { ...currentGoogle, lastTest } },
      });
      await audit(tx, req, 'PROJECT_API_CONNECTION_TESTED', { section: 'api', method: input.method, ok: lastTest.ok, status: lastTest.status });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    res.status(lastTest.ok ? 200 : 502).json({ ok: lastTest.ok, test: lastTest });
  }));

  app.put('/api/project-settings/system', ...write, wrap(async (req, res) => {
    const input = parse(systemSchema, req.body || {}, 'Invalid PostgreSQL system settings');
    await prisma.$transaction(async (tx) => {
      const raw = await currentRawSettings(tx, req.auth.shopId);
      await saveRawSettings(tx, req.auth.shopId, {
        ...raw,
        system: { ...input, settingsVersion: SETTINGS_VERSION },
      });
      await audit(tx, req, 'PROJECT_SYSTEM_SETTINGS_UPDATED', { section: 'system', defaultPageSize: input.defaultPageSize, maintenanceMode: input.maintenanceMode, timezone: input.timezone });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    const record = await loadRecord(req.auth.shopId);
    res.json(composePayload(record, req.auth.userId, true));
  }));
}

module.exports = attachProjectSettingsPostgresApi;
