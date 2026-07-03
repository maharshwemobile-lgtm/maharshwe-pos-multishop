const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { promises: fsp } = fs;
const { requireAuth, requireShopUser } = require('./auth-api');
const { prisma } = require('./prisma');

function requireBackupAdmin(req, res, next) {
  if (req.auth?.role === 'SUPER_ADMIN' || req.auth?.role === 'SHOP_ADMIN') return next();
  if (req.auth?.permissions?.settings === true) return next();
  return res.status(403).json({ ok: false, message: 'Insufficient backup permission' });
}

function backupDirectory() {
  return process.env.BACKUP_DIR || '/var/backups/mahar-pos/postgres';
}

function latestManifestPath() {
  return path.join(backupDirectory(), 'latest.json');
}

function ageDays(value) {
  if (!value) return null;
  const createdAt = new Date(value);
  if (Number.isNaN(createdAt.getTime())) return null;
  return Math.max(0, Math.floor((Date.now() - createdAt.getTime()) / 86400000));
}

async function fileSha256(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const input = fs.createReadStream(filePath);
    input.on('error', reject);
    input.on('data', (chunk) => hash.update(chunk));
    input.on('end', () => resolve(hash.digest('hex')));
  });
}

async function readManifest() {
  const raw = await fsp.readFile(latestManifestPath(), 'utf8');
  const manifest = JSON.parse(raw);
  const filePath = manifest.file || path.join(backupDirectory(), `${manifest.name}.dump`);
  const resolvedFile = path.resolve(filePath);
  const resolvedDirectory = path.resolve(backupDirectory());
  if (!resolvedFile.startsWith(`${resolvedDirectory}${path.sep}`)) {
    throw new Error('Backup manifest points outside BACKUP_DIR');
  }
  return { manifest, filePath: resolvedFile };
}

function jsonReplacer(_key, value) {
  if (typeof value === 'bigint') return value.toString();
  if (value && typeof value === 'object' && typeof value.toJSON === 'function') return value.toJSON();
  return value;
}

function safeFileSegment(value) {
  return String(value || 'shop')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'shop';
}

async function buildTenantBackup(shopId) {
  const [
    shop,
    settings,
    users,
    categories,
    products,
    moneyAccounts,
    customers,
    stockMovements,
    sales,
    payments,
    repairs,
    moneyServiceTransactions,
    auditLogs,
  ] = await Promise.all([
    prisma.shop.findUnique({
      where: { id: shopId },
      select: {
        id: true,
        slug: true,
        code: true,
        name: true,
        phone: true,
        address: true,
        logoUrl: true,
        active: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    prisma.shopSettings.findUnique({ where: { shopId } }),
    prisma.user.findMany({
      where: { shopId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        username: true,
        email: true,
        name: true,
        role: true,
        permissions: true,
        active: true,
        authProvider: true,
        lastLoginAt: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    prisma.category.findMany({ where: { shopId }, orderBy: { name: 'asc' } }),
    prisma.product.findMany({
      where: { shopId },
      include: {
        category: true,
        variants: {
          include: { category: true, inventoryBalance: true },
          orderBy: { variantName: 'asc' },
        },
      },
      orderBy: { name: 'asc' },
    }),
    prisma.moneyAccount.findMany({ where: { shopId }, orderBy: { name: 'asc' } }),
    prisma.customer.findMany({ where: { shopId }, orderBy: { createdAt: 'desc' }, take: 5000 }),
    prisma.stockMovement.findMany({
      where: { shopId },
      include: {
        productVariant: { include: { product: true } },
        user: { select: { id: true, username: true, name: true, role: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 5000,
    }),
    prisma.sale.findMany({
      where: { shopId },
      include: {
        items: true,
        payments: true,
        customer: true,
        staff: { select: { id: true, username: true, name: true, role: true } },
      },
      orderBy: { soldAt: 'desc' },
      take: 3000,
    }),
    prisma.payment.findMany({ where: { shopId }, orderBy: { createdAt: 'desc' }, take: 5000 }),
    prisma.repair.findMany({
      where: { shopId },
      include: {
        payments: true,
        statusHistory: true,
        technician: { select: { id: true, username: true, name: true, role: true } },
      },
      orderBy: { receivedAt: 'desc' },
      take: 3000,
    }),
    prisma.moneyServiceTransaction.findMany({
      where: { shopId },
      include: {
        account: true,
        user: { select: { id: true, username: true, name: true, role: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 5000,
    }),
    prisma.auditLog.findMany({
      where: { shopId },
      include: { user: { select: { id: true, username: true, name: true, role: true } } },
      orderBy: { createdAt: 'desc' },
      take: 5000,
    }),
  ]);

  if (!shop) {
    const error = new Error('Shop not found');
    error.status = 404;
    throw error;
  }

  return {
    ok: true,
    scope: 'tenant',
    exportedAt: new Date().toISOString(),
    warning: 'Tenant-scoped JSON export. System database dumps are restricted to super admin only.',
    shop,
    settings,
    users,
    categories,
    products,
    moneyAccounts,
    customers,
    stockMovements,
    sales,
    payments,
    repairs,
    moneyServiceTransactions,
    auditLogs,
  };
}

function attachBackupStatusApi(app) {
  const access = [requireAuth, requireShopUser, requireBackupAdmin];

  app.get('/api/backups/status', ...access, async (req, res) => {
    const directory = backupDirectory();
    const retentionDays = Number(process.env.BACKUP_RETENTION_DAYS || 14);
    const staleHours = Number(process.env.BACKUP_STALE_HOURS || 30);

    try {
      const [{ manifest, filePath }, files] = await Promise.all([
        readManifest(),
        fsp.readdir(directory).catch(() => []),
      ]);
      const stat = await fsp.stat(filePath);
      const createdAt = new Date(manifest.createdAt || stat.mtime);
      const ageHours = Math.max(0, (Date.now() - createdAt.getTime()) / 3600000);
      const verifyRequested = String(req.query.verify || '') === '1';
      const actualSha256 = verifyRequested ? await fileSha256(filePath) : null;
      const hashMatches = verifyRequested ? actualSha256 === manifest.sha256 : null;
      const archiveCount = files.filter((name) => /^mahar-pos-.*\.dump$/.test(name)).length;
      const [
        shop,
        totalUsers,
        activeUsers,
        shopAdmins,
        cashiers,
        oldestUser,
        newestUser,
      ] = await Promise.all([
        prisma.shop.findUnique({
          where: { id: req.auth.shopId },
          select: { id: true, slug: true, code: true, name: true, active: true, createdAt: true },
        }),
        prisma.user.count({ where: { shopId: req.auth.shopId } }),
        prisma.user.count({ where: { shopId: req.auth.shopId, active: true } }),
        prisma.user.count({ where: { shopId: req.auth.shopId, role: 'SHOP_ADMIN', active: true } }),
        prisma.user.count({ where: { shopId: req.auth.shopId, role: 'CASHIER', active: true } }),
        prisma.user.findFirst({
          where: { shopId: req.auth.shopId },
          orderBy: { createdAt: 'asc' },
          select: { createdAt: true },
        }),
        prisma.user.findFirst({
          where: { shopId: req.auth.shopId },
          orderBy: { createdAt: 'desc' },
          select: { createdAt: true },
        }),
      ]);
      const healthy = stat.size > 0
        && manifest.status === 'VERIFIED'
        && ageHours <= staleHours
        && hashMatches !== false;

      return res.json({
        ok: true,
        healthy,
        status: healthy ? 'HEALTHY' : ageHours > staleHours ? 'STALE' : 'NEEDS_ATTENTION',
        checkedAt: new Date().toISOString(),
        backup: {
          name: manifest.name || path.basename(filePath, '.dump'),
          fileName: path.basename(filePath),
          createdAt: createdAt.toISOString(),
          ageHours: Number(ageHours.toFixed(2)),
          sizeBytes: stat.size,
          sha256: manifest.sha256 || null,
          structuralVerification: manifest.structuralVerification || null,
          hashVerifiedNow: verifyRequested,
          hashMatches,
        },
        tenant: shop ? {
          shopId: shop.id,
          tenantId: shop.code || shop.slug,
          slug: shop.slug,
          name: shop.name,
          active: shop.active,
          createdAt: shop.createdAt,
          ageDays: ageDays(shop.createdAt),
          backupAgeHours: Number(ageHours.toFixed(2)),
          backedUpAt: createdAt.toISOString(),
          users: {
            total: totalUsers,
            active: activeUsers,
            inactive: Math.max(0, totalUsers - activeUsers),
            shopAdmins,
            cashiers,
            oldestAgeDays: ageDays(oldestUser?.createdAt),
            newestAgeDays: ageDays(newestUser?.createdAt),
          },
        } : null,
        policy: {
          schedule: 'Daily at 02:30',
          retentionDays,
          staleAfterHours: staleHours,
          archiveCount,
        },
      });
    } catch (error) {
      if (error.code === 'ENOENT') {
        return res.status(404).json({
          ok: false,
          healthy: false,
          status: 'NO_BACKUP',
          message: 'No verified backup manifest was found',
          policy: { retentionDays, staleAfterHours: staleHours },
        });
      }
      console.error('Backup status API:', error);
      return res.status(500).json({
        ok: false,
        healthy: false,
        status: 'ERROR',
        message: error.message || 'Backup status check failed',
      });
    }
  });

  app.get('/api/backups/download', ...access, async (req, res) => {
    try {
      if (req.auth?.role === 'SUPER_ADMIN' && String(req.query.scope || '') === 'system') {
        const { filePath } = await readManifest();
        return res.download(filePath, path.basename(filePath));
      }

      if (!req.auth?.shopId) {
        return res.status(403).json({ ok: false, message: 'Tenant backup download requires an active shop' });
      }

      const backup = await buildTenantBackup(req.auth.shopId);
      const tenant = safeFileSegment(backup.shop.code || backup.shop.slug || backup.shop.id);
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `mahar-pos-tenant-${tenant}-${timestamp}.json`;
      const body = JSON.stringify(backup, jsonReplacer, 2);

      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return res.send(body);
    } catch (error) {
      console.error('Backup download API:', error);
      return res.status(error.status || 500).json({
        ok: false,
        message: error.message || 'Backup download failed',
      });
    }
  });
}

module.exports = attachBackupStatusApi;
