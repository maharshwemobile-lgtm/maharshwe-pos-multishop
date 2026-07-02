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
}

module.exports = attachBackupStatusApi;
