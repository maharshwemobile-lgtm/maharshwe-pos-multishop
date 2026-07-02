const bcrypt = require("bcryptjs");
const { z } = require("zod");
const { prisma } = require("./prisma");
const { requireAuth, addDays } = require("./auth-api");

function requireGrandAdmin(req, res, next) {
  if (req.auth?.role !== "SUPER_ADMIN" || req.auth?.shopId) {
    return res.status(403).json({ ok: false, message: "Grand Super Admin only" });
  }
  return next();
}

function safeSettings(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function moneyNumber(value) {
  if (value === null || value === undefined) return 0;
  return Number(value || 0);
}

function subscriptionView(row) {
  if (!row) return null;
  return {
    id: row.id,
    status: row.status,
    setupFee: moneyNumber(row.setupFee),
    monthlyFee: moneyNumber(row.monthlyFee),
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    renewedAt: row.renewedAt || null,
    notes: row.notes || "",
  };
}

function healthSnapshot() {
  return {
    ok: true,
    api: { ok: true, name: "Mahar POS API", checkedAt: new Date().toISOString() },
    database: {
      ok: Boolean(process.env.DATABASE_URL),
      provider: process.env.DATABASE_URL?.startsWith("postgres") ? "PostgreSQL" : "Unknown",
    },
    thirdParty: {
      smsGateway: {
        ok: Boolean(process.env.SMS_GATEWAY_URL || process.env.SMS_API_KEY),
        status: process.env.SMS_GATEWAY_URL || process.env.SMS_API_KEY ? "configured" : "not_configured",
      },
      paymentGateway: {
        ok: Boolean(process.env.PAYMENT_GATEWAY_URL || process.env.PAYMENT_API_KEY),
        status: process.env.PAYMENT_GATEWAY_URL || process.env.PAYMENT_API_KEY ? "configured" : "not_configured",
      },
      mailServer: {
        ok: Boolean(process.env.SMTP_HOST || process.env.MAIL_HOST || process.env.EMAIL_HOST),
        status: process.env.SMTP_HOST || process.env.MAIL_HOST || process.env.EMAIL_HOST ? "configured" : "not_configured",
      },
    },
  };
}

async function audit(req, action, entityType, entityId, details = {}) {
  try {
    await prisma.auditLog.create({
      data: {
        shopId: null,
        userId: req.auth?.userId || null,
        action,
        entityType,
        entityId: entityId || null,
        details,
        ipAddress: req.ip || null,
        userAgent: req.headers?.["user-agent"] || null,
      },
    });
  } catch (error) {
    console.warn("Grand admin audit failed:", error.message);
  }
}

async function shopRow(shop) {
  const settingsRow = shop.settings || null;
  const settings = safeSettings(settingsRow?.settings);
  const platform = safeSettings(settings.platform);
  const featurePermissions = safeSettings(platform.featurePermissions);
  const subscription = subscriptionView(shop.subscriptions?.[0]);

  return {
    id: shop.id,
    tenantId: shop.code || shop.slug,
    code: shop.code || "",
    slug: shop.slug,
    name: shop.name,
    phone: shop.phone || "",
    address: shop.address || "",
    businessType: shop.businessType || "PHONE_SHOP",
    active: shop.active,
    adminPortalEnabled: platform.adminPortalEnabled !== false,
    featurePermissions,
    createdAt: shop.createdAt,
    updatedAt: shop.updatedAt,
    subscription,
    metrics: {
      users: shop._count?.users || 0,
      products: shop._count?.products || 0,
      variants: shop._count?.productVariants || 0,
      sales: shop._count?.sales || 0,
    },
  };
}

const updateShopSchema = z.object({
  name: z.string().trim().min(1).max(180).optional(),
  phone: z.string().trim().max(80).nullable().optional(),
  address: z.string().trim().max(300).nullable().optional(),
  tenantId: z.string().trim().min(2).max(80).optional(),
  businessType: z.enum(["PHONE_SHOP", "MINI_MART"]).optional(),
  active: z.boolean().optional(),
  adminPortalEnabled: z.boolean().optional(),
  featurePermissions: z.record(z.boolean()).optional(),
  subscription: z.object({
    status: z.enum(["TRIAL", "ACTIVE", "OVERDUE", "SUSPENDED"]).optional(),
    monthlyFee: z.number().min(0).optional(),
    setupFee: z.number().min(0).optional(),
    extendDays: z.number().int().min(1).max(3660).optional(),
    notes: z.string().trim().max(500).optional(),
  }).optional(),
});

const updateUserSchema = z.object({
  active: z.boolean().optional(),
  name: z.string().trim().min(1).max(180).optional(),
  role: z.enum(["SHOP_ADMIN", "CASHIER"]).optional(),
  permissions: z.record(z.any()).optional(),
});

const resetPasswordSchema = z.object({
  password: z.string().min(8).max(200),
  mustChange: z.boolean().default(true),
});

async function listShops(req, res) {
  const q = String(req.query.q || "").trim();
  const where = q
    ? {
        OR: [
          { name: { contains: q, mode: "insensitive" } },
          { slug: { contains: q, mode: "insensitive" } },
          { code: { contains: q, mode: "insensitive" } },
          { phone: { contains: q, mode: "insensitive" } },
        ],
      }
    : {};

  const shops = await prisma.shop.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: Math.min(Number(req.query.limit || 100), 250),
    include: {
      settings: true,
      subscriptions: { orderBy: { endsAt: "desc" }, take: 1 },
      _count: { select: { users: true, products: true, productVariants: true, sales: true } },
    },
  });

  res.json({ ok: true, shops: await Promise.all(shops.map(shopRow)) });
}

async function overview(req, res) {
  const [shopCount, activeShopCount, suspendedShopCount, userCount, productCount, saleCount, latestAuditLogs] = await Promise.all([
    prisma.shop.count(),
    prisma.shop.count({ where: { active: true } }),
    prisma.shop.count({ where: { active: false } }),
    prisma.user.count(),
    prisma.product.count(),
    prisma.sale.count(),
    prisma.auditLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 20,
      include: { user: { select: { name: true, username: true, role: true } }, shop: { select: { name: true, code: true, slug: true } } },
    }),
  ]);

  const heavyUsers = await prisma.shop.findMany({
    orderBy: [{ sales: { _count: "desc" } }],
    take: 10,
    include: {
      subscriptions: { orderBy: { endsAt: "desc" }, take: 1 },
      _count: { select: { users: true, products: true, productVariants: true, sales: true, auditLogs: true } },
    },
  });

  res.json({
    ok: true,
    health: healthSnapshot(),
    metrics: { shopCount, activeShopCount, suspendedShopCount, userCount, productCount, saleCount },
    heavyUsers: await Promise.all(heavyUsers.map(shopRow)),
    latestAuditLogs,
  });
}

async function updateShop(req, res) {
  const parsed = updateShopSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ ok: false, message: "Invalid shop update", errors: parsed.error.flatten().fieldErrors });

  const shopId = req.params.shopId;
  const input = parsed.data;
  const data = {};

  if (input.name !== undefined) data.name = input.name;
  if (input.phone !== undefined) data.phone = input.phone || null;
  if (input.address !== undefined) data.address = input.address || null;
  if (input.businessType !== undefined) data.businessType = input.businessType;
  if (input.active !== undefined) data.active = input.active;
  if (input.tenantId !== undefined) data.code = input.tenantId.trim().toUpperCase().replace(/[^A-Z0-9-]+/g, "-").replace(/^-+|-+$/g, "");

  const updated = await prisma.$transaction(async (tx) => {
    if (Object.keys(data).length) {
      await tx.shop.update({ where: { id: shopId }, data });
    }

    if (input.adminPortalEnabled !== undefined || input.featurePermissions !== undefined) {
      const current = await tx.shopSettings.upsert({
        where: { shopId },
        update: {},
        create: { shopId },
      });
      const settings = safeSettings(current.settings);
      const platform = safeSettings(settings.platform);
      await tx.shopSettings.update({
        where: { shopId },
        data: {
          settings: {
            ...settings,
            platform: {
              ...platform,
              ...(input.adminPortalEnabled !== undefined ? { adminPortalEnabled: input.adminPortalEnabled } : {}),
              ...(input.featurePermissions !== undefined ? { featurePermissions: input.featurePermissions } : {}),
              lastGrandAdminUpdateAt: new Date().toISOString(),
            },
          },
        },
      });
    }

    if (input.subscription) {
      const latest = await tx.subscription.findFirst({ where: { shopId }, orderBy: { endsAt: "desc" } });
      const now = new Date();
      const subData = {
        ...(input.subscription.status ? { status: input.subscription.status } : {}),
        ...(input.subscription.monthlyFee !== undefined ? { monthlyFee: input.subscription.monthlyFee } : {}),
        ...(input.subscription.setupFee !== undefined ? { setupFee: input.subscription.setupFee } : {}),
        ...(input.subscription.notes !== undefined ? { notes: input.subscription.notes } : {}),
        ...(input.subscription.extendDays ? { endsAt: addDays(now, input.subscription.extendDays), renewedAt: now } : {}),
      };
      if (latest) await tx.subscription.update({ where: { id: latest.id }, data: subData });
      else {
        await tx.subscription.create({
          data: {
            shopId,
            status: input.subscription.status || "ACTIVE",
            startsAt: now,
            endsAt: input.subscription.extendDays ? addDays(now, input.subscription.extendDays) : addDays(now, 30),
            monthlyFee: input.subscription.monthlyFee ?? 50000,
            setupFee: input.subscription.setupFee ?? 0,
            notes: input.subscription.notes || "Created by Grand Super Admin",
          },
        });
      }
    }

    return tx.shop.findUnique({
      where: { id: shopId },
      include: {
        settings: true,
        subscriptions: { orderBy: { endsAt: "desc" }, take: 1 },
        _count: { select: { users: true, products: true, productVariants: true, sales: true } },
      },
    });
  });

  await audit(req, "GRAND_ADMIN_SHOP_UPDATED", "shop", shopId, input);
  res.json({ ok: true, shop: await shopRow(updated) });
}

async function listShopUsers(req, res) {
  const users = await prisma.user.findMany({
    where: { shopId: req.params.shopId },
    orderBy: [{ role: "asc" }, { createdAt: "desc" }],
    select: {
      id: true,
      username: true,
      email: true,
      name: true,
      role: true,
      permissions: true,
      active: true,
      authProvider: true,
      lastLoginAt: true,
      createdAt: true,
    },
  });
  res.json({ ok: true, users });
}

async function updateUser(req, res) {
  const parsed = updateUserSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ ok: false, message: "Invalid user update", errors: parsed.error.flatten().fieldErrors });

  const user = await prisma.user.findUnique({ where: { id: req.params.userId }, select: { id: true, shopId: true, role: true } });
  if (!user || !user.shopId) return res.status(404).json({ ok: false, message: "Tenant user not found" });

  const data = {};
  if (parsed.data.active !== undefined) data.active = parsed.data.active;
  if (parsed.data.name !== undefined) data.name = parsed.data.name;
  if (parsed.data.role !== undefined) data.role = parsed.data.role;
  if (parsed.data.permissions !== undefined) data.permissions = parsed.data.permissions;

  const updated = await prisma.user.update({
    where: { id: user.id },
    data,
    select: { id: true, username: true, email: true, name: true, role: true, permissions: true, active: true, authProvider: true, lastLoginAt: true, createdAt: true },
  });

  await audit(req, "GRAND_ADMIN_USER_UPDATED", "user", user.id, data);
  res.json({ ok: true, user: updated });
}

async function resetUserPassword(req, res) {
  const parsed = resetPasswordSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ ok: false, message: "Invalid password reset", errors: parsed.error.flatten().fieldErrors });

  const user = await prisma.user.findUnique({ where: { id: req.params.userId }, select: { id: true, shopId: true } });
  if (!user || !user.shopId) return res.status(404).json({ ok: false, message: "Tenant user not found" });

  const passwordHash = await bcrypt.hash(parsed.data.password, 12);
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash, passwordMustChange: parsed.data.mustChange },
  });

  await audit(req, "GRAND_ADMIN_PASSWORD_RESET", "user", user.id, { mustChange: parsed.data.mustChange });
  res.json({ ok: true, message: "Password reset completed" });
}

async function auditLogs(req, res) {
  const shopId = String(req.query.shopId || "").trim();
  const rows = await prisma.auditLog.findMany({
    where: shopId ? { shopId } : {},
    orderBy: { createdAt: "desc" },
    take: Math.min(Number(req.query.limit || 100), 300),
    include: {
      user: { select: { name: true, username: true, role: true } },
      shop: { select: { id: true, name: true, code: true, slug: true } },
    },
  });
  res.json({ ok: true, rows });
}

function attachGrandAdminCentralControlApi(app) {
  app.get("/api/grand-admin/overview", requireAuth, requireGrandAdmin, overview);
  app.get("/api/grand-admin/shops", requireAuth, requireGrandAdmin, listShops);
  app.patch("/api/grand-admin/shops/:shopId", requireAuth, requireGrandAdmin, updateShop);
  app.get("/api/grand-admin/shops/:shopId/users", requireAuth, requireGrandAdmin, listShopUsers);
  app.patch("/api/grand-admin/users/:userId", requireAuth, requireGrandAdmin, updateUser);
  app.patch("/api/grand-admin/users/:userId/password", requireAuth, requireGrandAdmin, resetUserPassword);
  app.get("/api/grand-admin/audit-logs", requireAuth, requireGrandAdmin, auditLogs);
}

module.exports = attachGrandAdminCentralControlApi;
