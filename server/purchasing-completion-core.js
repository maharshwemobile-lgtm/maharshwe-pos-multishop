const { z } = require('zod');
const { Prisma } = require('@prisma/client');
const { prisma } = require('./prisma');
const {
  requireAuth,
  requireShopUser,
  requirePermission,
  requireWritableSubscription,
} = require('./auth-api');

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const optionalText = (max = 1000) => z.union([z.string().trim().max(max), z.literal(''), z.null()]).optional();

const receiveSchema = z.object({
  receivedDate: dateSchema,
  note: optionalText(1000),
  items: z.array(z.object({
    purchaseOrderItemId: z.string().uuid(),
    quantity: z.coerce.number().int().positive(),
    unitCost: z.coerce.number().finite().min(0).optional(),
  })).min(1).max(500),
});

const supplierPaymentSchema = z.object({
  supplierId: z.string().uuid(),
  purchaseOrderId: z.union([z.string().uuid(), z.literal(''), z.null()]).optional(),
  paymentDate: dateSchema,
  amount: z.coerce.number().finite().positive(),
  method: z.enum(['CASH', 'KPAY', 'WAVE_PAY', 'OTHER']),
  moneyAccountId: z.union([z.string().uuid(), z.literal(''), z.null()]).optional(),
  reference: optionalText(180),
  note: optionalText(1000),
});

const supplierReturnSchema = z.object({
  purchaseOrderId: z.string().uuid(),
  returnDate: dateSchema,
  reason: z.string().trim().min(1).max(1000),
  items: z.array(z.object({
    purchaseOrderItemId: z.string().uuid(),
    quantity: z.coerce.number().int().positive(),
    note: optionalText(500),
  })).min(1).max(500),
});

const repairPartsSchema = z.object({
  repairId: z.string().min(1).max(100),
  items: z.array(z.object({
    productVariantId: z.string().uuid(),
    quantity: z.coerce.number().int().positive(),
    note: optionalText(500),
  })).min(1).max(100),
});

const reverseRepairPartSchema = z.object({
  reason: z.string().trim().min(1).max(500),
});

class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

function parse(schema, value, message = 'Invalid purchasing request') {
  const result = schema.safeParse(value);
  if (!result.success) throw new ApiError(400, message, result.error.flatten().fieldErrors);
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
        return res.status(409).json({ ok: false, message: 'Duplicate purchasing reference' });
      }
      console.error('Purchasing completion API:', error);
      return res.status(500).json({ ok: false, message: error.message || 'Purchasing request failed' });
    }
  };
}

const access = {
  read: [requireAuth, requireShopUser, requirePermission('inventory')],
  write: [requireAuth, requireShopUser, requireWritableSubscription, requirePermission('inventory')],
};

async function serializable(work, timeout = 30000) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.$transaction(work, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 5000,
        timeout,
      });
    } catch (error) {
      if (error?.code === 'P2034' && attempt < 2) continue;
      throw error;
    }
  }
}

async function audit(tx, req, action, entityType, entityId, details) {
  await tx.auditLog.create({
    data: {
      shopId: req.auth.shopId,
      userId: req.auth.userId,
      action,
      entityType,
      entityId,
      details,
      ipAddress: req.ip || null,
      userAgent: req.headers['user-agent'] || null,
    },
  });
}

async function nextNumber(tx, shopId, table, column, prefix, width = 6) {
  const allowed = {
    purchase_receipts: 'receipt_number',
    supplier_payments: 'payment_number',
    purchase_returns: 'return_number',
  };
  if (allowed[table] !== column) throw new ApiError(500, 'Invalid purchasing number source');
  await tx.$queryRawUnsafe(
    `WITH advisory_lock AS (
       SELECT pg_advisory_xact_lock(hashtext($1))
     )
     SELECT 1::int AS acquired FROM advisory_lock`,
    `phase10:${table}:${shopId}`,
  );
  const rows = await tx.$queryRawUnsafe(
    `SELECT COALESCE(MAX(CASE WHEN ${column} ~ $2 THEN substring(${column} FROM $3)::int ELSE 0 END),0)::int + 1 AS next_number
       FROM ${table}
      WHERE shop_id=$1::uuid`,
    shopId,
    `^${prefix}[0-9]+$`,
    prefix.length + 1,
  );
  return `${prefix}${String(Number(rows[0]?.next_number || 1)).padStart(width, '0')}`;
}

async function assertCompletionTablesReady() {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT to_regclass('public.purchase_receipts')::text AS receipts,
            to_regclass('public.purchase_receipt_items')::text AS receipt_items,
            to_regclass('public.supplier_payments')::text AS payments,
            to_regclass('public.purchase_returns')::text AS returns,
            to_regclass('public.purchase_return_items')::text AS return_items,
            to_regclass('public.repair_part_usages')::text AS repair_parts`,
  );
  const row = rows[0] || {};
  if (!row.receipts || !row.receipt_items || !row.payments || !row.returns || !row.return_items || !row.repair_parts) {
    throw new ApiError(503, 'Phase 10 purchasing completion migration is not deployed');
  }
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

function csvCell(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

module.exports = {
  prisma,
  access,
  ApiError,
  parse,
  wrap,
  serializable,
  audit,
  nextNumber,
  assertCompletionTablesReady,
  receiveSchema,
  supplierPaymentSchema,
  supplierReturnSchema,
  repairPartsSchema,
  reverseRepairPartSchema,
  dateStart,
  dateEnd,
  csvCell,
};
