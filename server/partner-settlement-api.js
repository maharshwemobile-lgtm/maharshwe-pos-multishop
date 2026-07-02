const crypto = require('crypto');
const { z } = require('zod');
const { Prisma } = require('@prisma/client');
const { prisma } = require('./prisma');
const { requireAuth, requireShopUser, requireWritableSubscription } = require('./auth-api');

const partnerSchema = z.object({
  partnerShopSlug: z.string().trim().min(1).max(120),
  partnerCode: z.string().trim().min(1).max(30),
  displayName: z.string().trim().min(1).max(180),
  settlementWeekday: z.coerce.number().int().min(0).max(6).default(1),
  defaultPartnerProfitPercent: z.coerce.number().min(0).max(100).default(0),
  defaultProviderFee: z.coerce.number().min(0).default(0),
  customerPaysPartner: z.boolean().default(true),
});

const ledgerSchema = z.object({
  partnerLinkId: z.string().uuid(),
  partnerRepairId: z.string().uuid().optional().nullable(),
  providerRepairId: z.string().uuid().optional().nullable(),
  referralId: z.string().uuid().optional().nullable(),
  customerCharge: z.coerce.number().min(0).default(0),
  providerServiceFee: z.coerce.number().min(0).default(0),
  partsCost: z.coerce.number().min(0).default(0),
  otherCost: z.coerce.number().min(0).default(0),
  customerPaid: z.boolean().default(false),
  notes: z.string().trim().max(1000).optional().nullable(),
});

const autoSyncSchema = z.object({
  partnerLinkId: z.string().uuid().optional().nullable(),
});

const periodSchema = z.object({
  partnerLinkId: z.string().uuid(),
  periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  notes: z.string().trim().max(1000).optional().nullable(),
});

const paymentSchema = z.object({
  amount: z.coerce.number().positive(),
  paymentMethod: z.enum(['CASH', 'KBZPAY', 'WAVEPAY', 'BANK', 'OTHER']).default('CASH'),
  referenceNumber: z.string().trim().max(180).optional().nullable(),
  note: z.string().trim().max(1000).optional().nullable(),
});

const customerPaidSchema = z.object({
  customerPaid: z.boolean(),
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
  if (!result.success) {
    throw new ApiError(400, 'Invalid partner settlement request', result.error.flatten().fieldErrors);
  }
  return result.data;
}

function wrap(handler) {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (error) {
      if (error instanceof ApiError) {
        return res.status(error.status).json({ ok: false, message: error.message, details: error.details });
      }
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return res.status(409).json({ ok: false, message: 'Duplicate partner settlement record' });
      }
      console.error('Partner settlement API:', error);
      return res.status(500).json({ ok: false, message: error.message || 'Partner settlement request failed' });
    }
  };
}

function requirePartnerAccess(req, res, next) {
  if (req.auth?.role === 'SUPER_ADMIN' || req.auth?.role === 'SHOP_ADMIN') return next();
  const permissions = req.auth?.permissions || {};
  if (permissions.repairs === true || permissions.accounting === true || permissions.reports === true) return next();
  return res.status(403).json({ ok: false, message: 'Partner settlement permission is required' });
}

function requirePartnerAdmin(req, res, next) {
  if (req.auth?.role === 'SUPER_ADMIN' || req.auth?.role === 'SHOP_ADMIN') return next();
  return res.status(403).json({ ok: false, message: 'Shop admin permission is required' });
}

async function assertTablesReady() {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT to_regclass('public.partner_shop_links')::text AS links,
            to_regclass('public.partner_repair_ledger')::text AS ledger,
            to_regclass('public.partner_weekly_settlements')::text AS settlements,
            to_regclass('public.partner_settlement_payments')::text AS payments`,
  );
  if (!rows[0]?.links || !rows[0]?.ledger || !rows[0]?.settlements || !rows[0]?.payments) {
    throw new ApiError(503, 'Partner settlement migration is not deployed');
  }
}

async function accessibleLinks(shopId) {
  return prisma.$queryRawUnsafe(
    `SELECT l.id,
            l.provider_shop_id AS "providerShopId",
            l.partner_shop_id AS "partnerShopId",
            l.partner_code AS "partnerCode",
            l.display_name AS "displayName",
            l.settlement_weekday AS "settlementWeekday",
            l.default_partner_profit_percent AS "defaultPartnerProfitPercent",
            l.default_provider_fee AS "defaultProviderFee",
            l.customer_pays_partner AS "customerPaysPartner",
            l.active,
            provider.slug AS "providerSlug",
            provider.name AS "providerName",
            partner.slug AS "partnerSlug",
            partner.name AS "partnerName",
            CASE WHEN l.provider_shop_id=$1::uuid THEN 'PROVIDER' ELSE 'PARTNER' END AS "accessMode"
       FROM partner_shop_links l
       JOIN shops provider ON provider.id=l.provider_shop_id
       JOIN shops partner ON partner.id=l.partner_shop_id
      WHERE l.provider_shop_id=$1::uuid OR l.partner_shop_id=$1::uuid
      ORDER BY l.display_name`,
    shopId,
  );
}

async function assertLinkAccess(shopId, linkId) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT * FROM partner_shop_links
      WHERE id=$1::uuid
        AND (provider_shop_id=$2::uuid OR partner_shop_id=$2::uuid)
        AND active=TRUE
      LIMIT 1`,
    linkId,
    shopId,
  );
  if (!rows[0]) throw new ApiError(404, 'Partner shop link not found');
  return rows[0];
}

function assertProvider(link, shopId) {
  if (link.provider_shop_id !== shopId) {
    throw new ApiError(403, 'Only the provider shop can perform this settlement action');
  }
}

async function audit(db, req, action, entityType, entityId, details = {}) {
  await db.$executeRawUnsafe(
    `INSERT INTO audit_logs (
       id,shop_id,user_id,action,entity_type,entity_id,details,ip_address,user_agent,created_at
     ) VALUES ($1::uuid,$2::uuid,$3::uuid,$4,$5,$6::uuid,$7::jsonb,$8,$9,NOW())`,
    crypto.randomUUID(),
    req.auth.shopId,
    req.auth.userId || null,
    action,
    entityType,
    entityId || null,
    JSON.stringify(details),
    req.ip || null,
    req.get?.('user-agent') || null,
  );
}

function settlementNumber(link, periodStart) {
  return `SET-${String(link.partner_code || 'PARTNER').toUpperCase()}-${periodStart.replaceAll('-', '')}`;
}

function csv(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

async function getSettlement(shopId, settlementId, db = prisma, lock = false) {
  const rows = await db.$queryRawUnsafe(
    `SELECT s.id,
            s.provider_shop_id AS "providerShopId",
            s.partner_shop_id AS "partnerShopId",
            s.partner_link_id AS "partnerLinkId",
            s.settlement_number AS "settlementNumber",
            s.period_start AS "periodStart",
            s.period_end AS "periodEnd",
            s.status,
            s.total_jobs AS "totalJobs",
            s.customer_collected AS "customerCollected",
            s.provider_due AS "providerDue",
            s.partner_profit AS "partnerProfit",
            s.parts_cost AS "partsCost",
            s.other_cost AS "otherCost",
            s.paid_amount AS "paidAmount",
            s.outstanding_amount AS "outstandingAmount",
            s.locked_at AS "lockedAt",
            s.confirmed_at AS "confirmedAt",
            s.paid_at AS "paidAt",
            s.notes,
            s.created_at AS "createdAt",
            s.updated_at AS "updatedAt",
            l.display_name AS "partnerName",
            l.partner_code AS "partnerCode",
            provider.name AS "providerName",
            partner.name AS "partnerShopName",
            CASE WHEN s.provider_shop_id=$1::uuid THEN 'PROVIDER' ELSE 'PARTNER' END AS "accessMode"
       FROM partner_weekly_settlements s
       JOIN partner_shop_links l ON l.id=s.partner_link_id
       JOIN shops provider ON provider.id=s.provider_shop_id
       JOIN shops partner ON partner.id=s.partner_shop_id
      WHERE s.id=$2::uuid
        AND (s.provider_shop_id=$1::uuid OR s.partner_shop_id=$1::uuid)
      LIMIT 1${lock ? ' FOR UPDATE OF s' : ''}`,
    shopId,
    settlementId,
  );
  if (!rows[0]) throw new ApiError(404, 'Weekly settlement not found');
  return rows[0];
}

function attachPartnerSettlementApi(app) {
  const read = [requireAuth, requireShopUser, requirePartnerAccess];
  const write = [requireAuth, requireShopUser, requireWritableSubscription, requirePartnerAccess];
  const adminWrite = [requireAuth, requireShopUser, requireWritableSubscription, requirePartnerAdmin];

  app.get('/api/partner-settlements/partners', ...read, wrap(async (req, res) => {
    await assertTablesReady();
    res.json({ ok: true, partners: await accessibleLinks(req.auth.shopId) });
  }));

  app.post('/api/partner-settlements/partners', ...adminWrite, wrap(async (req, res) => {
    await assertTablesReady();
    const input = parse(partnerSchema, req.body || {});
    const partnerRows = await prisma.$queryRawUnsafe(
      `SELECT id,slug,name FROM shops WHERE slug=$1 AND active=TRUE LIMIT 1`,
      input.partnerShopSlug,
    );
    const partner = partnerRows[0];
    if (!partner) throw new ApiError(404, 'Partner shop tenant not found');
    if (partner.id === req.auth.shopId) throw new ApiError(409, 'A shop cannot be its own partner');

    const rows = await prisma.$queryRawUnsafe(
      `INSERT INTO partner_shop_links (
         id,provider_shop_id,partner_shop_id,partner_code,display_name,
         settlement_weekday,default_partner_profit_percent,default_provider_fee,
         customer_pays_partner,active,created_by_id,created_at,updated_at
       ) VALUES ($1::uuid,$2::uuid,$3::uuid,$4,$5,$6,$7,$8,$9,TRUE,$10::uuid,NOW(),NOW())
       ON CONFLICT (provider_shop_id,partner_shop_id)
       DO UPDATE SET partner_code=EXCLUDED.partner_code,
                     display_name=EXCLUDED.display_name,
                     settlement_weekday=EXCLUDED.settlement_weekday,
                     default_partner_profit_percent=EXCLUDED.default_partner_profit_percent,
                     default_provider_fee=EXCLUDED.default_provider_fee,
                     customer_pays_partner=EXCLUDED.customer_pays_partner,
                     active=TRUE,
                     updated_at=NOW()
       RETURNING id`,
      crypto.randomUUID(),
      req.auth.shopId,
      partner.id,
      input.partnerCode.toUpperCase(),
      input.displayName,
      input.settlementWeekday,
      input.defaultPartnerProfitPercent,
      input.defaultProviderFee,
      input.customerPaysPartner,
      req.auth.userId,
    );
    await audit(prisma, req, 'PARTNER_LINK_UPSERTED', 'partner_shop_link', rows[0].id, input);
    res.status(201).json({ ok: true, partnerLinkId: rows[0].id });
  }));

  app.get('/api/partner-settlements/dashboard', ...read, wrap(async (req, res) => {
    await assertTablesReady();
    const rows = await prisma.$queryRawUnsafe(
      `SELECT
          (SELECT COUNT(*)::int FROM partner_repair_ledger l
            WHERE (l.provider_shop_id=$1::uuid OR l.partner_shop_id=$1::uuid)
              AND l.settlement_status='UNSETTLED'
              AND l.customer_paid=TRUE) AS "unbatchedJobs",
          (SELECT COALESCE(SUM(provider_due),0) FROM partner_repair_ledger l
            WHERE (l.provider_shop_id=$1::uuid OR l.partner_shop_id=$1::uuid)
              AND l.settlement_status='UNSETTLED'
              AND l.customer_paid=TRUE) AS "unbatchedDue",
         (SELECT COUNT(*)::int FROM partner_weekly_settlements s
           WHERE (s.provider_shop_id=$1::uuid OR s.partner_shop_id=$1::uuid)
             AND s.status IN ('DRAFT','CONFIRMED','PARTIAL')) AS "openSettlements",
         (SELECT COALESCE(SUM(outstanding_amount),0) FROM partner_weekly_settlements s
           WHERE (s.provider_shop_id=$1::uuid OR s.partner_shop_id=$1::uuid)
             AND s.status IN ('DRAFT','CONFIRMED','PARTIAL')) AS "outstandingAmount",
         (SELECT COALESCE(SUM(partner_profit),0) FROM partner_repair_ledger l
           WHERE (l.provider_shop_id=$1::uuid OR l.partner_shop_id=$1::uuid)) AS "totalPartnerProfit",
         (SELECT COALESCE(SUM(paid_amount),0) FROM partner_weekly_settlements s
           WHERE (s.provider_shop_id=$1::uuid OR s.partner_shop_id=$1::uuid)) AS "totalPaid"`,
      req.auth.shopId,
    );
    res.json({ ok: true, dashboard: rows[0] || {} });
  }));

  app.get('/api/partner-settlements/summary', ...read, wrap(async (req, res) => {
    await assertTablesReady();
    const rows = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*) FILTER (WHERE settlement_status='UNSETTLED' AND customer_paid=TRUE)::int AS "unsettledJobs",
              COALESCE(SUM(provider_due) FILTER (WHERE settlement_status='UNSETTLED' AND customer_paid=TRUE),0) AS "providerDue",
              COALESCE(SUM(partner_profit) FILTER (WHERE settlement_status='UNSETTLED' AND customer_paid=TRUE),0) AS "partnerProfit",
              COALESCE(SUM(customer_charge) FILTER (WHERE settlement_status='UNSETTLED' AND customer_paid=TRUE),0) AS "customerCollected",
              COALESCE(SUM(parts_cost+other_cost) FILTER (WHERE settlement_status='UNSETTLED' AND customer_paid=TRUE),0) AS "repairCosts"
         FROM partner_repair_ledger
        WHERE provider_shop_id=$1::uuid OR partner_shop_id=$1::uuid`,
      req.auth.shopId,
    );
    res.json({ ok: true, summary: rows[0] || {} });
  }));

  app.get('/api/partner-settlements/ledger', ...read, wrap(async (req, res) => {
    await assertTablesReady();
    const linkId = String(req.query.partnerLinkId || '');
    const status = String(req.query.status || '').trim();
    const params = [req.auth.shopId];
    const filters = ['(l.provider_shop_id=$1::uuid OR l.partner_shop_id=$1::uuid)'];
    if (linkId) {
      params.push(linkId);
      filters.push(`l.id=$${params.length}::uuid`);
    }
    if (status) {
      params.push(status);
      filters.push(`ledger.settlement_status=$${params.length}`);
    }

    const rows = await prisma.$queryRawUnsafe(
      `SELECT ledger.id,
              ledger.partner_link_id AS "partnerLinkId",
              ledger.referral_id AS "referralId",
              ledger.partner_repair_id AS "partnerRepairId",
              ledger.provider_repair_id AS "providerRepairId",
              ledger.partner_repair_number AS "partnerRepairNumber",
              ledger.provider_repair_number AS "providerRepairNumber",
              ledger.customer_charge AS "customerCharge",
              ledger.provider_service_fee AS "providerServiceFee",
              ledger.provider_due AS "providerDue",
              ledger.partner_profit AS "partnerProfit",
              ledger.parts_cost AS "partsCost",
              ledger.other_cost AS "otherCost",
              ledger.customer_paid AS "customerPaid",
              ledger.customer_paid_at AS "customerPaidAt",
              ledger.settlement_status AS "settlementStatus",
              ledger.settlement_id AS "settlementId",
              ledger.completed_at AS "completedAt",
              ledger.notes,
              l.display_name AS "partnerName",
              l.partner_code AS "partnerCode"
         FROM partner_repair_ledger ledger
         JOIN partner_shop_links l ON l.id=ledger.partner_link_id
        WHERE ${filters.join(' AND ')}
        ORDER BY COALESCE(ledger.completed_at,ledger.created_at) DESC
        LIMIT 500`,
      ...params,
    );
    res.json({ ok: true, ledger: rows });
  }));

  app.post('/api/partner-settlements/ledger', ...write, wrap(async (req, res) => {
    await assertTablesReady();
    const input = parse(ledgerSchema, req.body || {});
    const link = await assertLinkAccess(req.auth.shopId, input.partnerLinkId);

    const partnerRepairRows = input.partnerRepairId
      ? await prisma.$queryRawUnsafe(
        `SELECT id,repair_number FROM repairs WHERE id=$1::uuid AND shop_id=$2::uuid LIMIT 1`,
        input.partnerRepairId,
        link.partner_shop_id,
      )
      : [];
    const providerRepairRows = input.providerRepairId
      ? await prisma.$queryRawUnsafe(
        `SELECT id,repair_number FROM repairs WHERE id=$1::uuid AND shop_id=$2::uuid LIMIT 1`,
        input.providerRepairId,
        link.provider_shop_id,
      )
      : [];

    if (input.partnerRepairId && !partnerRepairRows[0]) throw new ApiError(404, 'Partner repair record not found');
    if (input.providerRepairId && !providerRepairRows[0]) throw new ApiError(404, 'Provider repair record not found');

    const customerCharge = Number(input.customerCharge || 0);
    const partsCost = Number(input.partsCost || 0);
    const otherCost = Number(input.otherCost || 0);
    const configuredFee = Number(input.providerServiceFee || link.default_provider_fee || 0);
    const percent = Number(link.default_partner_profit_percent || 0);
    const percentProfit = percent > 0 ? Math.max(0, (customerCharge * percent) / 100) : null;
    const providerDue = configuredFee > 0
      ? configuredFee + partsCost + otherCost
      : Math.max(0, customerCharge - Number(percentProfit || 0));
    const partnerProfit = Math.max(0, customerCharge - providerDue);

    const rows = await prisma.$queryRawUnsafe(
      `INSERT INTO partner_repair_ledger (
         id,provider_shop_id,partner_shop_id,partner_link_id,referral_id,
         partner_repair_id,provider_repair_id,partner_repair_number,provider_repair_number,
         customer_charge,provider_service_fee,parts_cost,other_cost,provider_due,partner_profit,
         customer_paid,customer_paid_at,settlement_status,completed_at,notes,
         created_by_id,updated_by_id,created_at,updated_at
       ) VALUES (
         $1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,
         $6::uuid,$7::uuid,$8,$9,
         $10,$11,$12,$13,$14,$15,
         $16,CASE WHEN $16 THEN NOW() ELSE NULL END,'UNSETTLED',NOW(),$17,
         $18::uuid,$18::uuid,NOW(),NOW()
       ) RETURNING id`,
      crypto.randomUUID(),
      link.provider_shop_id,
      link.partner_shop_id,
      link.id,
      input.referralId || null,
      input.partnerRepairId || null,
      input.providerRepairId || null,
      partnerRepairRows[0]?.repair_number || null,
      providerRepairRows[0]?.repair_number || null,
      customerCharge,
      configuredFee,
      partsCost,
      otherCost,
      providerDue,
      partnerProfit,
      input.customerPaid,
      input.notes || null,
      req.auth.userId,
    );
    await audit(prisma, req, 'PARTNER_LEDGER_CREATED', 'partner_repair_ledger', rows[0].id, { providerDue, partnerProfit });
    res.status(201).json({ ok: true, ledgerId: rows[0].id, providerDue, partnerProfit });
  }));

  app.post('/api/partner-settlements/ledger/auto-sync', ...adminWrite, wrap(async (req, res) => {
    await assertTablesReady();
    const input = parse(autoSyncSchema, req.body || {});
    const params = [req.auth.shopId];
    let linkFilter = '';
    if (input.partnerLinkId) {
      params.push(input.partnerLinkId);
      linkFilter = ` AND l.id=$${params.length}::uuid`;
    }

    const candidates = await prisma.$queryRawUnsafe(
      `SELECT l.id AS "partnerLinkId",
              l.provider_shop_id AS "providerShopId",
              l.partner_shop_id AS "partnerShopId",
              l.default_partner_profit_percent AS "profitPercent",
              l.default_provider_fee AS "defaultProviderFee",
              rr.id AS "referralId",
              source.id AS "partnerRepairId",
              source.repair_number AS "partnerRepairNumber",
              provider.id AS "providerRepairId",
              provider.repair_number AS "providerRepairNumber",
              COALESCE(NULLIF(source.final_cost,0),source.estimated_cost,0) AS "customerCharge",
               COALESCE(provider.final_cost,0) AS "providerFinalCost",
               COALESCE(provider.parts_cost,0) AS "partsCost",
               COALESCE(provider.other_cost,0) AS "otherCost",
               source.status::text AS "partnerRepairStatus",
               source.delivered_at AS "partnerDeliveredAt",
               source.payment_status::text AS "partnerPaymentStatus",
               provider.completed_at AS "completedAt"
         FROM repair_referrals rr
         JOIN repairs source ON source.id=rr.source_repair_id AND source.shop_id=rr.source_shop_id
         JOIN repairs provider ON provider.id=rr.provider_repair_id AND provider.shop_id=rr.provider_shop_id
         JOIN partner_shop_links l ON l.provider_shop_id=rr.provider_shop_id AND l.partner_shop_id=rr.source_shop_id AND l.active=TRUE
         LEFT JOIN partner_repair_ledger ledger
           ON ledger.provider_shop_id=l.provider_shop_id
          AND ledger.partner_shop_id=l.partner_shop_id
          AND (ledger.referral_id=rr.id OR ledger.provider_repair_id=provider.id OR ledger.partner_repair_id=source.id)
        WHERE l.provider_shop_id=$1::uuid
          AND provider.status IN ('COMPLETED','DELIVERED')
          AND (source.status='DELIVERED' OR source.delivered_at IS NOT NULL)
          AND ledger.id IS NULL${linkFilter}
        ORDER BY provider.completed_at,provider.created_at
        LIMIT 200`,
      ...params,
    );

    const created = [];
    for (const item of candidates) {
      const customerCharge = Number(item.customerCharge || 0);
      const partsCost = Number(item.partsCost || 0);
      const otherCost = Number(item.otherCost || 0);
      const configuredFee = Number(item.defaultProviderFee || 0);
      const providerFinalCost = Number(item.providerFinalCost || 0);
      const percent = Number(item.profitPercent || 0);
      const percentProfit = percent > 0 ? Math.max(0, customerCharge * percent / 100) : 0;
      const providerDue = configuredFee > 0
        ? configuredFee + partsCost + otherCost
        : providerFinalCost > 0
          ? providerFinalCost
          : Math.max(0, customerCharge - percentProfit);
      const partnerProfit = Math.max(0, customerCharge - providerDue);
      // In Grand Report partner sheets, blank or "မရှင်းရသေး" means the partner still owes this amount.
      // PAID means it was already settled, so do not create a new settlement ledger row.
      const partnerAlreadySettled = item.partnerPaymentStatus === 'PAID';
      if (partnerAlreadySettled) continue;
      const customerPaid = true;
      const id = crypto.randomUUID();

      await prisma.$executeRawUnsafe(
        `INSERT INTO partner_repair_ledger (
           id,provider_shop_id,partner_shop_id,partner_link_id,referral_id,
           partner_repair_id,provider_repair_id,partner_repair_number,provider_repair_number,
           customer_charge,provider_service_fee,parts_cost,other_cost,provider_due,partner_profit,
           customer_paid,customer_paid_at,settlement_status,completed_at,notes,
           created_by_id,updated_by_id,created_at,updated_at
         ) VALUES (
           $1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::uuid,$7::uuid,$8,$9,
           $10,$11,$12,$13,$14,$15,$16,CASE WHEN $16 THEN NOW() ELSE NULL END,
           'UNSETTLED',$17,'Auto-created from completed partner repair',$18::uuid,$18::uuid,NOW(),NOW()
         ) ON CONFLICT DO NOTHING`,
        id,
        item.providerShopId,
        item.partnerShopId,
        item.partnerLinkId,
        item.referralId,
        item.partnerRepairId,
        item.providerRepairId,
        item.partnerRepairNumber,
        item.providerRepairNumber,
        customerCharge,
        configuredFee,
        partsCost,
        otherCost,
        providerDue,
        partnerProfit,
        customerPaid,
        item.completedAt || new Date(),
        req.auth.userId,
      );
      created.push({ id, partnerRepairNumber: item.partnerRepairNumber, providerRepairNumber: item.providerRepairNumber });
    }

    await audit(prisma, req, 'PARTNER_LEDGER_AUTO_SYNCED', 'partner_shop_link', input.partnerLinkId || null, { created: created.length });
    res.json({ ok: true, created: created.length, ledger: created });
  }));

  app.patch('/api/partner-settlements/ledger/:id/customer-paid', ...write, wrap(async (req, res) => {
    await assertTablesReady();
    const input = parse(customerPaidSchema, req.body || {});
    const rows = await prisma.$queryRawUnsafe(
      `UPDATE partner_repair_ledger
          SET customer_paid=$3,
              customer_paid_at=CASE WHEN $3 THEN COALESCE(customer_paid_at,NOW()) ELSE NULL END,
              updated_by_id=$2::uuid,
              updated_at=NOW()
        WHERE id=$1::uuid
          AND (provider_shop_id=$4::uuid OR partner_shop_id=$4::uuid)
          AND settlement_id IS NULL
          AND settlement_status='UNSETTLED'
        RETURNING id,customer_paid AS "customerPaid",customer_paid_at AS "customerPaidAt"`,
      req.params.id,
      req.auth.userId,
      input.customerPaid,
      req.auth.shopId,
    );
    if (!rows[0]) throw new ApiError(409, 'Ledger is locked in a settlement or was not found');
    await audit(prisma, req, 'PARTNER_CUSTOMER_PAYMENT_UPDATED', 'partner_repair_ledger', req.params.id, input);
    res.json({ ok: true, ledger: rows[0] });
  }));

  app.get('/api/partner-settlements/settlements', ...read, wrap(async (req, res) => {
    await assertTablesReady();
    const status = String(req.query.status || '').trim();
    const linkId = String(req.query.partnerLinkId || '').trim();
    const params = [req.auth.shopId];
    const filters = ['(s.provider_shop_id=$1::uuid OR s.partner_shop_id=$1::uuid)'];
    if (status) {
      params.push(status);
      filters.push(`s.status=$${params.length}`);
    }
    if (linkId) {
      params.push(linkId);
      filters.push(`s.partner_link_id=$${params.length}::uuid`);
    }
    const rows = await prisma.$queryRawUnsafe(
      `SELECT s.id,s.partner_link_id AS "partnerLinkId",s.settlement_number AS "settlementNumber",
              s.period_start AS "periodStart",s.period_end AS "periodEnd",s.status,
              s.total_jobs AS "totalJobs",s.customer_collected AS "customerCollected",
              s.provider_due AS "providerDue",s.partner_profit AS "partnerProfit",
              s.paid_amount AS "paidAmount",s.outstanding_amount AS "outstandingAmount",
              s.locked_at AS "lockedAt",s.confirmed_at AS "confirmedAt",s.paid_at AS "paidAt",
              s.created_at AS "createdAt",l.display_name AS "partnerName",l.partner_code AS "partnerCode",
              CASE WHEN s.provider_shop_id=$1::uuid THEN 'PROVIDER' ELSE 'PARTNER' END AS "accessMode"
         FROM partner_weekly_settlements s
         JOIN partner_shop_links l ON l.id=s.partner_link_id
        WHERE ${filters.join(' AND ')}
        ORDER BY s.period_end DESC,s.created_at DESC
        LIMIT 500`,
      ...params,
    );
    res.json({ ok: true, settlements: rows });
  }));

  app.get('/api/partner-settlements/settlements/:id', ...read, wrap(async (req, res) => {
    await assertTablesReady();
    const settlement = await getSettlement(req.auth.shopId, req.params.id);
    const ledger = await prisma.$queryRawUnsafe(
      `SELECT id,partner_repair_number AS "partnerRepairNumber",provider_repair_number AS "providerRepairNumber",
              customer_charge AS "customerCharge",provider_due AS "providerDue",partner_profit AS "partnerProfit",
              parts_cost AS "partsCost",other_cost AS "otherCost",customer_paid AS "customerPaid",
              settlement_status AS "settlementStatus",completed_at AS "completedAt",notes
         FROM partner_repair_ledger WHERE settlement_id=$1::uuid ORDER BY completed_at,created_at`,
      settlement.id,
    );
    const payments = await prisma.$queryRawUnsafe(
      `SELECT id,amount,payment_method AS "paymentMethod",reference_number AS "referenceNumber",
              note,created_at AS "createdAt"
         FROM partner_settlement_payments WHERE settlement_id=$1::uuid ORDER BY created_at`,
      settlement.id,
    );
    res.json({ ok: true, settlement, ledger, payments });
  }));

  app.post('/api/partner-settlements/settlements/generate', ...adminWrite, wrap(async (req, res) => {
    await assertTablesReady();
    const input = parse(periodSchema, req.body || {});
    if (input.periodStart > input.periodEnd) throw new ApiError(400, 'Period start must be before period end');
    const link = await assertLinkAccess(req.auth.shopId, input.partnerLinkId);
    assertProvider(link, req.auth.shopId);

    const result = await prisma.$transaction(async (tx) => {
      const existing = await tx.$queryRawUnsafe(
        `SELECT id FROM partner_weekly_settlements
          WHERE provider_shop_id=$1::uuid AND partner_shop_id=$2::uuid
            AND period_start=$3::date AND period_end=$4::date LIMIT 1`,
        link.provider_shop_id,
        link.partner_shop_id,
        input.periodStart,
        input.periodEnd,
      );
      if (existing[0]) return { existing: true, settlementId: existing[0].id };

      const ledger = await tx.$queryRawUnsafe(
        `SELECT id,customer_charge AS "customerCharge",provider_due AS "providerDue",
                partner_profit AS "partnerProfit",parts_cost AS "partsCost",other_cost AS "otherCost"
           FROM partner_repair_ledger
          WHERE partner_link_id=$1::uuid
            AND settlement_status='UNSETTLED'
            AND settlement_id IS NULL
            AND customer_paid=TRUE
            AND (completed_at AT TIME ZONE 'Asia/Yangon')::date BETWEEN $2::date AND $3::date
          ORDER BY completed_at,created_at FOR UPDATE`,
        link.id,
        input.periodStart,
        input.periodEnd,
      );
      if (!ledger.length) throw new ApiError(409, 'No paid, unsettled repair jobs found for this period');

      const totals = ledger.reduce((sum, row) => ({
        customerCollected: sum.customerCollected + Number(row.customerCharge || 0),
        providerDue: sum.providerDue + Number(row.providerDue || 0),
        partnerProfit: sum.partnerProfit + Number(row.partnerProfit || 0),
        partsCost: sum.partsCost + Number(row.partsCost || 0),
        otherCost: sum.otherCost + Number(row.otherCost || 0),
      }), { customerCollected: 0, providerDue: 0, partnerProfit: 0, partsCost: 0, otherCost: 0 });

      const id = crypto.randomUUID();
      const number = settlementNumber(link, input.periodStart);
      await tx.$executeRawUnsafe(
        `INSERT INTO partner_weekly_settlements (
           id,provider_shop_id,partner_shop_id,partner_link_id,settlement_number,period_start,period_end,
           status,total_jobs,customer_collected,provider_due,partner_profit,parts_cost,other_cost,
           paid_amount,outstanding_amount,notes,created_by_id,created_at,updated_at
         ) VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6::date,$7::date,'DRAFT',$8,$9,$10,$11,$12,$13,0,$10,$14,$15::uuid,NOW(),NOW())`,
        id,
        link.provider_shop_id,
        link.partner_shop_id,
        link.id,
        number,
        input.periodStart,
        input.periodEnd,
        ledger.length,
        totals.customerCollected,
        totals.providerDue,
        totals.partnerProfit,
        totals.partsCost,
        totals.otherCost,
        input.notes || null,
        req.auth.userId,
      );
      await tx.$executeRawUnsafe(
        `UPDATE partner_repair_ledger
            SET settlement_id=$1::uuid,settlement_status='IN_SETTLEMENT',updated_by_id=$3::uuid,updated_at=NOW()
          WHERE id=ANY($2::uuid[])`,
        id,
        ledger.map((row) => row.id),
        req.auth.userId,
      );
      await audit(tx, req, 'PARTNER_SETTLEMENT_GENERATED', 'partner_weekly_settlement', id, { number, jobs: ledger.length, ...totals });
      return { existing: false, settlementId: id };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5000, timeout: 20000 });

    const settlement = await getSettlement(req.auth.shopId, result.settlementId);
    res.status(result.existing ? 200 : 201).json({ ok: true, existing: result.existing, settlement });
  }));

  app.post('/api/partner-settlements/settlements/:id/confirm', ...adminWrite, wrap(async (req, res) => {
    await assertTablesReady();
    const result = await prisma.$transaction(async (tx) => {
      const settlement = await getSettlement(req.auth.shopId, req.params.id, tx, true);
      if (settlement.accessMode !== 'PROVIDER') throw new ApiError(403, 'Only the provider shop can confirm this settlement');
      if (settlement.lockedAt) return { alreadyLocked: true };
      if (settlement.status !== 'DRAFT') throw new ApiError(409, `Only DRAFT settlement can be confirmed; current status=${settlement.status}`);

      const totalsRows = await tx.$queryRawUnsafe(
        `SELECT COUNT(*)::int AS "totalJobs",COALESCE(SUM(customer_charge),0) AS "customerCollected",
                COALESCE(SUM(provider_due),0) AS "providerDue",COALESCE(SUM(partner_profit),0) AS "partnerProfit",
                COALESCE(SUM(parts_cost),0) AS "partsCost",COALESCE(SUM(other_cost),0) AS "otherCost"
           FROM partner_repair_ledger WHERE settlement_id=$1::uuid`,
        settlement.id,
      );
      const actual = totalsRows[0];
      const keys = ['totalJobs', 'customerCollected', 'providerDue', 'partnerProfit', 'partsCost', 'otherCost'];
      for (const key of keys) {
        if (Math.abs(Number(actual[key] || 0) - Number(settlement[key] || 0)) > 0.001) {
          throw new ApiError(409, `Settlement total mismatch: ${key}`);
        }
      }

      await tx.$executeRawUnsafe(
        `UPDATE partner_weekly_settlements SET status='CONFIRMED',confirmed_by_id=$2::uuid,
                locked_at=NOW(),confirmed_at=NOW(),updated_at=NOW() WHERE id=$1::uuid`,
        settlement.id,
        req.auth.userId,
      );
      await audit(tx, req, 'PARTNER_SETTLEMENT_CONFIRMED', 'partner_weekly_settlement', settlement.id, actual);
      return { alreadyLocked: false };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5000, timeout: 20000 });

    res.json({ ok: true, alreadyLocked: result.alreadyLocked, settlement: await getSettlement(req.auth.shopId, req.params.id) });
  }));

  app.post('/api/partner-settlements/settlements/:id/payments', ...adminWrite, wrap(async (req, res) => {
    await assertTablesReady();
    const input = parse(paymentSchema, req.body || {});
    const result = await prisma.$transaction(async (tx) => {
      const settlement = await getSettlement(req.auth.shopId, req.params.id, tx, true);
      if (settlement.accessMode !== 'PROVIDER') throw new ApiError(403, 'Only the provider shop can record received payments');
      if (!settlement.lockedAt) throw new ApiError(409, 'Confirm and lock the settlement before recording payment');
      if (settlement.status === 'PAID') throw new ApiError(409, 'Settlement is already fully paid');

      if (input.referenceNumber) {
        const duplicate = await tx.$queryRawUnsafe(
          `SELECT id FROM partner_settlement_payments WHERE settlement_id=$1::uuid AND reference_number=$2 LIMIT 1`,
          settlement.id,
          input.referenceNumber,
        );
        if (duplicate[0]) throw new ApiError(409, 'Payment reference number already exists for this settlement');
      }

      const paidRows = await tx.$queryRawUnsafe(
        `SELECT COALESCE(SUM(amount),0) AS total FROM partner_settlement_payments WHERE settlement_id=$1::uuid`,
        settlement.id,
      );
      const providerDue = Number(settlement.providerDue || 0);
      const paidAmount = Number(paidRows[0]?.total || 0) + Number(input.amount);
      if (paidAmount > providerDue + 0.001) throw new ApiError(409, 'Payment exceeds outstanding amount');
      const outstanding = Math.max(0, providerDue - paidAmount);
      const status = outstanding <= 0.001 ? 'PAID' : 'PARTIAL';
      const paymentId = crypto.randomUUID();

      await tx.$executeRawUnsafe(
        `INSERT INTO partner_settlement_payments (
           id,settlement_id,provider_shop_id,partner_shop_id,amount,payment_method,
           reference_number,note,received_by_id,created_at
         ) VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6,$7,$8,$9::uuid,NOW())`,
        paymentId,
        settlement.id,
        settlement.providerShopId,
        settlement.partnerShopId,
        input.amount,
        input.paymentMethod,
        input.referenceNumber || null,
        input.note || null,
        req.auth.userId,
      );
      await tx.$executeRawUnsafe(
        `UPDATE partner_weekly_settlements
            SET paid_amount=$2,outstanding_amount=$3,status=$4,paid_by_id=$5::uuid,
                paid_at=CASE WHEN $4='PAID' THEN NOW() ELSE NULL END,updated_at=NOW()
          WHERE id=$1::uuid`,
        settlement.id,
        paidAmount,
        outstanding,
        status,
        req.auth.userId,
      );
      if (status === 'PAID') {
        await tx.$executeRawUnsafe(
          `UPDATE partner_repair_ledger SET settlement_status='SETTLED',updated_by_id=$2::uuid,updated_at=NOW()
            WHERE settlement_id=$1::uuid`,
          settlement.id,
          req.auth.userId,
        );
      }
      await audit(tx, req, 'PARTNER_SETTLEMENT_PAYMENT_RECORDED', 'partner_weekly_settlement', settlement.id, { paymentId, ...input, paidAmount, outstanding, status });
      return { paymentId };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5000, timeout: 20000 });

    res.status(201).json({ ok: true, paymentId: result.paymentId, settlement: await getSettlement(req.auth.shopId, req.params.id) });
  }));

  app.get('/api/partner-settlements/export.csv', ...read, wrap(async (req, res) => {
    await assertTablesReady();
    const rows = await prisma.$queryRawUnsafe(
      `SELECT s.settlement_number AS "settlementNumber",l.partner_code AS "partnerCode",
              l.display_name AS "partnerName",s.period_start AS "periodStart",s.period_end AS "periodEnd",
              s.status,s.total_jobs AS "totalJobs",s.customer_collected AS "customerCollected",
              s.provider_due AS "providerDue",s.partner_profit AS "partnerProfit",
              s.paid_amount AS "paidAmount",s.outstanding_amount AS "outstandingAmount",
              s.confirmed_at AS "confirmedAt",s.paid_at AS "paidAt"
         FROM partner_weekly_settlements s JOIN partner_shop_links l ON l.id=s.partner_link_id
        WHERE s.provider_shop_id=$1::uuid OR s.partner_shop_id=$1::uuid
        ORDER BY s.period_end DESC,s.created_at DESC`,
      req.auth.shopId,
    );
    const headers = ['Settlement Number', 'Partner Code', 'Partner Name', 'Period Start', 'Period End', 'Status', 'Jobs', 'Customer Collected', 'Provider Due', 'Partner Profit', 'Paid', 'Outstanding', 'Confirmed At', 'Paid At'];
    const lines = [headers.map(csv).join(',')];
    for (const row of rows) {
      lines.push([
        row.settlementNumber,row.partnerCode,row.partnerName,row.periodStart?.toISOString?.().slice(0, 10) || row.periodStart,
        row.periodEnd?.toISOString?.().slice(0, 10) || row.periodEnd,row.status,row.totalJobs,row.customerCollected,
        row.providerDue,row.partnerProfit,row.paidAmount,row.outstandingAmount,row.confirmedAt?.toISOString?.() || '',row.paidAt?.toISOString?.() || '',
      ].map(csv).join(','));
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="partner-settlements.csv"');
    res.send(`\uFEFF${lines.join('\n')}`);
  }));
}

module.exports = attachPartnerSettlementApi;
