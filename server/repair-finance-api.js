const { z } = require('zod');
const { prisma } = require('./prisma');
const {
  requireAuth,
  requireShopUser,
  requireWritableSubscription,
} = require('./auth-api');
const { ensureRepairPlatformSchema } = require('./repair-platform-schema');

const financeSchema = z.object({
  finalCost: z.coerce.number().finite().min(0).optional(),
  partsCost: z.coerce.number().finite().min(0).default(0),
  technicianCommission: z.coerce.number().finite().min(0).default(0),
  otherCost: z.coerce.number().finite().min(0).default(0),
  note: z.string().trim().max(500).optional().nullable(),
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
  if (!result.success) throw new ApiError(400, 'Invalid repair finance request', result.error.flatten().fieldErrors);
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
      console.error('Repair finance API:', error);
      return res.status(500).json({ ok: false, message: error.message || 'Repair finance request failed' });
    }
  };
}

function requireRepairFinanceRead(req, res, next) {
  if (req.auth?.role === 'SUPER_ADMIN' || req.auth?.role === 'SHOP_ADMIN') return next();
  const permissions = req.auth?.permissions || {};
  if (permissions.repairs === true || permissions.accounting === true || permissions.reports === true) return next();
  return res.status(403).json({ ok: false, message: 'Insufficient repair finance permission' });
}

function requireRepairFinanceWrite(req, res, next) {
  if (req.auth?.role === 'SUPER_ADMIN' || req.auth?.role === 'SHOP_ADMIN') return next();
  const permissions = req.auth?.permissions || {};
  if (permissions.repairs === true && permissions.accounting === true) return next();
  return res.status(403).json({ ok: false, message: 'Repair and accounting permissions are required' });
}

const number = (value) => Number(value || 0);

function normalizeRepairId(value) {
  return String(value || '').trim().toUpperCase().replace(/\s+/g, '');
}

function repairFinanceJson(row) {
  if (!row) return null;
  const finalCost = number(row.finalCost);
  const partsCost = number(row.partsCost);
  const technicianCommission = number(row.technicianCommission);
  const otherCost = number(row.otherCost);
  const totalCost = partsCost + technicianCommission + otherCost;
  const profit = finalCost - totalCost;
  return {
    repairId: row.id,
    repairNumber: row.repairNumber,
    finalCost,
    partsCost,
    technicianCommission,
    otherCost,
    totalCost,
    profit,
    marginPercent: finalCost > 0 ? Number(((profit / finalCost) * 100).toFixed(2)) : 0,
    paidAmount: number(row.paidAmount),
    paymentStatus: row.paymentStatus,
    status: row.status,
    completedAt: row.completedAt,
  };
}

async function findRepairFinance(shopId, identifier) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT r.id,
            r.repair_number AS "repairNumber",
            r.final_cost AS "finalCost",
            r.parts_cost AS "partsCost",
            r.technician_commission AS "technicianCommission",
            r.other_cost AS "otherCost",
            r.payment_status AS "paymentStatus",
            r.status,
            r.completed_at AS "completedAt",
            COALESCE((
              SELECT SUM(rp.amount)
                FROM repair_payments rp
               WHERE rp.shop_id = r.shop_id
                 AND rp.repair_id = r.id
                 AND rp.status = 'PAID'
            ), 0) AS "paidAmount"
       FROM repairs r
      WHERE r.shop_id = $1::uuid
        AND (r.id::text = $2 OR r.repair_number = $3)
      LIMIT 1`,
    shopId,
    String(identifier || ''),
    normalizeRepairId(identifier),
  );
  return repairFinanceJson(rows[0]);
}

function csvCell(value) {
  const text = value === null || value === undefined ? '' : String(value);
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function dateStart(value) {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00+06:30`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function dateEnd(value) {
  if (!value) return null;
  const date = new Date(`${value}T23:59:59.999+06:30`);
  return Number.isNaN(date.getTime()) ? null : date;
}

async function weeklySummary(shopId) {
  const rows = await prisma.$queryRawUnsafe(
    `WITH bounds AS (
       SELECT
         (date_trunc('week', NOW() AT TIME ZONE 'Asia/Yangon') AT TIME ZONE 'Asia/Yangon') AS this_start,
         ((date_trunc('week', NOW() AT TIME ZONE 'Asia/Yangon') + INTERVAL '7 days') AT TIME ZONE 'Asia/Yangon') AS next_start,
         ((date_trunc('week', NOW() AT TIME ZONE 'Asia/Yangon') - INTERVAL '7 days') AT TIME ZONE 'Asia/Yangon') AS previous_start
     ),
     repair_totals AS (
       SELECT
         COALESCE(SUM(r.final_cost) FILTER (
           WHERE r.status IN ('COMPLETED','DELIVERED')
             AND COALESCE(r.completed_at, r.delivered_at, r.updated_at) >= b.this_start
             AND COALESCE(r.completed_at, r.delivered_at, r.updated_at) < b.next_start
         ), 0) AS repair_revenue,
         COALESCE(SUM(r.parts_cost + r.technician_commission + r.other_cost) FILTER (
           WHERE r.status IN ('COMPLETED','DELIVERED')
             AND COALESCE(r.completed_at, r.delivered_at, r.updated_at) >= b.this_start
             AND COALESCE(r.completed_at, r.delivered_at, r.updated_at) < b.next_start
         ), 0) AS repair_cost,
         COALESCE(SUM(r.final_cost - r.parts_cost - r.technician_commission - r.other_cost) FILTER (
           WHERE r.status IN ('COMPLETED','DELIVERED')
             AND COALESCE(r.completed_at, r.delivered_at, r.updated_at) >= b.this_start
             AND COALESCE(r.completed_at, r.delivered_at, r.updated_at) < b.next_start
         ), 0) AS repair_profit,
         COALESCE(SUM(r.final_cost - r.parts_cost - r.technician_commission - r.other_cost) FILTER (
           WHERE r.status IN ('COMPLETED','DELIVERED')
             AND COALESCE(r.completed_at, r.delivered_at, r.updated_at) >= b.previous_start
             AND COALESCE(r.completed_at, r.delivered_at, r.updated_at) < b.this_start
         ), 0) AS previous_repair_profit,
         COUNT(*) FILTER (
           WHERE r.status IN ('COMPLETED','DELIVERED')
             AND COALESCE(r.completed_at, r.delivered_at, r.updated_at) >= b.this_start
             AND COALESCE(r.completed_at, r.delivered_at, r.updated_at) < b.next_start
         )::int AS completed_repairs
       FROM repairs r CROSS JOIN bounds b
       WHERE r.shop_id = $1::uuid
     ),
     sale_totals AS (
       SELECT
         COALESCE(SUM(s.profit_total) FILTER (
           WHERE s.status = 'COMPLETED' AND s.sold_at >= b.this_start AND s.sold_at < b.next_start
         ), 0) AS sales_profit,
         COALESCE(SUM(s.profit_total) FILTER (
           WHERE s.status = 'COMPLETED' AND s.sold_at >= b.previous_start AND s.sold_at < b.this_start
         ), 0) AS previous_sales_profit
       FROM sales s CROSS JOIN bounds b
       WHERE s.shop_id = $1::uuid
     ),
     money_totals AS (
       SELECT
         COALESCE(SUM(m.service_profit) FILTER (
           WHERE m.created_at >= b.this_start AND m.created_at < b.next_start
         ), 0) AS money_profit,
         COALESCE(SUM(m.service_profit) FILTER (
           WHERE m.created_at >= b.previous_start AND m.created_at < b.this_start
         ), 0) AS previous_money_profit
       FROM money_service_transactions m CROSS JOIN bounds b
       WHERE m.shop_id = $1::uuid
     )
     SELECT b.this_start AS "weekStart",
            b.next_start AS "weekEnd",
            rt.repair_revenue AS "repairRevenue",
            rt.repair_cost AS "repairCost",
            rt.repair_profit AS "repairProfit",
            rt.previous_repair_profit AS "previousRepairProfit",
            rt.completed_repairs AS "completedRepairs",
            st.sales_profit AS "salesProfit",
            st.previous_sales_profit AS "previousSalesProfit",
            mt.money_profit AS "moneyProfit",
            mt.previous_money_profit AS "previousMoneyProfit"
       FROM bounds b, repair_totals rt, sale_totals st, money_totals mt`,
    shopId,
  );
  const row = rows[0] || {};
  const repairProfit = number(row.repairProfit);
  const salesProfit = number(row.salesProfit);
  const moneyProfit = number(row.moneyProfit);
  const previousTotal = number(row.previousRepairProfit) + number(row.previousSalesProfit) + number(row.previousMoneyProfit);
  const totalProfit = repairProfit + salesProfit + moneyProfit;
  return {
    weekStart: row.weekStart,
    weekEnd: row.weekEnd,
    repairRevenue: number(row.repairRevenue),
    repairCost: number(row.repairCost),
    repairProfit,
    salesProfit,
    moneyProfit,
    totalProfit,
    completedRepairs: Number(row.completedRepairs || 0),
    previousTotalProfit: previousTotal,
    changePercent: previousTotal === 0
      ? (totalProfit === 0 ? 0 : 100)
      : Number((((totalProfit - previousTotal) / Math.abs(previousTotal)) * 100).toFixed(2)),
  };
}

function attachRepairFinanceApi(app) {
  const read = [requireAuth, requireShopUser, requireRepairFinanceRead];
  const write = [requireAuth, requireShopUser, requireWritableSubscription, requireRepairFinanceWrite];

  app.get('/api/repair-platform/finance/weekly', ...read, wrap(async (req, res) => {
    res.json({ ok: true, weekly: await weeklySummary(req.auth.shopId) });
  }));

  app.get('/api/repair-platform/jobs/:id/finance', ...read, wrap(async (req, res) => {
    const finance = await findRepairFinance(req.auth.shopId, req.params.id);
    if (!finance) throw new ApiError(404, 'Repair job not found');
    res.json({ ok: true, finance });
  }));

  app.patch('/api/repair-platform/jobs/:id/finance', ...write, wrap(async (req, res) => {
    const input = parse(financeSchema, req.body || {});
    const current = await findRepairFinance(req.auth.shopId, req.params.id);
    if (!current) throw new ApiError(404, 'Repair job not found');

    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `UPDATE repairs
            SET final_cost = COALESCE($3::numeric, final_cost),
                parts_cost = $4::numeric,
                technician_commission = $5::numeric,
                other_cost = $6::numeric,
                updated_at = NOW()
          WHERE id = $1::uuid AND shop_id = $2::uuid`,
        current.repairId,
        req.auth.shopId,
        input.finalCost === undefined ? null : input.finalCost,
        input.partsCost,
        input.technicianCommission,
        input.otherCost,
      );
      await tx.auditLog.create({
        data: {
          shopId: req.auth.shopId,
          userId: req.auth.userId,
          action: 'REPAIR_FINANCE_UPDATED',
          entityType: 'repair',
          entityId: current.repairId,
          details: {
            repairNumber: current.repairNumber,
            before: current,
            after: input,
            note: input.note || null,
          },
          ipAddress: req.ip || null,
          userAgent: req.headers['user-agent'] || null,
        },
      });
    });

    res.json({
      ok: true,
      message: 'Repair finance updated',
      finance: await findRepairFinance(req.auth.shopId, current.repairId),
    });
  }));

  app.get('/api/repair-platform/export.csv', ...read, wrap(async (req, res) => {
    const params = [req.auth.shopId];
    const filters = ['r.shop_id = $1::uuid'];
    const search = String(req.query.q || '').trim().toLowerCase();
    const status = String(req.query.status || '').trim();
    const sourceType = String(req.query.sourceType || '').trim();
    const from = dateStart(req.query.from);
    const to = dateEnd(req.query.to);

    if (search) {
      params.push(`%${search}%`);
      filters.push(`LOWER(CONCAT_WS(' ', r.repair_number, r.customer_name, r.customer_phone, r.device_brand, r.device_model, r.imei_serial, r.problem)) LIKE $${params.length}`);
    }
    if (status) {
      params.push(status);
      filters.push(`r.status::text = $${params.length}`);
    }
    if (sourceType) {
      params.push(sourceType);
      filters.push(`r.source_type = $${params.length}`);
    }
    if (from) {
      params.push(from);
      filters.push(`r.received_at >= $${params.length}::timestamptz`);
    }
    if (to) {
      params.push(to);
      filters.push(`r.received_at <= $${params.length}::timestamptz`);
    }

    const rows = await prisma.$queryRawUnsafe(
      `SELECT r.repair_number AS "repairNumber",
              r.received_at AS "receivedAt",
              r.completed_at AS "completedAt",
              r.customer_name AS "customerName",
              r.customer_phone AS "customerPhone",
              r.device_brand AS "deviceBrand",
              r.device_model AS "deviceModel",
              r.imei_serial AS "imeiSerial",
              r.problem,
              r.status,
              r.source_type AS "sourceType",
              r.source_shop_name AS "sourceShopName",
              r.payment_status AS "paymentStatus",
              r.final_cost AS "finalCost",
              r.deposit,
              r.parts_cost AS "partsCost",
              r.technician_commission AS "technicianCommission",
              r.other_cost AS "otherCost",
              (r.parts_cost + r.technician_commission + r.other_cost) AS "totalCost",
              (r.final_cost - r.parts_cost - r.technician_commission - r.other_cost) AS profit,
              r.diagnosis,
              r.resolution,
              r.warranty_until AS "warrantyUntil",
              u.name AS "technicianName",
              COALESCE((SELECT SUM(rp.amount) FROM repair_payments rp WHERE rp.shop_id = r.shop_id AND rp.repair_id = r.id AND rp.status = 'PAID'), 0) AS "paidAmount"
         FROM repairs r
         LEFT JOIN users u ON u.id = r.technician_id AND (u.shop_id = r.shop_id OR u.shop_id IS NULL)
        WHERE ${filters.join(' AND ')}
        ORDER BY r.received_at DESC
        LIMIT 10000`,
      ...params,
    );

    const headers = [
      'Repair ID', 'Received At', 'Completed At', 'Customer', 'Phone', 'Brand', 'Model',
      'IMEI / Serial', 'Problem', 'Status', 'Source', 'Source Shop', 'Technician',
      'Final Cost', 'Paid Amount', 'Deposit', 'Parts Cost', 'Technician Commission',
      'Other Cost', 'Total Cost', 'Profit', 'Payment Status', 'Diagnosis', 'Resolution', 'Warranty Until',
    ];
    const records = rows.map((row) => [
      row.repairNumber,
      row.receivedAt?.toISOString?.() || row.receivedAt || '',
      row.completedAt?.toISOString?.() || row.completedAt || '',
      row.customerName,
      row.customerPhone,
      row.deviceBrand,
      row.deviceModel,
      row.imeiSerial,
      row.problem,
      row.status,
      row.sourceType,
      row.sourceShopName,
      row.technicianName,
      number(row.finalCost),
      number(row.paidAmount),
      number(row.deposit),
      number(row.partsCost),
      number(row.technicianCommission),
      number(row.otherCost),
      number(row.totalCost),
      number(row.profit),
      row.paymentStatus,
      row.diagnosis,
      row.resolution,
      row.warrantyUntil || '',
    ]);
    const csv = `\uFEFF${[headers, ...records].map((record) => record.map(csvCell).join(',')).join('\r\n')}`;
    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="repair-transactions-${stamp}.csv"`);
    res.send(csv);
  }));
}

module.exports = attachRepairFinanceApi;
