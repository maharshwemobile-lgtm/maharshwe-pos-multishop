const cors = require('cors');
const helmet = require('helmet');

const DEFAULT_LOCAL_ORIGINS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
];

const DEFAULT_PUBLIC_ORIGINS = [
  'https://maharshwe.shop',
  'https://www.maharshwe.shop',
  'https://app.maharshwe.shop',
  'https://admin.maharshwe.shop',
  'https://super.maharshwe.shop',
  'https://api.maharshwe.shop',
];

function normalizeOrigin(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function configuredOrigins() {
  const configured = String(process.env.CORS_ORIGINS || '')
    .split(',')
    .map(normalizeOrigin)
    .filter(Boolean);

  return [...new Set([...configured, ...DEFAULT_PUBLIC_ORIGINS, ...DEFAULT_LOCAL_ORIGINS])];
}

function corsOptions() {
  const origins = configuredOrigins();
  if (!origins.length) return { origin: true, credentials: true };

  return {
    credentials: true,
    origin(origin, callback) {
      const normalized = normalizeOrigin(origin);
      if (!origin || origins.includes(normalized)) return callback(null, true);

      const error = new Error('CORS origin is not allowed');
      error.code = 'CORS_ORIGIN_DENIED';
      error.status = 403;
      error.origin = normalized;
      return callback(error);
    },
  };
}

function attachSecurity(app) {
  // The API only listens on 127.0.0.1 and is reached through the local Nginx proxy.
  // Trust exactly that single proxy hop so express-rate-limit can safely use the
  // real client IP from X-Forwarded-For without rejecting login requests.
  app.set('trust proxy', 1);

  app.use(
    helmet({
      crossOriginResourcePolicy: false,
    })
  );
  app.use(cors(corsOptions()));
}

module.exports = { attachSecurity, configuredOrigins };
