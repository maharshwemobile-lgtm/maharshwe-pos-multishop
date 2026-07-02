const { requireAuth, requireShopUser } = require('./auth-api');

function isSuperAdmin(req) {
  return req.auth?.role === 'SUPER_ADMIN';
}

function allowed(req, permission, fallbackPermission) {
  if (isSuperAdmin(req)) return true;
  const permissions = req.auth?.permissions || {};
  if (typeof permissions[permission] === 'boolean') return permissions[permission];
  if (req.auth?.role === 'SHOP_ADMIN') return true;
  return fallbackPermission ? permissions[fallbackPermission] === true : false;
}

function deny(res, permission) {
  return res.status(403).json({ ok: false, message: `Permission required: ${permission}` });
}

function requestPath(req) {
  return String(req.originalUrl || req.baseUrl || req.path || '').split('?')[0];
}

function stockGuard(req, res, next) {
  const path = requestPath(req);
  if (req.method === 'POST' && /\/api\/stock\/movements$/.test(path)) {
    return allowed(req, 'stockAdjust', 'inventory') ? next() : deny(res, 'stockAdjust');
  }
  if (req.method === 'GET' && /\/api\/stock\/movements/.test(path)) {
    return allowed(req, 'stockHistory', 'inventory') ? next() : deny(res, 'stockHistory');
  }
  if (['POST', 'PATCH', 'DELETE'].includes(req.method)
      && (/\/api\/products(?:\/|$)/.test(path) || /\/api\/categories(?:\/|$)/.test(path))) {
    return allowed(req, 'productEdit', 'inventory') ? next() : deny(res, 'productEdit');
  }
  return next();
}

function repairGuard(req, res, next) {
  const path = requestPath(req);
  if (req.method === 'POST' && /\/api\/repair-platform\/intake$/.test(path)) {
    return allowed(req, 'repairCreate', 'repairs') ? next() : deny(res, 'repairCreate');
  }
  if (req.method === 'POST' && /\/api\/repair-platform\/import$/.test(path)) {
    return allowed(req, 'repairImport', 'repairs') ? next() : deny(res, 'repairImport');
  }
  if ((req.method === 'PATCH' && /\/api\/repair-platform\/jobs\/[^/]+\/status$/.test(path))
      || (req.method === 'POST' && /\/api\/repair-platform\/jobs\/[^/]+\/(link-provider|sync|device)$/.test(path))
      || (req.method === 'PATCH' && /\/api\/repair-platform\/jobs\/[^/]+\/finance$/.test(path))) {
    return allowed(req, 'repairEdit', 'repairs') ? next() : deny(res, 'repairEdit');
  }
  if (req.method === 'GET' && /\/api\/repair-platform\/export\.csv$/.test(path)) {
    return allowed(req, 'export', 'accounting') ? next() : deny(res, 'export');
  }
  return next();
}

function purchasingGuard(req, res, next) {
  const path = requestPath(req);
  if (req.method === 'POST' && /\/api\/purchasing\/orders\/[^/]+\/approve$/.test(path)) {
    return allowed(req, 'purchaseApprove', 'inventory') ? next() : deny(res, 'purchaseApprove');
  }
  if (req.method === 'POST' && /\/api\/purchasing\/orders\/[^/]+\/receive$/.test(path)) {
    return allowed(req, 'purchaseReceive', 'inventory') ? next() : deny(res, 'purchaseReceive');
  }
  if (req.method === 'POST' && /\/api\/purchasing\/payments$/.test(path)) {
    return allowed(req, 'purchasePayment', 'inventory') ? next() : deny(res, 'purchasePayment');
  }
  if (req.method === 'POST' && /\/api\/purchasing\/returns$/.test(path)) {
    return allowed(req, 'purchaseReturn', 'inventory') ? next() : deny(res, 'purchaseReturn');
  }
  if (['POST', 'PATCH', 'DELETE'].includes(req.method) && /\/api\/purchasing\/repair-parts/.test(path)) {
    return allowed(req, 'repairParts', 'inventory') ? next() : deny(res, 'repairParts');
  }
  return next();
}

function attachProjectFunctionAccessMiddleware(app) {
  app.use('/api/stock', requireAuth, requireShopUser, stockGuard);
  app.use('/api/categories', requireAuth, requireShopUser, stockGuard);
  app.use('/api/products', requireAuth, requireShopUser, stockGuard);
  app.use('/api/repair-platform', requireAuth, requireShopUser, repairGuard);
  app.use('/api/purchasing', requireAuth, requireShopUser, purchasingGuard);
}

module.exports = attachProjectFunctionAccessMiddleware;
