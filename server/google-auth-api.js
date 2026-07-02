const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const rateLimit = require("express-rate-limit");
const { OAuth2Client } = require("google-auth-library");
const { z } = require("zod");
const { prisma } = require("./prisma");
const {
  SHOP_ADMIN_PERMISSIONS,
  addDays,
  normalizeUsername,
  normalizeSlug,
  normalizeTenantCode,
  publicUser,
  signToken,
  uniqueShopSlug,
  uniqueTenantId,
  writeAudit,
} = require("./auth-api");
const {
  generateTemporaryPassword,
  sendGoogleTemporaryPasswordEmail,
} = require("./mail-service");

const DEFAULT_EXPIRES_IN = "12h";
const DEFAULT_GOOGLE_CLIENT_ID = "648689584934-kbfljosfdkui7phmiq9k9o3dfl9un0ql.apps.googleusercontent.com";
const NO_SHOP_MESSAGE = "No shop assigned. Please create a shop or contact admin.";
const GOOGLE_ISSUERS = new Set(["accounts.google.com", "https://accounts.google.com"]);

const googleLoginSchema = z.object({
  credential: z.string().trim().min(100),
  shopSlug: z.string().trim().min(1).max(80).optional(),
  businessType: z.enum(["PHONE_SHOP", "MINI_MART"]).optional(),
});

const googleLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: "draft-8",
  legacyHeaders: false,
});

const userWithShopInclude = {
  shop: {
    include: {
      subscriptions: {
        orderBy: { endsAt: "desc" },
        take: 1,
      },
    },
  },
};

let oauthClient;

function googleClientId() {
  const clientId = String(process.env.GOOGLE_CLIENT_ID || DEFAULT_GOOGLE_CLIENT_ID).trim();
  if (!clientId) throw new Error("GOOGLE_CLIENT_ID is required");
  return clientId;
}

function getOAuthClient() {
  if (!oauthClient) oauthClient = new OAuth2Client(googleClientId());
  return oauthClient;
}

function googleSelfSignupEnabled() {
  const value = String(process.env.GOOGLE_SELF_SIGNUP_ENABLED || "true").trim().toLowerCase();
  return !["0", "false", "no", "off"].includes(value);
}

function trialDays() {
  const parsed = Number(process.env.GOOGLE_TRIAL_DAYS || 7);
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > 60) return 7;
  return Math.floor(parsed);
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || "").trim());
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function safeDisplayName(payload, email) {
  return String(payload?.name || payload?.given_name || email.split("@")[0] || "Google User").trim();
}

function googleIdentityWhere(identity) {
  return [
    { authProvider: "google", providerId: identity.googleSub },
    { email: identity.email },
    { normalizedUsername: identity.email },
  ];
}

async function verifyGoogleIdentity(credential) {
  const ticket = await getOAuthClient().verifyIdToken({
    idToken: credential,
    audience: googleClientId(),
  });
  const payload = ticket.getPayload();
  const email = normalizeEmail(payload?.email);

  if (!payload?.sub || !email || payload.email_verified !== true || !GOOGLE_ISSUERS.has(String(payload.iss || ""))) {
    throw Object.assign(new Error("Google account could not be verified"), {
      status: 401,
      reason: "UNVERIFIED_GOOGLE_ACCOUNT",
      email: email || null,
    });
  }

  return {
    googleSub: String(payload.sub),
    email,
    name: safeDisplayName(payload, email),
    avatarUrl: String(payload.picture || "").trim() || null,
  };
}

async function resolveRequestedShop(selector, db = prisma) {
  const value = String(selector || "").trim();
  if (!value) return null;

  const slug = normalizeSlug(value);
  const code = normalizeTenantCode(value);
  const filters = [
    ...(isUuid(value) ? [{ id: value }] : []),
    ...(slug ? [{ slug }] : []),
    ...(code ? [{ code }] : []),
  ];
  if (!filters.length) return null;

  return db.shop.findFirst({
    where: { OR: filters },
    select: { id: true, slug: true, code: true, name: true, active: true },
  });
}

async function findUserForRequestedShop(identity, requestedShop) {
  if (!requestedShop?.id) return null;
  return prisma.user.findFirst({
    where: {
      shopId: requestedShop.id,
      active: true,
      OR: googleIdentityWhere(identity),
    },
    include: userWithShopInclude,
  });
}

async function findUserByGoogleIdentity(identity) {
  return prisma.user.findMany({
    where: {
      active: true,
      OR: googleIdentityWhere(identity),
    },
    include: userWithShopInclude,
    take: 3,
  });
}

function assertGoogleLinkAllowed(user, identity) {
  if (user.email && normalizeEmail(user.email) !== identity.email) {
    throw Object.assign(new Error("This user is linked to a different email"), { status: 409 });
  }
  if (user.authProvider === "google" && user.providerId && user.providerId !== identity.googleSub) {
    throw Object.assign(new Error("This user is linked to a different Google account"), { status: 409 });
  }
}

async function linkGoogleIdentity(user, identity) {
  assertGoogleLinkAllowed(user, identity);

  const data = { lastLoginAt: new Date() };
  if (!user.email) data.email = identity.email;
  if (!user.authProvider) data.authProvider = "google";
  if (!user.providerId) data.providerId = identity.googleSub;
  if (!user.avatarUrl && identity.avatarUrl) data.avatarUrl = identity.avatarUrl;
  if ((!user.name || user.name === user.username) && identity.name) data.name = identity.name;

  return prisma.user.update({
    where: { id: user.id },
    data,
    include: userWithShopInclude,
  });
}

async function createGoogleOwnerTenant(identity, req, businessType = "PHONE_SHOP") {
  const now = new Date();
  const days = trialDays();
  const trialEndsAt = addDays(now, days);
  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await bcrypt.hash(temporaryPassword, 12);
  const localPart = identity.email.split("@")[0] || "google-user";
  const shopName = `${identity.name || localPart} Shop`;
  const effectiveBusinessType = businessType === "MINI_MART" ? "MINI_MART" : "PHONE_SHOP";

  return prisma.$transaction(async (tx) => {
    const slug = await uniqueShopSlug(localPart, tx);
    const code = await uniqueTenantId(tx);

    const shop = await tx.shop.create({
      data: {
        slug,
        code,
        name: shopName,
        businessType: effectiveBusinessType,
        logoUrl: identity.avatarUrl,
        active: true,
      },
    });

    await tx.subscription.create({
      data: {
        shopId: shop.id,
        status: "TRIAL",
        startsAt: now,
        endsAt: trialEndsAt,
        notes: `${days}-day free trial created during Google self-signup`,
      },
    });

    await tx.shopSettings.create({
      data: {
        shopId: shop.id,
        receiptHeader: shopName,
        settings: {
          tenant: {
            selfRegistered: true,
            googleSelfSignup: true,
            tenantId: code,
            trialDays: days,
            businessType: effectiveBusinessType,
            createdAt: now.toISOString(),
          },
        },
      },
    });

    const user = await tx.user.create({
      data: {
        shopId: shop.id,
        email: identity.email,
        username: identity.email,
        normalizedUsername: normalizeUsername(identity.email),
        passwordHash,
        passwordMustChange: true,
        name: identity.name,
        avatarUrl: identity.avatarUrl,
        authProvider: "google",
        providerId: identity.googleSub,
        role: "SHOP_ADMIN",
        permissions: SHOP_ADMIN_PERMISSIONS,
        active: true,
        lastLoginAt: now,
      },
      include: userWithShopInclude,
    });

    user.temporaryPassword = temporaryPassword;

    await tx.auditLog.create({
      data: {
        shopId: shop.id,
        userId: user.id,
        action: "GOOGLE_TENANT_REGISTERED",
        entityType: "tenant",
        entityId: shop.id,
        details: {
          email: identity.email,
          googleSub: identity.googleSub,
          tenantId: code,
          slug,
          businessType: effectiveBusinessType,
          trialEndsAt: trialEndsAt.toISOString(),
        },
        ipAddress: req?.ip || null,
        userAgent: req?.headers?.["user-agent"] || null,
      },
    });

    return user;
  });
}

async function finishGoogleLogin(user, identity, req, res) {
  if (!user.shopId || !user.shop) {
    await writeAudit({
      userId: user.id,
      action: "GOOGLE_LOGIN_BLOCKED",
      details: { reason: "NO_SHOP_ASSIGNED", email: identity.email },
      req,
    });
    return res.status(403).json({ ok: false, message: NO_SHOP_MESSAGE });
  }

  if (!user.shop.active) {
    await writeAudit({
      shopId: user.shopId,
      userId: user.id,
      action: "GOOGLE_LOGIN_BLOCKED",
      details: { reason: "SHOP_INACTIVE", email: identity.email },
      req,
    });
    return res.status(403).json({ ok: false, message: "This shop is inactive" });
  }

  const linkedUser = await linkGoogleIdentity(user, identity);
  await writeAudit({
    shopId: linkedUser.shopId,
    userId: linkedUser.id,
    action: "GOOGLE_LOGIN_SUCCESS",
    details: { email: identity.email, googleSub: identity.googleSub, role: linkedUser.role },
    req,
  });

  return res.json({
    ok: true,
    token: signToken(linkedUser),
    expiresIn: process.env.JWT_EXPIRES_IN || DEFAULT_EXPIRES_IN,
    user: publicUser(linkedUser),
  });
}

function subscriptionEmailMeta(user) {
  const latest = user?.shop?.subscriptions?.[0] || null;
  const status = String(latest?.status || "TRIAL").toUpperCase();
  return {
    planLabel: process.env.POS_DEFAULT_PLAN_LABEL || (status === "TRIAL" ? "Trial" : status),
    expiryDate: latest?.endsAt || null,
    monthlyFee: latest?.monthlyFee || null,
  };
}

async function googleLoginHandler(req, res) {
  const parsed = googleLoginSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({
      ok: false,
      message: "Invalid Google login request",
      errors: parsed.error.flatten().fieldErrors,
    });
  }

  let identity;
  try {
    identity = await verifyGoogleIdentity(parsed.data.credential);
  } catch (error) {
    await writeAudit({
      action: "GOOGLE_LOGIN_FAILED",
      details: { reason: error.reason || "GOOGLE_VERIFY_FAILED", email: error.email || null },
      req,
    });
    return res.status(error.status || 401).json({
      ok: false,
      message: error.message || "Google login failed",
    });
  }

  try {
    const requestedShop = await resolveRequestedShop(parsed.data.shopSlug);
    if (parsed.data.shopSlug && !requestedShop) {
      await writeAudit({
        action: "GOOGLE_LOGIN_FAILED",
        details: { reason: "SHOP_NOT_FOUND", email: identity.email, shopSlug: parsed.data.shopSlug },
        req,
      });
      return res.status(404).json({ ok: false, message: "Shop not found" });
    }
    if (requestedShop && !requestedShop.active) {
      await writeAudit({
        shopId: requestedShop.id,
        action: "GOOGLE_LOGIN_BLOCKED",
        details: { reason: "SHOP_INACTIVE", email: identity.email, shopSlug: parsed.data.shopSlug },
        req,
      });
      return res.status(403).json({ ok: false, message: "This shop is inactive" });
    }

    if (requestedShop) {
      const user = await findUserForRequestedShop(identity, requestedShop);
      if (!user) {
        await writeAudit({
          shopId: requestedShop.id,
          action: "GOOGLE_LOGIN_BLOCKED",
          details: { reason: "NO_MEMBERSHIP_FOR_REQUESTED_SHOP", email: identity.email },
          req,
        });
        return res.status(403).json({ ok: false, message: NO_SHOP_MESSAGE });
      }
      return finishGoogleLogin(user, identity, req, res);
    }

    const users = await findUserByGoogleIdentity(identity);
    if (users.length > 1) {
      await writeAudit({
        action: "GOOGLE_LOGIN_BLOCKED",
        details: { reason: "MULTIPLE_SHOP_MEMBERSHIPS", email: identity.email },
        req,
      });
      return res.status(409).json({
        ok: false,
        message: "Multiple shops found for this Google account. Please enter the correct Tenant ID / Shop Slug.",
      });
    }

    if (users.length === 1) {
      return finishGoogleLogin(users[0], identity, req, res);
    }

    if (!googleSelfSignupEnabled()) {
      await writeAudit({
        action: "GOOGLE_LOGIN_BLOCKED",
        details: { reason: "NO_SHOP_ASSIGNED", email: identity.email },
        req,
      });
      return res.status(403).json({ ok: false, message: NO_SHOP_MESSAGE });
    }

    if (!parsed.data.businessType) {
      await writeAudit({
        action: "GOOGLE_REGISTRATION_NEEDS_BUSINESS_TYPE",
        details: { email: identity.email },
        req,
      });
      return res.status(428).json({
        ok: false,
        requiresBusinessType: true,
        message: "Google Register ဆက်လုပ်ရန် Phone ဆိုင် / Mini Mart ရွေးပါ။",
      });
    }

    const newOwner = await createGoogleOwnerTenant(identity, req, parsed.data.businessType);
    const subscriptionMeta = subscriptionEmailMeta(newOwner);
    sendGoogleTemporaryPasswordEmail({
      to: newOwner.email,
      name: newOwner.name,
      shopName: newOwner.shop?.name,
      shopSlug: newOwner.shop?.slug,
      tenantId: newOwner.shop?.code,
      username: newOwner.username,
      temporaryPassword: newOwner.temporaryPassword,
      ...subscriptionMeta,
    }).catch((mailError) => {
      console.error("Google welcome email failed:", mailError);
    });
    await writeAudit({
      shopId: newOwner.shopId,
      userId: newOwner.id,
      action: "GOOGLE_LOGIN_SUCCESS",
      details: { email: identity.email, googleSub: identity.googleSub, role: newOwner.role, createdTenant: true, businessType: parsed.data.businessType, welcomeEmailQueued: Boolean(newOwner.email && newOwner.temporaryPassword) },
      req,
    });

    return res.status(201).json({
      ok: true,
      token: signToken(newOwner),
      expiresIn: process.env.JWT_EXPIRES_IN || DEFAULT_EXPIRES_IN,
      user: publicUser(newOwner),
      tenant: newOwner.shop,
    });
  } catch (error) {
    console.error("Google login failed:", error);
    if (error?.code === "P2002") {
      return res.status(409).json({
        ok: false,
        message: "This Google account is already linked to another user",
      });
    }
    return res.status(error.status || 500).json({
      ok: false,
      message: error.message || "Google login failed",
    });
  }
}

function attachGoogleAuthApi(app) {
  app.post("/api/auth/google", googleLoginLimiter, googleLoginHandler);
}

module.exports = attachGoogleAuthApi;
