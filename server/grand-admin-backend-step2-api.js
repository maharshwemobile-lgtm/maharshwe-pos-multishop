const bcrypt = require("bcryptjs");
const { z } = require("zod");
const { prisma } = require("./prisma");
const {
  SHOP_ADMIN_PERMISSIONS,
  addDays,
  normalizeUsername,
} = require("./auth-api");
const {
  generateTemporaryPassword,
  sendGoogleTemporaryPasswordEmail,
} = require("./mail-service");
const {
  normalizeStatus,
  writeGrandAdminAudit,
} = require("./grand-admin-auth-guard");

const USER_STATUS = ["ACTIVE", "SUSPENDED", "LOCKED", "PENDING_SETUP", "PASSWORD_RESET_REQUIRED", "DELETED"];
const SPEC_SUBSCRIPTION_STATUS = ["TRIAL", "ACTIVE", "PAST_DUE", "EXPIRED", "CANCELLED", "SUSPENDED", "DELETED"];
const LEGACY_SUBSCRIPTION_STATUS = ["TRIAL", "ACTIVE", "OVERDUE", "SUSPENDED"];
const TENANT_PORTAL_STATUS = ["DRAFT", "PENDING_ACTIVATION", "ACTIVE", "SUSPENDED", "EXPIRED", "CANCELLED", "DELETED"];

function safeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function text(value, max = 500) {
  return String(value || "").trim().slice(0, max);
}

function textOrNull(value, max = 500) {
  const cleaned = text(value, max);
  return cleaned || null;
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || "").trim());
}

function platformFromShop(shop) {
  const settings = safeObject(shop?.settings?.settings);
  return safeObject(settings.platform);
}

function tenantFromShop(shop) {
  const settings = safeObject(shop?.settings?.settings);
  return safeObject(settings.tenant);
}

function tenantPortalStatus(shop) {
  const platform = platformFromShop(shop);
  if (platform.tenantPortalStatus) return platform.tenantPortalStatus;
  if (platform.adminPortalEnabled === true && shop?.active) return "ACTIVE";
  return "DRAFT";
}

function userStatus(user) {
  const permissions = safeObject(user?.permissions);
  return normalizeStatus(permissions.__status, USER_STATUS, user?.active ? "ACTIVE" : "SUSPENDED");
}

function legacySubscriptionStatus(value) {
  const status = normalizeStatus(value, [...SPEC_SUBSCRIPTION_STATUS, ...LEGACY_SUBSCRIPTION_STATUS], "TRIAL");
  if (status === "PAST_DUE" || status === "EXPIRED") return "OVERDUE";
  if (status === "CANCELLED" || status === "DELETED") return "SUSPENDED";
  return LEGACY_SUBSCRIPTION_STATUS.includes(status) ? status : "TRIAL";
}

function specSubscriptionStatus(value) {
  const status = normalizeStatus(value, [...SPEC_SUBSCRIPTION_STATUS, ...LEGACY_SUBSCRIPTION_STATUS], "TRIAL");
  if (status === "OVERDUE") return "PAST_DUE";
  return SPEC_SUBSCRIPTION_STATUS.includes(status) ? status : "TRIAL";
}

async function shopSettingsPatch(tx, shopId, platformPatch = {}, tenantPatch = {}) {
  const current = await tx.shopSettings.upsert({
    where: { shopId },
    update: {},
    create: { shopId },
  });
  const settings = safeObject(current.settings);
  const platform = safeObject(settings.platform);
  const tenant = safeObject(settings.tenant);
  return tx.shopSettings.update({
    where: { shopId },
    data: {
      settings: {
        ...settings,
        tenant: { ...tenant, ...tenantPatch },
        platform: {
          ...platform,
          ...platformPatch,
          lastGrandAdminStep2UpdateAt: new Date().toISOString(),
        },
      },
    },
  });
}

async function fetchShop(shopId, tx = prisma) {
  return tx.shop.findUnique({
    where: { id: shopId },
    include: {
      settings: true,
      subscriptions: { orderBy: { endsAt: "desc" }, take: 1 },
      users: { where: { role: "SHOP_ADMIN" }, orderBy: { createdAt: "asc" }, take: 5 },
    },
  });
}

function serializeUser(user) {
  if (!user) return null;
  const permissions = safeObject(user.permissions);
  return {
    id: user.id,
    userId: user.id,
    shopId: user.shopId,
    username: user.username,
    email: user.email || null,
    name: user.name,
    role: user.role,
    active: user.active,
    status: userStatus(user),
    passwordMustChange: Boolean(user.passwordMustChange),
    authProvider: user.authProvider || null,
    providerId: user.providerId ? "linked" : null,
    googleLinkAllowed: Boolean(permissions.__googleLinkAllowed || user.email),
    phone: user.shop?.phone || null,
    shop: user.shop || null,
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt || null,
  };
}

function serializeSubscription(row, shop) {
  const platform = platformFromShop(shop);
  if (!row) {
    return {
      id: null,
      status: platform.subscriptionStatus || "TRIAL",
      legacyStatus: null,
      startsAt: null,
      endsAt: null,
      renewedAt: null,
      monthlyFee: 0,
      setupFee: 0,
      bundleBudget: Number(platform.bundleBudget || 0),
      plan: platform.subscriptionPlan || "starter",
      notes: "",
    };
  }
  return {
    id: row.id,
    status: platform.subscriptionStatus || specSubscriptionStatus(row.status),
    legacyStatus: row.status,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    renewedAt: row.renewedAt || null,
    monthlyFee: Number(row.monthlyFee || 0),
    setupFee: Number(row.setupFee || 0),
    bundleBudget: Number(platform.bundleBudget || 0),
    plan: platform.subscriptionPlan || "starter",
    customDays: platform.subscriptionCustomDays || null,
    notes: row.notes || "",
  };
}

async function assertShopDraftForTenantAdmin(shop) {
  if (!shop) {
    const error = new Error("Shop not found");
    error.statusCode = 404;
    throw error;
  }
  const portalStatus = tenantPortalStatus(shop);
  if (portalStatus === "ACTIVE") {
    const error = new Error("Tenant portal is already ACTIVE. Suspend or edit the existing tenant admin instead.");
    error.statusCode = 409;
    throw error;
  }
}

async function assertUserUnique(tx, { shopId, username, email, currentUserId = null }) {
  const normalizedUsername = normalizeUsername(username);
  const usernameUser = await tx.user.findFirst({
    where: { shopId, normalizedUsername },
    select: { id: true },
  });
  if (usernameUser && usernameUser.id !== currentUserId) {
    const error = new Error("Username already exists for this shop");
    error.statusCode = 409;
    throw error;
  }
  if (email) {
    const emailUser = await tx.user.findUnique({ where: { email }, select: { id: true } }).catch(() => null);
    if (emailUser && emailUser.id !== currentUserId) {
      const error = new Error("Email already exists");
      error.statusCode = 409;
      throw error;
    }
  }
}

function tenantAdminPermissions({ status = "PENDING_SETUP", googleLinkAllowed = false, extra = {} } = {}) {
  return {
    ...SHOP_ADMIN_PERMISSIONS,
    ...safeObject(extra),
    __status: status,
    __createdByGrandAdmin: true,
    __googleLinkAllowed: Boolean(googleLinkAllowed),
  };
}

const tenantAdminSchema = z.object({
  username: z.string().trim().min(2).max(80).optional(),
  email: z.string().trim().email().max(180).optional().or(z.literal("")),
  name: z.string().trim().min(1).max(180).optional(),
  password: z.string().min(8).max(200).optional(),
  googleAccount: z.boolean().optional().default(false),
  googleEmail: z.string().trim().email().max(180).optional().or(z.literal("")),
  phone: z.string().trim().max(80).optional(),
  sendEmail: z.boolean().optional().default(false),
});

async function createTenantAdmin(req, res) {
  const parsed = tenantAdminSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ ok: false, message: "Invalid tenant admin request", errors: parsed.error.flatten().fieldErrors });

  const input = parsed.data;
  const shopId = req.params.shopId;
  const email = normalizeEmail(input.email || input.googleEmail || "");
  const username = text(input.username || email, 80);
  const name = text(input.name || username || email || "Tenant Admin", 180);
  if (!username) return res.status(400).json({ ok: false, message: "Username or email is required" });

  const temporaryPassword = input.password || generateTemporaryPassword();
  const passwordHash = await bcrypt.hash(temporaryPassword, 12);
  const normalizedUsername = normalizeUsername(username);

  try {
    const created = await prisma.$transaction(async (tx) => {
      const shop = await fetchShop(shopId, tx);
      await assertShopDraftForTenantAdmin(shop);
      await assertUserUnique(tx, { shopId, username, email });

      const user = await tx.user.create({
        data: {
          shopId,
          email: email || null,
          username,
          normalizedUsername,
          passwordHash,
          passwordMustChange: true,
          name,
          role: "SHOP_ADMIN",
          permissions: tenantAdminPermissions({ status: "PENDING_SETUP", googleLinkAllowed: Boolean(email || input.googleAccount) }),
          active: false,
        },
        include: { shop: { select: { id: true, name: true, code: true, slug: true, phone: true } } },
      });

      await shopSettingsPatch(tx, shopId, {
        tenantAdminUserId: user.id,
        tenantAdminStatus: "PENDING_SETUP",
        tenantPortalStatus: "PENDING_ACTIVATION",
        tenantAdminCreatedAt: new Date().toISOString(),
        tenantAdminLoginEnabled: false,
      }, {
        tenantAdminEmail: email || null,
        tenantAdminUsername: username,
        tenantAdminName: name,
        phone: textOrNull(input.phone),
      });

      return user;
    });

    await writeGrandAdminAudit(req, "USER_CREATED", "user", created.id, { shopId, role: "SHOP_ADMIN", status: "PENDING_SETUP" });
    await writeGrandAdminAudit(req, "TENANT_ADMIN_CREATED", "shop", shopId, { userId: created.id, email: email || null, username });

    let emailResult = null;
    if (parsed.data.sendEmail && email) {
      emailResult = await sendGoogleTemporaryPasswordEmail({
        to: email,
        name,
        shopName: created.shop?.name,
        shopSlug: created.shop?.slug,
        tenantId: created.shop?.code,
        username,
        temporaryPassword,
      });
    }

    return res.status(201).json({
      ok: true,
      user: serializeUser(created),
      temporaryPassword: input.password ? null : temporaryPassword,
      passwordMustChange: true,
      emailResult,
      note: "Tenant admin is PENDING_SETUP and inactive until tenant portal activation.",
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ ok: false, message: error.message || "Tenant admin creation failed" });
  }
}

const authSetupSchema = z.object({
  username: z.string().trim().min(2).max(80).optional(),
  email: z.string().trim().email().max(180).optional().or(z.literal("")),
  password: z.string().min(8).max(200).optional(),
  passwordMustChange: z.boolean().optional(),
  googleLinkAllowed: z.boolean().optional(),
  status: z.enum(USER_STATUS).optional(),
});

async function updateUserAuthSetup(req, res) {
  const parsed = authSetupSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ ok: false, message: "Invalid user auth setup", errors: parsed.error.flatten().fieldErrors });
  const input = parsed.data;
  const userId = req.params.userId;

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const current = await tx.user.findUnique({ where: { id: userId }, include: { shop: { select: { id: true, name: true, code: true, slug: true, phone: true } } } });
      if (!current || !current.shopId) {
        const error = new Error("Tenant user not found");
        error.statusCode = 404;
        throw error;
      }
      const username = input.username || current.username;
      const email = input.email !== undefined ? normalizeEmail(input.email) : current.email;
      await assertUserUnique(tx, { shopId: current.shopId, username, email, currentUserId: current.id });
      const permissions = safeObject(current.permissions);
      const data = {
        username,
        normalizedUsername: normalizeUsername(username),
        email: email || null,
        permissions: {
          ...permissions,
          ...(input.status ? { __status: input.status } : {}),
          ...(input.googleLinkAllowed !== undefined ? { __googleLinkAllowed: input.googleLinkAllowed } : {}),
        },
      };
      if (input.password) data.passwordHash = await bcrypt.hash(input.password, 12);
      if (input.passwordMustChange !== undefined) data.passwordMustChange = input.passwordMustChange;
      return tx.user.update({
        where: { id: current.id },
        data,
        include: { shop: { select: { id: true, name: true, code: true, slug: true, phone: true } } },
      });
    });

    await writeGrandAdminAudit(req, "USER_AUTH_SETUP_UPDATED", "user", updated.id, { shopId: updated.shopId, status: userStatus(updated), googleLinkAllowed: safeObject(updated.permissions).__googleLinkAllowed === true });
    return res.json({ ok: true, user: serializeUser(updated) });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ ok: false, message: error.message || "User auth setup failed" });
  }
}

const googleLinkSchema = z.object({
  email: z.string().trim().email().max(180),
  allowLink: z.boolean().optional().default(true),
});

async function allowGoogleLink(req, res) {
  const parsed = googleLinkSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ ok: false, message: "Invalid Google link request", errors: parsed.error.flatten().fieldErrors });
  const email = normalizeEmail(parsed.data.email);
  try {
    const updated = await prisma.$transaction(async (tx) => {
      const current = await tx.user.findUnique({ where: { id: req.params.userId }, include: { shop: { select: { id: true, name: true, code: true, slug: true, phone: true } } } });
      if (!current || !current.shopId) {
        const error = new Error("Tenant user not found");
        error.statusCode = 404;
        throw error;
      }
      await assertUserUnique(tx, { shopId: current.shopId, username: current.username, email, currentUserId: current.id });
      return tx.user.update({
        where: { id: current.id },
        data: {
          email,
          permissions: {
            ...safeObject(current.permissions),
            __googleLinkAllowed: parsed.data.allowLink,
          },
        },
        include: { shop: { select: { id: true, name: true, code: true, slug: true, phone: true } } },
      });
    });
    await writeGrandAdminAudit(req, "GOOGLE_ACCOUNT_LINK_ALLOWED", "user", updated.id, { email, allowLink: parsed.data.allowLink });
    return res.json({ ok: true, user: serializeUser(updated), note: "Google will link on first verified Google login with this email after the user is active." });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ ok: false, message: error.message || "Google link setup failed" });
  }
}

const subscriptionSchema = z.object({
  status: z.enum([...SPEC_SUBSCRIPTION_STATUS, ...LEGACY_SUBSCRIPTION_STATUS]).optional(),
  plan: z.string().trim().max(80).optional(),
  monthlyFee: z.number().min(0).optional(),
  setupFee: z.number().min(0).optional(),
  bundleBudget: z.number().min(0).optional(),
  customDays: z.number().int().min(1).max(3660).optional(),
  startsAt: z.string().optional(),
  endsAt: z.string().optional(),
  notes: z.string().trim().max(800).optional(),
});

async function getSubscription(req, res) {
  const shop = await fetchShop(req.params.shopId);
  if (!shop) return res.status(404).json({ ok: false, message: "Shop not found" });
  return res.json({ ok: true, shopId: shop.id, subscription: serializeSubscription(shop.subscriptions?.[0], shop) });
}

async function upsertSubscription(req, res) {
  const parsed = subscriptionSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ ok: false, message: "Invalid subscription request", errors: parsed.error.flatten().fieldErrors });
  const input = parsed.data;
  const shopId = req.params.shopId;
  try {
    const result = await prisma.$transaction(async (tx) => {
      const shop = await fetchShop(shopId, tx);
      if (!shop) {
        const error = new Error("Shop not found");
        error.statusCode = 404;
        throw error;
      }
      const latest = shop.subscriptions?.[0] || null;
      const now = new Date();
      const data = {
        status: legacySubscriptionStatus(input.status || latest?.status || "TRIAL"),
        startsAt: input.startsAt ? new Date(input.startsAt) : latest?.startsAt || now,
        endsAt: input.endsAt ? new Date(input.endsAt) : latest?.endsAt || addDays(now, input.customDays || 30),
        monthlyFee: input.monthlyFee ?? latest?.monthlyFee ?? 50000,
        setupFee: input.setupFee ?? latest?.setupFee ?? 0,
        notes: input.notes ?? latest?.notes ?? "Updated by Grand Super Admin",
      };
      const subscription = latest
        ? await tx.subscription.update({ where: { id: latest.id }, data })
        : await tx.subscription.create({ data: { shopId, ...data } });
      await shopSettingsPatch(tx, shopId, {
        subscriptionStatus: specSubscriptionStatus(input.status || data.status),
        subscriptionPlan: input.plan || platformFromShop(shop).subscriptionPlan || "starter",
        bundleBudget: input.bundleBudget ?? platformFromShop(shop).bundleBudget ?? 0,
        subscriptionCustomDays: input.customDays || platformFromShop(shop).subscriptionCustomDays || null,
      }, {});
      return { shop: await fetchShop(shopId, tx), subscription };
    });
    await writeGrandAdminAudit(req, "SUBSCRIPTION_UPDATED", "shop", shopId, { subscriptionId: result.subscription.id, status: result.subscription.status, plan: parsed.data.plan || null, bundleBudget: parsed.data.bundleBudget || null });
    return res.json({ ok: true, subscription: serializeSubscription(result.shop.subscriptions?.[0], result.shop) });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ ok: false, message: error.message || "Subscription update failed" });
  }
}

const renewSchema = z.object({
  days: z.number().int().min(1).max(3660).optional(),
  months: z.number().int().min(1).max(120).optional(),
  customDays: z.number().int().min(1).max(3660).optional(),
  plan: z.string().trim().max(80).optional(),
  monthlyFee: z.number().min(0).optional(),
  bundleBudget: z.number().min(0).optional(),
  notes: z.string().trim().max(800).optional(),
});

async function renewSubscription(req, res) {
  const parsed = renewSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ ok: false, message: "Invalid renewal request", errors: parsed.error.flatten().fieldErrors });
  const input = parsed.data;
  const days = input.customDays || input.days || (input.months ? input.months * 30 : 30);
  const shopId = req.params.shopId;
  try {
    const result = await prisma.$transaction(async (tx) => {
      const shop = await fetchShop(shopId, tx);
      if (!shop) {
        const error = new Error("Shop not found");
        error.statusCode = 404;
        throw error;
      }
      const latest = shop.subscriptions?.[0] || null;
      const now = new Date();
      const base = latest?.endsAt && latest.endsAt > now ? latest.endsAt : now;
      const newEndsAt = addDays(base, days);
      const subscription = latest
        ? await tx.subscription.update({ where: { id: latest.id }, data: { status: "ACTIVE", endsAt: newEndsAt, renewedAt: now, monthlyFee: input.monthlyFee ?? latest.monthlyFee, notes: input.notes || latest.notes || `Renewed for ${days} days` } })
        : await tx.subscription.create({ data: { shopId, status: "ACTIVE", startsAt: now, endsAt: newEndsAt, renewedAt: now, monthlyFee: input.monthlyFee ?? 50000, notes: input.notes || `Renewed for ${days} days` } });
      await shopSettingsPatch(tx, shopId, { subscriptionStatus: "ACTIVE", subscriptionPlan: input.plan || platformFromShop(shop).subscriptionPlan || "starter", bundleBudget: input.bundleBudget ?? platformFromShop(shop).bundleBudget ?? 0, subscriptionCustomDays: input.customDays || null }, {});
      if (tx.adminRenewalHistory?.create) {
        await tx.adminRenewalHistory.create({
          data: {
            shopId,
            tenantId: shop.code || shop.slug,
            shopName: shop.name,
            subscriptionId: subscription.id,
            plan: input.plan || platformFromShop(shop).subscriptionPlan || "starter",
            months: input.months || null,
            customDays: input.customDays || input.days || null,
            durationLabel: `${days} days`,
            previousEndsAt: latest?.endsAt || null,
            startsAt: now,
            newEndsAt,
            note: input.notes || null,
            renewedBy: req.auth?.userId || null,
            metadataJson: { source: "grand-admin", bundleBudget: input.bundleBudget ?? null },
          },
        });
      }
      return fetchShop(shopId, tx);
    });
    await writeGrandAdminAudit(req, "SUBSCRIPTION_RENEWED", "shop", shopId, { days, plan: input.plan || null, bundleBudget: input.bundleBudget ?? null });
    return res.json({ ok: true, subscription: serializeSubscription(result.subscriptions?.[0], result) });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ ok: false, message: error.message || "Subscription renewal failed" });
  }
}

async function cancelSubscription(req, res) {
  const shopId = req.params.shopId;
  try {
    const result = await prisma.$transaction(async (tx) => {
      const shop = await fetchShop(shopId, tx);
      if (!shop) {
        const error = new Error("Shop not found");
        error.statusCode = 404;
        throw error;
      }
      const latest = shop.subscriptions?.[0] || null;
      if (latest) await tx.subscription.update({ where: { id: latest.id }, data: { status: "SUSPENDED", notes: `${latest.notes || ""}\nCancelled by Grand Super Admin`.trim() } });
      await shopSettingsPatch(tx, shopId, { subscriptionStatus: "CANCELLED" }, {});
      return fetchShop(shopId, tx);
    });
    await writeGrandAdminAudit(req, "SUBSCRIPTION_CANCELLED", "shop", shopId, {});
    return res.json({ ok: true, subscription: serializeSubscription(result.subscriptions?.[0], result) });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ ok: false, message: error.message || "Subscription cancel failed" });
  }
}

function userWhereFromQuery(query) {
  const where = { shopId: { not: null } };
  if (query.shopId && isUuid(query.shopId)) where.shopId = query.shopId;
  if (query.role) where.role = String(query.role).toUpperCase();
  if (query.provider) where.authProvider = String(query.provider).toLowerCase();
  const status = String(query.status || "").toUpperCase();
  if (status === "ACTIVE") where.active = true;
  if (["SUSPENDED", "PENDING_SETUP", "DELETED"].includes(status)) where.active = false;
  const q = text(query.q, 120);
  if (q) {
    where.OR = [
      { username: { contains: q, mode: "insensitive" } },
      { normalizedUsername: { contains: q.toLowerCase(), mode: "insensitive" } },
      { email: { contains: q.toLowerCase(), mode: "insensitive" } },
      { name: { contains: q, mode: "insensitive" } },
      { shop: { name: { contains: q, mode: "insensitive" } } },
      { shop: { code: { contains: q.toUpperCase(), mode: "insensitive" } } },
    ];
  }
  return where;
}

async function listTenantUsers(req, res) {
  const where = userWhereFromQuery(req.query || {});
  const limit = Math.min(Number(req.query.limit || 200), 1000);
  const users = await prisma.user.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: { shop: { select: { id: true, name: true, code: true, slug: true, phone: true } } },
    take: limit,
  });
  const serialized = users.map(serializeUser);
  const emails = serialized.map((user) => user.email).filter(Boolean);
  const phones = serialized.map((user) => user.phone).filter(Boolean);
  const marketingRows = serialized.map((user) => ({
    userId: user.id,
    shopId: user.shopId,
    shopName: user.shop?.name || null,
    tenantId: user.shop?.code || user.shop?.slug || null,
    name: user.name,
    email: user.email,
    phone: user.phone,
    loginType: user.authProvider === "google" ? "Google" : "Password",
    status: user.status,
    lastLoginAt: user.lastLoginAt,
  }));
  return res.json({ ok: true, users: serialized, export: { emails, phones, marketingRows } });
}

async function suspendTenant(req, res) {
  const shopId = req.params.shopId;
  try {
    const result = await prisma.$transaction(async (tx) => {
      const shop = await fetchShop(shopId, tx);
      if (!shop) {
        const error = new Error("Shop not found");
        error.statusCode = 404;
        throw error;
      }
      await tx.shop.update({ where: { id: shopId }, data: { active: false } });
      await tx.user.updateMany({ where: { shopId }, data: { active: false } });
      await shopSettingsPatch(tx, shopId, { shopStatus: "SUSPENDED", tenantPortalStatus: "SUSPENDED", adminPortalEnabled: false, suspendedAt: new Date().toISOString(), suspendedBy: req.auth?.userId || null }, {});
      return fetchShop(shopId, tx);
    });
    await writeGrandAdminAudit(req, "SHOP_SUSPENDED", "shop", shopId, {});
    return res.json({ ok: true, shopId, status: "SUSPENDED", tenantPortalStatus: tenantPortalStatus(result) });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ ok: false, message: error.message || "Tenant suspend failed" });
  }
}

async function deleteTenant(req, res) {
  const shopId = req.params.shopId;
  try {
    const result = await prisma.$transaction(async (tx) => {
      const shop = await fetchShop(shopId, tx);
      if (!shop) {
        const error = new Error("Shop not found");
        error.statusCode = 404;
        throw error;
      }
      const platform = platformFromShop(shop);
      const isSuspended = shop.active === false && (platform.shopStatus === "SUSPENDED" || platform.tenantPortalStatus === "SUSPENDED");
      if (!isSuspended) {
        const error = new Error("Suspend tenant before delete");
        error.statusCode = 409;
        throw error;
      }
      await tx.user.updateMany({ where: { shopId }, data: { active: false } });
      await shopSettingsPatch(tx, shopId, { shopStatus: "DELETED", tenantPortalStatus: "DELETED", adminPortalEnabled: false, deletedAt: new Date().toISOString(), deletedBy: req.auth?.userId || null }, {});
      return fetchShop(shopId, tx);
    });
    await writeGrandAdminAudit(req, "SHOP_DELETED", "shop", shopId, { softDelete: true });
    return res.json({ ok: true, shopId, status: "DELETED", tenantPortalStatus: tenantPortalStatus(result), message: "Tenant soft-deleted after suspension" });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ ok: false, message: error.message || "Tenant delete failed" });
  }
}

function attachGrandAdminBackendStep2Api(app) {
  app.post("/api/grand-admin/shops/:shopId/tenant-admin", createTenantAdmin);
  app.patch("/api/grand-admin/users/:userId/auth-setup", updateUserAuthSetup);
  app.post("/api/grand-admin/users/:userId/google-link", allowGoogleLink);
  app.get("/api/grand-admin/shops/:shopId/subscription", getSubscription);
  app.post("/api/grand-admin/shops/:shopId/subscription", upsertSubscription);
  app.patch("/api/grand-admin/shops/:shopId/subscription", upsertSubscription);
  app.post("/api/grand-admin/shops/:shopId/subscription/renew", renewSubscription);
  app.post("/api/grand-admin/shops/:shopId/subscription/cancel", cancelSubscription);
  app.get("/api/grand-admin/users", listTenantUsers);
  app.post("/api/grand-admin/shops/:shopId/suspend", suspendTenant);
  app.delete("/api/grand-admin/shops/:shopId", deleteTenant);
}

module.exports = attachGrandAdminBackendStep2Api;
