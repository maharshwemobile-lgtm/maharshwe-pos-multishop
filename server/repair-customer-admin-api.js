const crypto = require('crypto');
const { z } = require('zod');
const { prisma } = require('./prisma');
const {
  requireAuth,
  requireShopUser,
  requireWritableSubscription,
} = require('./auth-api');
const { ensureRepairPlatformSchema } = require('./repair-platform-schema');
const { enqueueRepairNotification, listRepairNotifications } = require('./repair-notification-outbox');
const {
  hmac,
  publicBaseUrl,
  findTenantRepair,
} = require('./repair-customer-portal-utils');

const contactSchema = z.object({
  telegramChatId: z.string().trim().max(120).optional().nullable(),
  appPushToken: z.string().trim().max(1000).optional().nullable(),
  estimatedCompletionAt: z.string().trim().optional().nullable(),
  publicStatusEnabled: z.boolean().optional(),
});
const pickupSchema = z.object({ code: z.string().trim().regex(/^\d{4}$/) });
const warrantySchema = z.object({ reason: z.string().trim().min(3).max(1000) });
const warrantyResolveSchema = z.object({
  status: z.enum(['APPROVED', 'REJECTED', 'RESOLVED']),
  resolution: z.string().trim().min(2).max(1000),
});

class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

function parse(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) throw new ApiError(400, 'Invalid request', result.error.flatten().fieldErrors);
  return result.data;
}

function wrap(handler) {
  return async (req, res) => {
    try {
      await ensureRepairPlatformSchema();
      await handler(req, res);
    } catch (error) {
      if (error instanceof ApiError) {
        return res.status(error.status).json({ ok: false, message: error.message, details: error.details });
      }
      console.error('Repair customer admin API:', error);
      return res.status(500).json({ ok: false, message: error.message || 'Repair customer operation failed' });
    }
  };
}

function requireRepairAdmin(req, res, next) {
  if (req.auth?.role === 'SUPER_ADMIN' || req.auth?.role === 'SHOP_ADMIN') return next();
  if (req.auth?.permissions?.repairs === true) return next();
  return res.status(403).json({ ok: false, message: 'Repair permission is required' });
}

async function addEvent({ shopId, repairId, eventType, status, userId, note, payload = {} }) {
  await prisma.$executeRawUnsafe(
    `INSERT INTO repair_events (id,shop_id,repair_id,event_type,status,changed_by_id,source,note,payload,occurred_at)
     VALUES ($1::uuid,$2::uuid,$3::uuid,$4,$5,$6::uuid,'PLATFORM',$7,$8::jsonb,NOW())`,
    crypto.randomUUID(), shopId, repairId, eventType, status || null, userId || null, note || null, JSON.stringify(payload),
  );
}

async function issuePublicAccess(repair, userId) {
  const shareKey = crypto.randomBytes(24).toString('base64url');
  const shareHash = hmac(shareKey, 'public-repair');
  const days = Math.max(1, Number(process.env.PUBLIC_REPAIR_LINK_DAYS || 90));
  await prisma.$executeRawUnsafe(
    `INSERT INTO repair_public_access (
       id,shop_id,repair_id,access_token_hash,access_token_last4,active,expires_at,created_by_id,created_at,updated_at
     ) VALUES ($1::uuid,$2::uuid,$3::uuid,$4,$5,TRUE,NOW()+($6::text || ' days')::interval,$7::uuid,NOW(),NOW())
     ON CONFLICT (shop_id,repair_id)
     DO UPDATE SET access_token_hash=EXCLUDED.access_token_hash,
                   access_token_last4=EXCLUDED.access_token_last4,
                   active=TRUE,expires_at=EXCLUDED.expires_at,
                   created_by_id=EXCLUDED.created_by_id,updated_at=NOW()`,
    crypto.randomUUID(), repair.shopId, repair.id, shareHash, shareKey.slice(-4), String(days), userId || null,
  );
  return {
    shareKey,
    url: `${publicBaseUrl()}/repair?shop=${encodeURIComponent(repair.shopSlug)}&id=${encodeURIComponent(repair.repairNumber)}&key=${encodeURIComponent(shareKey)}`,
    expiresInDays: days,
  };
}

function attachRepairCustomerAdminApi(app) {
  const read = [requireAuth, requireShopUser, requireRepairAdmin];
  const write = [requireAuth, requireShopUser, requireWritableSubscription, requireRepairAdmin];

  app.get('/api/repair-platform/jobs/:id/customer-ops', ...read, wrap(async (req, res) => {
    const repair = await findTenantRepair(req.auth.shopId, req.params.id);
    if (!repair) throw new ApiError(404, 'Repair job not found');
    const [accessRows, notifications, claims] = await Promise.all([
      prisma.$queryRawUnsafe(
        `SELECT active,access_token_last4 AS "keyLast4",expires_at AS "expiresAt",
                last_viewed_at AS "lastViewedAt",created_at AS "createdAt"
           FROM repair_public_access WHERE shop_id=$1::uuid AND repair_id=$2::uuid LIMIT 1`,
        repair.shopId, repair.id,
      ),
      listRepairNotifications(repair.shopId, repair.id, 20),
      prisma.$queryRawUnsafe(
        `SELECT id,claim_number AS "claimNumber",reason,status,resolution,
                created_at AS "createdAt",resolved_at AS "resolvedAt"
           FROM repair_warranty_claims
          WHERE shop_id=$1::uuid AND repair_id=$2::uuid ORDER BY created_at DESC`,
        repair.shopId, repair.id,
      ),
    ]);
    res.json({ ok: true, repair, publicAccess: accessRows[0] || null, notifications, warrantyClaims: claims });
  }));

  app.post('/api/repair-platform/jobs/:id/public-access', ...write, wrap(async (req, res) => {
    const repair = await findTenantRepair(req.auth.shopId, req.params.id);
    if (!repair) throw new ApiError(404, 'Repair job not found');
    const access = await issuePublicAccess(repair, req.auth.userId);
    await addEvent({ shopId: repair.shopId, repairId: repair.id, eventType: 'PUBLIC_LINK_ROTATED', status: repair.status, userId: req.auth.userId, note: 'Customer repair status link created' });
    res.status(201).json({ ok: true, access });
  }));

  app.patch('/api/repair-platform/jobs/:id/customer-contact', ...write, wrap(async (req, res) => {
    const input = parse(contactSchema, req.body || {});
    const repair = await findTenantRepair(req.auth.shopId, req.params.id);
    if (!repair) throw new ApiError(404, 'Repair job not found');
    const estimated = input.estimatedCompletionAt ? new Date(input.estimatedCompletionAt) : null;
    if (estimated && Number.isNaN(estimated.getTime())) throw new ApiError(400, 'Invalid estimated completion time');
    await prisma.$executeRawUnsafe(
      `UPDATE repairs SET customer_telegram_chat_id=$3,customer_fcm_token=$4,
              estimated_completion_at=$5::timestamptz,
              public_status_enabled=COALESCE($6,public_status_enabled),updated_at=NOW()
        WHERE id=$1::uuid AND shop_id=$2::uuid`,
      repair.id, repair.shopId,
      input.telegramChatId || null,
      input.appPushToken || null,
      estimated,
      input.publicStatusEnabled === undefined ? null : input.publicStatusEnabled,
    );
    res.json({ ok: true, message: 'Customer contact and portal settings updated' });
  }));

  app.post('/api/repair-platform/jobs/:id/pickup-code', ...write, wrap(async (req, res) => {
    const repair = await findTenantRepair(req.auth.shopId, req.params.id);
    if (!repair) throw new ApiError(404, 'Repair job not found');
    const code = String(crypto.randomInt(1000, 10000));
    const codeHash = hmac(`${repair.shopId}:${repair.id}:${code}`, 'pickup-code');
    await prisma.$executeRawUnsafe(
      `UPDATE repairs SET pickup_code_hash=$3,pickup_code_last4=$4,pickup_code_created_at=NOW(),
              pickup_verified_at=NULL,pickup_verified_by_id=NULL,pickup_attempts=0,updated_at=NOW()
        WHERE id=$1::uuid AND shop_id=$2::uuid`,
      repair.id, repair.shopId, codeHash, code,
    );
    await addEvent({ shopId: repair.shopId, repairId: repair.id, eventType: 'PICKUP_CODE_ISSUED', status: repair.status, userId: req.auth.userId, note: 'Pickup code issued' });
    const queued = await enqueueRepairNotification({
      shopId: repair.shopId,
      repairId: repair.id,
      eventType: 'PICKUP_CODE_ISSUED',
      status: repair.status,
      title: `${repair.shopName} · Pickup Code`,
      body: `${repair.repairNumber} အတွက် Pickup Code: ${code}`,
      actionUrl: `${publicBaseUrl()}/repair`,
      nonce: code,
    });
    res.status(201).json({ ok: true, pickupCode: code, queuedNotifications: queued.queued });
  }));

  app.post('/api/repair-platform/jobs/:id/pickup-verify', ...write, wrap(async (req, res) => {
    const input = parse(pickupSchema, req.body || {});
    const repair = await findTenantRepair(req.auth.shopId, req.params.id);
    if (!repair) throw new ApiError(404, 'Repair job not found');
    const rows = await prisma.$queryRawUnsafe(
      `SELECT pickup_code_hash AS "codeHash",pickup_attempts AS attempts,pickup_verified_at AS "verifiedAt"
         FROM repairs WHERE id=$1::uuid AND shop_id=$2::uuid LIMIT 1`,
      repair.id, repair.shopId,
    );
    const pickup = rows[0];
    if (!pickup?.codeHash) throw new ApiError(409, 'Pickup code has not been issued');
    if (pickup.verifiedAt) throw new ApiError(409, 'Pickup code was already verified');
    if (Number(pickup.attempts || 0) >= 5) throw new ApiError(423, 'Pickup verification is locked. Generate a new code.');
    const suppliedHash = hmac(`${repair.shopId}:${repair.id}:${input.code}`, 'pickup-code');
    const valid = crypto.timingSafeEqual(Buffer.from(suppliedHash), Buffer.from(pickup.codeHash));
    if (!valid) {
      await prisma.$executeRawUnsafe(`UPDATE repairs SET pickup_attempts=pickup_attempts+1,updated_at=NOW() WHERE id=$1::uuid AND shop_id=$2::uuid`, repair.id, repair.shopId);
      throw new ApiError(400, 'Pickup code is incorrect');
    }
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `UPDATE repairs SET pickup_verified_at=NOW(),pickup_verified_by_id=$3::uuid,
                pickup_code_hash=NULL,status='DELIVERED'::"RepairStatus",
                delivered_at=COALESCE(delivered_at,NOW()),updated_at=NOW()
          WHERE id=$1::uuid AND shop_id=$2::uuid`,
        repair.id, repair.shopId, req.auth.userId,
      );
      await tx.$executeRawUnsafe(
        `INSERT INTO repair_status_history (id,shop_id,repair_id,status,changed_by_id,note,created_at)
         VALUES ($1::uuid,$2::uuid,$3::uuid,'DELIVERED'::"RepairStatus",$4::uuid,'Pickup code verified',NOW())`,
        crypto.randomUUID(), repair.shopId, repair.id, req.auth.userId,
      );
    });
    await addEvent({ shopId: repair.shopId, repairId: repair.id, eventType: 'PICKUP_VERIFIED', status: 'DELIVERED', userId: req.auth.userId, note: 'Phone delivered after pickup-code verification' });
    await enqueueRepairNotification({ shopId: repair.shopId, repairId: repair.id, eventType: 'PICKUP_VERIFIED', status: 'DELIVERED', nonce: new Date().toISOString() });
    res.json({ ok: true, message: 'Pickup verified and repair marked delivered' });
  }));

  app.post('/api/repair-platform/jobs/:id/warranty-claim', ...write, wrap(async (req, res) => {
    const input = parse(warrantySchema, req.body || {});
    const repair = await findTenantRepair(req.auth.shopId, req.params.id);
    if (!repair) throw new ApiError(404, 'Repair job not found');
    const today = new Date(new Date().toISOString().slice(0, 10));
    if (!repair.warrantyUntil || new Date(repair.warrantyUntil) < today) {
      throw new ApiError(409, 'Repair warranty is expired or not configured');
    }
    const countRows = await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS count FROM repair_warranty_claims WHERE shop_id=$1::uuid AND repair_id=$2::uuid`, repair.shopId, repair.id);
    const claimNumber = `W-${repair.repairNumber}-${String(Number(countRows[0]?.count || 0) + 1).padStart(2, '0')}`;
    const claimId = crypto.randomUUID();
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `INSERT INTO repair_warranty_claims (id,shop_id,repair_id,claim_number,reason,status,created_by_id,created_at,updated_at)
         VALUES ($1::uuid,$2::uuid,$3::uuid,$4,$5,'OPEN',$6::uuid,NOW(),NOW())`,
        claimId, repair.shopId, repair.id, claimNumber, input.reason, req.auth.userId,
      );
      await tx.$executeRawUnsafe(`UPDATE repairs SET warranty_status='CLAIM_OPEN',warranty_claim_reason=$3,updated_at=NOW() WHERE id=$1::uuid AND shop_id=$2::uuid`, repair.id, repair.shopId, input.reason);
    });
    await addEvent({ shopId: repair.shopId, repairId: repair.id, eventType: 'WARRANTY_CLAIM_OPENED', status: repair.status, userId: req.auth.userId, note: input.reason, payload: { claimNumber } });
    await enqueueRepairNotification({ shopId: repair.shopId, repairId: repair.id, eventType: 'WARRANTY_CLAIM_OPENED', status: repair.status, title: `${repair.shopName} · Warranty Claim`, body: `${claimNumber} ကို လက်ခံပြီးပါပြီ။`, nonce: claimNumber });
    res.status(201).json({ ok: true, warrantyClaim: { id: claimId, claimNumber, status: 'OPEN' } });
  }));

  app.patch('/api/repair-platform/warranty-claims/:claimId', ...write, wrap(async (req, res) => {
    const input = parse(warrantyResolveSchema, req.body || {});
    const rows = await prisma.$queryRawUnsafe(
      `SELECT id,repair_id AS "repairId",claim_number AS "claimNumber"
         FROM repair_warranty_claims WHERE id=$1::uuid AND shop_id=$2::uuid LIMIT 1`,
      req.params.claimId, req.auth.shopId,
    );
    const claim = rows[0];
    if (!claim) throw new ApiError(404, 'Warranty claim not found');
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `UPDATE repair_warranty_claims SET status=$3,resolution=$4,resolved_by_id=$5::uuid,
                resolved_at=CASE WHEN $3 IN ('REJECTED','RESOLVED') THEN NOW() ELSE resolved_at END,updated_at=NOW()
          WHERE id=$1::uuid AND shop_id=$2::uuid`,
        claim.id, req.auth.shopId, input.status, input.resolution, req.auth.userId,
      );
      await tx.$executeRawUnsafe(`UPDATE repairs SET warranty_status=$3,updated_at=NOW() WHERE id=$1::uuid AND shop_id=$2::uuid`, claim.repairId, req.auth.shopId, input.status);
    });
    await addEvent({ shopId: req.auth.shopId, repairId: claim.repairId, eventType: 'WARRANTY_CLAIM_UPDATED', userId: req.auth.userId, note: input.resolution, payload: { claimNumber: claim.claimNumber, status: input.status } });
    res.json({ ok: true, message: 'Warranty claim updated' });
  }));
}

module.exports = attachRepairCustomerAdminApi;
