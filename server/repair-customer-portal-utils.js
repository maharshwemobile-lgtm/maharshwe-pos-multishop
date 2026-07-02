const crypto = require('crypto');
const { prisma } = require('./prisma');

function normalizeRepairNumber(value) {
  return String(value || '').trim().toUpperCase().replace(/\s+/g, '');
}

function digits(value) {
  return String(value || '').replace(/\D/g, '');
}

function hmac(value, purpose) {
  const secret = String(process.env.PUBLIC_REPAIR_TOKEN_SECRET || process.env.JWT_SECRET || 'change-this-secret');
  return crypto.createHmac('sha256', secret).update(`${purpose}:${value}`).digest('hex');
}

function maskName(value) {
  const words = String(value || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return 'Customer';
  return words.map((word) => `${word.slice(0, 1)}${'*'.repeat(Math.max(2, Math.min(5, word.length - 1)))}`).join(' ');
}

function publicBaseUrl() {
  return String(process.env.PUBLIC_APP_URL || 'https://maharshwe.shop').replace(/\/+$/, '');
}

async function findTenantRepair(shopId, identifier) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT r.id, r.shop_id AS "shopId", r.repair_number AS "repairNumber",
            r.customer_name AS "customerName", r.customer_phone AS "customerPhone",
            r.device_brand AS "deviceBrand", r.device_model AS "deviceModel",
            r.problem, r.status, r.final_cost AS "finalCost", r.deposit,
            r.payment_status AS "paymentStatus", r.received_at AS "receivedAt",
            r.completed_at AS "completedAt", r.delivered_at AS "deliveredAt",
            r.estimated_completion_at AS "estimatedCompletionAt",
            r.warranty_until AS "warrantyUntil", r.public_status_enabled AS "publicStatusEnabled",
            r.pickup_code_created_at AS "pickupCodeCreatedAt",
            r.pickup_verified_at AS "pickupVerifiedAt",
            r.customer_telegram_chat_id AS "telegramChatId",
            r.customer_fcm_token AS "appPushToken",
            r.warranty_status AS "warrantyStatus",
            s.slug AS "shopSlug", s.name AS "shopName"
       FROM repairs r JOIN shops s ON s.id = r.shop_id
      WHERE r.shop_id = $1::uuid
        AND (r.id::text = $2 OR r.repair_number = $3)
      LIMIT 1`,
    shopId,
    String(identifier || ''),
    normalizeRepairNumber(identifier),
  );
  return rows[0] || null;
}

async function findPublicRepair(shopSlug, repairNumber) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT r.id, r.shop_id AS "shopId", r.repair_number AS "repairNumber",
            r.customer_name AS "customerName", r.customer_phone AS "customerPhone",
            r.device_brand AS "deviceBrand", r.device_model AS "deviceModel",
            r.problem, r.status, r.final_cost AS "finalCost", r.deposit,
            r.payment_status AS "paymentStatus", r.received_at AS "receivedAt",
            r.completed_at AS "completedAt", r.delivered_at AS "deliveredAt",
            r.estimated_completion_at AS "estimatedCompletionAt",
            r.warranty_until AS "warrantyUntil", r.public_status_enabled AS "publicStatusEnabled",
            r.pickup_code_created_at AS "pickupCodeCreatedAt",
            r.pickup_verified_at AS "pickupVerifiedAt",
            r.warranty_status AS "warrantyStatus",
            s.slug AS "shopSlug", s.name AS "shopName"
       FROM repairs r JOIN shops s ON s.id = r.shop_id
      WHERE s.slug = $1 AND s.active = TRUE AND r.repair_number = $2
      LIMIT 1`,
    String(shopSlug || '').trim(),
    normalizeRepairNumber(repairNumber),
  );
  return rows[0] || null;
}

async function publicRepairPayload(repair) {
  const [payments, timeline, claims] = await Promise.all([
    prisma.$queryRawUnsafe(
      `SELECT COALESCE(SUM(amount),0) AS paid FROM repair_payments
        WHERE shop_id=$1::uuid AND repair_id=$2::uuid AND status='PAID'`,
      repair.shopId,
      repair.id,
    ),
    prisma.$queryRawUnsafe(
      `SELECT event_type AS "eventType", status, occurred_at AS "occurredAt"
         FROM repair_events
        WHERE shop_id=$1::uuid AND repair_id=$2::uuid
        ORDER BY occurred_at ASC`,
      repair.shopId,
      repair.id,
    ),
    prisma.$queryRawUnsafe(
      `SELECT claim_number AS "claimNumber", reason, status,
              resolution, created_at AS "createdAt", resolved_at AS "resolvedAt"
         FROM repair_warranty_claims
        WHERE shop_id=$1::uuid AND repair_id=$2::uuid
        ORDER BY created_at DESC`,
      repair.shopId,
      repair.id,
    ),
  ]);
  const paidAmount = Number(repair.deposit || 0) + Number(payments[0]?.paid || 0);
  const finalCost = Number(repair.finalCost || 0);
  const today = new Date(new Date().toISOString().slice(0, 10));
  return {
    shop: { slug: repair.shopSlug, name: repair.shopName },
    repair: {
      repairNumber: repair.repairNumber,
      customerName: maskName(repair.customerName),
      deviceBrand: repair.deviceBrand,
      deviceModel: repair.deviceModel,
      problem: repair.problem,
      status: repair.status,
      receivedAt: repair.receivedAt,
      completedAt: repair.completedAt,
      deliveredAt: repair.deliveredAt,
      estimatedCompletionAt: repair.estimatedCompletionAt,
      finalCost,
      paidAmount,
      balanceDue: Math.max(0, finalCost - paidAmount),
      paymentStatus: repair.paymentStatus,
      pickupCodeIssued: Boolean(repair.pickupCodeCreatedAt),
      pickupVerified: Boolean(repair.pickupVerifiedAt),
      warrantyUntil: repair.warrantyUntil,
      warrantyActive: Boolean(repair.warrantyUntil && new Date(repair.warrantyUntil) >= today),
      warrantyStatus: repair.warrantyStatus,
    },
    timeline,
    warrantyClaims: claims,
    checkedAt: new Date().toISOString(),
  };
}

module.exports = {
  normalizeRepairNumber,
  digits,
  hmac,
  maskName,
  publicBaseUrl,
  findTenantRepair,
  findPublicRepair,
  publicRepairPayload,
};
