const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { z } = require('zod');
const { Prisma } = require('@prisma/client');
const { prisma } = require('./prisma');
const { requireAuth } = require('./auth-api');
const {
  sendPushToShop,
  sendPushToUser,
} = require('./push-notifications-api');
const { recordTelegramSheetSafe } = require('./telegram-sheet-recorder');

const VPN_ADS_URL = 'https://maharshwe.online/api/vpn-ads';
const VPN_PUSH_URL = 'https://maharshwe.online/api/notifications/send';
const VPN_TOPIC = String(process.env.FCM_TOPIC || 'maharshwe-vpn').trim() || 'maharshwe-vpn';
const VPN_FIREBASE_PROJECT = 'maharshweonlinevpn';
const VPN_REGISTERED_TOKEN_FALLBACK = 140;
const ADMIN_PORTAL_SHOP_SLUG = 'mahar-admin-portal';
const HIDDEN_TENANT_SLUG_PREFIXES = ['codex-', 'browser-cors-'];
const VISIBLE_POS_SHOP_WHERE = {
  AND: [
    { slug: { not: ADMIN_PORTAL_SHOP_SLUG } },
    { NOT: HIDDEN_TENANT_SLUG_PREFIXES.map((prefix) => ({ slug: { startsWith: prefix } })) },
  ],
};
const VISIBLE_POS_USER_WHERE = {
  shopId: { not: null },
  shop: { is: VISIBLE_POS_SHOP_WHERE },
};

const ROLE_PERMISSIONS = {
  super_admin: ['*'],
  notification_manager: ['dashboard.view', 'push.view', 'push.send', 'campaign.view'],
  vpn_ads_manager: ['dashboard.view', 'vpn_ads.view', 'vpn_ads.manage', 'campaign.view'],
  pos_viewer: ['dashboard.view', 'pos.view', 'pos.reports.view'],
  pos_manager: ['dashboard.view', 'pos.view', 'pos.manage', 'pos.reports.view'],
  viewer: ['dashboard.view'],
};

const PRODUCT_SEEDS = [
  {
    name: 'Mahar POS Web App',
    slug: 'mahar_pos_web',
    type: 'web',
    domain: 'https://app.maharshwe.shop',
    firebaseProject: VPN_FIREBASE_PROJECT,
    pushType: 'web_fcm',
    adsApiEnabled: false,
  },
  {
    name: 'Mahar Shwe VPN',
    slug: 'mahar_shwe_vpn',
    type: 'android',
    packageName: 'com.maharshwe.vpn',
    firebaseProject: VPN_FIREBASE_PROJECT,
    topic: VPN_TOPIC,
    pushType: 'topic_fcm',
    adsApiEnabled: true,
    metadata: { androidAppId: '1:648689584934:android:d12e28d3c2d6c54132cfe7' },
  },
  {
    name: 'Facebook Video Downloader',
    slug: 'facebook_video_downloader',
    type: 'android',
    packageName: 'com.maharshwe.videodownloader',
    firebaseProject: VPN_FIREBASE_PROJECT,
    pushType: 'android_fcm_or_future',
    adsApiEnabled: false,
    metadata: { androidAppId: '1:648689584934:android:72865b27b54897f932cfe7' },
  },
];

class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

function wrap(handler) {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (error) {
      if (error instanceof ApiError) {
        return res.status(error.status).json({ ok: false, message: error.message, details: error.details });
      }
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        return res.status(404).json({ ok: false, message: 'Admin portal record not found' });
      }
      console.error('Admin integrations API:', error);
      return res.status(500).json({ ok: false, message: error.message || 'Admin portal request failed' });
    }
  };
}

function parse(schema, value, message = 'Invalid admin portal request') {
  const result = schema.safeParse(value);
  if (!result.success) throw new ApiError(400, message, result.error.flatten().fieldErrors);
  return result.data;
}

function cleanText(value, max = 500) {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function normalizeUsername(value) {
  return String(value || '').trim().toLowerCase();
}

function decimal(value) {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value?.toNumber === 'function') return value.toNumber();
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function validOptionalUrl(value) {
  const text = cleanText(value, 1000);
  if (!text) return null;
  try {
    const parsed = new URL(text);
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function optionalUrlSchema() {
  return z.string().trim().max(1000).optional().transform((value, ctx) => {
    if (!value) return null;
    const url = validOptionalUrl(value);
    if (!url) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Must be a valid http(s) URL' });
      return z.NEVER;
    }
    return url;
  });
}

function roleAllows(role, permission) {
  const permissions = ROLE_PERMISSIONS[String(role || '').toLowerCase()] || [];
  return permissions.includes('*') || permissions.includes(permission);
}

function jsonAllows(source, permission) {
  return Boolean(source && typeof source === 'object' && source[permission] === true);
}

function requireAdminPermission(permission) {
  return async (req, res, next) => {
    if (!req.auth) return res.status(401).json({ ok: false, message: 'Authentication is required' });
    if (req.auth.role === 'SUPER_ADMIN' || jsonAllows(req.auth.permissions, permission)) return next();

    try {
      if (prisma.adminUserRole?.findMany) {
        const roles = await prisma.adminUserRole.findMany({
          where: { userId: req.auth.userId, active: true },
          select: { role: true, permissions: true },
        });
        const allowed = roles.some((row) => roleAllows(row.role, permission) || jsonAllows(row.permissions, permission));
        if (allowed) return next();
      }
    } catch (error) {
      console.warn('Admin role lookup failed:', error.message);
    }

    return res.status(403).json({ ok: false, message: `Admin permission required: ${permission}` });
  };
}

function adminAccess(permission) {
  return [requireAuth, requireAdminPermission(permission)];
}

async function writeAdminAudit(req, action, resourceType, resourceId = null, metadata = {}) {
  try {
    if (!prisma.adminAuditLog?.create) return null;
    return prisma.adminAuditLog.create({
      data: {
        adminUserId: req.auth?.userId || null,
        action,
        resourceType,
        resourceId: resourceId ? String(resourceId) : null,
        metadataJson: metadata || {},
        ipAddress: req.ip || null,
        userAgent: req.headers?.['user-agent'] || null,
      },
    });
  } catch (error) {
    console.warn('Admin audit log write failed:', error.message);
    return null;
  }
}

function adminApiKey() {
  const key = String(process.env.MAHARSHWE_ONLINE_ADMIN_API_KEY || '').trim();
  if (!key) throw new ApiError(500, 'MAHARSHWE_ONLINE_ADMIN_API_KEY is not configured on the server');
  return key;
}

async function externalJson(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'x-api-key': adminApiKey(),
        ...(options.headers || {}),
      },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) {
      throw new ApiError(response.status || 502, data.message || `Upstream request failed (${response.status})`, data);
    }
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

async function ensureProductsSeeded() {
  if (!prisma.adminProduct?.upsert) return [];
  await Promise.all(PRODUCT_SEEDS.map((product) => prisma.adminProduct.upsert({
    where: { slug: product.slug },
    create: { ...product, metadata: {} },
    update: product,
  })));
  return prisma.adminProduct.findMany({ orderBy: [{ type: 'asc' }, { name: 'asc' }] });
}

const hexColor = z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, 'Must be a 6-digit hex color');

const vpnAdsSchema = z.object({
  enabled: z.boolean(),
  title: z.string().trim().max(180).optional().default(''),
  message: z.string().trim().max(700).optional().default(''),
  imageUrl: optionalUrlSchema(),
  videoUrl: optionalUrlSchema(),
  mediaType: z.enum(['auto', 'image', 'video']).default('auto'),
  clickUrl: optionalUrlSchema(),
  cta: z.string().trim().max(80).optional().default('Open'),
  backgroundColor: hexColor.default('#141510'),
  textColor: hexColor.default('#ffffff'),
});

const vpnPushSchema = z.object({
  title: z.string().trim().min(1).max(120),
  body: z.string().trim().min(1).max(300),
  url: optionalUrlSchema().default('https://maharshwe.online/download/?auto=1'),
  topic: z.string().trim().min(1).max(120).default(VPN_TOPIC),
}).transform((value) => ({ ...value, topic: VPN_TOPIC }));

const posPushSchema = z.object({
  title: z.string().trim().min(1).max(120),
  body: z.string().trim().min(1).max(220),
  url: z.string().trim().max(220).optional().default('/dashboard'),
  targetType: z.enum(['all', 'shop', 'user', 'role']).default('all'),
  shopId: z.string().uuid().optional(),
  userId: z.string().uuid().optional(),
  role: z.enum(['SUPER_ADMIN', 'SHOP_ADMIN', 'CASHIER']).optional(),
});

const adminPortalRoleSchema = z.enum([
  'super_admin',
  'notification_manager',
  'vpn_ads_manager',
  'pos_viewer',
  'pos_manager',
  'viewer',
]);

const adminUserCreateSchema = z.object({
  username: z.string().trim().min(2).max(80),
  email: z.string().trim().email().max(180).optional(),
  name: z.string().trim().min(1).max(180),
  password: z.string().min(6).max(200),
  adminRole: adminPortalRoleSchema.default('viewer'),
});

const adminRoleAssignSchema = z.object({
  userId: z.string().uuid(),
  adminRole: adminPortalRoleSchema,
  active: z.boolean().optional().default(true),
  permissions: z.record(z.string(), z.boolean()).optional().default({}),
});

const adminRoleUpdateSchema = z.object({
  active: z.boolean().optional(),
  permissions: z.record(z.string(), z.boolean()).optional(),
}).refine((value) => Object.keys(value).length > 0, { message: 'At least one field is required' });

const uuidSchema = z.string().uuid();

function serializeProduct(product) {
  return {
    id: product.id,
    name: product.name,
    slug: product.slug,
    type: product.type,
    domain: product.domain,
    packageName: product.packageName,
    firebaseProject: product.firebaseProject,
    topic: product.topic,
    pushType: product.pushType,
    adsApiEnabled: product.adsApiEnabled,
    metadata: product.metadata || {},
    createdAt: product.createdAt,
    updatedAt: product.updatedAt,
  };
}

function serializeCampaign(item) {
  return {
    id: item.id,
    productSlug: item.productSlug,
    title: item.title,
    body: item.body,
    url: item.url,
    topic: item.topic,
    provider: item.provider,
    status: item.status,
    responseJson: item.responseJson || null,
    createdBy: item.createdBy || null,
    createdAt: item.createdAt,
    sentAt: item.sentAt,
  };
}

function serializeAdsHistory(item) {
  return {
    id: item.id,
    productSlug: item.productSlug,
    adsType: item.adsType,
    enabled: item.enabled,
    title: item.title,
    message: item.message,
    imageUrl: item.imageUrl,
    videoUrl: item.videoUrl,
    mediaType: item.mediaType,
    clickUrl: item.clickUrl,
    cta: item.cta,
    backgroundColor: item.backgroundColor,
    textColor: item.textColor,
    responseJson: item.responseJson || null,
    createdBy: item.createdBy || null,
    createdAt: item.createdAt,
  };
}

function serializeRenewalHistory(item) {
  return {
    id: item.id,
    productSlug: item.productSlug,
    shopId: item.shopId,
    tenantId: item.tenantId,
    shopName: item.shopName,
    subscriptionId: item.subscriptionId,
    plan: item.plan,
    months: item.months,
    customDays: item.customDays,
    durationLabel: item.durationLabel,
    previousEndsAt: item.previousEndsAt,
    startsAt: item.startsAt,
    newEndsAt: item.newEndsAt,
    note: item.note,
    renewedBy: item.renewedBy || null,
    metadataJson: item.metadataJson || null,
    createdAt: item.createdAt,
  };
}

async function createCampaign(data) {
  if (!prisma.adminPushCampaign?.create) return null;
  return prisma.adminPushCampaign.create({ data });
}

async function updateCampaign(id, data) {
  if (!id || !prisma.adminPushCampaign?.update) return null;
  return prisma.adminPushCampaign.update({ where: { id }, data });
}

async function createAdsHistory(data) {
  if (!prisma.adminAdsHistory?.create) return null;
  return prisma.adminAdsHistory.create({ data });
}

function posLimit(req, fallback = 50, max = 200) {
  const value = Number.parseInt(req.query.limit || fallback, 10);
  return Math.min(max, Math.max(1, Number.isFinite(value) ? value : fallback));
}

function shopFilter(req) {
  const shopId = String(req.query.shopId || '').trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(shopId) ? shopId : null;
}

function attachAdminIntegrationsApi(app) {
  app.get('/api/admin/products', ...adminAccess('dashboard.view'), wrap(async (_req, res) => {
    const products = await ensureProductsSeeded();
    res.json({ ok: true, products: products.map(serializeProduct) });
  }));

  app.get('/api/admin/roles', ...adminAccess('dashboard.view'), wrap(async (_req, res) => {
    res.json({
      ok: true,
      roles: Object.entries(ROLE_PERMISSIONS).map(([role, permissions]) => ({
        role,
        permissions,
      })),
    });
  }));

  app.get('/api/admin/admin-users', ...adminAccess('dashboard.view'), wrap(async (_req, res) => {
    const [superAdmins, roleRows] = await Promise.all([
      prisma.user.findMany({
        where: { role: 'SUPER_ADMIN', active: true },
        select: { id: true, username: true, email: true, name: true, active: true, createdAt: true, lastLoginAt: true },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
      prisma.adminUserRole?.findMany
        ? prisma.adminUserRole.findMany({ where: { active: true }, orderBy: { createdAt: 'desc' }, take: 200 })
        : Promise.resolve([]),
    ]);
    const roleUserIds = [...new Set(roleRows.map((row) => row.userId).filter(Boolean))];
    const roleUsers = roleUserIds.length
      ? await prisma.user.findMany({
        where: { id: { in: roleUserIds }, active: true },
        select: { id: true, username: true, email: true, name: true, active: true, createdAt: true, lastLoginAt: true },
      })
      : [];
    const usersById = new Map([...superAdmins, ...roleUsers].map((user) => [user.id, user]));
    const visibleRoleRows = roleRows.filter((row) => usersById.has(row.userId));
    res.json({
      ok: true,
      users: [...usersById.values()],
      roleAssignments: visibleRoleRows.map((row) => ({
        id: row.id,
        userId: row.userId,
        role: row.role,
        permissions: row.permissions || {},
        active: row.active,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        user: usersById.get(row.userId) || null,
      })),
    });
  }));

  app.post('/api/admin/admin-users', ...adminAccess('admin.manage'), wrap(async (req, res) => {
    const input = parse(adminUserCreateSchema, req.body || {}, 'Invalid admin user');
    const normalizedUsername = normalizeUsername(input.username);
    const email = input.email ? normalizeUsername(input.email) : null;

    const passwordHash = await bcrypt.hash(input.password, 12);
    const user = await prisma.$transaction(async (tx) => {
      const portalShop = input.adminRole === 'super_admin'
        ? null
        : await tx.shop.upsert({
          where: { slug: ADMIN_PORTAL_SHOP_SLUG },
          update: { active: true, name: 'Mahar Admin Portal' },
          create: {
            slug: ADMIN_PORTAL_SHOP_SLUG,
            name: 'Mahar Admin Portal',
            active: true,
          },
          select: { id: true },
        });
      const adminShopId = portalShop?.id || null;
      const existing = await tx.user.findFirst({
        where: {
          OR: [
            { normalizedUsername, shopId: adminShopId },
            ...(email ? [{ email }] : []),
          ],
        },
        select: { id: true },
      });
      if (existing) throw new ApiError(409, 'Admin username or email already exists');

      const created = await tx.user.create({
        data: {
          shopId: adminShopId,
          username: input.username.trim(),
          normalizedUsername,
          email,
          passwordHash,
          name: input.name.trim(),
          role: input.adminRole === 'super_admin' ? 'SUPER_ADMIN' : 'SHOP_ADMIN',
          permissions: {},
          active: true,
          authProvider: 'password',
        },
        select: { id: true, username: true, email: true, name: true, role: true, active: true, createdAt: true },
      });
      if (input.adminRole !== 'super_admin') {
        await tx.adminUserRole.create({
          data: {
            userId: created.id,
            role: input.adminRole,
            permissions: {},
            active: true,
          },
        });
      }
      return created;
    });

    await writeAdminAudit(req, 'ADMIN_USER_CREATE', 'admin_user', user.id, {
      username: user.username,
      adminRole: input.adminRole,
    });
    res.status(201).json({ ok: true, user });
  }));

  app.delete('/api/admin/admin-users/:userId', ...adminAccess('admin.manage'), wrap(async (req, res) => {
    const userId = parse(uuidSchema, req.params.userId, 'Invalid admin user id');
    if (userId === req.auth?.userId) throw new ApiError(409, 'You cannot delete your own admin account');

    const result = await prisma.$transaction(async (tx) => {
      const [user, roleRows] = await Promise.all([
        tx.user.findUnique({
          where: { id: userId },
          select: { id: true, shopId: true, username: true, email: true, name: true, role: true, active: true },
        }),
        tx.adminUserRole?.findMany
          ? tx.adminUserRole.findMany({ where: { userId }, select: { id: true, role: true, active: true } })
          : Promise.resolve([]),
      ]);
      if (!user) return null;

      const isAdminAccount = user.role === 'SUPER_ADMIN' || user.shopId === null || roleRows.length > 0;
      if (!isAdminAccount) {
        throw new ApiError(400, 'This is a POS tenant user. Delete it from Tenant Users instead.');
      }

      if (user.role === 'SUPER_ADMIN' && user.active) {
        const otherSuperAdmins = await tx.user.count({
          where: { role: 'SUPER_ADMIN', active: true, id: { not: user.id } },
        });
        if (otherSuperAdmins < 1) {
          throw new ApiError(409, 'At least one active Super Admin is required');
        }
      }

      await tx.adminAuditLog.create({
        data: {
          adminUserId: req.auth?.userId || null,
          action: 'ADMIN_USER_DELETE',
          resourceType: 'admin_user',
          resourceId: user.id,
          metadataJson: {
            targetUsername: user.username,
            targetEmail: user.email || null,
            targetName: user.name,
            targetRole: user.role,
            adminRoles: roleRows.map((row) => row.role),
          },
          ipAddress: req.ip || null,
          userAgent: req.headers?.['user-agent'] || null,
        },
      });

      await tx.adminUserRole.deleteMany({ where: { userId: user.id } });
      try {
        await tx.user.delete({ where: { id: user.id } });
        return { mode: 'hard_deleted', user };
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2003') throw error;
        const deletedMarker = `deleted-admin-${String(user.id).slice(0, 8)}-${Date.now()}`;
        const passwordHash = await bcrypt.hash(`${deletedMarker}-${crypto.randomUUID?.() || Math.random()}`, 12);
        const updated = await tx.user.update({
          where: { id: user.id },
          data: {
            email: null,
            username: deletedMarker,
            normalizedUsername: deletedMarker,
            passwordHash,
            name: 'Deleted Admin',
            avatarUrl: null,
            authProvider: null,
            providerId: null,
            permissions: {},
            active: false,
          },
          select: { id: true, shopId: true, username: true, email: true, name: true, role: true, active: true },
        });
        return { mode: 'soft_deleted', user: updated };
      }
    });

    if (!result) throw new ApiError(404, 'Admin user not found');
    res.json({
      ok: true,
      mode: result.mode,
      message: result.mode === 'hard_deleted'
        ? `Admin account @${result.user.username} deleted`
        : 'Admin account login access removed. Historical audit data was preserved.',
      user: result.user,
    });
  }));

  app.post('/api/admin/admin-users/roles', ...adminAccess('admin.manage'), wrap(async (req, res) => {
    const input = parse(adminRoleAssignSchema, req.body || {}, 'Invalid admin role assignment');
    const user = await prisma.user.findUnique({ where: { id: input.userId }, select: { id: true, active: true } });
    if (!user) throw new ApiError(404, 'User not found');
    const role = await prisma.adminUserRole.upsert({
      where: { userId_role: { userId: input.userId, role: input.adminRole } },
      create: {
        userId: input.userId,
        role: input.adminRole,
        permissions: input.permissions || {},
        active: input.active,
      },
      update: {
        permissions: input.permissions || {},
        active: input.active,
      },
    });
    await writeAdminAudit(req, 'ADMIN_ROLE_ASSIGN', 'admin_user_role', role.id, {
      userId: input.userId,
      role: input.adminRole,
      active: input.active,
    });
    res.json({ ok: true, role });
  }));

  app.patch('/api/admin/admin-users/roles/:id', ...adminAccess('admin.manage'), wrap(async (req, res) => {
    const id = parse(z.string().uuid(), req.params.id, 'Invalid role assignment id');
    const input = parse(adminRoleUpdateSchema, req.body || {}, 'Invalid admin role update');
    const role = await prisma.adminUserRole.update({
      where: { id },
      data: {
        ...(input.active !== undefined ? { active: input.active } : {}),
        ...(input.permissions ? { permissions: input.permissions } : {}),
      },
    });
    await writeAdminAudit(req, 'ADMIN_ROLE_UPDATE', 'admin_user_role', role.id, {
      role: role.role,
      active: role.active,
    });
    res.json({ ok: true, role });
  }));

  app.get('/api/admin/dashboard', ...adminAccess('dashboard.view'), wrap(async (_req, res) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const monthStart = new Date(today);
    monthStart.setDate(1);

    const [
      products,
      totalShops,
      activeShops,
      posUsers,
      todaySales,
      webPushTokens,
      latestPush,
      latestAds,
      latestRenewal,
      renewalsThisMonth,
    ] = await Promise.all([
      ensureProductsSeeded(),
      prisma.shop.count({ where: VISIBLE_POS_SHOP_WHERE }),
      prisma.shop.count({ where: { ...VISIBLE_POS_SHOP_WHERE, active: true } }),
      prisma.user.count({ where: { ...VISIBLE_POS_USER_WHERE, active: true } }),
      prisma.sale.aggregate({
        where: { soldAt: { gte: today }, status: { not: 'VOIDED' } },
        _count: { _all: true },
        _sum: { total: true, profitTotal: true },
      }),
      prisma.userPushToken?.count ? prisma.userPushToken.count({ where: { isActive: true } }) : Promise.resolve(0),
      prisma.adminPushCampaign?.findFirst
        ? prisma.adminPushCampaign.findFirst({ orderBy: { createdAt: 'desc' } })
        : Promise.resolve(null),
      prisma.adminAdsHistory?.findFirst
        ? prisma.adminAdsHistory.findFirst({ orderBy: { createdAt: 'desc' } })
        : Promise.resolve(null),
      prisma.adminRenewalHistory?.findFirst
        ? prisma.adminRenewalHistory.findFirst({ orderBy: { createdAt: 'desc' } })
        : Promise.resolve(null),
      prisma.adminRenewalHistory?.count
        ? prisma.adminRenewalHistory.count({ where: { createdAt: { gte: monthStart } } })
        : Promise.resolve(0),
    ]);

    let vpnAds = { available: false, enabled: null, message: 'Not loaded' };
    try {
      const data = await externalJson(VPN_ADS_URL);
      vpnAds = { available: true, ...data };
    } catch (error) {
      vpnAds = {
        available: false,
        enabled: null,
        message: error.message,
      };
    }

    res.json({
      ok: true,
      generatedAt: new Date(),
      products: products.map(serializeProduct),
      vpn: {
        firebaseProject: VPN_FIREBASE_PROJECT,
        topic: VPN_TOPIC,
        registeredTokens: VPN_REGISTERED_TOKEN_FALLBACK,
        ads: vpnAds,
      },
      pos: {
        totalShops,
        activeShops,
        users: posUsers,
        todaySales: todaySales._count?._all || 0,
        todayRevenue: decimal(todaySales._sum?.total),
        todayProfit: decimal(todaySales._sum?.profitTotal),
        webPushTokens,
        renewalsThisMonth,
      },
      latestPush: latestPush ? serializeCampaign(latestPush) : null,
      latestAdsUpdate: latestAds ? serializeAdsHistory(latestAds) : null,
      latestRenewal: latestRenewal ? serializeRenewalHistory(latestRenewal) : null,
      videoDownloader: { pushStatus: 'future', available: false },
    });
  }));

  app.get('/api/admin/integrations/vpn-ads', ...adminAccess('vpn_ads.view'), wrap(async (_req, res) => {
    const data = await externalJson(VPN_ADS_URL);
    res.json({
      ok: true,
      productSlug: 'mahar_shwe_vpn',
      behavior: 'Free Server Ads appear only after a Free Server connection, 5 seconds after connect. Other Key connections do not show ads.',
      config: data.config || data,
      raw: data,
    });
  }));

  app.post('/api/admin/integrations/vpn-ads', ...adminAccess('vpn_ads.manage'), wrap(async (req, res) => {
    const input = parse(vpnAdsSchema, req.body || {}, 'Invalid VPN ads config');
    const payload = {
      enabled: input.enabled,
      title: cleanText(input.title, 180),
      message: cleanText(input.message, 700),
      imageUrl: input.imageUrl || '',
      videoUrl: input.videoUrl || '',
      mediaType: input.mediaType,
      clickUrl: input.clickUrl || '',
      cta: cleanText(input.cta, 80) || 'Open',
      backgroundColor: input.backgroundColor,
      textColor: input.textColor,
    };
    const upstream = await externalJson(VPN_ADS_URL, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    const history = await createAdsHistory({
      productSlug: 'mahar_shwe_vpn',
      adsType: 'free_server_banner',
      enabled: payload.enabled,
      title: payload.title || null,
      message: payload.message || null,
      imageUrl: payload.imageUrl || null,
      videoUrl: payload.videoUrl || null,
      mediaType: payload.mediaType,
      clickUrl: payload.clickUrl || null,
      cta: payload.cta || null,
      backgroundColor: payload.backgroundColor,
      textColor: payload.textColor,
      responseJson: upstream,
      createdBy: req.auth.userId || null,
    });
    await writeAdminAudit(req, payload.enabled ? 'VPN_ADS_SAVE' : 'VPN_ADS_DISABLE', 'vpn_ads', history?.id || null, {
      productSlug: 'mahar_shwe_vpn',
      enabled: payload.enabled,
    });
    res.json({ ok: true, savedAt: new Date(), config: payload, response: upstream, historyId: history?.id || null });
  }));

  app.post('/api/admin/integrations/vpn-notifications/send', ...adminAccess('push.send'), wrap(async (req, res) => {
    const input = parse(vpnPushSchema, req.body || {}, 'Invalid VPN push notification');
    const payload = {
      title: cleanText(input.title, 120),
      body: cleanText(input.body, 300),
      url: input.url || 'https://maharshwe.online/download/?auto=1',
      topic: VPN_TOPIC,
    };
    const campaign = await createCampaign({
      productSlug: 'mahar_shwe_vpn',
      title: payload.title,
      body: payload.body,
      url: payload.url,
      topic: payload.topic,
      provider: 'maharshwe.online/firebase',
      status: 'PENDING',
      createdBy: req.auth.userId || null,
    });
    try {
      const upstream = await externalJson(VPN_PUSH_URL, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      await updateCampaign(campaign?.id, { status: 'SENT', responseJson: upstream, sentAt: new Date() });
      await writeAdminAudit(req, 'VPN_PUSH_SEND', 'push_campaign', campaign?.id || null, {
        productSlug: 'mahar_shwe_vpn',
        topic: VPN_TOPIC,
      });
      recordTelegramSheetSafe('push_notification', {
        productSlug: 'mahar_shwe_vpn',
        campaignId: campaign?.id || null,
        title: payload.title,
        body: payload.body,
        url: payload.url,
        topic: VPN_TOPIC,
        provider: 'maharshwe.online/firebase',
        status: 'SENT',
        sentAt: new Date().toISOString(),
      }).catch((sheetError) => console.warn('Telegram sheet record failed:', sheetError.message));
      res.json({ ok: true, campaignId: campaign?.id || null, sentAt: new Date(), response: upstream });
    } catch (error) {
      await updateCampaign(campaign?.id, {
        status: 'FAILED',
        responseJson: { message: error.message, details: error.details || null },
      });
      recordTelegramSheetSafe('push_notification_failed', {
        productSlug: 'mahar_shwe_vpn',
        campaignId: campaign?.id || null,
        title: payload.title,
        topic: VPN_TOPIC,
        status: 'FAILED',
        message: error.message || 'VPN push failed',
      }).catch((sheetError) => console.warn('Telegram sheet record failed:', sheetError.message));
      throw error;
    }
  }));

  app.post('/api/admin/push/pos/send', ...adminAccess('push.send'), wrap(async (req, res) => {
    const input = parse(posPushSchema, req.body || {}, 'Invalid POS web push notification');
    const notification = {
      eventType: 'ADMIN_POS_WEB_PUSH',
      title: cleanText(input.title, 120),
      body: cleanText(input.body, 220),
      url: input.url?.startsWith('/') ? input.url : '/dashboard',
      data: { source: 'admin-portal' },
    };
    const campaign = await createCampaign({
      productSlug: 'mahar_pos_web',
      title: notification.title,
      body: notification.body,
      url: notification.url,
      topic: input.targetType,
      provider: 'firebase-web',
      status: 'PENDING',
      createdBy: req.auth.userId || null,
    });

    let result;
    if (input.targetType === 'shop') {
      if (!input.shopId) throw new ApiError(400, 'shopId is required for selected shop push');
      const shop = await prisma.shop.findFirst({ where: { id: input.shopId, ...VISIBLE_POS_SHOP_WHERE, active: true }, select: { id: true } });
      if (!shop) throw new ApiError(404, 'Target POS shop not found');
      result = await sendPushToShop({ shopId: input.shopId, ...notification });
    } else if (input.targetType === 'user') {
      if (!input.userId) throw new ApiError(400, 'userId is required for selected user push');
      const user = await prisma.user.findFirst({ where: { id: input.userId, ...VISIBLE_POS_USER_WHERE, active: true }, select: { id: true, shopId: true } });
      if (!user?.shopId) throw new ApiError(404, 'Target POS user not found');
      result = await sendPushToUser({ shopId: user.shopId, userId: user.id, ...notification });
    } else if (input.targetType === 'role') {
      if (!input.role) throw new ApiError(400, 'role is required for role push');
      const users = await prisma.user.findMany({
        where: { role: input.role, ...VISIBLE_POS_USER_WHERE, active: true },
        select: { id: true, shopId: true },
        take: 500,
      });
      const perUser = [];
      for (const user of users) {
        perUser.push(await sendPushToUser({ shopId: user.shopId, userId: user.id, ...notification }));
      }
      result = {
        targetUsers: users.length,
        inApp: { count: perUser.reduce((sum, item) => sum + (item.inApp?.count || 0), 0) },
        push: {
          sent: perUser.reduce((sum, item) => sum + (item.push?.sent || 0), 0),
          failed: perUser.reduce((sum, item) => sum + (item.push?.failed || 0), 0),
          skipped: perUser.every((item) => item.push?.skipped),
        },
      };
    } else {
      const shops = await prisma.shop.findMany({ where: { ...VISIBLE_POS_SHOP_WHERE, active: true }, select: { id: true }, take: 500 });
      const perShop = [];
      for (const shop of shops) {
        perShop.push(await sendPushToShop({ shopId: shop.id, ...notification }));
      }
      result = {
        targetShops: shops.length,
        inApp: { count: perShop.reduce((sum, item) => sum + (item.inApp?.count || 0), 0) },
        push: {
          sent: perShop.reduce((sum, item) => sum + (item.push?.sent || 0), 0),
          failed: perShop.reduce((sum, item) => sum + (item.push?.failed || 0), 0),
          skipped: perShop.every((item) => item.push?.skipped),
        },
      };
    }

    await updateCampaign(campaign?.id, { status: 'SENT', responseJson: result, sentAt: new Date() });
    await writeAdminAudit(req, 'POS_WEB_PUSH_SEND', 'push_campaign', campaign?.id || null, {
      productSlug: 'mahar_pos_web',
      targetType: input.targetType,
      shopId: input.shopId || null,
      userId: input.userId || null,
      role: input.role || null,
    });
    recordTelegramSheetSafe('push_notification', {
      productSlug: 'mahar_pos_web',
      campaignId: campaign?.id || null,
      title: notification.title,
      body: notification.body,
      url: notification.url,
      targetType: input.targetType,
      shopId: input.shopId || null,
      userId: input.userId || null,
      role: input.role || null,
      status: 'SENT',
      sentAt: new Date().toISOString(),
      result,
    }).catch((sheetError) => console.warn('Telegram sheet record failed:', sheetError.message));
    res.json({ ok: true, campaignId: campaign?.id || null, result });
  }));

  app.post('/api/admin/push/vpn/test', ...adminAccess('push.send'), wrap((_req, res) => {
    res.status(501).json({
      ok: false,
      message: 'No VPN test-token endpoint is available yet. Use the topic send flow only after confirmation.',
    });
  }));

  app.get('/api/admin/history/push-campaigns', ...adminAccess('campaign.view'), wrap(async (req, res) => {
    const productSlug = cleanText(req.query.productSlug, 120);
    const where = productSlug ? { productSlug } : {};
    const campaigns = prisma.adminPushCampaign?.findMany
      ? await prisma.adminPushCampaign.findMany({ where, orderBy: { createdAt: 'desc' }, take: posLimit(req, 50, 200) })
      : [];
    res.json({ ok: true, campaigns: campaigns.map(serializeCampaign) });
  }));

  app.get('/api/admin/history/ads', ...adminAccess('campaign.view'), wrap(async (req, res) => {
    const productSlug = cleanText(req.query.productSlug, 120);
    const where = productSlug ? { productSlug } : {};
    const records = prisma.adminAdsHistory?.findMany
      ? await prisma.adminAdsHistory.findMany({ where, orderBy: { createdAt: 'desc' }, take: posLimit(req, 50, 200) })
      : [];
    res.json({ ok: true, adsHistory: records.map(serializeAdsHistory) });
  }));

  app.get('/api/admin/history/renewals', ...adminAccess('campaign.view'), wrap(async (req, res) => {
    const productSlug = cleanText(req.query.productSlug, 120);
    const where = {
      ...(productSlug ? { productSlug } : {}),
      ...(shopFilter(req) ? { shopId: shopFilter(req) } : {}),
    };
    const records = prisma.adminRenewalHistory?.findMany
      ? await prisma.adminRenewalHistory.findMany({ where, orderBy: { createdAt: 'desc' }, take: posLimit(req, 50, 200) })
      : [];
    res.json({ ok: true, renewals: records.map(serializeRenewalHistory) });
  }));

  app.get('/api/admin/history/audit', ...adminAccess('campaign.view'), wrap(async (req, res) => {
    const logs = prisma.adminAuditLog?.findMany
      ? await prisma.adminAuditLog.findMany({ orderBy: { createdAt: 'desc' }, take: posLimit(req, 80, 300) })
      : [];
    res.json({ ok: true, logs });
  }));

  app.get('/api/admin/pos/overview', ...adminAccess('pos.view'), wrap(async (_req, res) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const [shops, activeShops, users, sales, todaySales, stock, credits, accounts, auditLogs] = await Promise.all([
      prisma.shop.count(),
      prisma.shop.count({ where: { active: true } }),
      prisma.user.count({ where: { shopId: { not: null }, active: true } }),
      prisma.sale.aggregate({ where: { status: { not: 'VOIDED' } }, _count: { _all: true }, _sum: { total: true, profitTotal: true } }),
      prisma.sale.aggregate({ where: { soldAt: { gte: today }, status: { not: 'VOIDED' } }, _count: { _all: true }, _sum: { total: true, profitTotal: true } }),
      prisma.inventoryBalance.aggregate({ _count: { _all: true }, _sum: { quantity: true } }),
      prisma.customer.count({ where: { balance: { not: 0 } } }),
      prisma.moneyAccount.count(),
      prisma.auditLog.count(),
    ]);
    res.json({
      ok: true,
      overview: {
        shops,
        activeShops,
        users,
        sales: sales._count?._all || 0,
        salesRevenue: decimal(sales._sum?.total),
        salesProfit: decimal(sales._sum?.profitTotal),
        todaySales: todaySales._count?._all || 0,
        todayRevenue: decimal(todaySales._sum?.total),
        todayProfit: decimal(todaySales._sum?.profitTotal),
        stockRows: stock._count?._all || 0,
        stockQuantity: stock._sum?.quantity || 0,
        customerCredits: credits,
        moneyAccounts: accounts,
        auditLogs,
      },
    });
  }));

  app.get('/api/admin/pos/shops', ...adminAccess('pos.view'), wrap(async (req, res) => {
    const shops = await prisma.shop.findMany({
      where: VISIBLE_POS_SHOP_WHERE,
      orderBy: { createdAt: 'desc' },
      include: {
        subscriptions: { orderBy: { endsAt: 'desc' }, take: 1 },
        _count: { select: { users: true, products: true, sales: true, repairs: true, moneyAccounts: true } },
      },
      take: posLimit(req, 100, 300),
    });
    res.json({ ok: true, shops });
  }));

  app.get('/api/admin/pos/users', ...adminAccess('pos.view'), wrap(async (req, res) => {
    const where = shopFilter(req)
      ? { shopId: shopFilter(req), shop: { is: VISIBLE_POS_SHOP_WHERE } }
      : VISIBLE_POS_USER_WHERE;
    const users = await prisma.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        shopId: true,
        username: true,
        email: true,
        name: true,
        role: true,
        active: true,
        authProvider: true,
        lastLoginAt: true,
        createdAt: true,
        shop: { select: { id: true, name: true, code: true, slug: true } },
      },
      take: posLimit(req, 100, 300),
    });
    res.json({ ok: true, users });
  }));

  app.get('/api/admin/pos/users/export', ...adminAccess('pos.view'), wrap(async (req, res) => {
    const provider = String(req.query.provider || '').trim().toLowerCase();
    const where = shopFilter(req)
      ? { shopId: shopFilter(req), shop: { is: VISIBLE_POS_SHOP_WHERE } }
      : VISIBLE_POS_USER_WHERE;
    if (provider) where.authProvider = provider;
    const users = await prisma.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        shopId: true,
        username: true,
        email: true,
        name: true,
        authProvider: true,
        passwordHash: true,
        createdAt: true,
        lastLoginAt: true,
        shop: { select: { id: true, name: true, code: true, slug: true } },
      },
      take: posLimit(req, 200, 1000),
    });
    res.json({
      ok: true,
      users: users.map((user) => ({
        userId: user.id,
        shopId: user.shopId,
        shopName: user.shop?.name || null,
        shopSlug: user.shop?.slug || null,
        email: user.email || null,
        userName: user.username || null,
        password: null,
        hasPassword: Boolean(user.passwordHash),
        loginType: user.authProvider === 'google' ? 'Google' : 'Password',
        lastCreate: user.createdAt,
        lastLoginAt: user.lastLoginAt,
      })),
      note: 'Passwords are not returned. Only hasPassword/loginType are exposed for security.',
    });
  }));

  app.get('/api/admin/pos/sales', ...adminAccess('pos.view'), wrap(async (req, res) => {
    const where = {
      ...(shopFilter(req) ? { shopId: shopFilter(req) } : {}),
    };
    const sales = await prisma.sale.findMany({
      where,
      orderBy: { soldAt: 'desc' },
      include: {
        shop: { select: { id: true, name: true, code: true, slug: true } },
        user: { select: { id: true, name: true, username: true } },
        customer: { select: { id: true, name: true, phone: true } },
        _count: { select: { items: true, payments: true } },
      },
      take: posLimit(req, 80, 300),
    });
    res.json({ ok: true, sales });
  }));

  app.get('/api/admin/pos/stock', ...adminAccess('pos.view'), wrap(async (req, res) => {
    const where = shopFilter(req) ? { shopId: shopFilter(req) } : {};
    const stock = await prisma.inventoryBalance.findMany({
      where,
      orderBy: [{ quantity: 'asc' }, { updatedAt: 'desc' }],
      include: {
        shop: { select: { id: true, name: true, code: true, slug: true } },
        productVariant: {
          select: {
            id: true,
            variantName: true,
            sku: true,
            barcode: true,
            costPrice: true,
            standardSellingPrice: true,
            minimumSellingPrice: true,
            product: { select: { id: true, name: true, brand: true, model: true } },
          },
        },
      },
      take: posLimit(req, 100, 300),
    });
    res.json({ ok: true, stock });
  }));

  app.get('/api/admin/pos/customer-credits', ...adminAccess('pos.view'), wrap(async (req, res) => {
    const where = {
      balance: { not: 0 },
      ...(shopFilter(req) ? { shopId: shopFilter(req) } : {}),
    };
    const customers = await prisma.customer.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      include: { shop: { select: { id: true, name: true, code: true, slug: true } } },
      take: posLimit(req, 100, 300),
    });
    res.json({ ok: true, customers });
  }));

  app.get('/api/admin/pos/money-accounts', ...adminAccess('pos.view'), wrap(async (req, res) => {
    const where = shopFilter(req) ? { shopId: shopFilter(req) } : {};
    const accounts = await prisma.moneyAccount.findMany({
      where,
      orderBy: [{ active: 'desc' }, { updatedAt: 'desc' }],
      include: { shop: { select: { id: true, name: true, code: true, slug: true } } },
      take: posLimit(req, 100, 300),
    });
    res.json({ ok: true, accounts });
  }));

  app.get('/api/admin/pos/reports', ...adminAccess('pos.reports.view'), wrap(async (_req, res) => {
    const [sales, payments, repairs, moneyService, lowStock, outOfStock] = await Promise.all([
      prisma.sale.aggregate({ where: { status: { not: 'VOIDED' } }, _count: { _all: true }, _sum: { total: true, profitTotal: true } }),
      prisma.payment.aggregate({ where: { status: 'PAID' }, _count: { _all: true }, _sum: { amount: true } }),
      prisma.repair.aggregate({ _count: { _all: true }, _sum: { finalCost: true, deposit: true } }),
      prisma.moneyServiceTransaction.aggregate({ _count: { _all: true }, _sum: { serviceProfit: true, feeAmount: true } }),
      prisma.inventoryBalance.count({ where: { quantity: { gt: 0, lte: 3 } } }),
      prisma.inventoryBalance.count({ where: { quantity: { lte: 0 } } }),
    ]);
    res.json({
      ok: true,
      reports: {
        sales: { count: sales._count?._all || 0, revenue: decimal(sales._sum?.total), profit: decimal(sales._sum?.profitTotal) },
        payments: { count: payments._count?._all || 0, total: decimal(payments._sum?.amount) },
        repairs: { count: repairs._count?._all || 0, revenue: decimal(repairs._sum?.finalCost), deposits: decimal(repairs._sum?.deposit) },
        moneyService: { count: moneyService._count?._all || 0, profit: decimal(moneyService._sum?.serviceProfit), fees: decimal(moneyService._sum?.feeAmount) },
        stock: { lowStock, outOfStock },
      },
    });
  }));

  app.get('/api/admin/pos/audit-logs', ...adminAccess('pos.view'), wrap(async (req, res) => {
    const where = shopFilter(req) ? { shopId: shopFilter(req) } : {};
    const logs = await prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        shop: { select: { id: true, name: true, code: true, slug: true } },
        user: { select: { id: true, name: true, username: true, role: true } },
      },
      take: posLimit(req, 100, 300),
    });
    res.json({ ok: true, logs });
  }));

}

module.exports = attachAdminIntegrationsApi;
module.exports.requireAdminPermission = requireAdminPermission;
module.exports.ROLE_PERMISSIONS = ROLE_PERMISSIONS;
