const { prisma } = require('./prisma');
const { requireAuth, requireShopUser } = require('./auth-api');
const { verifyAuditRows } = require('./audit-chain');
const attachReportsPostgresApi = require('./reports-postgres-api');

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function requireAuditAccess(req, res, next) {
  if (req.auth?.role === 'SUPER_ADMIN') return next();
  return res.status(403).json({ ok: false, message: 'Insufficient audit permission' });
}

function startOfDay(value) {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function endOfDay(value) {
  if (!value) return null;
  const date = new Date(`${value}T23:59:59.999Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toEvent(row) {
  const details = row.details && typeof row.details === 'object' ? row.details : {};
  const actor = details.actor || {};
  const crypto = details.crypto || null;
  return {
    id: row.id,
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    summary: details.summary || row.action,
    outcome: details.outcome || 'LEGACY',
    requestId: details.requestId || null,
    actor: {
      id: row.userId,
      name: actor.name || row.user?.name || null,
      username: actor.username || row.user?.username || null,
      role: actor.role || row.user?.role || null,
    },
    request: details.request || null,
    changes: details.changes || null,
    metadata: details.metadata || null,
    crypto: crypto ? {
      chainVersion: crypto.chainVersion,
      algorithm: crypto.algorithm,
      previousHash: crypto.previousHash,
      payloadHash: crypto.payloadHash,
      eventHash: crypto.eventHash,
      signedAt: crypto.signedAt,
    } : null,
    ipAddress: row.ipAddress,
    userAgent: row.userAgent,
    createdAt: row.createdAt,
  };
}

function attachAuditTrailApi(app) {
  attachReportsPostgresApi(app);
  const access = [requireAuth, requireShopUser, requireAuditAccess];

  app.get('/api/audit/events', ...access, async (req, res) => {
    try {
      const page = Math.max(1, Number.parseInt(req.query.page || '1', 10) || 1);
      const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit || '25', 10) || 25));
      const search = String(req.query.q || '').trim().toLowerCase();
      const action = String(req.query.action || '').trim();
      const outcome = String(req.query.outcome || '').trim();
      const actorId = String(req.query.actorId || '').trim();
      const from = startOfDay(req.query.from);
      const to = endOfDay(req.query.to);

      const rows = await prisma.auditLog.findMany({
        where: {
          shopId: req.auth.shopId,
          ...(action ? { action } : {}),
          ...(actorId && UUID_PATTERN.test(actorId) ? { userId: actorId } : {}),
          ...(from || to ? { createdAt: { gte: from || undefined, lte: to || undefined } } : {}),
        },
        include: { user: { select: { id: true, name: true, username: true, role: true } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 5000,
      });

      const all = rows.map(toEvent);
      const filtered = all.filter((event) => {
        if (outcome && event.outcome !== outcome) return false;
        if (!search) return true;
        return [event.action, event.summary, event.entityType, event.entityId, event.requestId, event.actor.name, event.actor.username, event.ipAddress]
          .some((value) => String(value || '').toLowerCase().includes(search));
      });
      const total = filtered.length;
      const events = filtered.slice((page - 1) * limit, page * limit);
      const actors = [...new Map(all.filter((event) => event.actor.id).map((event) => [event.actor.id, event.actor])).values()]
        .sort((a, b) => String(a.name || a.username).localeCompare(String(b.name || b.username)));

      res.json({
        ok: true,
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
        summary: {
          totalEvents: all.length,
          successful: all.filter((event) => event.outcome === 'SUCCESS').length,
          failed: all.filter((event) => event.outcome === 'FAILED').length,
          chained: all.filter((event) => event.crypto).length,
          legacy: all.filter((event) => !event.crypto).length,
        },
        actions: [...new Set(all.map((event) => event.action))].sort(),
        actors,
        events,
      });
    } catch (error) {
      console.error('Audit event list failed:', error);
      res.status(500).json({ ok: false, message: error.message || 'Audit event list failed' });
    }
  });

  app.get('/api/audit/integrity', ...access, async (req, res) => {
    try {
      const rows = await prisma.auditLog.findMany({
        where: { shopId: req.auth.shopId },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: 20000,
      });
      res.json({ ok: true, checkedAt: new Date().toISOString(), ...verifyAuditRows(rows) });
    } catch (error) {
      console.error('Audit integrity verification failed:', error);
      res.status(500).json({ ok: false, message: error.message || 'Audit verification failed' });
    }
  });
}

module.exports = attachAuditTrailApi;
