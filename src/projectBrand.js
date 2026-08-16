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

// Same-origin on purpose. The app is served from both app.maharpos.shop and
// app.maharshwe.shop, and a shop that can only reach one of them would lose the
// logo if it were pinned to the other.
export const PROJECT_LOGO_URL = '/mahar-pos-logo.png?v=20260806-logo-refresh';
export const PROJECT_NAME = 'Mahar POS';
