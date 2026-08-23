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

async function call(route, data = {}) {
  const creds = credentials();
  if (!creds) throw new MoogoldApiError('NOT_CONFIGURED', 'MooGold API credentials are not set');

  // Shape and key order follow MooGold's published sample exactly: path
  // first, arguments nested under data, and nothing else at the top level.
  const hasData = data && Object.keys(data).length > 0;
  const payload = hasData ? { path: route, data } : { path: route };
  const payloadJson = JSON.stringify(payload);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const stringToSign = payloadJson + timestamp + route;
  const auth = crypto.createHmac('sha256', creds.secret).update(stringToSign).digest('hex');
  const basicAuth = Buffer.from(`${creds.partnerId}:${creds.secret}`).toString('base64');

  const response = await fetch(`${BASE_URL}/${route}`, {
    method: 'POST',
    headers: {
      timestamp,
      auth,
      Authorization: `Basic ${basicAuth}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: payloadJson,
    signal: AbortSignal.timeout(15000),
  });

  const text = await response.text();
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
function createOrder({ category, productId, quantity, playerId, server, partnerOrderId }) {
  const data = { category, 'product-id': productId, quantity: String(quantity) };
  if (playerId) data['User ID'] = playerId;
  if (server) data.Server = server;
  if (partnerOrderId) data.partnerOrderId = partnerOrderId;
  return call('order/create_order', data);
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
