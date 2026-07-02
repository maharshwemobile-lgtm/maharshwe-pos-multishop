function querySuffix(url) {
  const index = String(url || '').indexOf('?');
  return index >= 0 ? String(url).slice(index) : '';
}

function canonicalPath(req) {
  const path = String(req.path || '');

  if (path === '/api/project-settings/api' && req.method === 'PUT') {
    req.body = { ...(req.body?.googleSheets || {}) };
    return '/api/project-settings/integrations/google-sheet';
  }
  if (path === '/api/project-settings/api/google-sheet/test') {
    return '/api/project-settings/integrations/google-sheet/test';
  }

  const prefix = '/api/project-settings/postgresql';
  if (!path.startsWith(prefix)) return null;
  const rest = path.slice(prefix.length) || '/overview';

  if (rest === '/overview') return '/api/project-settings';
  if (rest === '/system') return '/api/project-settings/system';
  if (rest === '/catalogs') return '/api/finance/settings/catalogs';
  if (rest === '/sale-payment-methods') return '/api/pos/payment-methods';
  if (rest === '/payment-methods') return '/api/finance/settings/payment-methods';
  if (rest.startsWith('/payment-methods/')) return `/api/finance/settings${rest}`;
  if (rest === '/money-service-fees') {
    return req.method === 'PUT' ? '/api/money-service/settings/rates' : '/api/money-service/settings';
  }
  if (rest === '/income-categories' || rest.startsWith('/income-categories/')) {
    return `/api/business-control${rest}`;
  }
  if (rest === '/expense-categories' || rest.startsWith('/expense-categories/')) {
    return `/api/business-control${rest}`;
  }
  if (rest === '/google-sheet' || rest.startsWith('/google-sheet/')) {
    return `/api/project-settings/integrations${rest}`;
  }
  return null;
}

function attachPostgreSqlSettingsApiAliasV23(app) {
  app.use((req, _res, next) => {
    const target = canonicalPath(req);
    if (target) req.url = `${target}${querySuffix(req.url)}`;
    next();
  });
}

module.exports = attachPostgreSqlSettingsApiAliasV23;
