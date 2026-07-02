const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { z } = require('zod');
const { Prisma } = require('@prisma/client');
const { prisma } = require('./prisma');
const { requireAuth, requireRole } = require('./auth-api');
const { recordTelegramSheetSafe } = require('./telegram-sheet-recorder');

const uuid = z.string().uuid();
const ADMIN_PORTAL_SHOP_SLUG = 'mahar-admin-portal';
const HIDDEN_TENANT_SLUG_PREFIXES = ['codex-', 'browser-cors-'];
const VISIBLE_TENANT_SHOP_WHERE = {
  AND: [
    { slug: { not: ADMIN_PORTAL_SHOP_SLUG } },
    { NOT: HIDDEN_TENANT_SLUG_PREFIXES.map((prefix) => ({ slug: { startsWith: prefix } })) },
  ],
};
const VISIBLE_TENANT_USER_WHERE = {
  shopId: { not: null },
  shop: { is: VISIBLE_TENANT_SHOP_WHERE },
};

function optionalInt(min, max) {
  return z.preprocess((value) => {
    if (value === undefined || value === null || value === '') return undefined;
    return Number(value);
  }, z.number().int().min(min).max(max).optional());
}

const renewSchema = z.object({
  plan: z.enum(['1M', '3M', '1Y', 'CUSTOM']).optional(),
  months: optionalInt(1, 120),
  customDays: optionalInt(1, 1095),
  note: z.string().trim().max(300).optional(),
});
const adminPasswordResetSchema = z.object({
  password: z.string().min(6).max(200),
  reason: z.string().trim().max(300).optional(),
});

const permissionSchema = z.record(z.string(), z.boolean()).optional();
const tenantUserCreateSchema = z.object({
  username: z.string().trim().min(2).max(80),
  email: z.string().trim().email().max(180).optional(),
  password: z.string().min(6).max(200),
  name: z.string().trim().min(1).max(180),
  role: z.enum(['SHOP_ADMIN', 'CASHIER']).default('SHOP_ADMIN'),
  permissions: permissionSchema,
});

const tenantCreateSchema = z.object({
  name: z.string().trim().min(1).max(180),
  slug: z.string().trim().min(2).max(80).optional(),
  tenantId: z.string().trim().min(2).max(80).optional(),
  phone: z.string().trim().max(80).optional(),
  address: z.string().trim().max(300).optional(),
  adminName: z.string().trim().max(180).optional(),
  adminUsername: z.string().trim().min(2).max(80),
  adminEmail: z.string().trim().email().max(180).optional(),
  adminPassword: z.string().min(6).max(200),
  trialDays: optionalInt(1, 365),
});
const tenantUserUpdateSchema = z.object({
  name: z.string().trim().min(1).max(180).optional(),
  email: z.string().trim().email().max(180).optional(),
  role: z.enum(['SHOP_ADMIN', 'CASHIER']).optional(),
  permissions: permissionSchema,
  active: z.boolean().optional(),
}).refine((value) => Object.keys(value).length > 0, { message: 'At least one field is required' });

const tenantLimitsSchema = z.object({
  maxUsers: optionalInt(1, 1000),
  maxProducts: optionalInt(1, 100000),
  maxDailySales: optionalInt(1, 100000),
  maxRepairs: optionalInt(1, 100000),
  maxStorageMb: optionalInt(10, 100000),
}).optional();

const tenantSettingsSchema = z.object({
  planLabel: z.string().trim().max(80).optional(),
  supportTier: z.enum(['BASIC', 'STANDARD', 'VIP', 'CUSTOM']).optional(),
  supportNote: z.string().trim().max(1000).optional(),
  adminNote: z.string().trim().max(1200).optional(),
  billingContact: z.string().trim().max(180).optional(),
  notificationEmail: z.string().trim().max(180).optional(),
  notificationPhone: z.string().trim().max(80).optional(),
  featurePreset: z.enum(['FULL', 'SALE_HISTORY_ONLY', 'CUSTOM']).optional(),
  featureFlags: z.record(z.string(), z.boolean()).optional(),
  limits: tenantLimitsSchema,
  dataRetentionDays: optionalInt(30, 3650),
  maintenanceLocked: z.boolean().optional(),
  autoSuspendOnExpiry: z.boolean().optional(),
  allowTrialRenewal: z.boolean().optional(),
}).refine((value) => Object.keys(value).length > 0, { message: 'At least one setting is required' });

const TABS = [
  'tab.Dashboard',
  'tab.Sale POS',
  'tab.Sales History',
  'tab.Repairs',
  'tab.Partner Settlement',
  'tab.Products',
  'tab.Stock',
  'tab.Purchases',
  'tab.Customers',
  'tab.Accounting',
  'tab.Reports',
  'tab.Audit Trail',
  'tab.Backup',
  'tab.Settings',
];

const FUNCTIONS = [
  'sale',
  'history',
  'reprint',
  'export',
  'discount',
  'editSale',
  'deleteSale',
  'repairs',
  'repairCreate',
  'repairEdit',
  'repairPrint',
  'repairImport',
  'inventory',
  'stockAdjust',
  'stockHistory',
  'productEdit',
  'purchaseApprove',
  'purchaseReceive',
  'purchasePayment',
  'purchaseReturn',
  'repairParts',
  'accounting',
  'settings',
  'viewCost',
];

const SHOP_ADMIN_PERMISSIONS = {
  ...Object.fromEntries([...TABS, ...FUNCTIONS].map((key) => [key, true])),
  'tab.Audit Trail': false,
};
const CASHIER_PERMISSIONS = {
  ...Object.fromEntries([...TABS, ...FUNCTIONS].map((key) => [key, false])),
  'tab.Dashboard': true,
  'tab.Sale POS': true,
  'tab.Sales History': true,
  sale: true,
  history: true,
  reprint: true,
};

const FEATURE_FLAGS = [
  ['dashboard', 'Dashboard'],
  ['salePos', 'Sale POS'],
  ['salesHistory', 'Sales History'],
  ['products', 'Products / Catalog'],
  ['stock', 'Stock / IMEI'],
  ['purchases', 'Purchases'],
  ['repairs', 'Repairs'],
  ['repairImport', 'Repair Import'],
  ['partnerSettlement', 'Partner Settlement'],
  ['customers', 'Customers / Credit'],
  ['accounting', 'Accounting'],
  ['reports', 'Reports'],
  ['moneyService', 'Money Service'],
  ['googleSheetSync', 'Google Sheet Sync'],
  ['auditTrail', 'Audit Trail'],
  ['backup', 'Backup'],
  ['settings', 'Tenant Settings'],
  ['viewCost', 'Cost / Profit View'],
];

const TENANT_COUNT_SELECT = {
  users: true,
  products: true,
  sales: true,
  repairs: true,
  moneyServiceTransactions: true,
};

function addMonths(date, months) {
  const next = new Date(date);
  next.setMonth(next.getMonth() + months);
  return next;
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function effectiveSubscriptionStatus(subscription) {
  if (!subscription) return null;
  const ended = subscription.endsAt && subscription.endsAt < new Date();
  return ended && subscription.status !== 'SUSPENDED' ? 'OVERDUE' : subscription.status;
}

function number(value) {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value?.toNumber === 'function') return value.toNumber();
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function daysLeft(date) {
  if (!date) return null;
  return Math.ceil((new Date(date).getTime() - Date.now()) / (24 * 60 * 60 * 1000));
}

function jsonObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function defaultFeatureFlags() {
  return Object.fromEntries(FEATURE_FLAGS.map(([key]) => [key, true]));
}

function serializeAdminSettings(record) {
  const settings = jsonObject(record?.settings);
  const adminPortal = jsonObject(settings.adminPortal);
  return {
    planLabel: adminPortal.planLabel || '',
    supportTier: adminPortal.supportTier || 'STANDARD',
    supportNote: adminPortal.supportNote || '',
    adminNote: adminPortal.adminNote || '',
    billingContact: adminPortal.billingContact || '',
    notificationEmail: adminPortal.notificationEmail || '',
    notificationPhone: adminPortal.notificationPhone || '',
    featurePreset: adminPortal.featurePreset || 'FULL',
    featureFlags: { ...defaultFeatureFlags(), ...jsonObject(adminPortal.featureFlags) },
    limits: { ...jsonObject(adminPortal.limits) },
    dataRetentionDays: Number.isInteger(adminPortal.dataRetentionDays) ? adminPortal.dataRetentionDays : 365,
    maintenanceLocked: adminPortal.maintenanceLocked === true,
    autoSuspendOnExpiry: adminPortal.autoSuspendOnExpiry !== false,
    allowTrialRenewal: adminPortal.allowTrialRenewal !== false,
    updatedAt: adminPortal.updatedAt || null,
  };
}

function mergeAdminSettings(existing, input) {
  const next = {
    ...existing,
    featureFlags: { ...defaultFeatureFlags(), ...jsonObject(existing.featureFlags) },
    limits: { ...jsonObject(existing.limits) },
  };
  for (const key of [
    'planLabel',
    'supportTier',
    'supportNote',
    'adminNote',
    'billingContact',
    'notificationEmail',
    'notificationPhone',
    'featurePreset',
    'dataRetentionDays',
    'maintenanceLocked',
    'autoSuspendOnExpiry',
    'allowTrialRenewal',
  ]) {
    if (input[key] !== undefined) next[key] = input[key];
  }
  if (input.featureFlags) next.featureFlags = { ...next.featureFlags, ...input.featureFlags };
  if (input.limits) next.limits = { ...next.limits, ...input.limits };
  next.updatedAt = new Date().toISOString();
  return next;
}

function subscriptionMetrics(subscription) {
  const remaining = daysLeft(subscription?.endsAt);
  return {
    daysLeft: remaining,
    endingSoon: remaining !== null && remaining >= 0 && remaining <= 7,
  };
}

function planFromNotes(notes) {
  const match = String(notes || '').match(/(?:^|;) *PLAN=([^;]+)/i);
  return match?.[1]?.toUpperCase() || null;
}

function normalizeRenewPlan(input) {
  if (input.plan) return input.plan;
  if (input.months === 3) return '3M';
  if (input.months === 12) return '1Y';
  if (input.months && input.months !== 1) return 'CUSTOM';
  return '1M';
}

function resolveRenewDuration(input, base) {
  const plan = normalizeRenewPlan(input);
  if (plan === '1M') return { plan, months: 1, label: '1 month', endsAt: addMonths(base, 1) };
  if (plan === '3M') return { plan, months: 3, label: '3 months', endsAt: addMonths(base, 3) };
  if (plan === '1Y') return { plan, months: 12, label: '1 year', endsAt: addMonths(base, 12) };

  if (input.customDays) {
    return {
      plan: 'CUSTOM',
      customDays: input.customDays,
      label: `${input.customDays} day(s)`,
      endsAt: addDays(base, input.customDays),
    };
  }

  const months = input.months || 1;
  return { plan: 'CUSTOM', months, label: `${months} month(s)`, endsAt: addMonths(base, months) };
}

function serializeSubscription(subscription) {
  if (!subscription) return null;
  const status = effectiveSubscriptionStatus(subscription);
  const metrics = subscriptionMetrics(subscription);
  return {
    id: subscription.id,
    status,
    storedStatus: subscription.status,
    setupFee: number(subscription.setupFee),
    monthlyFee: number(subscription.monthlyFee),
    startsAt: subscription.startsAt,
    endsAt: subscription.endsAt,
    renewedAt: subscription.renewedAt,
    notes: subscription.notes || '',
    plan: planFromNotes(subscription.notes),
    daysLeft: metrics.daysLeft,
    endingSoon: metrics.endingSoon,
    expired: status === 'OVERDUE',
    accessMode: status === 'OVERDUE' ? 'SALE_HISTORY_ONLY' : 'FULL',
  };
}

function serializeTenant(shop) {
  const subscription = shop.subscriptions?.[0] || null;
  return {
    id: shop.id,
    tenantId: shop.code || shop.slug,
    slug: shop.slug,
    code: shop.code || null,
    name: shop.name,
    phone: shop.phone || '',
    address: shop.address || '',
    active: shop.active,
    createdAt: shop.createdAt,
    updatedAt: shop.updatedAt,
    subscription: serializeSubscription(subscription),
    settings: serializeAdminSettings(shop.settings),
    counts: {
      users: shop._count?.users || 0,
      products: shop._count?.products || 0,
      sales: shop._count?.sales || 0,
      repairs: shop._count?.repairs || 0,
      moneyServiceTransactions: shop._count?.moneyServiceTransactions || 0,
    },
  };
}

function defaultPermissions(role) {
  return role === 'SHOP_ADMIN' ? SHOP_ADMIN_PERMISSIONS : CASHIER_PERMISSIONS;
}

function normalizeSlug(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeTenantCode(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeUsername(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeEmail(value) {
  const email = normalizeUsername(value);
  return email && email.includes('@') ? email : null;
}

function emailForUserInput(input) {
  return normalizeEmail(input.email) || normalizeEmail(input.username);
}

function sanitizePermissions(permissions, role) {
  const next = { ...(permissions || defaultPermissions(role)) };
  if (role !== 'SUPER_ADMIN') next['tab.Audit Trail'] = false;
  if (role === 'SHOP_ADMIN') next['tab.Settings'] = true;
  return next;
}

function permissionsForUser(user) {
  return sanitizePermissions({ ...defaultPermissions(user.role), ...(user.permissions || {}) }, user.role);
}

function serializeTenantUser(user) {
  return {
    id: user.id,
    shopId: user.shopId,
    email: user.email || null,
    username: user.username,
    name: user.name,
    avatarUrl: user.avatarUrl || null,
    provider: user.authProvider || null,
    role: user.role,
    permissions: permissionsForUser(user),
    active: user.active,
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

async function writeTenantAudit(req, shopId, action, details = {}) {
  try {
    await prisma.auditLog.create({
      data: {
        shopId,
        userId: req.auth?.userId || null,
        action,
        entityType: 'tenant',
        entityId: shopId,
        details,
        ipAddress: req.ip || null,
        userAgent: req.headers?.['user-agent'] || null,
      },
    });
  } catch (error) {
    console.warn('Tenant lifecycle audit failed:', error.message);
  }
}

function parseBody(schema, body, res, message) {
  const parsed = schema.safeParse(body || {});
  if (!parsed.success) {
    res.status(400).json({ ok: false, message, errors: parsed.error.flatten().fieldErrors });
    return null;
  }
  return parsed.data;
}

async function activeAdminCount(tx, shopId) {
  return tx.user.count({ where: { shopId, role: 'SHOP_ADMIN', active: true } });
}

async function tenantUserDependencyCounts(tx, shopId, userId) {
  const [
    sales,
    saleApprovals,
    repairs,
    repairPayments,
    repairStatusChanges,
    stockMovements,
    moneyServiceTransactions,
    auditLogs,
    appNotifications,
    pushTokens,
  ] = await Promise.all([
    tx.sale.count({ where: { shopId, userId } }),
    tx.saleItem.count({ where: { shopId, approvedById: userId } }),
    tx.repair.count({ where: { shopId, technicianId: userId } }),
    tx.repairPayment.count({ where: { shopId, receivedById: userId } }),
    tx.repairStatusHistory.count({ where: { shopId, changedById: userId } }),
    tx.stockMovement.count({ where: { shopId, userId } }),
    tx.moneyServiceTransaction.count({ where: { shopId, userId } }),
    tx.auditLog.count({ where: { shopId, userId } }),
    tx.appNotification.count({ where: { shopId, userId } }),
    tx.userPushToken.count({ where: { shopId, userId } }),
  ]);
  return {
    sales,
    saleApprovals,
    repairs,
    repairPayments,
    repairStatusChanges,
    stockMovements,
    moneyServiceTransactions,
    auditLogs,
    appNotifications,
    pushTokens,
  };
}

function hasHistoricalUserDependencies(counts) {
  return Object.entries(counts || {})
    .some(([key, count]) => key !== 'appNotifications' && key !== 'pushTokens' && Number(count || 0) > 0);
}

function deletedUsername(userId) {
  return `deleted-${String(userId || '').slice(0, 8)}-${Date.now()}`;
}

function generatedTenantId() {
  return `MS-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

function isHiddenTenantSlug(slug) {
  const value = normalizeSlug(slug);
  return value === ADMIN_PORTAL_SHOP_SLUG || HIDDEN_TENANT_SLUG_PREFIXES.some((prefix) => value.startsWith(prefix));
}

async function uniqueTenantId(tx = prisma) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = generatedTenantId();
    const existing = await tx.shop.findUnique({ where: { code }, select: { id: true } });
    if (!existing) return code;
  }
  throw new Error('Could not generate a tenant ID. Please try again.');
}

async function uniqueShopSlug(base, tx = prisma) {
  const normalizedBase = normalizeSlug(base) || `shop-${crypto.randomBytes(2).toString('hex')}`;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const slug = attempt === 0 ? normalizedBase : `${normalizedBase}-${attempt + 1}`;
    const existing = await tx.shop.findUnique({ where: { slug }, select: { id: true } });
    if (!existing) return slug;
  }
  return `${normalizedBase}-${crypto.randomBytes(2).toString('hex')}`;
}

function monthBuckets(count = 12) {
  const now = new Date();
  const currentMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  return Array.from({ length: count }, (_unused, index) => {
    const date = new Date(currentMonth);
    date.setUTCMonth(currentMonth.getUTCMonth() - (count - index - 1));
    const next = new Date(date);
    next.setUTCMonth(date.getUTCMonth() + 1);
    return {
      key: date.toISOString().slice(0, 7),
      label: date.toLocaleString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' }),
      start: date,
      end: next,
      revenue: 0,
      profit: 0,
      sales: 0,
    };
  });
}

function summarizeDistribution(rows, pickKey) {
  const counts = new Map();
  for (const row of rows) {
    const key = pickKey(row) || 'UNKNOWN';
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()].map(([label, value]) => ({ label, value }));
}

function serializeAuditLog(log) {
  return {
    id: log.id,
    action: log.action,
    entityType: log.entityType || '',
    entityId: log.entityId || '',
    details: log.details || {},
    createdAt: log.createdAt,
    shop: log.shop ? {
      id: log.shop.id,
      name: log.shop.name,
      tenantId: log.shop.code || log.shop.slug,
      slug: log.shop.slug,
    } : null,
    user: log.user ? {
      id: log.user.id,
      username: log.user.username,
      name: log.user.name,
      role: log.user.role,
    } : null,
  };
}

async function findTenantForAdmin(shopId, options = {}) {
  return prisma.shop.findFirst({
    where: { id: shopId, ...VISIBLE_TENANT_SHOP_WHERE },
    include: {
      settings: true,
      subscriptions: {
        orderBy: { endsAt: 'desc' },
        take: options.subscriptionLimit || 1,
      },
      _count: { select: TENANT_COUNT_SELECT },
    },
  });
}

function attachTenantLifecycleApi(app) {
  const superAdminOnly = [requireAuth, requireRole('SUPER_ADMIN')];

  app.get('/api/admin/overview', ...superAdminOnly, async (_req, res) => {
    try {
      const now = new Date();
      const nextSevenDays = addDays(now, 7);
      const buckets = monthBuckets(12);
      const startDate = buckets[0]?.start || addMonths(now, -11);

      const [
        shops,
        salesAggregate,
        monthlySales,
        repairsAggregate,
        moneyAggregate,
        activeUsers,
        customersTotal,
        productVariantsTotal,
        lowStockTotal,
        auditLogs,
      ] = await Promise.all([
        prisma.shop.findMany({
          where: VISIBLE_TENANT_SHOP_WHERE,
          orderBy: { createdAt: 'desc' },
          include: {
            settings: true,
            subscriptions: { orderBy: { endsAt: 'desc' }, take: 1 },
            _count: { select: TENANT_COUNT_SELECT },
          },
        }),
        prisma.sale.aggregate({
          where: { status: { not: 'VOIDED' } },
          _count: { _all: true },
          _sum: { total: true, profitTotal: true },
        }),
        prisma.sale.findMany({
          where: { status: { not: 'VOIDED' }, soldAt: { gte: startDate } },
          select: { shopId: true, soldAt: true, total: true, profitTotal: true },
          orderBy: { soldAt: 'asc' },
        }),
        prisma.repair.aggregate({
          _count: { _all: true },
          _sum: { finalCost: true, deposit: true },
        }),
        prisma.moneyServiceTransaction.aggregate({
          _count: { _all: true },
          _sum: { serviceProfit: true, feeAmount: true },
        }),
        prisma.user.count({ where: { ...VISIBLE_TENANT_USER_WHERE, active: true } }),
        prisma.customer.count(),
        prisma.productVariant.count(),
        prisma.inventoryBalance.count({ where: { quantity: { lte: 0 } } }),
        prisma.auditLog.findMany({
          orderBy: { createdAt: 'desc' },
          take: 12,
          include: {
            shop: { select: { id: true, name: true, code: true, slug: true } },
            user: { select: { id: true, username: true, name: true, role: true } },
          },
        }),
      ]);

      const tenants = shops.map(serializeTenant);
      const monthlyByKey = new Map(buckets.map((bucket) => [bucket.key, { ...bucket }]));
      const salesByShop = new Map();
      for (const sale of monthlySales) {
        const key = new Date(sale.soldAt).toISOString().slice(0, 7);
        const bucket = monthlyByKey.get(key);
        if (bucket) {
          bucket.revenue += number(sale.total);
          bucket.profit += number(sale.profitTotal);
          bucket.sales += 1;
        }
        const shopSummary = salesByShop.get(sale.shopId) || { revenue: 0, profit: 0, sales: 0 };
        shopSummary.revenue += number(sale.total);
        shopSummary.profit += number(sale.profitTotal);
        shopSummary.sales += 1;
        salesByShop.set(sale.shopId, shopSummary);
      }

      const statusDistribution = summarizeDistribution(tenants, (tenant) => (
        tenant.active ? tenant.subscription?.status || 'NO_SUBSCRIPTION' : 'INACTIVE'
      ));
      const planDistribution = summarizeDistribution(tenants, (tenant) => (
        tenant.settings?.planLabel || tenant.subscription?.plan || tenant.subscription?.status || 'NO_PLAN'
      ));
      const expiringTenants = tenants
        .filter((tenant) => tenant.subscription?.endsAt && new Date(tenant.subscription.endsAt) >= now && new Date(tenant.subscription.endsAt) <= nextSevenDays)
        .sort((a, b) => new Date(a.subscription.endsAt) - new Date(b.subscription.endsAt))
        .slice(0, 12);
      const topTenants = tenants
        .map((tenant) => ({ ...tenant, revenue: salesByShop.get(tenant.id)?.revenue || 0, profit: salesByShop.get(tenant.id)?.profit || 0 }))
        .sort((a, b) => b.revenue - a.revenue || b.counts.sales - a.counts.sales)
        .slice(0, 8);

      res.json({
        ok: true,
        generatedAt: now,
        featureFlags: FEATURE_FLAGS.map(([key, label]) => ({ key, label })),
        summary: {
          totalTenants: tenants.length,
          activeTenants: tenants.filter((tenant) => tenant.active).length,
          inactiveTenants: tenants.filter((tenant) => !tenant.active).length,
          trialTenants: tenants.filter((tenant) => tenant.subscription?.status === 'TRIAL').length,
          overdueTenants: tenants.filter((tenant) => tenant.subscription?.status === 'OVERDUE').length,
          suspendedTenants: tenants.filter((tenant) => tenant.subscription?.status === 'SUSPENDED' || !tenant.active).length,
          expiringInSevenDays: expiringTenants.length,
          activeUsers,
          customersTotal,
          productsTotal: shops.reduce((sum, shop) => sum + (shop._count?.products || 0), 0),
          productVariantsTotal,
          lowStockTotal,
          salesTotal: salesAggregate._count?._all || 0,
          repairsTotal: repairsAggregate._count?._all || 0,
          moneyServiceTransactionsTotal: moneyAggregate._count?._all || 0,
          salesRevenue: number(salesAggregate._sum?.total),
          salesProfit: number(salesAggregate._sum?.profitTotal),
          repairRevenue: number(repairsAggregate._sum?.finalCost),
          repairDeposits: number(repairsAggregate._sum?.deposit),
          moneyServiceProfit: number(moneyAggregate._sum?.serviceProfit),
          moneyServiceFees: number(moneyAggregate._sum?.feeAmount),
        },
        monthlyRevenue: [...monthlyByKey.values()],
        statusDistribution,
        planDistribution,
        expiringTenants,
        recentTenants: tenants.slice(0, 8),
        topTenants,
        recentActivity: auditLogs.map(serializeAuditLog),
      });
    } catch (error) {
      res.status(500).json({ ok: false, message: error.message || 'Admin overview failed' });
    }
  });

  app.get('/api/admin/tenants', ...superAdminOnly, async (_req, res) => {
    try {
      const shops = await prisma.shop.findMany({
        where: VISIBLE_TENANT_SHOP_WHERE,
        orderBy: { createdAt: 'desc' },
        include: {
          settings: true,
          subscriptions: { orderBy: { endsAt: 'desc' }, take: 1 },
          _count: { select: TENANT_COUNT_SELECT },
        },
      });
      res.json({ ok: true, tenants: shops.map(serializeTenant) });
    } catch (error) {
      res.status(500).json({ ok: false, message: error.message || 'Tenant list failed' });
    }
  });

  app.post('/api/admin/tenants', ...superAdminOnly, async (req, res) => {
    const input = parseBody(tenantCreateSchema, req.body, res, 'Invalid tenant create request');
    if (!input) return;

    try {
      const now = new Date();
      const trialDays = input.trialDays || 7;
      const created = await prisma.$transaction(async (tx) => {
        const slug = await uniqueShopSlug(input.slug || input.name, tx);
        if (isHiddenTenantSlug(slug)) {
          const error = new Error('This tenant slug is reserved for system/test tenants');
          error.status = 400;
          throw error;
        }

        const requestedCode = normalizeTenantCode(input.tenantId);
        if (requestedCode) {
          const existingCode = await tx.shop.findUnique({ where: { code: requestedCode }, select: { id: true } });
          if (existingCode) {
            const error = new Error('Tenant ID already exists');
            error.status = 409;
            throw error;
          }
        }
        const code = requestedCode || await uniqueTenantId(tx);
        const adminUsername = input.adminUsername.trim();
        const adminEmail = normalizeEmail(input.adminEmail) || emailForUserInput({ username: adminUsername });
        const adminPasswordHash = await bcrypt.hash(input.adminPassword, 12);

        return tx.shop.create({
          data: {
            slug,
            code,
            name: input.name.trim(),
            phone: input.phone?.trim() || null,
            address: input.address?.trim() || null,
            active: true,
            settings: {
              create: {
                settings: {
                  adminPortal: {
                    planLabel: '7 Day Trial',
                    supportTier: 'STANDARD',
                    featurePreset: 'FULL',
                    featureFlags: defaultFeatureFlags(),
                    allowTrialRenewal: true,
                    createdBySuperAdmin: true,
                  },
                },
              },
            },
            subscriptions: {
              create: {
                status: 'TRIAL',
                startsAt: now,
                endsAt: addDays(now, trialDays),
                notes: `PLAN=TRIAL;CREATED_BY=SUPER_ADMIN;TRIAL_DAYS=${trialDays}`,
              },
            },
            users: {
              create: {
                email: adminEmail,
                username: adminUsername,
                normalizedUsername: normalizeUsername(adminUsername),
                passwordHash: adminPasswordHash,
                name: input.adminName?.trim() || `${input.name.trim()} Admin`,
                role: 'SHOP_ADMIN',
                permissions: SHOP_ADMIN_PERMISSIONS,
                active: true,
                authProvider: 'password',
              },
            },
          },
          include: {
            settings: true,
            subscriptions: { orderBy: { endsAt: 'desc' }, take: 1 },
            _count: { select: TENANT_COUNT_SELECT },
          },
        });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

      await writeTenantAudit(req, created.id, 'TENANT_CREATED_BY_SUPER_ADMIN', {
        tenantId: created.code || created.slug,
        slug: created.slug,
        trialDays,
        active: created.active,
      });
      res.status(201).json({ ok: true, tenant: serializeTenant(created) });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return res.status(409).json({ ok: false, message: 'Tenant slug, Tenant ID, username, or email already exists' });
      }
      res.status(error.status || 500).json({ ok: false, message: error.message || 'Tenant create failed' });
    }
  });

  app.delete('/api/admin/tenants/:shopId', ...superAdminOnly, async (req, res) => {
    const shopId = req.params.shopId;
    if (!uuid.safeParse(shopId).success) return res.status(400).json({ ok: false, message: 'Invalid tenant id' });

    try {
      const deleted = await prisma.$transaction(async (tx) => {
        const shop = await tx.shop.findFirst({
          where: { id: shopId, ...VISIBLE_TENANT_SHOP_WHERE },
          include: {
            settings: true,
            subscriptions: { orderBy: { endsAt: 'desc' }, take: 1 },
            _count: { select: TENANT_COUNT_SELECT },
          },
        });
        if (!shop) return null;
        if (shop.active) {
          const error = new Error('Active tenant cannot be deleted. Suspend/deactivate it first, then delete.');
          error.status = 409;
          throw error;
        }

        if (tx.adminAuditLog?.create) {
          await tx.adminAuditLog.create({
            data: {
              adminUserId: req.auth?.userId || null,
              action: 'TENANT_DELETED',
              resourceType: 'pos_tenant',
              resourceId: shop.id,
              metadataJson: {
                tenantId: shop.code || shop.slug,
                slug: shop.slug,
                name: shop.name,
                active: shop.active,
                counts: shop._count || {},
              },
              ipAddress: req.ip || null,
              userAgent: req.headers?.['user-agent'] || null,
            },
          });
        }
        await tx.shop.delete({ where: { id: shop.id } });
        return shop;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

      if (!deleted) return res.status(404).json({ ok: false, message: 'Tenant not found' });
      res.json({
        ok: true,
        mode: 'hard_deleted',
        message: `Tenant ${deleted.name} permanently deleted`,
        tenant: serializeTenant(deleted),
      });
    } catch (error) {
      res.status(error.status || 500).json({ ok: false, message: error.message || 'Tenant delete failed' });
    }
  });

  app.get('/api/admin/tenants/:shopId/detail', ...superAdminOnly, async (req, res) => {
    const shopId = req.params.shopId;
    if (!uuid.safeParse(shopId).success) return res.status(400).json({ ok: false, message: 'Invalid tenant id' });

    try {
      const shop = await findTenantForAdmin(shopId, { subscriptionLimit: 12 });
      if (!shop) return res.status(404).json({ ok: false, message: 'Tenant not found' });

      const [
        users,
        salesAggregate,
        repairAggregate,
        moneyAggregate,
        recentSales,
        recentRepairs,
        recentActivity,
      ] = await Promise.all([
        prisma.user.findMany({
          where: { shopId },
          select: {
            id: true,
            shopId: true,
            email: true,
            username: true,
            name: true,
            avatarUrl: true,
            authProvider: true,
            role: true,
            permissions: true,
            active: true,
            lastLoginAt: true,
            createdAt: true,
            updatedAt: true,
          },
          orderBy: [{ active: 'desc' }, { role: 'asc' }, { createdAt: 'asc' }],
        }),
        prisma.sale.aggregate({
          where: { shopId, status: { not: 'VOIDED' } },
          _count: { _all: true },
          _sum: { total: true, profitTotal: true, discount: true },
        }),
        prisma.repair.aggregate({
          where: { shopId },
          _count: { _all: true },
          _sum: { finalCost: true, deposit: true },
        }),
        prisma.moneyServiceTransaction.aggregate({
          where: { shopId },
          _count: { _all: true },
          _sum: { serviceProfit: true, feeAmount: true },
        }),
        prisma.sale.findMany({
          where: { shopId },
          orderBy: { soldAt: 'desc' },
          take: 8,
          select: {
            id: true,
            invoiceNumber: true,
            status: true,
            paymentStatus: true,
            total: true,
            profitTotal: true,
            soldAt: true,
          },
        }),
        prisma.repair.findMany({
          where: { shopId },
          orderBy: { receivedAt: 'desc' },
          take: 8,
          select: {
            id: true,
            repairNumber: true,
            customerName: true,
            deviceBrand: true,
            deviceModel: true,
            status: true,
            paymentStatus: true,
            finalCost: true,
            receivedAt: true,
          },
        }),
        prisma.auditLog.findMany({
          where: { shopId },
          orderBy: { createdAt: 'desc' },
          take: 12,
          include: {
            shop: { select: { id: true, name: true, code: true, slug: true } },
            user: { select: { id: true, username: true, name: true, role: true } },
          },
        }),
      ]);

      res.json({
        ok: true,
        tenant: serializeTenant(shop),
        subscriptions: shop.subscriptions.map(serializeSubscription),
        settings: serializeAdminSettings(shop.settings),
        users: users.map(serializeTenantUser),
        financials: {
          salesCount: salesAggregate._count?._all || 0,
          salesRevenue: number(salesAggregate._sum?.total),
          salesProfit: number(salesAggregate._sum?.profitTotal),
          salesDiscount: number(salesAggregate._sum?.discount),
          repairCount: repairAggregate._count?._all || 0,
          repairRevenue: number(repairAggregate._sum?.finalCost),
          repairDeposits: number(repairAggregate._sum?.deposit),
          moneyServiceCount: moneyAggregate._count?._all || 0,
          moneyServiceProfit: number(moneyAggregate._sum?.serviceProfit),
          moneyServiceFees: number(moneyAggregate._sum?.feeAmount),
        },
        recentSales: recentSales.map((sale) => ({
          ...sale,
          total: number(sale.total),
          profitTotal: number(sale.profitTotal),
        })),
        recentRepairs: recentRepairs.map((repair) => ({
          ...repair,
          finalCost: number(repair.finalCost),
        })),
        recentActivity: recentActivity.map(serializeAuditLog),
        featureFlags: FEATURE_FLAGS.map(([key, label]) => ({ key, label })),
      });
    } catch (error) {
      res.status(500).json({ ok: false, message: error.message || 'Tenant detail failed' });
    }
  });

  app.get('/api/admin/tenants/:shopId/settings', ...superAdminOnly, async (req, res) => {
    const shopId = req.params.shopId;
    if (!uuid.safeParse(shopId).success) return res.status(400).json({ ok: false, message: 'Invalid tenant id' });

    try {
      const shop = await findTenantForAdmin(shopId);
      if (!shop) return res.status(404).json({ ok: false, message: 'Tenant not found' });
      res.json({
        ok: true,
        tenant: serializeTenant(shop),
        settings: serializeAdminSettings(shop.settings),
        featureFlags: FEATURE_FLAGS.map(([key, label]) => ({ key, label })),
      });
    } catch (error) {
      res.status(500).json({ ok: false, message: error.message || 'Tenant settings load failed' });
    }
  });

  app.patch('/api/admin/tenants/:shopId/settings', ...superAdminOnly, async (req, res) => {
    const shopId = req.params.shopId;
    if (!uuid.safeParse(shopId).success) return res.status(400).json({ ok: false, message: 'Invalid tenant id' });

    const input = parseBody(tenantSettingsSchema, req.body, res, 'Invalid tenant settings request');
    if (!input) return;

    try {
      const result = await prisma.$transaction(async (tx) => {
        const shop = await tx.shop.findUnique({ where: { id: shopId }, select: { id: true, name: true } });
        if (!shop) return null;

        const current = await tx.shopSettings.findUnique({ where: { shopId } });
        const rawSettings = jsonObject(current?.settings);
        const nextAdminSettings = mergeAdminSettings(serializeAdminSettings(current), input);
        const settings = {
          ...rawSettings,
          adminPortal: nextAdminSettings,
        };

        const saved = await tx.shopSettings.upsert({
          where: { shopId },
          create: {
            shopId,
            receiptHeader: shop.name,
            settings,
          },
          update: { settings },
        });

        const refreshed = await tx.shop.findUnique({
          where: { id: shopId },
          include: {
            settings: true,
            subscriptions: { orderBy: { endsAt: 'desc' }, take: 1 },
            _count: { select: TENANT_COUNT_SELECT },
          },
        });

        return { saved, shop: refreshed };
      });

      if (!result) return res.status(404).json({ ok: false, message: 'Tenant not found' });
      await writeTenantAudit(req, shopId, 'TENANT_ADMIN_SETTINGS_UPDATED', {
        changedFields: Object.keys(input),
      });
      res.json({
        ok: true,
        tenant: serializeTenant(result.shop),
        settings: serializeAdminSettings(result.saved),
      });
    } catch (error) {
      res.status(500).json({ ok: false, message: error.message || 'Tenant settings update failed' });
    }
  });

  app.post('/api/admin/tenants/:shopId/renew', ...superAdminOnly, async (req, res) => {
    const shopId = req.params.shopId;
    if (!uuid.safeParse(shopId).success) return res.status(400).json({ ok: false, message: 'Invalid tenant id' });

    const input = parseBody(renewSchema, req.body, res, 'Invalid renew request');
    if (!input) return;

    try {
      const result = await prisma.$transaction(async (tx) => {
        const shop = await tx.shop.findUnique({
          where: { id: shopId },
          include: { subscriptions: { orderBy: { endsAt: 'desc' }, take: 1 } },
        });
        if (!shop) return null;

        const now = new Date();
        const current = shop.subscriptions?.[0] || null;
        const base = current?.endsAt && current.endsAt > now ? current.endsAt : now;
        const duration = resolveRenewDuration(input, base);
        const notes = `PLAN=${duration.plan}; Renewed for ${duration.label}${input.note ? `; ${input.note}` : ''}`;
        const previousEndsAt = current?.endsAt || null;

        const subscription = current
          ? await tx.subscription.update({
              where: { id: current.id },
              data: { status: 'ACTIVE', endsAt: duration.endsAt, renewedAt: now, notes },
            })
          : await tx.subscription.create({
              data: { shopId, status: 'ACTIVE', startsAt: now, endsAt: duration.endsAt, renewedAt: now, notes },
            });

        const renewalRecord = await tx.adminRenewalHistory.create({
          data: {
            productSlug: 'mahar_pos_web',
            shopId,
            tenantId: shop.code || shop.slug,
            shopName: shop.name,
            subscriptionId: subscription.id,
            plan: duration.plan,
            months: duration.months || null,
            customDays: duration.customDays || null,
            durationLabel: duration.label,
            previousEndsAt,
            startsAt: subscription.startsAt,
            newEndsAt: subscription.endsAt,
            note: input.note || null,
            renewedBy: req.auth?.userId || null,
            metadataJson: {
              requestPlan: input.plan || null,
              requestMonths: input.months || null,
              requestCustomDays: input.customDays || null,
              baseAt: base,
              renewedAt: now,
            },
          },
        });

        await tx.adminAuditLog.create({
          data: {
            adminUserId: req.auth?.userId || null,
            action: 'TENANT_RENEWED',
            resourceType: 'pos_tenant',
            resourceId: shopId,
            metadataJson: {
              shopName: shop.name,
              tenantId: shop.code || shop.slug,
              subscriptionId: subscription.id,
              renewalHistoryId: renewalRecord.id,
              plan: duration.plan,
              months: duration.months || null,
              customDays: duration.customDays || null,
              previousEndsAt,
              newEndsAt: subscription.endsAt,
            },
            ipAddress: req.ip || null,
            userAgent: req.headers?.['user-agent'] || null,
          },
        });

        const updatedShop = await tx.shop.update({
          where: { id: shopId },
          data: { active: true },
          include: {
            settings: true,
            subscriptions: { orderBy: { endsAt: 'desc' }, take: 1 },
            _count: { select: TENANT_COUNT_SELECT },
          },
        });

        return { shop: updatedShop, subscription, duration, renewalRecord };
      });

      if (!result) return res.status(404).json({ ok: false, message: 'Tenant not found' });
      await writeTenantAudit(req, shopId, 'TENANT_RENEWED', {
        plan: result.duration.plan,
        months: result.duration.months || null,
        customDays: result.duration.customDays || null,
        subscriptionId: result.subscription.id,
        endsAt: result.subscription.endsAt,
      });
      recordTelegramSheetSafe('tenant_renewal', {
        productSlug: 'mahar_pos_web',
        renewalHistoryId: result.renewalRecord?.id || null,
        shopId,
        tenantId: result.shop.code || result.shop.slug,
        shopName: result.shop.name,
        subscriptionId: result.subscription.id,
        plan: result.duration.plan,
        months: result.duration.months || null,
        customDays: result.duration.customDays || null,
        durationLabel: result.duration.label,
        newEndsAt: result.subscription.endsAt,
        renewedBy: req.auth?.userId || null,
      }).catch((sheetError) => console.warn('Telegram sheet record failed:', sheetError.message));
      res.json({ ok: true, tenant: serializeTenant(result.shop), renewalHistoryId: result.renewalRecord?.id || null });
    } catch (error) {
      res.status(500).json({ ok: false, message: error.message || 'Tenant renew failed' });
    }
  });

  app.post('/api/admin/tenants/:shopId/suspend', ...superAdminOnly, async (req, res) => {
    const shopId = req.params.shopId;
    if (!uuid.safeParse(shopId).success) return res.status(400).json({ ok: false, message: 'Invalid tenant id' });
    try {
      const shop = await prisma.shop.update({
        where: { id: shopId },
        data: { active: false },
        include: { settings: true, subscriptions: { orderBy: { endsAt: 'desc' }, take: 1 }, _count: { select: TENANT_COUNT_SELECT } },
      });
      await writeTenantAudit(req, shopId, 'TENANT_SUSPENDED');
      res.json({ ok: true, tenant: serializeTenant(shop) });
    } catch (error) {
      res.status(500).json({ ok: false, message: error.message || 'Tenant suspend failed' });
    }
  });

  app.post('/api/admin/tenants/:shopId/activate', ...superAdminOnly, async (req, res) => {
    const shopId = req.params.shopId;
    if (!uuid.safeParse(shopId).success) return res.status(400).json({ ok: false, message: 'Invalid tenant id' });
    try {
      const shop = await prisma.shop.update({
        where: { id: shopId },
        data: { active: true },
        include: { settings: true, subscriptions: { orderBy: { endsAt: 'desc' }, take: 1 }, _count: { select: TENANT_COUNT_SELECT } },
      });
      await writeTenantAudit(req, shopId, 'TENANT_ACTIVATED');
      res.json({ ok: true, tenant: serializeTenant(shop) });
    } catch (error) {
      res.status(500).json({ ok: false, message: error.message || 'Tenant activate failed' });
    }
  });

  app.get('/api/admin/tenants/:shopId/users', ...superAdminOnly, async (req, res) => {
    const shopId = req.params.shopId;
    if (!uuid.safeParse(shopId).success) return res.status(400).json({ ok: false, message: 'Invalid tenant id' });
    try {
      const shop = await prisma.shop.findUnique({
        where: { id: shopId },
        include: {
          settings: true,
          subscriptions: { orderBy: { endsAt: 'desc' }, take: 1 },
          _count: { select: TENANT_COUNT_SELECT },
        },
      });
      if (!shop) return res.status(404).json({ ok: false, message: 'Tenant not found' });

      const users = await prisma.user.findMany({
        where: { shopId },
          select: {
            id: true,
            shopId: true,
            email: true,
            username: true,
            name: true,
            avatarUrl: true,
            authProvider: true,
            role: true,
            permissions: true,
          active: true,
          lastLoginAt: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: [{ active: 'desc' }, { role: 'asc' }, { createdAt: 'asc' }],
      });

      res.json({ ok: true, tenant: serializeTenant(shop), users: users.map(serializeTenantUser) });
    } catch (error) {
      res.status(500).json({ ok: false, message: error.message || 'Tenant users load failed' });
    }
  });

  app.post('/api/admin/tenants/:shopId/users', ...superAdminOnly, async (req, res) => {
    const shopId = req.params.shopId;
    if (!uuid.safeParse(shopId).success) return res.status(400).json({ ok: false, message: 'Invalid tenant id' });

    const input = parseBody(tenantUserCreateSchema, req.body, res, 'Invalid user create request');
    if (!input) return;

    try {
      const created = await prisma.$transaction(async (tx) => {
        const shop = await tx.shop.findUnique({ where: { id: shopId }, select: { id: true } });
        if (!shop) return null;

        const role = input.role || 'SHOP_ADMIN';
        const user = await tx.user.create({
          data: {
            shopId,
            email: emailForUserInput(input),
            username: input.username.trim(),
            normalizedUsername: normalizeUsername(input.username),
            passwordHash: await bcrypt.hash(input.password, 12),
            name: input.name.trim(),
            role,
            permissions: sanitizePermissions(input.permissions || defaultPermissions(role), role),
            active: true,
          },
        });
        return user;
      });

      if (!created) return res.status(404).json({ ok: false, message: 'Tenant not found' });
      await writeTenantAudit(req, shopId, 'TENANT_USER_CREATED', {
        userId: created.id,
        role: created.role,
        username: created.username,
      });
      res.status(201).json({ ok: true, user: serializeTenantUser(created) });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return res.status(409).json({ ok: false, message: 'Username or email already exists' });
      }
      res.status(500).json({ ok: false, message: error.message || 'Tenant user create failed' });
    }
  });

  app.patch('/api/admin/tenants/:shopId/users/:userId', ...superAdminOnly, async (req, res) => {
    const shopId = req.params.shopId;
    const userId = req.params.userId;
    if (!uuid.safeParse(shopId).success || !uuid.safeParse(userId).success) {
      return res.status(400).json({ ok: false, message: 'Invalid tenant or user id' });
    }

    const input = parseBody(tenantUserUpdateSchema, req.body, res, 'Invalid user access request');
    if (!input) return;

    try {
      const updated = await prisma.$transaction(async (tx) => {
        const existing = await tx.user.findFirst({ where: { id: userId, shopId } });
        if (!existing) return null;

        const nextRole = input.role || existing.role;
        const nextActive = input.active === undefined ? existing.active : input.active;
        const leavesNoActiveShopAdmin = existing.role === 'SHOP_ADMIN'
          && existing.active
          && (nextRole !== 'SHOP_ADMIN' || nextActive === false)
          && await activeAdminCount(tx, shopId) <= 1;

        const nextPermissions = input.permissions
          ? sanitizePermissions(input.permissions, nextRole)
          : input.role
            ? sanitizePermissions(defaultPermissions(nextRole), nextRole)
            : undefined;

        const updated = await tx.user.update({
          where: { id: existing.id },
          data: {
            ...(input.name ? { name: input.name.trim() } : {}),
            ...(input.email !== undefined ? { email: normalizeEmail(input.email) } : {}),
            ...(input.role ? { role: nextRole } : {}),
            ...(input.active !== undefined ? { active: input.active } : {}),
            ...(nextPermissions ? { permissions: nextPermissions } : {}),
          },
        });
        return { updated, leavesNoActiveShopAdmin };
      });

      if (!updated) return res.status(404).json({ ok: false, message: 'User not found in this tenant' });
      await writeTenantAudit(req, shopId, 'TENANT_USER_ACCESS_UPDATED', {
        userId: updated.updated.id,
        role: updated.updated.role,
        active: updated.updated.active,
        leavesNoActiveShopAdmin: updated.leavesNoActiveShopAdmin,
      });
      res.json({
        ok: true,
        user: serializeTenantUser(updated.updated),
        warning: updated.leavesNoActiveShopAdmin
          ? 'This tenant now has no active Shop Admin. Create a replacement admin before normal shop login.'
          : null,
      });
    } catch (error) {
      res.status(error.status || 500).json({ ok: false, message: error.message || 'Tenant user update failed' });
    }
  });

  app.post('/api/admin/tenants/:shopId/users/:userId/reset-password', ...superAdminOnly, async (req, res) => {
    const shopId = req.params.shopId;
    const userId = req.params.userId;
    if (!uuid.safeParse(shopId).success || !uuid.safeParse(userId).success) {
      return res.status(400).json({ ok: false, message: 'Invalid tenant or user id' });
    }

    const input = parseBody(adminPasswordResetSchema, req.body, res, 'Invalid password reset request');
    if (!input) return;

    try {
      const updated = await prisma.$transaction(async (tx) => {
        const existing = await tx.user.findFirst({ where: { id: userId, shopId } });
        if (!existing) return null;

        const passwordHash = await bcrypt.hash(input.password, 12);
        const changed = await tx.user.update({
          where: { id: existing.id },
          data: { passwordHash },
          select: { id: true, shopId: true, username: true, name: true, role: true, active: true, updatedAt: true },
        });

        await tx.auditLog.create({
          data: {
            shopId,
            userId: req.auth?.userId || null,
            action: 'TENANT_USER_PASSWORD_RESET',
            entityType: 'tenant_user',
            entityId: existing.id,
            details: {
              targetUsername: existing.username,
              targetName: existing.name,
              targetRole: existing.role,
              reason: input.reason || null,
            },
            ipAddress: req.ip || null,
            userAgent: req.headers?.['user-agent'] || null,
          },
        });

        return changed;
      });

      if (!updated) return res.status(404).json({ ok: false, message: 'User not found in this tenant' });
      res.json({
        ok: true,
        message: `Password reset completed for @${updated.username}`,
        passwordChanged: true,
        user: updated,
      });
    } catch (error) {
      res.status(error.status || 500).json({ ok: false, message: error.message || 'Tenant user password reset failed' });
    }
  });

  app.delete('/api/admin/tenants/:shopId/users/:userId', ...superAdminOnly, async (req, res) => {
    const shopId = req.params.shopId;
    const userId = req.params.userId;
    if (!uuid.safeParse(shopId).success || !uuid.safeParse(userId).success) {
      return res.status(400).json({ ok: false, message: 'Invalid tenant or user id' });
    }

    try {
      const result = await prisma.$transaction(async (tx) => {
        const existing = await tx.user.findFirst({ where: { id: userId, shopId } });
        if (!existing) return null;
        if (existing.id === req.auth?.userId) {
          const error = new Error('You cannot delete your own account');
          error.status = 409;
          throw error;
        }
        const leavesNoActiveShopAdmin = existing.role === 'SHOP_ADMIN'
          && existing.active
          && await activeAdminCount(tx, shopId) <= 1;

        const dependencyCounts = await tenantUserDependencyCounts(tx, shopId, userId);
        const hasHistory = hasHistoricalUserDependencies(dependencyCounts);

        if (hasHistory) {
          const nextUsername = deletedUsername(existing.id);
          const disabledPasswordHash = await bcrypt.hash(`${nextUsername}-${crypto.randomUUID()}`, 12);
          const updated = await tx.user.update({
            where: { id: existing.id },
            data: {
              email: null,
              username: nextUsername,
              normalizedUsername: nextUsername,
              passwordHash: disabledPasswordHash,
              name: 'Deleted User',
              avatarUrl: null,
              authProvider: null,
              providerId: null,
              permissions: {},
              active: false,
            },
          });
          await tx.userPushToken.updateMany({
            where: { shopId, userId: existing.id },
            data: { isActive: false, lastSeenAt: new Date() },
          });
          await tx.auditLog.create({
            data: {
              shopId,
              userId: req.auth?.userId || null,
              action: 'TENANT_USER_SOFT_DELETED',
              entityType: 'tenant_user',
              entityId: existing.id,
              details: {
                targetUsername: existing.username,
                targetName: existing.name,
                targetRole: existing.role,
                mode: 'soft_deleted',
                leavesNoActiveShopAdmin,
                dependencyCounts,
              },
              ipAddress: req.ip || null,
              userAgent: req.headers?.['user-agent'] || null,
            },
          });
          return { mode: 'soft_deleted', user: updated, dependencyCounts, leavesNoActiveShopAdmin };
        }

        await tx.auditLog.create({
          data: {
            shopId,
            userId: req.auth?.userId || null,
            action: 'TENANT_USER_HARD_DELETED',
            entityType: 'tenant_user',
            entityId: existing.id,
            details: {
              targetUsername: existing.username,
              targetName: existing.name,
              targetRole: existing.role,
              mode: 'hard_deleted',
              leavesNoActiveShopAdmin,
              dependencyCounts,
            },
            ipAddress: req.ip || null,
            userAgent: req.headers?.['user-agent'] || null,
          },
        });

        await tx.user.delete({ where: { id: existing.id } });
        return {
          mode: 'hard_deleted',
          user: {
            id: existing.id,
            shopId: existing.shopId,
            username: existing.username,
            name: existing.name,
            role: existing.role,
            active: false,
          },
          dependencyCounts,
          leavesNoActiveShopAdmin,
        };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

      if (!result) return res.status(404).json({ ok: false, message: 'User not found in this tenant' });
      res.json({
        ok: true,
        mode: result.mode,
        message: result.mode === 'hard_deleted'
          ? `User @${result.user.username} permanently deleted`
          : 'User login access removed. Historical records were preserved.',
        user: serializeTenantUser(result.user),
        dependencyCounts: result.dependencyCounts,
        warning: result.leavesNoActiveShopAdmin
          ? 'This tenant now has no active Shop Admin. Create a replacement admin before normal shop login.'
          : null,
      });
    } catch (error) {
      res.status(error.status || 500).json({ ok: false, message: error.message || 'Tenant user delete failed' });
    }
  });
}

module.exports = attachTenantLifecycleApi;
