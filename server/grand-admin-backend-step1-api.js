const { z } = require("zod");
const { prisma } = require("./prisma");
const { uniqueShopSlug } = require("./auth-api");
const {
  GRAND_ADMIN_FEATURE_KEYS,
  normalizeTenantId,
  writeGrandAdminAudit,
} = require("./grand-admin-auth-guard");

const DEFAULT_FEATURE_PERMISSIONS = GRAND_ADMIN_FEATURE_KEYS.reduce((acc, key) => {
  acc[key] = false;
  return acc;
}, {});

function safeSettings(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function textOrNull(value) {
  const text = String(value || "").trim();
  return text || null;
}

function tenantStatusFromSettings(settings, shop) {
  const platform = safeSettings(settings.platform);
  if (platform.tenantPortalStatus) return platform.tenantPortalStatus;
  if (platform.adminPortalEnabled === true && shop.active) return "ACTIVE";
  return "DRAFT";
}

function shopStatusFromSettings(settings, shop) {
  const platform = safeSettings(settings.platform);
  if (platform.shopStatus) return platform.shopStatus;
  return shop.active ? "ACTIVE" : "DRAFT";
}

function featurePermissionsFromSettings(settings) {
  const platform = safeSettings(settings.platform);
  return {
    ...DEFAULT_FEATURE_PERMISSIONS,
    ...safeSettings(platform.featurePermissions),
  };
}

async function upsertPlatformSettings(tx, shopId, platformPatch = {}, tenantPatch = {}) {
  const current = await tx.shopSettings.upsert({
    where: { shopId },
    update: {},
    create: { shopId },
  });
  const settings = safeSettings(current.settings);
  const platform = safeSettings(settings.platform);
  const tenant = safeSettings(settings.tenant);

  return tx.shopSettings.update({
    where: { shopId },
    data: {
      settings: {
        ...settings,
        tenant: { ...tenant, ...tenantPatch },
        platform: {
          ...platform,
          ...platformPatch,
          lastGrandAdminStep1UpdateAt: new Date().toISOString(),
        },
      },
    },
  });
}

async function assertUniqueTenantId(tx, tenantId, currentShopId = null) {
  if (!tenantId) return;
  const existing = await tx.shop.findUnique({ where: { code: tenantId }, select: { id: true } });
  if (existing && existing.id !== currentShopId) {
    const error = new Error("Tenant ID already exists");
    error.statusCode = 409;
    throw error;
  }
}

async function shopView(shop) {
  const rawSettings = safeSettings(shop.settings?.settings);
  const tenant = safeSettings(rawSettings.tenant);
  const subscription = shop.subscriptions?.[0] || null;
  const tenantPortalStatus = tenantStatusFromSettings(rawSettings, shop);
  return {
    id: shop.id,
    shopId: shop.id,
    tenantId: shop.code || tenant.manualTenantId || shop.slug,
    manualTenantId: shop.code || tenant.manualTenantId || "",
    code: shop.code || "",
    slug: shop.slug,
    name: shop.name,
    shopName: shop.name,
    businessName: tenant.businessName || shop.name,
    ownerName: tenant.ownerName || "",
    phone: shop.phone || "",
    email: tenant.email || "",
    address: shop.address || "",
    city: tenant.city || "",
    businessType: shop.businessType || "PHONE_SHOP",
    active: shop.active,
    status: shopStatusFromSettings(rawSettings, shop),
    tenantPortalStatus,
    subscriptionStatus: subscription?.status || "TRIAL",
    adminPortalEnabled: tenantPortalStatus === "ACTIVE",
    featurePermissions: featurePermissionsFromSettings(rawSettings),
    createdAt: shop.createdAt,
    updatedAt: shop.updatedAt,
    subscription,
  };
}

async function fetchShop(shopId, tx = prisma) {
  return tx.shop.findUnique({
    where: { id: shopId },
    include: {
      settings: true,
      subscriptions: { orderBy: { endsAt: "desc" }, take: 1 },
    },
  });
}

const createShopSchema = z.object({
  name: z.string().trim().min(1).max(180).optional(),
  shopName: z.string().trim().min(1).max(180).optional(),
  businessName: z.string().trim().max(180).optional(),
  ownerName: z.string().trim().max(180).optional(),
  phone: z.string().trim().max(80).optional(),
  email: z.string().trim().email().max(180).optional().or(z.literal("")),
  address: z.string().trim().max(300).optional(),
  city: z.string().trim().max(120).optional(),
  tenantId: z.string().trim().min(2).max(80).optional(),
  businessType: z.enum(["PHONE_SHOP", "MINI_MART"]).default("PHONE_SHOP"),
});

const tenantIdSchema = z.object({ tenantId: z.string().trim().min(2).max(80) });
const featuresSchema = z.object({
  features: z.record(z.boolean()).optional(),
  featurePermissions: z.record(z.boolean()).optional(),
});

async function createShopDraft(req, res) {
  const parsed = createShopSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ ok: false, message: "Invalid shop draft", errors: parsed.error.flatten().fieldErrors });

  const input = parsed.data;
  const shopName = input.shopName || input.name;
  if (!shopName) return res.status(400).json({ ok: false, message: "Shop name is required" });

  const tenantId = input.tenantId ? normalizeTenantId(input.tenantId) : null;
  if (input.tenantId && !tenantId) return res.status(400).json({ ok: false, message: "Invalid Tenant ID" });

  try {
    const created = await prisma.$transaction(async (tx) => {
      await assertUniqueTenantId(tx, tenantId);
      const slug = await uniqueShopSlug(shopName, tx);
      const shop = await tx.shop.create({
        data: {
          slug,
          code: tenantId,
          name: shopName.trim(),
          businessType: input.businessType,
          phone: textOrNull(input.phone),
          address: textOrNull(input.address),
          active: false,
        },
      });
      await upsertPlatformSettings(tx, shop.id, {
        createdByGrandAdminId: req.auth.userId,
        createdByGrandAdminAt: new Date().toISOString(),
        shopStatus: "DRAFT",
        tenantPortalStatus: "DRAFT",
        subscriptionStatus: "TRIAL",
        adminPortalEnabled: false,
        featurePermissions: { ...DEFAULT_FEATURE_PERMISSIONS },
      }, {
        manualTenantId: tenantId,
        businessName: textOrNull(input.businessName) || shopName.trim(),
        ownerName: textOrNull(input.ownerName),
        email: textOrNull(input.email),
        city: textOrNull(input.city),
      });
      return fetchShop(shop.id, tx);
    });

    await writeGrandAdminAudit(req, "SHOP_CREATED", "shop", created.id, { tenantId, shopStatus: "DRAFT", tenantPortalStatus: "DRAFT" });
    return res.status(201).json({ ok: true, shop: await shopView(created) });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ ok: false, message: error.message || "Shop draft creation failed" });
  }
}

async function assignTenantId(req, res) {
  const parsed = tenantIdSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ ok: false, message: "Invalid Tenant ID", errors: parsed.error.flatten().fieldErrors });

  const shopId = req.params.shopId;
  const tenantId = normalizeTenantId(parsed.data.tenantId);
  if (!tenantId) return res.status(400).json({ ok: false, message: "Invalid Tenant ID" });

  try {
    const result = await prisma.$transaction(async (tx) => {
      const before = await tx.shop.findUnique({ where: { id: shopId }, select: { code: true } });
      if (!before) {
        const error = new Error("Shop not found");
        error.statusCode = 404;
        throw error;
      }
      await assertUniqueTenantId(tx, tenantId, shopId);
      await tx.shop.update({ where: { id: shopId }, data: { code: tenantId } });
      await upsertPlatformSettings(tx, shopId, { tenantIdAssignedAt: new Date().toISOString() }, { manualTenantId: tenantId });
      return { before: before.code || null, shop: await fetchShop(shopId, tx) };
    });

    await writeGrandAdminAudit(req, result.before ? "TENANT_ID_CHANGED" : "TENANT_ID_ASSIGNED", "shop", shopId, { before: result.before, after: tenantId });
    return res.json({ ok: true, shop: await shopView(result.shop) });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ ok: false, message: error.message || "Tenant ID assignment failed" });
  }
}

async function getShopFeatures(req, res) {
  const shop = await fetchShop(req.params.shopId);
  if (!shop) return res.status(404).json({ ok: false, message: "Shop not found" });
  const settings = safeSettings(shop.settings?.settings);
  return res.json({ ok: true, shopId: shop.id, tenantId: shop.code || shop.slug, features: featurePermissionsFromSettings(settings), featureKeys: GRAND_ADMIN_FEATURE_KEYS });
}

async function updateShopFeatures(req, res) {
  const parsed = featuresSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ ok: false, message: "Invalid feature permissions", errors: parsed.error.flatten().fieldErrors });
  const features = { ...DEFAULT_FEATURE_PERMISSIONS, ...(parsed.data.features || parsed.data.featurePermissions || {}) };
  await prisma.$transaction((tx) => upsertPlatformSettings(tx, req.params.shopId, { featurePermissions: features }, {}));
  await writeGrandAdminAudit(req, "FEATURE_PERMISSION_CONFIGURED", "shop", req.params.shopId, { featureKeys: Object.keys(features) });
  return res.json({ ok: true, shopId: req.params.shopId, features, featureKeys: GRAND_ADMIN_FEATURE_KEYS });
}

async function subscriptionPlans(_req, res) {
  return res.json({
    ok: true,
    plans: [
      { id: "starter", name: "Starter", price: 50000, billingCycle: "MONTHLY", enabledFeatures: ["dashboard", "sales", "products"] },
      { id: "standard", name: "Standard", price: 80000, billingCycle: "MONTHLY", enabledFeatures: ["dashboard", "sales", "products", "stock", "repairs", "customers"] },
      { id: "pro", name: "Pro", price: 120000, billingCycle: "MONTHLY", enabledFeatures: GRAND_ADMIN_FEATURE_KEYS },
    ],
  });
}

function serviceRow(serviceName, serviceType, status, configured) {
  return { serviceName, serviceType, status, configured, enabled: true, checkedAt: new Date().toISOString() };
}

async function systemHealth(_req, res) {
  return res.json({
    ok: true,
    services: [
      serviceRow("Core POS API", "api", "OK", true),
      serviceRow("Database", "database", process.env.DATABASE_URL ? "OK" : "UNKNOWN", Boolean(process.env.DATABASE_URL)),
      serviceRow("Mail Server", "mail", process.env.SMTP_HOST || process.env.MAIL_HOST || process.env.EMAIL_HOST ? "CONFIGURED" : "NOT_CONFIGURED", Boolean(process.env.SMTP_HOST || process.env.MAIL_HOST || process.env.EMAIL_HOST)),
      serviceRow("SMS Gateway", "sms", process.env.SMS_GATEWAY_URL || process.env.SMS_API_KEY ? "CONFIGURED" : "NOT_CONFIGURED", Boolean(process.env.SMS_GATEWAY_URL || process.env.SMS_API_KEY)),
      serviceRow("Payment Gateway", "payment", process.env.PAYMENT_GATEWAY_URL || process.env.PAYMENT_API_KEY ? "CONFIGURED" : "NOT_CONFIGURED", Boolean(process.env.PAYMENT_GATEWAY_URL || process.env.PAYMENT_API_KEY)),
      serviceRow("Google OAuth", "oauth", process.env.GOOGLE_CLIENT_ID ? "CONFIGURED" : "NOT_CONFIGURED", Boolean(process.env.GOOGLE_CLIENT_ID)),
      serviceRow("Google Sheet Sync", "sync", "UNKNOWN", false),
      serviceRow("Telegram Bot", "telegram", process.env.TELEGRAM_BOT_TOKEN ? "CONFIGURED" : "NOT_CONFIGURED", Boolean(process.env.TELEGRAM_BOT_TOKEN)),
    ],
  });
}

function attachGrandAdminBackendStep1Api(app) {
  app.post("/api/grand-admin/shops", createShopDraft);
  app.post("/api/grand-admin/shops/:shopId/assign-tenant-id", assignTenantId);
  app.get("/api/grand-admin/shops/:shopId/features", getShopFeatures);
  app.patch("/api/grand-admin/shops/:shopId/features", updateShopFeatures);
  app.get("/api/grand-admin/subscription-plans", subscriptionPlans);
  app.get("/api/grand-admin/system-health", systemHealth);
  app.get("/api/grand-admin/integrations/status", systemHealth);
}

module.exports = attachGrandAdminBackendStep1Api;
