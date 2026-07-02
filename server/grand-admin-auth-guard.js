const { prisma } = require("./prisma");

const GRAND_ADMIN_ROLE = "SUPER_ADMIN";
const GRAND_ADMIN_FEATURE_KEYS = [
  "dashboard",
  "sales",
  "products",
  "stock",
  "repairs",
  "customers",
  "money_service",
  "accounting",
  "reports",
  "purchases",
  "users",
  "settings",
  "backup",
  "audit_logs",
  "telegram_integration",
  "google_sheet_sync",
  "payment_gateway",
  "sms_gateway",
  "mail_notifications",
];

const SHOP_STATUSES = ["DRAFT", "ACTIVE", "SUSPENDED", "DELETED"];
const TENANT_PORTAL_STATUSES = ["DRAFT", "PENDING_ACTIVATION", "ACTIVE", "SUSPENDED", "EXPIRED", "CANCELLED", "DELETED"];
const SPEC_SUBSCRIPTION_STATUSES = ["TRIAL", "ACTIVE", "PAST_DUE", "EXPIRED", "CANCELLED", "SUSPENDED", "DELETED"];

function uuidOrNull(value) {
  const text = String(value || "").trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text) ? text : null;
}

function normalizeTenantId(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

function normalizeStatus(value, allowed, fallback) {
  const normalized = String(value || "").trim().toUpperCase().replace(/[\s-]+/g, "_");
  return allowed.includes(normalized) ? normalized : fallback;
}

function requestAuditDetails(req, extra = {}) {
  return {
    method: req.method,
    path: req.originalUrl || req.url,
    role: req.auth?.role || null,
    shopId: req.auth?.shopId || null,
    userId: req.auth?.userId || null,
    ...extra,
  };
}

async function writeGrandAdminAudit(req, action, entityType, entityId, details = {}) {
  try {
    await prisma.auditLog.create({
      data: {
        shopId: uuidOrNull(details.shopId) || null,
        userId: req.auth?.userId || null,
        action,
        entityType: entityType || "grand_admin",
        entityId: uuidOrNull(entityId),
        details: requestAuditDetails(req, details),
        ipAddress: req.ip || null,
        userAgent: req.headers?.["user-agent"] || null,
      },
    });
  } catch (error) {
    console.warn("Grand admin audit failed:", error.message);
  }
}

function isGrandAdminAuth(auth) {
  return auth?.role === GRAND_ADMIN_ROLE && !auth?.shopId;
}

function requireGrandAdmin(req, res, next) {
  if (isGrandAdminAuth(req.auth)) return next();

  const reason = !req.auth
    ? "AUTH_REQUIRED"
    : req.auth.role !== GRAND_ADMIN_ROLE
      ? "ROLE_NOT_SUPER_ADMIN"
      : "SUPER_ADMIN_MUST_HAVE_NULL_SHOP_ID";

  writeGrandAdminAudit(req, "GRAND_ADMIN_ACCESS_DENIED", "grand_admin_route", null, { reason }).catch(() => {});

  return res.status(403).json({
    ok: false,
    message: "Grand Super Admin only",
    reason,
  });
}

module.exports = {
  GRAND_ADMIN_FEATURE_KEYS,
  GRAND_ADMIN_ROLE,
  SHOP_STATUSES,
  SPEC_SUBSCRIPTION_STATUSES,
  TENANT_PORTAL_STATUSES,
  isGrandAdminAuth,
  normalizeStatus,
  normalizeTenantId,
  requireGrandAdmin,
  writeGrandAdminAudit,
};
