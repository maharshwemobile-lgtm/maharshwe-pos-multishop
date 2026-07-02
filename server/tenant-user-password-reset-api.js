const bcrypt = require('bcryptjs');
const { z } = require('zod');
const { prisma } = require('./prisma');
const {
  requireAuth,
  requireShopUser,
  requireWritableSubscription,
} = require('./auth-api');

const paramsSchema = z.object({ id: z.string().uuid() });
const passwordSchema = z.object({
  password: z.string().min(6).max(200),
  reason: z.string().trim().max(300).optional(),
});
const accessSchema = z.object({
  name: z.string().trim().min(1).max(180).optional(),
  role: z.enum(['SHOP_ADMIN', 'CASHIER', 'Admin', 'Cashier']).optional(),
  permissions: z.record(z.string(), z.boolean()).optional(),
  active: z.boolean().optional(),
}).refine((value) => Object.keys(value).length > 0, { message: 'At least one field is required' });

function requireUserAdmin(req, res, next) {
  if (req.auth?.role === 'SUPER_ADMIN' || req.auth?.role === 'SHOP_ADMIN') return next();
  if (req.auth?.permissions?.settings === true) return next();
  return res.status(403).json({ ok: false, message: 'Insufficient user management permission' });
}

function requirePasswordAdmin(req, res, next) {
  if (req.auth?.role === 'SUPER_ADMIN' || req.auth?.role === 'SHOP_ADMIN') return next();
  return res.status(403).json({ ok: false, message: 'Only an Admin can reset a user password' });
}

function normalizeRole(value) {
  return value === 'SHOP_ADMIN' || value === 'Admin' ? 'SHOP_ADMIN' : 'CASHIER';
}

function publicUser(user) {
  return {
    id: user.id,
    shopId: user.shopId,
    username: user.username,
    name: user.name,
    role: user.role,
    permissions: user.permissions || {},
    active: user.active,
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

async function findTenantUser(shopId, userId) {
  return prisma.user.findFirst({ where: { id: userId, shopId } });
}

function attachTenantUserPasswordResetApi(app) {
  const write = [requireAuth, requireShopUser, requireWritableSubscription, requireUserAdmin];
  const passwordWrite = [requireAuth, requireShopUser, requireWritableSubscription, requirePasswordAdmin];

  app.patch('/api/users/live/:id', ...write, async (req, res) => {
    try {
      const params = paramsSchema.safeParse(req.params || {});
      const body = accessSchema.safeParse(req.body || {});
      if (!params.success || !body.success) {
        return res.status(400).json({
          ok: false,
          message: 'Invalid user access request',
          details: {
            params: params.success ? undefined : params.error.flatten().fieldErrors,
            body: body.success ? undefined : body.error.flatten().fieldErrors,
          },
        });
      }

      const existing = await findTenantUser(req.auth.shopId, params.data.id);
      if (!existing) return res.status(404).json({ ok: false, message: 'User not found in this shop' });
      if (existing.role === 'SUPER_ADMIN' && req.auth.role !== 'SUPER_ADMIN') {
        return res.status(403).json({ ok: false, message: 'Only Super Admin can modify this account' });
      }

      const nextRole = body.data.role ? normalizeRole(body.data.role) : existing.role;
      const nextActive = body.data.active === undefined ? existing.active : body.data.active;
      if (existing.id === req.auth.userId && nextActive === false) {
        return res.status(409).json({ ok: false, message: 'You cannot deactivate your own account' });
      }

      const removesActiveAdmin = existing.role === 'SHOP_ADMIN'
        && existing.active
        && (nextRole !== 'SHOP_ADMIN' || nextActive === false);
      if (removesActiveAdmin) {
        const activeAdmins = await prisma.user.count({
          where: { shopId: req.auth.shopId, role: 'SHOP_ADMIN', active: true },
        });
        if (activeAdmins <= 1) {
          return res.status(409).json({ ok: false, message: 'At least one active shop admin is required' });
        }
      }

      const data = {
        ...(body.data.name ? { name: body.data.name.trim() } : {}),
        ...(body.data.role ? { role: nextRole } : {}),
        ...(body.data.active !== undefined ? { active: body.data.active } : {}),
        ...(body.data.permissions ? { permissions: body.data.permissions } : {}),
      };

      const updated = await prisma.user.update({ where: { id: existing.id }, data });
      return res.json({
        ok: true,
        message: 'User access updated',
        passwordChanged: false,
        user: publicUser(updated),
      });
    } catch (error) {
      console.error('Tenant user access hotfix:', error);
      return res.status(500).json({ ok: false, message: error.message || 'User access update failed' });
    }
  });

  app.post('/api/users/live/:id/reset-password', ...passwordWrite, async (req, res) => {
    try {
      const params = paramsSchema.safeParse(req.params || {});
      const body = passwordSchema.safeParse(req.body || {});
      if (!params.success || !body.success) {
        return res.status(400).json({ ok: false, message: 'Password must contain at least 6 characters' });
      }

      const user = await findTenantUser(req.auth.shopId, params.data.id);
      if (!user) return res.status(404).json({ ok: false, message: 'User not found in this shop' });
      if (user.role === 'SUPER_ADMIN' && req.auth.role !== 'SUPER_ADMIN') {
        return res.status(403).json({ ok: false, message: 'Only Super Admin can reset this account' });
      }

      const passwordHash = await bcrypt.hash(body.data.password, 12);
      const updated = await prisma.$transaction(async (tx) => {
        const changed = await tx.user.update({
          where: { id: user.id },
          data: { passwordHash },
          select: { id: true, username: true, name: true, role: true, updatedAt: true },
        });

        await tx.auditLog.create({
          data: {
            shopId: req.auth.shopId,
            userId: req.auth.userId,
            action: 'USER_PASSWORD_RESET',
            entityType: 'user',
            entityId: user.id,
            details: {
              targetUsername: user.username,
              targetName: user.name,
              targetRole: user.role,
              resetByRole: req.auth.role,
              reason: body.data.reason || null,
            },
            ipAddress: req.ip || null,
            userAgent: req.headers['user-agent'] || null,
          },
        });

        return changed;
      });

      return res.json({
        ok: true,
        message: `Password reset completed for @${updated.username}`,
        passwordChanged: true,
        user: updated,
      });
    } catch (error) {
      console.error('Tenant password reset:', error);
      return res.status(500).json({ ok: false, message: error.message || 'Password reset failed' });
    }
  });
}

module.exports = attachTenantUserPasswordResetApi;
