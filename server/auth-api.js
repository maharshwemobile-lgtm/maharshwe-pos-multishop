const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const rateLimit = require("express-rate-limit");
const { z } = require("zod");
const { prisma } = require("./prisma");
const { cleanupDemoData, seedDemoDataForShop } = require("./onboarding-demo-cleanup");

const TOKEN_ISSUER = "maharshwe-pos";
const DEFAULT_EXPIRES_IN = "12h";

function normalizeBusinessType(value) {
  return value === "MINI_MART" ? "MINI_MART" : "PHONE_SHOP";
}

const loginSchema = z.object({
  username: z.string().trim().min(1).max(80),
  password: z.string().min(1).max(200),
  shopSlug: z.string().trim().min(1).max(80).optional(),
  shop: z.string().trim().min(1).max(80).optional(),
});

const registerSchema = z.object({
  shopName: z.string().trim().min(2).max(180),
  shopSlug: z.string().trim().min(2).max(80).optional(),
  ownerName: z.string().trim().min(1).max(180).optional(),
  username: z.string().trim().min(2).max(80),
  password: z.string().min(6).max(200),
  phone: z.string().trim().max(60).optional(),
  businessType: z.enum(["PHONE_SHOP", "MINI_MART"]).default("PHONE_SHOP"),
  address: z.string().trim().max(300).optional(),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(8).max(200),
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-8",
  legacyHeaders: false,
});

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
});

const SHOP_ADMIN_PERMISSIONS = {
  "tab.Dashboard": true,
  "tab.Sale POS": true,
  "tab.Sales History": true,
  "tab.Repairs": true,
  "tab.Partner Settlement": true,
  "tab.Products": true,
  "tab.Stock": true,
  "tab.Purchases": true,
  "tab.Customers": true,
  "tab.Accounting": true,
  "tab.Reports": true,
  "tab.Audit Trail": false,
  "tab.Backup": true,
  "tab.Settings": true,
  sale: true,
  history: true,
  reprint: true,
  export: true,
  discount: true,
  editSale: true,
  deleteSale: true,
  repairs: true,
  repairCreate: true,
  repairEdit: true,
  repairPrint: true,
  repairImport: true,
  inventory: true,
  stockAdjust: true,
  stockHistory: true,
  productEdit: true,
  purchaseApprove: true,
  purchaseReceive: true,
  purchasePayment: true,
  purchaseReturn: true,
  repairParts: true,
  accounting: true,
  settings: true,
  viewCost: true,
};

function normalizeUsername(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeSlug(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeTenantCode(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function addDays(date, days) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function tenantId() {
  return `MS-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
}

async function uniqueTenantId(tx = prisma) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = tenantId();
    const existing = await tx.shop.findUnique({ where: { code }, select: { id: true } });
    if (!existing) return code;
  }
  throw new Error("Could not generate a tenant ID. Please try again.");
}

async function uniqueShopSlug(base, tx = prisma) {
  const normalizedBase = normalizeSlug(base) || `shop-${crypto.randomBytes(2).toString("hex")}`;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const slug = attempt === 0 ? normalizedBase : `${normalizedBase}-${attempt + 1}`;
    const existing = await tx.shop.findUnique({ where: { slug }, select: { id: true } });
    if (!existing) return slug;
  }
  return `${normalizedBase}-${crypto.randomBytes(2).toString("hex")}`;
}

function jwtSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  if (process.env.NODE_ENV === "production") {
    throw new Error("JWT_SECRET is required in production");
  }
  return "dev-only-change-this-jwt-secret";
}

function latestSubscription(shop) {
  return shop?.subscriptions?.[0] || null;
}

function subscriptionView(shop) {
  const subscription = latestSubscription(shop);
  if (!subscription) return null;
  const now = new Date();
  const ended = subscription.endsAt && subscription.endsAt < now;
  const effectiveStatus = ended && !["SUSPENDED"].includes(subscription.status)
    ? "OVERDUE"
    : subscription.status;
  return {
    id: subscription.id,
    status: effectiveStatus,
    storedStatus: subscription.status,
    startsAt: subscription.startsAt,
    endsAt: subscription.endsAt,
    renewedAt: subscription.renewedAt || null,
    expired: effectiveStatus === "OVERDUE",
    accessMode: effectiveStatus === "OVERDUE" ? "SALE_HISTORY_ONLY" : "FULL",
  };
}

function publicShop(shop) {
  if (!shop) return null;
  const subscription = subscriptionView(shop);
  return {
    id: shop.id,
    slug: shop.slug,
    code: shop.code || null,
    tenantId: shop.code || shop.slug,
    name: shop.name,
    businessType: shop.businessType || "PHONE_SHOP",
    active: shop.active,
    subscription,
  };
}

function publicUser(user) {
  const email = user.email || (String(user.username || "").includes("@") ? normalizeUsername(user.username) : null);
  const loginType = user.authProvider === "google" ? "Google" : "Username Password";
  return {
    id: user.id,
    shopId: user.shopId,
    email,
    username: user.username,
    name: user.name,
    avatarUrl: user.avatarUrl || null,
    image: user.avatarUrl || null,
    provider: user.authProvider || null,
    role: user.role,
    permissions: user.permissions || {},
    loginType,
    shop: publicShop(user.shop),
  };
}

function signToken(user) {
  const subscription = subscriptionView(user.shop);
  return jwt.sign(
    {
      sub: user.id,
      shopId: user.shopId,
      shopSlug: user.shop?.slug || null,
      role: user.role,
      permissions: user.permissions || {},
      email: user.email || null,
      loginType: user.authProvider === "google" ? "Google" : "Username Password",
      subscriptionStatus: subscription?.status || null,
      subscriptionAccess: subscription?.accessMode || null,
      tenantId: user.shop?.code || user.shop?.slug || null,
    },
    jwtSecret(),
    {
      expiresIn: process.env.JWT_EXPIRES_IN || DEFAULT_EXPIRES_IN,
      issuer: TOKEN_ISSUER,
    }
  );
}

async function writeAudit({ shopId, userId, action, details, req }) {
  try {
    await prisma.auditLog.create({
      data: {
        shopId: shopId || null,
        userId: userId || null,
        action,
        entityType: "auth",
        details: details || {},
        ipAddress: req?.ip || null,
        userAgent: req?.headers?.["user-agent"] || null,
      },
    });
  } catch (error) {
    console.warn("Audit log write failed:", error.message);
  }
}

async function findLoginUser({ username, shopSlug }) {
  const normalizedUsername = normalizeUsername(username);
  const emailLookup = normalizedUsername.includes("@") ? normalizedUsername : null;
  const loginIdentityFilter = emailLookup
    ? { OR: [{ normalizedUsername }, { email: emailLookup }] }
    : { normalizedUsername };
  const include = {
    shop: {
      include: {
        subscriptions: {
          orderBy: { endsAt: "desc" },
          take: 1,
        },
      },
    },
  };

  if (shopSlug) {
    const slug = normalizeSlug(shopSlug);
    const code = normalizeTenantCode(shopSlug);
    if (!slug && !code) return { user: null, reason: "SHOP_NOT_FOUND" };
    const shop = await prisma.shop.findFirst({
      where: {
        OR: [
          ...(slug ? [{ slug }] : []),
          ...(code ? [{ code }] : []),
        ],
      },
      select: { id: true },
    });
    if (!shop) return { user: null, reason: "SHOP_NOT_FOUND" };

    const user = await prisma.user.findFirst({
      where: { shopId: shop.id, active: true, ...loginIdentityFilter },
      include,
    });
    return { user, reason: user ? null : "USER_NOT_FOUND" };
  }

  const users = await prisma.user.findMany({
    where: { active: true, ...loginIdentityFilter },
    include,
    take: 3,
  });

  const superAdmin = users.find((user) => user.role === "SUPER_ADMIN");
  if (superAdmin) return { user: superAdmin, reason: null };
  if (users.length === 1) return { user: users[0], reason: null };
  if (users.length > 1) return { user: null, reason: "SHOP_SLUG_REQUIRED" };
  return { user: null, reason: "USER_NOT_FOUND" };
}

async function registerHandler(req, res) {
  const parsed = registerSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({
      ok: false,
      message: "Invalid register request",
      errors: parsed.error.flatten().fieldErrors,
    });
  }

  const input = parsed.data;
  const normalizedUsername = normalizeUsername(input.username);
  const businessType = normalizeBusinessType(input.businessType);
  const now = new Date();

  const existingAccount = await prisma.user.findFirst({
    where: {
      active: true,
      OR: [
        { normalizedUsername },
        ...(normalizedUsername.includes("@") ? [{ email: normalizedUsername }] : []),
      ],
    },
    select: { id: true },
  });
  if (existingAccount) {
    return res.status(409).json({
      ok: false,
      message: "Account already exists. Please login.",
    });
  }
  const trialEndsAt = addDays(now, 7);

  try {
    const created = await prisma.$transaction(async (tx) => {
      const slug = await uniqueShopSlug(input.shopSlug || input.shopName, tx);
      const code = await uniqueTenantId(tx);
      const passwordHash = await bcrypt.hash(input.password, 12);

      const shop = await tx.shop.create({
        data: {
          slug,
          code,
          name: input.shopName.trim(),
          businessType,
          phone: input.phone || null,
          address: input.address || null,
          active: false,
        },
      });

      await tx.subscription.create({
        data: {
          shopId: shop.id,
          status: "TRIAL",
          startsAt: now,
          endsAt: trialEndsAt,
          notes: "7-day free trial created during self-registration",
        },
      });

      await tx.shopSettings.create({
        data: {
          shopId: shop.id,
          receiptHeader: input.shopName.trim(),
          settings: {
            tenant: { selfRegistered: true, tenantId: code, trialDays: 7, businessType, createdAt: now.toISOString() },
            platform: { adminPortalEnabled: false, portalEnabledByGrandAdmin: false },
          },
        },
      });

      const user = await tx.user.create({
        data: {
          shopId: shop.id,
          email: normalizedUsername.includes("@") ? normalizedUsername : null,
          username: input.username.trim(),
          normalizedUsername,
          passwordHash,
          name: input.ownerName || `${input.shopName.trim()} Admin`,
          role: "SHOP_ADMIN",
          permissions: SHOP_ADMIN_PERMISSIONS,
          active: true,
        },
        include: {
          shop: {
            include: {
              subscriptions: { orderBy: { endsAt: "desc" }, take: 1 },
            },
          },
        },
      });

      await tx.auditLog.create({
        data: {
          shopId: shop.id,
          userId: user.id,
          action: "TENANT_REGISTERED",
          entityType: "tenant",
          entityId: shop.id,
          details: { tenantId: code, slug, businessType, trialEndsAt: trialEndsAt.toISOString() },
          ipAddress: req?.ip || null,
          userAgent: req?.headers?.["user-agent"] || null,
        },
      });

      return { user };
    });

    return res.status(201).json({
      ok: true,
      message: "Tenant registered. Grand Super Admin approval is required before login.",
      tenant: publicShop(created.user.shop),
      user: publicUser(created.user),
    });
  } catch (error) {
    if (error?.code === "P2002") {
      return res.status(409).json({ ok: false, message: "Account already exists. Please login." });
    }
    return res.status(500).json({ ok: false, message: error.message || "Registration failed" });
  }
}


function plainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

async function maybeAutoCleanupDemoData(user) {
  if (!user?.shopId) return null;
  try {
    const row = await prisma.shopSettings.upsert({
      where: { shopId: user.shopId },
      update: {},
      create: { shopId: user.shopId },
    });
    const settings = plainObject(row.settings);
    const onboarding = plainObject(settings.onboardingDemo);
    const loginCount = Number(onboarding.loginCount || 0) + 1;
    const lifecycleCompleted = Boolean(onboarding.demoLifecycleCompletedAt || onboarding.lastAutoCleanupAt);

    if (loginCount >= 3 && !lifecycleCompleted) {
      const now = new Date().toISOString();
      const result = await cleanupDemoData(user.shopId);
      await prisma.shopSettings.update({
        where: { shopId: user.shopId },
        data: {
          settings: {
            ...settings,
            onboardingDemo: {
              ...onboarding,
              loginCount,
              demoSeededAt: null,
              demoLifecycleCompletedAt: now,
              lastAutoCleanupAt: now,
              lastAutoCleanupResult: result,
            },
          },
        },
      });
      return { ok: true, triggered: true, loginCount, showGuide: false, lifecycleCompleted: true, result };
    }

    let seedResult = null;
    if (loginCount === 1 && !onboarding.demoSeededAt && !lifecycleCompleted) {
      const realProductCount = await prisma.product.count({
        where: {
          shopId: user.shopId,
          NOT: { OR: [{ name: { startsWith: "Demo " } }, { brand: "Demo" }] },
        },
      }).catch(() => 0);
      if (realProductCount === 0) seedResult = await seedDemoDataForShop({ shopId: user.shopId, userId: user.id });
    }

    await prisma.shopSettings.update({
      where: { shopId: user.shopId },
      data: {
        settings: {
          ...settings,
          onboardingDemo: {
            ...onboarding,
            loginCount,
            demoSeededAt: seedResult ? new Date().toISOString() : onboarding.demoSeededAt || null,
            demoLifecycleCompletedAt: onboarding.demoLifecycleCompletedAt || null,
            lastSeedResult: seedResult || onboarding.lastSeedResult || null,
          },
        },
      },
    });
    return {
      ok: true,
      triggered: false,
      loginCount,
      showGuide: loginCount === 1 && !lifecycleCompleted,
      lifecycleCompleted,
      seeded: Boolean(seedResult),
      seedResult,
    };
  } catch (error) {
    console.error("Demo auto cleanup after login failed:", error);
    return { ok: false, triggered: false, showGuide: false, message: error.message || "Demo auto cleanup failed" };
  }
}

async function loginHandler(req, res) {
  const parsed = loginSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({
      ok: false,
      message: "Invalid login request",
      errors: parsed.error.flatten().fieldErrors,
    });
  }

  const username = parsed.data.username;
  const password = parsed.data.password;
  const shopSlug = String(parsed.data.shopSlug || parsed.data.shop || "").trim();

  try {
    const { user, reason } = await findLoginUser({ username, shopSlug });
    if (!user) {
      await writeAudit({
        action: "LOGIN_FAILED",
        details: { username: normalizeUsername(username), shopSlug: shopSlug || null, reason },
        req,
      });
      const message =
        reason === "SHOP_SLUG_REQUIRED"
          ? "ဆိုင်ကုဒ် / Tenant ID လိုအပ်သည်"
          : "Username or password is incorrect";
      return res.status(401).json({ ok: false, message });
    }

    if (user.shop && !user.shop.active) {
      await writeAudit({
        shopId: user.shopId,
        userId: user.id,
        action: "LOGIN_BLOCKED",
        details: { reason: "SHOP_INACTIVE" },
        req,
      });
      return res.status(403).json({ ok: false, message: "This shop is inactive" });
    }

    const passwordOk = await bcrypt.compare(password, user.passwordHash);
    if (!passwordOk) {
      await writeAudit({
        shopId: user.shopId,
        userId: user.id,
        action: "LOGIN_FAILED",
        details: { username: user.normalizedUsername, reason: "BAD_PASSWORD" },
        req,
      });
      return res.status(401).json({ ok: false, message: "Username or password is incorrect" });
    }

    const demoAutoCleanup = await maybeAutoCleanupDemoData(user);

    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });
    await writeAudit({
      shopId: user.shopId,
      userId: user.id,
      action: "LOGIN_SUCCESS",
      details: { role: user.role, onboardingCleanup: demoAutoCleanup ? { ok: demoAutoCleanup.ok !== false, triggered: Boolean(demoAutoCleanup.triggered), loginCount: demoAutoCleanup.loginCount || null } : null },
      req,
    });

    return res.json({
      ok: true,
      token: signToken(user),
      expiresIn: process.env.JWT_EXPIRES_IN || DEFAULT_EXPIRES_IN,
      passwordLogin: true,
      passwordMustChange: Boolean(user.passwordMustChange),
      demoAutoCleanup,
      user: {
        ...publicUser(user),
        passwordMustChange: Boolean(user.passwordMustChange),
      },
    });
  } catch (error) {
    return res.status(500).json({ ok: false, message: error.message || "Login failed" });
  }
}

async function changePasswordHandler(req, res) {
  const parsed = changePasswordSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({
      ok: false,
      message: "Invalid password change request",
      errors: parsed.error.flatten().fieldErrors,
    });
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: req.auth.userId },
      include: {
        shop: {
          include: {
            subscriptions: { orderBy: { endsAt: "desc" }, take: 1 },
          },
        },
      },
    });

    if (!user || !user.active) {
      return res.status(401).json({ ok: false, message: "User is no longer active" });
    }

    const passwordOk = await bcrypt.compare(parsed.data.currentPassword, user.passwordHash);
    if (!passwordOk) {
      await writeAudit({
        shopId: user.shopId,
        userId: user.id,
        action: "PASSWORD_CHANGE_FAILED",
        details: { reason: "BAD_CURRENT_PASSWORD" },
        req,
      });
      return res.status(401).json({ ok: false, message: "Current password is incorrect" });
    }

    const passwordHash = await bcrypt.hash(parsed.data.newPassword, 12);
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        passwordMustChange: false,
        lastLoginAt: new Date(),
      },
      include: {
        shop: {
          include: {
            subscriptions: { orderBy: { endsAt: "desc" }, take: 1 },
          },
        },
      },
    });

    await writeAudit({
      shopId: updated.shopId,
      userId: updated.id,
      action: "PASSWORD_CHANGED",
      details: { forced: Boolean(user.passwordMustChange) },
      req,
    });

    return res.json({
      ok: true,
      token: signToken(updated),
      expiresIn: process.env.JWT_EXPIRES_IN || DEFAULT_EXPIRES_IN,
      passwordLogin: true,
      passwordMustChange: false,
      user: {
        ...publicUser(updated),
        passwordMustChange: false,
      },
    });
  } catch (error) {
    return res.status(500).json({ ok: false, message: error.message || "Password change failed" });
  }
}

function isOverdueLimited(req) {
  return req.auth?.subscriptionStatus === "OVERDUE"
    || req.auth?.subscriptionAccess === "SALE_HISTORY_ONLY";
}

function pathCandidates(req) {
  return [req.path, req.originalUrl, req.url]
    .map((value) => String(value || "").split("?")[0])
    .filter(Boolean);
}

function isOverdueAllowedPath(method, path) {
  if (method === "GET" && path === "/api/project-settings") return true;
  if (method === "GET" && path === "/api/pos/catalog") return true;
  if (method === "GET" && path === "/api/pos/payment-methods") return true;
  if (method === "GET" && path === "/api/categories") return true;
  if (method === "GET" && path === "/api/project-settings/postgresql/overview") return true;
  if (method === "GET" && path === "/api/project-settings/postgresql/catalogs") return true;
  if (method === "GET" && path === "/api/project-settings/postgresql/sale-payment-methods") return true;
  if (method === "GET" && (path === "/api/sales" || /^\/api\/sales\/[^/]+$/.test(path))) return true;
  if (method === "POST" && path === "/api/sales") return true;
  return false;
}

function isAllowedWhenOverdue(req) {
  const method = String(req.method || "GET").toUpperCase();
  return pathCandidates(req).some((path) => isOverdueAllowedPath(method, path));
}

async function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return res.status(401).json({ ok: false, message: "Bearer token is required" });

  try {
    const decoded = jwt.verify(token, jwtSecret(), { issuer: TOKEN_ISSUER });
    const user = await prisma.user.findUnique({
      where: { id: decoded.sub },
      include: {
        shop: {
          include: {
            subscriptions: {
              orderBy: { endsAt: "desc" },
              take: 1,
            },
          },
        },
      },
    });

    if (!user || !user.active) {
      return res.status(401).json({ ok: false, message: "User is no longer active" });
    }
    if (user.shop && !user.shop.active) {
      return res.status(403).json({ ok: false, message: "This shop is inactive" });
    }

    const subscription = subscriptionView(user.shop);
    req.auth = {
      userId: user.id,
      shopId: user.shopId,
      shopSlug: user.shop?.slug || null,
      tenantId: user.shop?.code || user.shop?.slug || null,
      role: user.role,
      permissions: user.permissions || {},
      subscriptionStatus: subscription?.status || null,
      subscriptionAccess: subscription?.accessMode || null,
      user: publicUser(user),
    };
    req.user = {
      sub: user.id,
      id: user.id,
      shopId: user.shopId,
      shopSlug: user.shop?.slug || null,
      tenantId: user.shop?.code || user.shop?.slug || null,
      role: user.role,
      name: user.name,
      username: user.username,
    };
    return next();
  } catch {
    return res.status(401).json({ ok: false, message: "Token is invalid or expired" });
  }
}

function normalizeTenantCompare(value) {
  return String(value || "").trim().toLowerCase();
}

function valuesFrom(source, keys) {
  const values = [];
  for (const key of keys) {
    const value = source?.[key];
    if (Array.isArray(value)) values.push(...value);
    else if (value !== undefined && value !== null && value !== "") values.push(value);
  }
  return values;
}

function findCrossTenantInput(req) {
  if (!req.auth?.shopId) return null;

  const authShopId = normalizeTenantCompare(req.auth.shopId);
  const allowedTenants = new Set(
    [req.auth.shopId, req.auth.shopSlug, req.auth.tenantId]
      .filter(Boolean)
      .map(normalizeTenantCompare)
  );

  const shopIdValues = [
    ...valuesFrom(req.body, ["shopId", "shop_id"]),
    ...valuesFrom(req.query, ["shopId", "shop_id"]),
    ...valuesFrom(req.params, ["shopId", "shop_id"]),
  ];
  for (const value of shopIdValues) {
    if (normalizeTenantCompare(value) !== authShopId) {
      return { field: "shopId", value: String(value) };
    }
  }

  const tenantValues = [
    ...valuesFrom(req.body, ["tenantId", "tenant_id", "shopSlug", "shop_slug"]),
    ...valuesFrom(req.query, ["tenantId", "tenant_id", "shopSlug", "shop_slug"]),
    ...valuesFrom(req.params, ["tenantId", "tenant_id", "shopSlug", "shop_slug"]),
  ];
  for (const value of tenantValues) {
    if (!allowedTenants.has(normalizeTenantCompare(value))) {
      return { field: "tenantId", value: String(value) };
    }
  }

  return null;
}

function requireShopUser(req, res, next) {
  if (!req.auth?.shopId) {
    return res.status(403).json({
      ok: false,
      message: "No shop assigned. Please create a shop or contact admin.",
    });
  }
  const crossTenantInput = findCrossTenantInput(req);
  if (crossTenantInput) {
    return res.status(403).json({
      ok: false,
      message: "Requested shop/tenant does not match your active shop",
      field: crossTenantInput.field,
    });
  }
  if (isOverdueLimited(req) && !isAllowedWhenOverdue(req)) {
    return res.status(402).json({
      ok: false,
      message: "Subscription expired. Only Sale POS and Sales History are available until renewal.",
      subscription: {
        status: req.auth.subscriptionStatus,
        accessMode: req.auth.subscriptionAccess,
      },
    });
  }
  return next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.auth || !roles.includes(req.auth.role)) {
      return res.status(403).json({ ok: false, message: "Insufficient role" });
    }
    return next();
  };
}

function requirePermission(permission) {
  return (req, res, next) => {
    if (req.auth?.role === "SUPER_ADMIN" || req.auth?.permissions?.[permission] === true) {
      return next();
    }
    return res.status(403).json({ ok: false, message: "Insufficient permission" });
  };
}

function requireWritableSubscription(req, res, next) {
  const status = req.auth?.subscriptionStatus;
  if (status === "SUSPENDED") {
    return res.status(402).json({ ok: false, message: "Subscription is suspended" });
  }
  return next();
}

function attachAuthApi(app) {
  app.post("/api/auth/register", registerLimiter, registerHandler);
  app.post("/api/auth/login", loginLimiter, loginHandler);
  app.post("/api/login", loginLimiter, loginHandler);
  app.post("/api/auth/change-password", requireAuth, changePasswordHandler);
  app.get("/api/auth/me", requireAuth, (req, res) => res.json({ ok: true, user: req.auth.user }));
  app.post("/api/auth/logout", requireAuth, async (req, res) => {
    await writeAudit({
      shopId: req.auth.shopId,
      userId: req.auth.userId,
      action: "LOGOUT",
      details: {},
      req,
    });
    res.json({ ok: true });
  });
}

module.exports = {
  attachAuthApi,
  requireAuth,
  requireShopUser,
  requireRole,
  requirePermission,
  requireWritableSubscription,
  SHOP_ADMIN_PERMISSIONS,
  addDays,
  normalizeUsername,
  normalizeSlug,
  normalizeTenantCode,
  uniqueTenantId,
  uniqueShopSlug,
  publicUser,
  signToken,
  writeAudit,
};
