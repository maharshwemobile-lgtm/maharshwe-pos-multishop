function normalizePermissions(user) {
  if (!user || user.role !== 'SHOP_ADMIN') return user;
  return {
    ...user,
      permissions: {
        ...(user.permissions || {}),
        'tab.Audit Trail': false,
        'tab.Settings': true,
      },
  };
}

function normalizePayload(payload) {
  if (!payload || typeof payload !== 'object') return payload;
  const next = { ...payload };
  if (next.user) next.user = normalizePermissions(next.user);
  if (Array.isArray(next.users)) next.users = next.users.map(normalizePermissions);
  return next;
}

function attachShopAdminSettingsLock(app) {
  app.use('/api/users/live', (req, res, next) => {
    if (req.body && typeof req.body === 'object') {
      const role = req.body.role;
      if (role === 'SHOP_ADMIN' || role === 'Admin') {
        req.body.permissions = {
          ...(req.body.permissions || {}),
          'tab.Audit Trail': false,
          'tab.Settings': true,
        };
      }
    }

    const originalJson = res.json.bind(res);
    res.json = (payload) => originalJson(normalizePayload(payload));
    next();
  });
}

module.exports = attachShopAdminSettingsLock;
