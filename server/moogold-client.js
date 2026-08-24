// MooGold API client — https://moogold.com
//
// MooGold sells game top-ups (Mobile Legends diamonds, etc.) at wholesale
// through a signed HTTP API. Every request carries three things: a JSON body
// with the route baked into it as "path", an HMAC-SHA256 signature of
// (payload + timestamp + route) keyed with the partner secret, and HTTP
// Basic auth using the same partner id/secret pair.
//
// Credentials are read from env at call time, not at module load, so the
// feature can be deployed before MOOGOLD_PARTNER_ID/MOOGOLD_SECRET exist and
// every caller gets a clean "not configured" result instead of a crash —
// same shape as imei-lookup-api.js's provider gate.
const crypto = require('crypto');
const https = require('https');

const BASE_URL = 'https://moogold.com/wp-json/v1/api';

function credentials() {
  const partnerId = String(process.env.MOOGOLD_PARTNER_ID || '').trim();
  const secret = String(process.env.MOOGOLD_SECRET || '').trim();
  return partnerId && secret ? { partnerId, secret } : null;
}

function isConfigured() {
  return Boolean(credentials());
}

class MoogoldApiError extends Error {
  constructor(code, message) {
    super(message || `MooGold error (${code})`);
    this.code = code;
  }
}

// MooGold authorises by whitelisted IP, and this host prefers IPv6, which the
// whitelist does not cover — so requests were rejected before authentication
// with a 403 HTML page. Node's fetch cannot pick an address family, so this
// goes through https.request with family 4 pinned.
function postIpv4(url, body, headers) {
  const target = new URL(url);
  return new Promise((resolve, reject) => {
    const request = https.request({
      hostname: target.hostname,
      path: target.pathname + target.search,
      method: 'POST',
      family: 4,
      headers: { ...headers, 'Content-Length': Buffer.byteLength(body) },
      timeout: 15000,
    }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { text += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, ok: res.statusCode >= 200 && res.statusCode < 300, text }));
    });
    request.on('error', reject);
    request.on('timeout', () => { request.destroy(new Error('MooGold request timed out')); });
    request.end(body);
  });
}

async function call(route, data = {}) {
  const creds = credentials();
  if (!creds) throw new MoogoldApiError('NOT_CONFIGURED', 'MooGold API credentials are not set');

  // Per the OpenAPI spec every endpoint but create_order takes its arguments
  // flat beside "path"; create_order is the one that nests them under "data",
  // which it does by passing { data: ... }. Path goes first, as the docs show.
  const payload = { path: route, ...data };
  const payloadJson = JSON.stringify(payload);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const stringToSign = payloadJson + timestamp + route;
  const auth = crypto.createHmac('sha256', creds.secret).update(stringToSign).digest('hex');
  const basicAuth = Buffer.from(`${creds.partnerId}:${creds.secret}`).toString('base64');

  const response = await postIpv4(`${BASE_URL}/${route}`, payloadJson, {
    timestamp,
    auth,
    Authorization: `Basic ${basicAuth}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  });

  const text = response.text;
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new MoogoldApiError('BAD_RESPONSE', `MooGold returned a non-JSON response (HTTP ${response.status})`);
  }

  if (body && typeof body === 'object' && body.err_code) {
    throw new MoogoldApiError(body.err_code, body.err_message || 'MooGold request failed');
  }
  if (!response.ok) {
    throw new MoogoldApiError(String(response.status), `MooGold request failed (HTTP ${response.status})`);
  }
  return body;
}

// { ID, post_title }[] — the lightweight product list for a category.
function listProduct(categoryId) {
  return call('product/list_product', { category_id: categoryId });
}

// { Product_Name, Image_URL, Variation: [{variation_name, variation_id, variation_price}], fields: [{field}] }
function productDetail(productId) {
  return call('product/product_detail', { product_id: productId });
}

// { data: { [serverId]: serverName } } — only meaningful for products that need a server pick.
function serverList(productId) {
  return call('product/server_list', { product_id: productId });
}

// category is MooGold's own category id/slug the product belongs to, not our
// internal id. { status, message, account_details: { player_id, server_id, order_id } }
// playerField/serverField are the labels MooGold gave for this particular game
// (product_detail returns them); they differ per game, so they are carried on
// the product rather than assumed here.
function createOrder({ category, productId, quantity, playerId, server, partnerOrderId, playerField, serverField }) {
  const data = { category, 'product-id': productId, quantity: String(quantity) };
  if (playerId) data[playerField || 'User ID'] = playerId;
  if (server) data[serverField || 'Server ID'] = server;
  const body = { data };
  if (partnerOrderId) body.partnerOrderId = partnerOrderId;
  return call('order/create_order', body);
}

function orderDetail(orderId) {
  return call('order/order_detail', { order_id: orderId });
}

function partnerOrderDetail(partnerOrderId) {
  return call('order/order_detail_partner_id', { partner_order_id: partnerOrderId });
}

// { currency, balance } — the platform's own prepaid balance held at MooGold,
// i.e. how much wholesale credit is left before orders start failing.
function balance() {
  return call('user/balance', {});
}

module.exports = {
  MoogoldApiError,
  isConfigured,
  listProduct,
  productDetail,
  serverList,
  createOrder,
  orderDetail,
  partnerOrderDetail,
  balance,
};
