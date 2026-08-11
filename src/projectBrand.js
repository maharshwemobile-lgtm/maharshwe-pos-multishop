// Public URLs for the browser build.
//
// The product is moving from maharshwe.shop to maharpos.shop. Set
// VITE_PUBLIC_DOMAIN at build time to switch; everything below follows from it,
// so no page carries the domain in its own markup.
const DOMAIN = String(import.meta.env?.VITE_PUBLIC_DOMAIN || 'maharshwe.shop')
  .trim()
  .replace(/^https?:\/\//, '')
  .replace(/\/.*$/, '')
  .toLowerCase();

export const PROJECT_DOMAIN = DOMAIN;
export const LANDING_URL = `https://${DOMAIN}`;
export const ADMIN_URL = `https://admin.${DOMAIN}`;
export const API_URL = `https://api.${DOMAIN}`;

// The app is served from its own origin in the browser, so prefer that and fall
// back to the configured domain only when there is no window (build, tests).
export const APP_URL = typeof window === 'undefined' ? `https://app.${DOMAIN}` : window.location.origin;
export const APP_HOST = `app.${DOMAIN}`;

export const PROJECT_LOGO_URL = `https://app.${DOMAIN}/mahar-pos-logo.png?v=20260806-logo-refresh`;
export const PROJECT_NAME = 'Mahar POS';
