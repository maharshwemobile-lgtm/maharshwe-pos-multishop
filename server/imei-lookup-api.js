// IMEI → device lookup.
//
// An IMEI carries a TAC in its first 8 digits, which identifies the brand and
// model. It does NOT carry colour or storage — those are never derivable from
// the number, only from what this shop recorded the last time it handled the
// same model.
//
// So the lookup answers in this order:
//   1. the shop's own repair history for that TAC  (free, instant, has colour)
//   2. the shared TAC cache filled by earlier provider calls
//   3. an external provider, if IMEI_LOOKUP_URL and IMEI_LOOKUP_TOKEN are set
//
// Step 3 stays optional on purpose: every provider worth using charges per
// lookup, so a result is cached by TAC and never bought twice.
const { prisma } = require('./prisma');
const { requireAuth, requireShopUser } = require('./auth-api');

let schemaPromise;

async function ensureTacSchema() {
  if (!schemaPromise) {
    schemaPromise = prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS tac_devices (
      tac TEXT PRIMARY KEY,
      brand TEXT,
      model TEXT,
      source TEXT NOT NULL DEFAULT 'provider',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`).catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  return schemaPromise;
}

function cleanImei(value) {
  return String(value || '').replace(/\D/g, '').slice(0, 15);
}

function validImei(digits) {
  if (digits.length !== 15) return false;
  let sum = 0;
  for (let index = 0; index < 15; index += 1) {
    let digit = Number(digits[index]);
    if (index % 2 === 1) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  return sum % 10 === 0;
}

// What this shop saw last time a device with the same TAC came in.
async function fromShopHistory(shopId, tac) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT device_brand AS brand, device_model AS model
       FROM repairs
      WHERE shop_id = $1::uuid
        AND imei_serial IS NOT NULL
        AND LEFT(regexp_replace(imei_serial, '\\D', '', 'g'), 8) = $2
        AND (device_brand IS NOT NULL OR device_model IS NOT NULL)
      ORDER BY received_at DESC
      LIMIT 1`,
    shopId, tac,
  ).catch(() => []);
  const row = rows?.[0];
  if (!row) return null;
  return { brand: row.brand || '', model: row.model || '', source: 'history' };
}

async function fromCache(tac) {
  const rows = await prisma.$queryRawUnsafe('SELECT brand, model FROM tac_devices WHERE tac = $1', tac).catch(() => []);
  const row = rows?.[0];
  if (!row) return null;
  return { brand: row.brand || '', model: row.model || '', source: 'cache' };
}

// Providers disagree on everything, so the whole call is described by env:
//
//   IMEI_LOOKUP_URL   template with {imei}, {tac} and optionally {key}
//   IMEI_LOOKUP_TOKEN the key; sent as a Bearer header unless {key} is in the URL
//
// imeicheck.com, for example:
//   IMEI_LOOKUP_URL=https://alpha.imeicheck.com/api/modelBrandName?imei={imei}&format=json&key={key}
function pickField(data, names) {
  for (const name of names) {
    const value = data?.[name] ?? data?.object?.[name] ?? data?.result?.[name];
    if (value) return String(value).trim();
  }
  return '';
}

async function fromProvider(imei, tac) {
  const template = String(process.env.IMEI_LOOKUP_URL || '').trim();
  const token = String(process.env.IMEI_LOOKUP_TOKEN || '').trim();
  // the key is optional: some endpoints are open, most are not
  if (!template) return null;

  const usesKeyInUrl = template.includes('{key}');
  if (usesKeyInUrl && !token) return null;
  const url = template
    .replace('{imei}', encodeURIComponent(imei))
    .replace('{tac}', encodeURIComponent(tac))
    .replace('{key}', encodeURIComponent(token));

  try {
    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        // a browser-ish agent: some TAC services block default fetch agents
        'User-Agent': 'MaharPOS/1.0 (+https://app.maharshwe.shop)',
        ...(!usesKeyInUrl && token ? { Authorization: `Bearer ${token}` } : {}),
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) {
      // 403 from these services almost always means the key is missing or the
      // caller IP is not whitelisted — say so instead of failing silently
      console.warn(`IMEI provider returned ${response.status} for TAC ${tac}`);
      return null;
    }
    const data = await response.json();
    // imeicheck answers {"status":"succes"} — their spelling, so match both
    const status = String(data.status || data.Status || '').toLowerCase();
    if (status && !status.startsWith('succe')) return null;

    let brand = pickField(data, ['brand', 'Brand', 'manufacturer', 'Manufacturer']);
    // Prefer the name a customer would recognise. imeicheck returns
    // model "XT2231-5" and name "Moto G22" — the shop wants the latter, and
    // the part code is kept behind it for anyone who needs to be precise.
    const friendly = pickField(data, ['name', 'Name', 'deviceName', 'modelName']);
    const partCode = pickField(data, ['model', 'Model']);
    let model = friendly || partCode;
    const modelCode = friendly && partCode && friendly !== partCode ? partCode : '';

    // some services answer with a single "Brand Model" string
    if (!brand && model.includes(' ')) {
      const [first, ...rest] = model.split(' ');
      brand = first;
      model = rest.join(' ');
    }
    if (!brand && !model) return null;

    await prisma.$executeRawUnsafe(
      `INSERT INTO tac_devices (tac, brand, model, source, created_at)
       VALUES ($1, $2, $3, 'provider', NOW())
       ON CONFLICT (tac) DO UPDATE SET brand = EXCLUDED.brand, model = EXCLUDED.model`,
      tac, brand, model,
    ).catch(() => null);
    return { brand, model, modelCode, source: 'provider' };
  } catch (error) {
    console.warn('IMEI provider lookup failed:', error.message);
    return null;
  }
}

function attachImeiLookupApi(app) {
  app.get('/api/imei/lookup', requireAuth, requireShopUser, async (req, res) => {
    try {
      const imei = cleanImei(req.query.imei);
      if (!validImei(imei)) {
        return res.status(400).json({ ok: false, message: 'IMEI must be 15 digits and pass the check digit' });
      }
      await ensureTacSchema();
      const tac = imei.slice(0, 8);

      const found = await fromShopHistory(req.auth.shopId, tac)
        || await fromCache(tac)
        || await fromProvider(imei, tac);

      if (!found) {
        return res.json({ ok: true, tac, found: false, providerConfigured: Boolean(process.env.IMEI_LOOKUP_URL) });
      }
      return res.json({ ok: true, tac, found: true, ...found });
    } catch (error) {
      console.error('IMEI lookup failed:', error);
      return res.status(500).json({ ok: false, message: error.message || 'IMEI lookup failed' });
    }
  });
}

module.exports = attachImeiLookupApi;
