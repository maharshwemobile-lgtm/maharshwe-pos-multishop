const crypto = require('crypto');
const { z } = require('zod');
const { prisma } = require('./prisma');
const { requireAuth, requireShopUser, requireWritableSubscription } = require('./auth-api');
const { ensureDefaultExpenseCategories, ensureExpenseCategoriesSchema } = require('./expense-categories-core');

const uuid = z.string().uuid();
const createSchema = z.object({ name: z.string().trim().min(1).max(80) });
const updateSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  active: z.boolean().optional(),
  sortOrder: z.coerce.number().int().min(0).max(10000).optional(),
}).refine((value) => Object.keys(value).length > 0, { message: 'At least one field is required' });

function requireAccountingRead(req, res, next) {
  if (req.auth?.role === 'SUPER_ADMIN' || req.auth?.role === 'SHOP_ADMIN') return next();
  const permissions = req.auth?.permissions || {};
  if (permissions.accounting === true || permissions.history === true || permissions.reports === true) return next();
  return res.status(403).json({ ok: false, message: 'Accounting permission is required' });
}

function requireAccountingWrite(req, res, next) {
  if (req.auth?.role === 'SUPER_ADMIN' || req.auth?.role === 'SHOP_ADMIN') return next();
  if (req.auth?.permissions?.accounting === true) return next();
  return res.status(403).json({ ok: false, message: 'Accounting permission is required' });
}

function parse(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) {
    const error = new Error('Invalid expense category request');
    error.status = 400;
    error.details = result.error.flatten().fieldErrors;
    throw error;
  }
  return result.data;
}

async function audit(req, action, entityId, details) {
  await prisma.auditLog.create({
    data: {
      shopId: req.auth.shopId,
      userId: req.auth.userId,
      action,
      entityType: 'business_expense_category',
      entityId,
      details,
      ipAddress: req.ip || null,
      userAgent: req.headers['user-agent'] || null,
    },
  }).catch((error) => console.warn('Expense category audit failed:', error.message));
}

function duplicateCategory(error) {
  const text = String(error?.message || '');
  return text.includes('business_expense_categories_shop_name_unique') || text.includes('duplicate key');
}

function attachExpenseCategoriesApi(app) {
  const read = [requireAuth, requireShopUser, requireAccountingRead];
  const write = [requireAuth, requireShopUser, requireWritableSubscription, requireAccountingWrite];

  app.get('/api/business-control/expense-categories', ...read, async (req, res) => {
    try {
      await ensureExpenseCategoriesSchema();
      await ensureDefaultExpenseCategories(req.auth.shopId, req.auth.userId);
      const includeInactive = String(req.query.includeInactive || '') === 'true';
      const rows = await prisma.$queryRawUnsafe(
        `SELECT c.id,c.name,c.active,c.sort_order AS "sortOrder",c.created_at AS "createdAt",c.updated_at AS "updatedAt",u.name AS "createdBy"
           FROM business_expense_categories c
           LEFT JOIN users u ON u.id=c.created_by_id
          WHERE c.shop_id=$1::uuid ${includeInactive ? '' : 'AND c.active=TRUE'}
          ORDER BY c.active DESC,c.sort_order ASC,LOWER(c.name) ASC`,
        req.auth.shopId,
      );
      return res.json({ ok: true, categories: rows });
    } catch (error) {
      return res.status(500).json({ ok: false, message: error.message || 'Expense categories failed' });
    }
  });

  app.post('/api/business-control/expense-categories', ...write, async (req, res) => {
    try {
      await ensureExpenseCategoriesSchema();
      const input = parse(createSchema, req.body || {});
      const id = crypto.randomUUID();
      const rows = await prisma.$queryRawUnsafe(
        `INSERT INTO business_expense_categories(id,shop_id,name,active,sort_order,created_by_id,created_at,updated_at)
         VALUES($1::uuid,$2::uuid,$3,TRUE,COALESCE((SELECT MAX(sort_order)+1 FROM business_expense_categories WHERE shop_id=$2::uuid),1),$4::uuid,NOW(),NOW())
         RETURNING id,name,active,sort_order AS "sortOrder",created_at AS "createdAt",updated_at AS "updatedAt"`,
        id, req.auth.shopId, input.name, req.auth.userId,
      );
      await audit(req, 'EXPENSE_CATEGORY_CREATED', id, { name: input.name });
      return res.status(201).json({ ok: true, category: rows[0], message: 'Expense category added' });
    } catch (error) {
      if (duplicateCategory(error)) return res.status(409).json({ ok: false, message: 'Expense category already exists' });
      return res.status(error.status || 500).json({ ok: false, message: error.message || 'Expense category add failed', details: error.details });
    }
  });

  app.patch('/api/business-control/expense-categories/:id', ...write, async (req, res) => {
    try {
      await ensureExpenseCategoriesSchema();
      const id = parse(uuid, req.params.id);
      const input = parse(updateSchema, req.body || {});
      const existing = await prisma.$queryRawUnsafe(
        'SELECT id,name,active,sort_order AS "sortOrder" FROM business_expense_categories WHERE id=$1::uuid AND shop_id=$2::uuid LIMIT 1',
        id, req.auth.shopId,
      );
      if (!existing[0]) return res.status(404).json({ ok: false, message: 'Expense category not found' });
      const rows = await prisma.$queryRawUnsafe(
        `UPDATE business_expense_categories
            SET name=$3,active=$4,sort_order=$5,updated_at=NOW()
          WHERE id=$1::uuid AND shop_id=$2::uuid
          RETURNING id,name,active,sort_order AS "sortOrder",created_at AS "createdAt",updated_at AS "updatedAt"`,
        id,
        req.auth.shopId,
        input.name ?? existing[0].name,
        input.active ?? existing[0].active,
        input.sortOrder ?? existing[0].sortOrder,
      );
      await audit(req, 'EXPENSE_CATEGORY_UPDATED', id, { before: existing[0], after: rows[0] });
      return res.json({ ok: true, category: rows[0], message: 'Expense category updated' });
    } catch (error) {
      if (duplicateCategory(error)) return res.status(409).json({ ok: false, message: 'Expense category already exists' });
      return res.status(error.status || 500).json({ ok: false, message: error.message || 'Expense category update failed', details: error.details });
    }
  });

  app.delete('/api/business-control/expense-categories/:id', ...write, async (req, res) => {
    try {
      await ensureExpenseCategoriesSchema();
      const id = parse(uuid, req.params.id);
      const rows = await prisma.$queryRawUnsafe(
        `UPDATE business_expense_categories
            SET active=FALSE,updated_at=NOW()
          WHERE id=$1::uuid AND shop_id=$2::uuid AND active=TRUE
          RETURNING id,name,active,sort_order AS "sortOrder",updated_at AS "updatedAt"`,
        id, req.auth.shopId,
      );
      if (!rows[0]) return res.status(404).json({ ok: false, message: 'Expense category not found or already hidden' });
      await audit(req, 'EXPENSE_CATEGORY_ARCHIVED', id, { name: rows[0].name });
      return res.json({ ok: true, category: rows[0], message: 'Expense category removed from future selection' });
    } catch (error) {
      return res.status(error.status || 500).json({ ok: false, message: error.message || 'Expense category remove failed' });
    }
  });
}

module.exports = attachExpenseCategoriesApi;
