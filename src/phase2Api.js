const SESSION_KEY = 'mahar_pos_session_v1';
const SESSION_EVENT = 'mahar-pos-session-changed';
const SETTINGS_EVENT = 'mahar-project-settings-updated';
const PAGE_SIZE_KEY = 'mahar-pos-page-size';
const API_BASE_URL = String(import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '');

function normalizePageSize(value) {
  const size = Number(value || 20);
  return [10, 20, 50, 100].includes(size) ? size : 20;
}

function savedPageSize() {
  if (typeof window === 'undefined') return 20;
  try {
    return normalizePageSize(window.localStorage.getItem(PAGE_SIZE_KEY));
  } catch {
    return 20;
  }
}

function normalizePostgreSqlSettingsPath(path) {
  const text = String(path || '');
  if (/^https?:\/\//i.test(text) || text.startsWith('/api/project-settings/postgresql/')) return text;
  const [pathname, query = ''] = text.split('?');
  const suffix = query ? `?${query}` : '';

  if (pathname === '/api/finance/settings/catalogs') return `/api/project-settings/postgresql/catalogs${suffix}`;
  if (pathname === '/api/finance/settings/payment-methods') return `/api/project-settings/postgresql/payment-methods${suffix}`;
  if (pathname.startsWith('/api/finance/settings/payment-methods/')) return `${pathname.replace('/api/finance/settings', '/api/project-settings/postgresql')}${suffix}`;
  if (pathname === '/api/pos/payment-methods') return `/api/project-settings/postgresql/sale-payment-methods${suffix}`;
  if (pathname === '/api/money-service/settings' || pathname === '/api/money-service/settings/rates') return `/api/project-settings/postgresql/money-service-fees${suffix}`;
  if (pathname.startsWith('/api/business-control/income-categories')) return `${pathname.replace('/api/business-control', '/api/project-settings/postgresql')}${suffix}`;
  if (pathname.startsWith('/api/business-control/expense-categories')) return `${pathname.replace('/api/business-control', '/api/project-settings/postgresql')}${suffix}`;
  if (pathname.startsWith('/api/project-settings/integrations/google-sheet')) return `${pathname.replace('/api/project-settings/integrations/google-sheet', '/api/project-settings/postgresql/google-sheet')}${suffix}`;
  return text;
}

function applySavedPageSize(path) {
  const text = String(path || '');
  if (/^https?:\/\//i.test(text)) return text;
  const [pathname, query = ''] = text.split('?');
  if (!['/api/pos/catalog', '/api/repair-platform/jobs'].includes(pathname)) return text;
  const params = new URLSearchParams(query);
  params.set('limit', String(savedPageSize()));
  return `${pathname}?${params.toString()}`;
}

function resolveApiUrl(path) {
  if (/^https?:\/\//i.test(path)) return path;
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${API_BASE_URL}${normalizedPath}`;
}

function normalizeUser(user) {
  if (!user) return user;
  if (user.role !== 'SHOP_ADMIN') return user;
  return {
    ...user,
    permissions: {
      ...(user.permissions || {}),
      'tab.Settings': true,
    },
  };
}

function normalizeSession(session) {
  return session ? { ...session, user: normalizeUser(session.user) } : session;
}

function notifySessionChanged(session) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(SESSION_EVENT, { detail: session || null }));
}

function publishProjectSettings(path, data) {
  if (typeof window === 'undefined') return;
  if (!String(path || '').startsWith('/api/project-settings')) return;
  if (!data?.business || !data?.appearance || !data?.preferences) return;
  try {
    window.localStorage.setItem('mahar-pos-theme', data.preferences.theme || data.appearance.theme || 'light');
    window.localStorage.setItem('mahar-pos-language', data.preferences.language || data.appearance.language || 'my');
    window.localStorage.setItem(PAGE_SIZE_KEY, String(normalizePageSize(data.preferences.pageSize)));
  } catch {
    // Storage can be unavailable in browser privacy mode.
  }
  window.dispatchEvent(new CustomEvent(SETTINGS_EVENT, { detail: data }));
}

function publishUserAccess(path, data) {
  if (typeof window === 'undefined' || !data?.user?.id) return;
  if (!/^\/api\/users\/live\/[^/]+(?:\/reset-password)?$/.test(String(path || ''))) return;
  const session = getSession();
  const user = normalizeUser(data.user);
  if (session?.user?.id === user.id) {
    saveSession({ ...session, user: { ...session.user, ...user } });
  }
  window.dispatchEvent(new CustomEvent('mahar-user-access-updated', { detail: user }));
}

function readLegacyToken() {
  return localStorage.getItem('mahar_pos_token')
    || localStorage.getItem('authToken')
    || localStorage.getItem('token')
    || '';
}

export function getSession() {
  try {
    const stored = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
    if (stored?.token) return normalizeSession(stored);
  } catch {
    // Ignore invalid browser storage and fall back to legacy token keys.
  }

  const token = readLegacyToken();
  return token ? { token, user: null } : null;
}

export function saveSession(session) {
  const normalized = normalizeSession(session);
  localStorage.setItem(SESSION_KEY, JSON.stringify(normalized));
  if (normalized?.token) localStorage.setItem('mahar_pos_token', normalized.token);
  notifySessionChanged(normalized);
}

export function clearSession() {
  localStorage.removeItem(SESSION_KEY);
  localStorage.removeItem('mahar_pos_token');
  localStorage.removeItem('authToken');
  localStorage.removeItem('token');
  notifySessionChanged(null);
}

export function subscribeSession(listener) {
  if (typeof window === 'undefined') return () => {};
  const handler = (event) => listener(normalizeSession(event.detail || getSession()));
  window.addEventListener(SESSION_EVENT, handler);
  window.addEventListener('storage', handler);
  return () => {
    window.removeEventListener(SESSION_EVENT, handler);
    window.removeEventListener('storage', handler);
  };
}

async function readJson(response) {
  return response.json().catch(() => ({}));
}

function sessionFromResponse(data) {
  const session = normalizeSession({
    token: data.token,
    user: data.user || null,
    expiresIn: data.expiresIn || null,
    demoAutoCleanup: data.demoAutoCleanup || null,
    onboardingDemo: data.demoAutoCleanup || null,
  });
  saveSession(session);
  return session;
}

export async function login({ username, password, shopSlug }) {
  const response = await fetch(resolveApiUrl('/api/auth/login'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ username, password, shopSlug }),
  });
  const data = await readJson(response);
  if (!response.ok || !data?.token) {
    const error = new Error(data?.message || 'Login failed');
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return sessionFromResponse(data);
}

export async function registerTenant(payload) {
  const response = await fetch(resolveApiUrl('/api/auth/register'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await readJson(response);
  if (!response.ok || !data?.tenant) {
    const error = new Error(data?.message || 'Registration failed');
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

export async function changePassword({ currentPassword, newPassword }) {
  const response = await apiFetch('/api/auth/change-password', {
    method: 'POST',
    body: JSON.stringify({ currentPassword, newPassword }),
  });
  const data = await readJson(response);
  if (!response.ok || !data?.token) {
    const error = new Error(data?.message || 'Password change failed');
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return sessionFromResponse(data);
}

export async function googleLogin({ credential, shopSlug, businessType }) {
  const response = await fetch(resolveApiUrl('/api/auth/google'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ credential, shopSlug, businessType }),
  });
  const data = await readJson(response);
  if (!response.ok || !data?.token) {
    const error = new Error(data?.message || 'Google login failed');
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return sessionFromResponse(data);
}

export async function apiFetch(path, options = {}) {
  const session = getSession();
  const canonicalPath = normalizePostgreSqlSettingsPath(path);
  const effectivePath = applySavedPageSize(canonicalPath);
  const headers = {
    Accept: 'application/json',
    ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    ...(session?.token ? { Authorization: `Bearer ${session.token}` } : {}),
    ...(options.headers || {}),
  };

  const response = await fetch(resolveApiUrl(effectivePath), {
    cache: 'no-store',
    ...options,
    headers,
    ...(options.body !== undefined && typeof options.body !== 'string'
      ? { body: JSON.stringify(options.body) }
      : {}),
  });

  const data = await readJson(response);
  if (!response.ok) {
    if (response.status === 401) clearSession();
    const error = new Error(data?.message || `Request failed (${response.status})`);
    error.status = response.status;
    error.data = data;
    throw error;
  }
  if (data?.user) data.user = normalizeUser(data.user);
  publishProjectSettings(canonicalPath, data);
  publishUserAccess(path, data);
  return data;
}

export async function apiDownload(path, fallbackName = 'download') {
  const session = getSession();
  const response = await fetch(resolveApiUrl(path), {
    headers: {
      Accept: '*/*',
      ...(session?.token ? { Authorization: `Bearer ${session.token}` } : {}),
    },
  });

  if (!response.ok) {
    const data = await readJson(response);
    if (response.status === 401) clearSession();
    const error = new Error(data?.message || `Download failed (${response.status})`);
    error.status = response.status;
    error.data = data;
    throw error;
  }

  const disposition = response.headers.get('content-disposition') || '';
  const match = disposition.match(/filename="?([^";]+)"?/i);
  const fileName = match?.[1] || fallbackName;
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
  return fileName;
}
