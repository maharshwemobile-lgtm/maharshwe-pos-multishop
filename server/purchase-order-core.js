const { z } = require('zod');
const { Prisma } = require('@prisma/client');
const {
  requireAuth,
  requireShopUser,
  requirePermission,
  requireWritableSubscription,
} = require('./auth-api');

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const optionalText = (max = 1000) => z.union([z.string().trim().max(max), z.null()]).optional();

const createOrderSchema = z.object({
  supplierId: z.string().uuid(),
  orderDate: dateSchema,
  expectedDate: z.union([dateSchema, z.literal(''), z.null()]).optional(),
  notes: optionalText(1000),
  items: z.array(z.object({
    productVariantId: z.string().uuid(),
    quantity: z.coerce.number().int().positive(),
    unitCost: z.coerce.number().finite().min(0),
    note: optionalText(500),
  })).min(1).max(500),
}).superRefine((value, context) => {
  if (value.expectedDate && value.expectedDate < value.orderDate) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['expectedDate'], message: 'Expected date cannot be before order date' });
  }
  const ids = value.items.map((item) => item.productVariantId);
  if (new Set(ids).size !== ids.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['items'], message: 'Duplicate product variants are not allowed' });
  }
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
  if (!result.success) throw new ApiError(400, 'Invalid purchase order request', result.error.flatten().fieldErrors);
  return result.data;
}

function wrap(handler) {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (error) {
      if (error instanceof ApiError) return res.status(error.status).json({ ok: false, message: error.message, details: error.details });
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return res.status(409).json({ ok: false, message: 'Purchase order number already exists' });
      }
      console.error('Purchase order API:', error);
      return res.status(500).json({ ok: false, message: error.message || 'Purchase order request failed' });
    }
  };
}

const access = {
  read: [requireAuth, requireShopUser, requirePermission('inventory')],
  write: [requireAuth, requireShopUser, requireWritableSubscription, requirePermission('inventory')],
};

module.exports = { createOrderSchema, ApiError, parse, wrap, access };
