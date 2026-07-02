const { requireAuth, requireShopUser } = require('./auth-api');
const { buildProjectSettingsState } = require('./project-settings-state');

module.exports = function attachProjectSettingsRead(app) {
  app.get('/api/project-settings', requireAuth, requireShopUser, async (req, res, next) => {
    try {
      const payload = await buildProjectSettingsState(req.auth.shopId, req.auth.userId);
      res.json(payload);
    } catch (error) {
      next(error);
    }
  });
};
