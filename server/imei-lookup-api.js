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

// Provider shape is configurable so the shop can point at whichever service it
// buys: {imei} is substituted into the URL.
async function fromProvider(imei, tac) {
  const url = String(process.env.IMEI_LOOKUP_URL || '').trim();
  const token = String(process.env.IMEI_LOOKUP_TOKEN || '').trim();
  if (!url || !token) return null;

  try {
    const response = await fetch(url.replace('{imei}', imei).replace('{tac}', tac), {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return null;
    const data = await response.json();
    const brand = String(data.brand || data.Brand || data.manufacturer || '').trim();
    const model = String(data.model || data.Model || data.deviceName || '').trim();
    if (!brand && !model) return null;

    await prisma.$executeRawUnsafe(
      `INSERT INTO tac_devices (tac, brand, model, source, created_at)
       VALUES ($1, $2, $3, 'provider', NOW())
       ON CONFLICT (tac) DO UPDATE SET brand = EXCLUDED.brand, model = EXCLUDED.model`,
      tac, brand, model,
    ).catch(() => null);
    return { brand, model, source: 'provider' };
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
        return res.json({ ok: true, tac, found: false, providerConfigured: Boolean(process.env.IMEI_LOOKUP_URL && process.env.IMEI_LOOKUP_TOKEN) });
      }
      return res.json({ ok: true, tac, found: true, ...found });
    } catch (error) {
      console.error('IMEI lookup failed:', error);
      return res.status(500).json({ ok: false, message: error.message || 'IMEI lookup failed' });
    }
  });
}

module.exports = attachImeiLookupApi;
