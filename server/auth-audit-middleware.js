const crypto = require('crypto');
const { appendAuditEvent, sanitizeAuditValue } = require('./audit-chain');

function attachAuthAuditMiddleware(app) {
  app.use((req, res, next) => {
    const pathname = String(req.path || '');
    const isLogin = pathname === '/api/auth/login' || pathname === '/api/login';
    const isLogout = pathname === '/api/auth/logout';
    if (req.method !== 'POST' || (!isLogin && !isLogout)) return next();

    const requestId = req.headers['x-request-id'] || crypto.randomUUID();
    const startedAt = Date.now();
    let responseBody = null;
    const originalJson = res.json.bind(res);
    res.json = (body) => {
      responseBody = body;
      return originalJson(body);
    };
    res.setHeader('X-Request-Id', requestId);

    res.on('finish', () => {
      const responseUser = responseBody?.user || null;
      const authUser = req.auth?.user || null;
      const user = authUser || responseUser || {};
      const shopId = req.auth?.shopId || user.shopId || user.shop?.id || null;
      const userId = req.auth?.userId || user.id || null;
      const success = res.statusCode >= 200 && res.statusCode < 400;
      const action = isLogout ? 'LOGOUT' : success ? 'LOGIN_SUCCESS' : 'LOGIN_FAILED';
      const attemptedUsername = String(req.body?.username || '').trim() || null;

      appendAuditEvent({
        shopId,
        userId,
        action,
        entityType: 'auth',
        entityId: userId,
        summary: isLogout ? 'User logged out' : success ? 'User logged in' : 'Login attempt failed',
        outcome: success ? 'SUCCESS' : 'FAILED',
        requestId,
        actor: {
          id: userId,
          name: user.name || null,
          username: user.username || attemptedUsername,
          role: req.auth?.role || user.role || null,
          shopId,
        },
        request: {
          method: req.method,
          path: pathname,
          body: sanitizeAuditValue(req.body || {}),
        },
        changes: {},
        metadata: {
          statusCode: res.statusCode,
          durationMs: Date.now() - startedAt,
          attemptedUsername,
          shopSlug: req.body?.shopSlug || req.body?.shop || null,
          message: responseBody?.message || null,
        },
        ipAddress: req.ip || null,
        userAgent: req.headers['user-agent'] || null,
      }).catch((error) => console.error('Authentication audit write failed:', error.message));
    });

    return next();
  });
}

module.exports = attachAuthAuditMiddleware;
