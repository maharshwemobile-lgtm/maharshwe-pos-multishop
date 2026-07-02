function indexedString(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const keys = Object.keys(value);
  if (!keys.length || !keys.every((key, index) => key === String(index))) return null;
  const chars = keys.map((key) => value[key]);
  if (!chars.every((char) => typeof char === 'string')) return null;
  return chars.join('');
}

function sensitiveKey(key) {
  return /(^|_)(secret|token|password|authorization|apiKey)($|_)/i.test(String(key || ''));
}

function sanitize(value, key = '') {
  if (sensitiveKey(key)) return '';
  if (Array.isArray(value)) return value.map((entry) => sanitize(entry));
  if (!value || typeof value !== 'object') return value;

  const recovered = indexedString(value);
  if (recovered !== null) return recovered;

  return Object.fromEntries(
    Object.entries(value).map(([entryKey, entry]) => [entryKey, sanitize(entry, entryKey)]),
  );
}

function attachProjectSettingsResponseSanitizer(app) {
  app.use('/api/project-settings', (_req, res, next) => {
    const originalJson = res.json.bind(res);
    res.json = (body) => originalJson(sanitize(body));
    next();
  });
}

module.exports = attachProjectSettingsResponseSanitizer;
