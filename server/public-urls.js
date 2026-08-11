// Every public URL the server hands out, in one place.
//
// The product is moving from maharshwe.shop to maharpos.shop, and the two need
// to answer at the same time while DNS, Google OAuth and the Telegram webhook
// catch up. So this reads a list of domains rather than one:
//
//   PUBLIC_DOMAINS=maharpos.shop,maharshwe.shop
//
// The first is the one we hand out in links and emails; every domain in the
// list stays accepted for CORS and for the host checks that gate the super
// admin and app logins. Individual URLs can still be pinned outright with
// PUBLIC_APP_URL, PUBLIC_LANDING_URL, PUBLIC_API_URL and friends.

const SUBDOMAINS = ['app', 'admin', 'super', 'api'];

function domainList() {
  const raw = String(process.env.PUBLIC_DOMAINS || process.env.PUBLIC_ROOT_DOMAIN || 'maharshwe.shop');
  const domains = raw
    .split(',')
    .map((value) => value.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '').toLowerCase())
    .filter(Boolean);
  return domains.length ? domains : ['maharshwe.shop'];
}

function primaryDomain() {
  return domainList()[0];
}

function clean(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function pinned(name) {
  return clean(process.env[name]) || '';
}

function landingUrl() {
  return pinned('PUBLIC_LANDING_URL') || `https://${primaryDomain()}`;
}

function appUrl() {
  return pinned('PUBLIC_APP_URL') || pinned('APP_URL') || `https://app.${primaryDomain()}`;
}

function apiUrl() {
  return pinned('PUBLIC_API_URL') || `https://api.${primaryDomain()}`;
}

function adminUrl() {
  return pinned('PUBLIC_ADMIN_URL') || `https://admin.${primaryDomain()}`;
}

function superAdminUrl() {
  return pinned('PUBLIC_SUPER_URL') || `https://super.${primaryDomain()}`;
}

function projectLogoUrl() {
  return `${appUrl()}/mahar-pos-logo.png?v=20260806-logo-refresh`;
}

// Both bare and www, plus every subdomain, for each domain we answer on.
function allowedOrigins() {
  const origins = [];
  domainList().forEach((domain) => {
    origins.push(`https://${domain}`, `https://www.${domain}`);
    SUBDOMAINS.forEach((sub) => origins.push(`https://${sub}.${domain}`));
  });
  return [...new Set(origins)];
}

function hostname(value) {
  return String(value || '').split(':')[0].trim().toLowerCase();
}

function isHostFor(subdomain, value) {
  const host = hostname(value);
  return domainList().some((domain) => host === `${subdomain}.${domain}`);
}

const isAppHost = (value) => isHostFor('app', value);
const isSuperAdminHost = (value) => isHostFor('super', value);

module.exports = {
  domainList,
  primaryDomain,
  landingUrl,
  appUrl,
  apiUrl,
  adminUrl,
  superAdminUrl,
  projectLogoUrl,
  allowedOrigins,
  isAppHost,
  isSuperAdminHost,
};
