const crypto = require('crypto');
const { appendAuditEvent, sanitizeAuditValue } = require('./audit-chain');
const { queueGoogleSheetSync } = require('./google-sheet-sync');

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function descriptor(method, pathname) {
  const rules = [
    [/^\/api\/sales\/[^/]+\/void$/, 'SALE_VOIDED', 'sale', 'Voided a sale'],
    [/^\/api\/sales$/, 'SALE_CREATED', 'sale', 'Completed a sale'],
    [/^\/api\/customers\/[^/]+\/collect$/, 'CUSTOMER_CREDIT_COLLECTED', 'customer', 'Collected customer credit'],
    [/^\/api\/customers\/[^/]+$/, 'CUSTOMER_UPDATED', 'customer', 'Updated customer profile'],
    [/^\/api\/customers$/, 'CUSTOMER_CREATED', 'customer', 'Created customer profile'],
    [/^\/api\/payments\/accounts\/transfer$/, 'MONEY_ACCOUNT_TRANSFERRED', 'money_account', 'Transferred money between accounts'],
    [/^\/api\/payments\/accounts\/[^/]+\/adjust$/, 'MONEY_ACCOUNT_ADJUSTED', 'money_account', 'Adjusted an account balance'],
    [/^\/api\/repair-platform\/intake$/, 'REPAIR_INTAKE_CREATED', 'repair', 'Created a tenant repair intake'],
    [/^\/api\/repair-platform\/import$/, 'REPAIR_EXTERNAL_IMPORTED', 'repair', 'Imported a Mahar Shwe Repair ID'],
    [/^\/api\/repair-platform\/jobs\/[^/]+\/finance$/, 'REPAIR_FINANCE_UPDATED', 'repair', 'Updated repair revenue, costs and profit'],
    [/^\/api\/repair-platform\/jobs\/[^/]+\/link-provider$/, 'REPAIR_PROVIDER_LINKED', 'repair', 'Linked a provider Repair ID'],
    [/^\/api\/repair-platform\/jobs\/[^/]+\/sync$/, 'REPAIR_PROVIDER_SYNCED', 'repair', 'Synced repair data from provider'],
    [/^\/api\/repair-platform\/jobs\/[^/]+\/status$/, 'REPAIR_STATUS_CHANGED', 'repair', 'Changed repair status'],
    [/^\/api\/repair-platform\/jobs\/[^/]+\/device$/, 'REPAIR_DEVICE_LINKED', 'repair', 'Linked IMEI or serial to repair'],
    [/^\/api\/repair-platform\/jobs\/[^/]+\/referral$/, 'REPAIR_REFERRAL_CREATED', 'repair_referral', 'Created a repair referral'],
    [/^\/api\/repair-platform\/referrals\/claim$/, 'REPAIR_REFERRAL_CLAIMED', 'repair_referral', 'Claimed a repair referral'],
    [/^\/api\/(stock|inventory)/, `INVENTORY_${method}`, 'inventory', 'Changed inventory data'],
    [/^\/api\/(products|catalog)/, `PRODUCT_${method}`, 'product', 'Changed product data'],
    [/^\/api\/(repair-platform|repairs|service)/, `REPAIR_${method}`, 'repair', 'Changed repair data'],
    [/^\/api\/users/, `USER_${method}`, 'user', 'Changed user data'],
    [/^\/api\/settings/, `SETTINGS_${method}`, 'settings', 'Changed shop settings'],
  ];
  for (const [pattern, action, entityType, summary] of rules) {
    if (pattern.test(pathname)) return { action, entityType, summary };
  }
  const name = pathname.replace(/^\/api\//, '').replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '').toUpperCase();
  return { action: `${method}_${name || 'API'}`, entityType: pathname.split('/').filter(Boolean)[1] || 'api', summary: `${method} ${pathname}` };
}

function inferEntityId(pathname, body) {
  const pathId = pathname.split('/').find((part) => UUID_PATTERN.test(part));
  if (pathId) return pathId;
  for (const key of ['id', 'saleId', 'customerId', 'productId', 'productVariantId', 'repairId', 'accountId', 'userId']) {
    const value = String(body?.[key] || '');
    if (UUID_PATTERN.test(value)) return value;
  }
  return null;
}

function attachAuditTrailMiddleware(app) {
  app.use((req, res, next) => {
    const method = String(req.method || '').toUpperCase();
    const pathname = String(req.path || '');
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)
      || !pathname.startsWith('/api/')
      || pathname.startsWith('/api/audit')
      || pathname.startsWith('/api/auth')) return next();

    const requestId = req.headers['x-request-id'] || crypto.randomUUID();
    const startedAt = Date.now();
    res.setHeader('X-Request-Id', requestId);

    res.on('finish', () => {
      if (!req.auth?.shopId || !req.auth?.userId) return;
      const info = descriptor(method, pathname);
      const actor = req.auth.user || {};
      const event = {
        shopId: req.auth.shopId,
        userId: req.auth.userId,
        action: info.action,
        entityType: info.entityType,
        entityId: inferEntityId(pathname, req.body || {}),
        summary: info.summary,
        outcome: res.statusCode >= 200 && res.statusCode < 400 ? 'SUCCESS' : 'FAILED',
        requestId,
        actor: {
          id: req.auth.userId,
          name: actor.name || req.user?.name || null,
          username: actor.username || req.user?.username || null,
          role: req.auth.role || null,
        },
        request: {
          method,
          path: pathname,
          query: sanitizeAuditValue(req.query || {}),
          body: sanitizeAuditValue(req.body || {}),
        },
        changes: sanitizeAuditValue(req.body || {}),
        metadata: { statusCode: res.statusCode, durationMs: Date.now() - startedAt },
        ipAddress: req.ip || null,
        userAgent: req.headers['user-agent'] || null,
      };

      appendAuditEvent(event).catch((error) => console.error('Cryptographic audit write failed:', error.message));

      const userCaptureAlreadyQueued = pathname.startsWith('/api/users') || pathname.startsWith('/api/project-settings');
      if (!userCaptureAlreadyQueued) {
        queueGoogleSheetSync({
          shopId: req.auth.shopId,
          dataset: 'user-audit',
          action: info.action,
          entityId: event.entityId || requestId,
          payload: event,
        }).catch((error) => console.warn('User audit Sheet sync failed:', error.message));
      }
    });
    return next();
  });
}

module.exports = attachAuditTrailMiddleware;
