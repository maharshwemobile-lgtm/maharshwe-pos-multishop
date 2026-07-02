const { prisma } = require('./prisma');

const PROJECT_LOGO_URL = 'https://raw.githubusercontent.com/maharshwemobile-lgtm/maharshwe.shop/main/mahar-pos-logo.png';

const DEFAULTS = {
  business: { subtitle: 'Mobile Software & Hardware Expert', secondaryPhone: '', townshipRegion: '', website: '', googleMapUrl: '', kbzPayNumber: '', wavePayNumber: '', repairPrefix: '' },
  preferences: { language: 'my', theme: 'light', openingPage: 'Dashboard', sidebarMode: 'expanded', tableDensity: 'comfortable', dateFormat: 'DD/MM/YYYY', timeFormat: '12h', pageSize: 20 },
  appearance: { language: 'my', theme: 'light', accent: 'green', fontScale: 'normal', tableDensity: 'comfortable', currency: 'MMK', timezone: 'Asia/Yangon', dateFormat: 'DD/MM/YYYY', timeFormat: '12h' },
  slip: { showLogo: true, saleHeader: '', saleFooter: '', footerTag: '', warrantyText: '', salePaperSize: '80mm', showCustomerPhone: true, showPaymentType: true, showCashierName: true, repairVoucherHeader: '', repairVoucherFooter: '', repairPaperSize: '80mm' },
  api: { googleSheets: { enabled: false, getUrl: '', postUrl: '', timeoutMs: 10000, lastTest: null } },
  system: { defaultPageSize: 20, sessionTimeoutMinutes: 720, maintenanceMode: false, timezone: 'Asia/Yangon', settingsVersion: 1 },
};

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function merge(base, value) {
  return { ...base, ...object(value) };
}

function licenseState(subscription) {
  if (!subscription) return { status: 'NOT_CONFIGURED', startsAt: null, endsAt: null, renewedAt: null, monthlyFee: 0, totalDays: 0, usedDays: 0, remainingDays: 0, usedPercent: 0, expired: false };
  const day = 86400000;
  const now = Date.now();
  const start = new Date(subscription.startsAt).getTime();
  const end = new Date(subscription.endsAt).getTime();
  const totalDays = Math.max(1, Math.ceil((end - start) / day));
  const usedDays = Math.min(totalDays, Math.max(0, Math.floor((now - start) / day)));
  const remainingDays = Math.max(0, Math.ceil((end - now) / day));
  const expired = now > end;
  return { ...subscription, status: expired && subscription.status !== 'SUSPENDED' ? 'EXPIRED' : subscription.status, monthlyFee: Number(subscription.monthlyFee || 0), setupFee: Number(subscription.setupFee || 0), totalDays, usedDays, remainingDays, usedPercent: Math.round((usedDays / totalDays) * 100), expired };
}

async function buildProjectSettingsState(shopId, userId) {
  const [shop, row, subscription, users] = await Promise.all([
    prisma.shop.findUnique({ where: { id: shopId } }),
    prisma.shopSettings.findUnique({ where: { shopId } }),
    prisma.subscription.findFirst({ where: { shopId }, orderBy: [{ endsAt: 'desc' }, { createdAt: 'desc' }] }),
    prisma.user.findMany({ where: { shopId }, select: { active: true, role: true } }),
  ]);
  if (!shop) throw new Error('Shop was not found');
  const settings = object(row?.settings);
  const business = merge(DEFAULTS.business, settings.business);
  const appearance = merge(DEFAULTS.appearance, settings.appearance);
  const slip = merge(DEFAULTS.slip, settings.slip);
  const api = merge(DEFAULTS.api, settings.api);
  api.googleSheets = merge(DEFAULTS.api.googleSheets, api.googleSheets);
  const system = merge(DEFAULTS.system, settings.system);
  const preferences = merge(DEFAULTS.preferences, object(settings.userPreferences)[userId]);
  return {
    ok: true,
    canManage: true,
    settingsVersion: Number(system.settingsVersion || 1),
    business: { id: shop.id, slug: shop.slug, code: shop.code || '', name: shop.name, phone: shop.phone || '', address: shop.address || '', logoUrl: shop.logoUrl || PROJECT_LOGO_URL, active: shop.active, createdAt: shop.createdAt, updatedAt: shop.updatedAt, ...business, repairPrefix: row?.repairPrefix || business.repairPrefix || '' },
    license: licenseState(subscription),
    preferences,
    appearance: { ...appearance, language: row?.language || appearance.language, theme: row?.theme || appearance.theme, currency: row?.currency || 'MMK' },
    slip: { ...slip, saleHeader: row?.receiptHeader ?? slip.saleHeader, saleFooter: row?.receiptFooter ?? slip.saleFooter, warrantyText: row?.warrantyText ?? slip.warrantyText },
    api,
    system,
    userSummary: { total: users.length, active: users.filter((item) => item.active).length, admins: users.filter((item) => item.active && item.role === 'SHOP_ADMIN').length, cashiers: users.filter((item) => item.active && item.role === 'CASHIER').length },
    database: { provider: 'PostgreSQL', connected: true, tenantScoped: true, shopId: shop.id, shopSlug: shop.slug },
  };
}

module.exports = { PROJECT_LOGO_URL, DEFAULTS, object, merge, buildProjectSettingsState };
