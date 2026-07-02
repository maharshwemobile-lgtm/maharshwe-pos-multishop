const bcrypt = require('bcryptjs');
const { z } = require('zod');
const { Prisma } = require('@prisma/client');
const { prisma } = require('./prisma');
const {
  requireAuth,
  requireShopUser,
  requireWritableSubscription,
} = require('./auth-api');

const uuid = z.string().uuid();
const permissionSchema = z.record(z.string(), z.boolean()).optional();

const createUserSchema = z.object({
  username: z.string().trim().min(2).max(80),
  email: z.string().trim().email().max(180).optional(),
  password: z.string().min(6).max(200),
  name: z.string().trim().min(1).max(180),
  role: z.enum(['SHOP_ADMIN', 'CASHIER', 'Admin', 'Cashier']).default('CASHIER'),
  permissions: permissionSchema,
});

const updateUserSchema = z.object({
  name: z.string().trim().min(1).max(180).optional(),
  email: z.string().trim().email().max(180).optional(),
  password: z.string().min(6).max(200).optional(),
  role: z.enum(['SHOP_ADMIN', 'CASHIER', 'Admin', 'Cashier']).optional(),
  permissions: permissionSchema,
  active: z.boolean().optional(),
}).refine((value) => Object.keys(value).length > 0, { message: 'At least one field is required' });

const deleteUserSchema = z.object({
  confirmation: z.string().trim().min(1).max(100),
});

const ADMIN_PERMISSIONS = {
  sale: true,
  history: true,
  discount: true,
  editSale: true,
  deleteSale: true,
  inventory: true,
  accounting: true,
  settings: true,
  viewCost: true,
};

const CASHIER_PERMISSIONS = {
  sale: true,
  history: true,
  discount: false,
  editSale: false,
  deleteSale: false,
  inventory: false,
  accounting: false,
  settings: false,
  viewCost: false,
};

class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

function parse(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) throw new ApiError(400, 'Invalid user request', result.error.flatten().fieldErrors);
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
        return res.status(409).json({ ok: false, message: 'Username or email already exists' });
      }
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
        return res.status(409).json({ ok: false, message: 'This user is linked to historical records. Deactivate the user instead of deleting.' });
      }
      console.error('Tenant users API:', error);
      return res.status(500).json({ ok: false, message: error.message || 'User request failed' });
    }
  };
}

function normalizeUsername(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeEmail(value) {
  const email = normalizeUsername(value);
  return email && email.includes('@') ? email : null;
}

function emailForUserInput(input) {
  return normalizeEmail(input.email) || normalizeEmail(input.username);
}

function normalizeRole(value) {
  return value === 'SHOP_ADMIN' || value === 'Admin' ? 'SHOP_ADMIN' : 'CASHIER';
}

function defaultPermissions(role) {
  return role === 'SHOP_ADMIN' ? ADMIN_PERMISSIONS : CASHIER_PERMISSIONS;
}

function publicUser(user) {
  return {
    id: user.id,
    shopId: user.shopId,
    email: user.email || null,
    username: user.username,
    name: user.name,
    avatarUrl: user.avatarUrl || null,
    provider: user.authProvider || null,
    role: user.role,
    permissions: user.permissions || {},
    active: user.active,
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

function requireUserAdmin(req, res, next) {
  if (req.auth?.role === 'SHOP_ADMIN' || req.auth?.role === 'SUPER_ADMIN') return next();
  if (req.auth?.permissions?.settings === true) return next();
  return res.status(403).json({ ok: false, message: 'Insufficient user management permission' });
}

function requireStrictAdmin(req, res, next) {
  if (req.auth?.role === 'SHOP_ADMIN' || req.auth?.role === 'SUPER_ADMIN') return next();
  return res.status(403).json({ ok: false, message: 'Only an Admin can permanently delete a user' });
}

async function ensureTenantUser(tx, shopId, userId) {
  const user = await tx.user.findFirst({ where: { id: userId, shopId } });
  if (!user) throw new ApiError(404, 'User not found in this shop');
  return user;
}

async function activeAdminCount(tx, shopId) {
  return tx.user.count({ where: { shopId, role: 'SHOP_ADMIN', active: true } });
}

function attachTenantUsersPostgresApi(app) {
  const read = [requireAuth, requireShopUser, requireUserAdmin];
  const write = [requireAuth, requireShopUser, requireWritableSubscription, requireUserAdmin];
  const strictWrite = [requireAuth, requireShopUser, requireWritableSubscription, requireStrictAdmin];

  app.get('/api/users/live', ...read, wrap(async (req, res) => {
    const users = await prisma.user.findMany({
      where: { shopId: req.auth.shopId },
      select: {
        id: true,
        shopId: true,
        email: true,
        username: true,
        name: true,
        avatarUrl: true,
        authProvider: true,
        role: true,
        permissions: true,
        active: true,
        lastLoginAt: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: [{ active: 'desc' }, { role: 'asc' }, { createdAt: 'asc' }],
    });

    const shop = await prisma.shop.findUnique({
      where: { id: req.auth.shopId },
      select: { id: true, slug: true, name: true },
    });

    res.json({
      ok: true,
      tenant: shop,
      total: users.length,
      users: users.map(publicUser),
    });
  }));

  app.post('/api/users/live', ...write, wrap(async (req, res) => {
    const input = parse(createUserSchema, req.body || {});
    const role = normalizeRole(input.role);
    const normalizedUsername = normalizeUsername(input.username);
    const passwordHash = await bcrypt.hash(input.password, 12);

    const user = await prisma.user.create({
      data: {
        shopId: req.auth.shopId,
        email: emailForUserInput(input),
        username: input.username.trim(),
        normalizedUsername,
        passwordHash,
        name: input.name.trim(),
        role,
        permissions: input.permissions || defaultPermissions(role),
        active: true,
      },
    });

    res.status(201).json({ ok: true, user: publicUser(user) });
  }));

  app.patch('/api/users/live/:id', ...write, wrap(async (req, res) => {
    const userId = parse(uuid, req.params.id);
    const input = parse(updateUserSchema, req.body || {});

    const updated = await prisma.$transaction(async (tx) => {
      const existing = await ensureTenantUser(tx, req.auth.shopId, userId);
      const nextRole = input.role ? normalizeRole(input.role) : existing.role;
      const nextActive = input.active === undefined ? existing.active : input.active;

      if (existing.id === req.auth.userId && nextActive === false) {
        throw new ApiError(409, 'You cannot deactivate your own account');
      }

      const removesActiveAdmin = existing.role === 'SHOP_ADMIN'
        && existing.active
        && (nextRole !== 'SHOP_ADMIN' || nextActive === false);
      if (removesActiveAdmin && await activeAdminCount(tx, req.auth.shopId) <= 1) {
        throw new ApiError(409, 'At least one active shop admin is required');
      }

      const data = {
        ...(input.name ? { name: input.name.trim() } : {}),
        ...(input.email !== undefined ? { email: normalizeEmail(input.email) } : {}),
        ...(input.role ? { role: nextRole } : {}),
        ...(input.active !== undefined ? { active: input.active } : {}),
        ...(input.permissions ? { permissions: input.permissions } : input.role ? { permissions: defaultPermissions(nextRole) } : {}),
        ...(input.password ? { passwordHash: await bcrypt.hash(input.password, 12) } : {}),
      };

      return tx.user.update({ where: { id: existing.id }, data });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    res.json({ ok: true, user: publicUser(updated) });
  }));

  app.delete('/api/users/live/:id', ...write, wrap(async (req, res) => {
    const userId = parse(uuid, req.params.id);

    const user = await prisma.$transaction(async (tx) => {
      const existing = await ensureTenantUser(tx, req.auth.shopId, userId);
      if (existing.id === req.auth.userId) throw new ApiError(409, 'You cannot deactivate your own account');
      if (!existing.active) return existing;

      if (existing.role === 'SHOP_ADMIN' && await activeAdminCount(tx, req.auth.shopId) <= 1) {
        throw new ApiError(409, 'At least one active shop admin is required');
      }

      return tx.user.update({ where: { id: existing.id }, data: { active: false } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    res.json({
      ok: true,
      message: 'User deactivated. Historical sales remain linked to this user.',
      user: publicUser(user),
    });
  }));

  app.delete('/api/users/live/:id/permanent', ...strictWrite, wrap(async (req, res) => {
    const userId = parse(uuid, req.params.id);
    const input = parse(deleteUserSchema, req.body || {});

    const deleted = await prisma.$transaction(async (tx) => {
      const existing = await ensureTenantUser(tx, req.auth.shopId, userId);
      if (existing.id === req.auth.userId) throw new ApiError(409, 'You cannot delete your own account');
      if (existing.role !== 'CASHIER') {
        throw new ApiError(403, 'Admin accounts cannot be permanently deleted');
      }

      const confirmation = normalizeUsername(input.confirmation.replace(/^@/, ''));
      if (confirmation !== normalizeUsername(existing.username)) {
        throw new ApiError(400, `Type ${existing.username} to confirm permanent deletion`);
      }

      const salesCount = await tx.sale.count({ where: { shopId: req.auth.shopId, userId: existing.id } });
      if (salesCount > 0) {
        throw new ApiError(409, `This user has ${salesCount} linked sale record(s). Deactivate the user instead.`);
      }

      await tx.auditLog.create({
        data: {
          shopId: req.auth.shopId,
          userId: req.auth.userId,
          action: 'USER_PERMANENT_DELETE',
          entityType: 'user',
          entityId: existing.id,
          details: {
            targetUsername: existing.username,
            targetName: existing.name,
            targetRole: existing.role,
          },
          ipAddress: req.ip || null,
          userAgent: req.headers['user-agent'] || null,
        },
      });

      await tx.user.delete({ where: { id: existing.id } });
      return { id: existing.id, username: existing.username, name: existing.name };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    res.json({
      ok: true,
      message: `User @${deleted.username} permanently deleted`,
      user: deleted,
    });
  }));
}

module.exports = attachTenantUsersPostgresApi;
