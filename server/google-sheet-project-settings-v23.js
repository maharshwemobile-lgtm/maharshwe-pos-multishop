const crypto = require('crypto');
const { z } = require('zod');
const { prisma } = require('./prisma');
const { requireAuth, requireShopUser, requireWritableSubscription } = require('./auth-api');

const DATASETS = {
  remittances: 'Remittances',
  'sale-history': 'Sale History',
  'other-income': 'Other Income',
  'service-income': 'Service Income',
  expense: 'Expense',
  stock: 'STOCK',
  'user-audit': 'User audit',
  'repair-records': 'Repair Records',
  'daily-closing': 'Daily Closing',
  // The repair book goes to the shop's own tab, named in the row itself.
  'repair-voucher': 'Repairs',
};

const GOOGLE_HOSTS = new Set(['script.google.com', 'script.googleusercontent.com']);

// Read from the script the POS hands out, so this never drifts from what a shop
// would get by pressing Copy today.
const SCRIPT_VERSION = (() => {
  try {
    const source = require('fs').readFileSync(
      require('path').join(__dirname, '..', 'integrations', 'google-apps-script', 'MaharShwePosSync.gs'), 'utf8');
    const match = source.match(/SCRIPT_VERSION\s*=\s*'([^']+)'/);
    return match ? match[1] : '';
  } catch {
    return '';
  }
})();
const configSchema = z.object({
  enabled: z.boolean().default(false),
  postUrl: z.string().trim().max(2000).optional().default(''),
  getUrl: z.string().trim().max(2000).optional().default(''),
  secret: z.string().trim().max(500).optional().default(''),
  timeoutMs: z.coerce.number().int().min(1000).max(60000).default(10000),
  repairSheetTab: z.string().trim().max(200).optional(),
  sheetId: z.string().trim().max(400).optional(),
});

let runner = null;
let schemaPromise = null;

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function clean(value, max = 500) {
  return String(value ?? '').trim().slice(0, max);
}

function parseGoogleSheetResponse(text) {
  try {
    const data = JSON.parse(String(text || ''));
    return { data, accepted: data?.ok !== false, message: clean(data?.message || '', 500) };
  } catch {
    return { data: null, accepted: true, message: '' };
  }
}

function requireManager(req, res, next) {
  if (req.auth?.role === 'SUPER_ADMIN' || req.auth?.role === 'SHOP_ADMIN' || req.auth?.permissions?.settings === true) return next();
  return res.status(403).json({ ok: false, message: 'Settings permission is required' });
}

function validateGoogleUrl(value, required = false) {
  const text = clean(value, 2000);
  if (!text) {
    if (required) throw Object.assign(new Error('Google Apps Script Web App URL is required'), { status: 400 });
    return '';
  }
  let url;
  try {
    url = new URL(text);
  } catch {
    throw Object.assign(new Error('Google Apps Script URL is invalid'), { status: 400 });
  }
  if (url.protocol !== 'https:' || !GOOGLE_HOSTS.has(url.hostname.toLowerCase())) {
    throw Object.assign(new Error('Only HTTPS Google Apps Script Web App URLs are allowed'), { status: 400 });
  }
  return url.toString();
}

async function ensureSchema() {
  if (!schemaPromise) {
    schemaPromise = prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS google_sheet_sync_outbox (
        id UUID PRIMARY KEY,
        shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
        dataset TEXT NOT NULL,
        action TEXT NOT NULL,
        entity_id TEXT,
        payload JSONB NOT NULL DEFAULT '{}'::jsonb,
        status TEXT NOT NULL DEFAULT 'PENDING',
        attempts INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        sent_at TIMESTAMPTZ
      )`);
      await tx.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS google_sheet_sync_outbox_pending_idx ON google_sheet_sync_outbox(status,created_at)');
      return true;
    }).catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  return schemaPromise;
}

async function readRawSettings(shopId) {
  const row = await prisma.shopSettings.findUnique({ where: { shopId }, select: { settings: true } });
  return object(row?.settings);
}

async function loadConfig(shopId) {
  const raw = await readRawSettings(shopId);
  const api = object(raw.api);
  const saved = object(api.googleSheets);
  return {
    enabled: saved.enabled === true,
    postUrl: clean(saved.postUrl || saved.webhookUrl, 2000),
    getUrl: clean(saved.getUrl, 2000),
    secret: clean(saved.secret, 500),
    timeoutMs: Math.min(60000, Math.max(1000, Number(saved.timeoutMs || 10000))),
    // Which tab the repair book lives in. It is named for the branch — "Mahar",
    // not the shop's full name — so it has to be told, not guessed.
    repairSheetTab: clean(saved.repairSheetTab || object(raw.integrations).repairSheetTab, 200),
    // Which workbook. Given, the script does not have to be bound to the sheet
    // and can live in its own project.
    sheetId: clean(saved.sheetId, 400),
    lastTest: saved.lastTest || null,
    updatedAt: saved.updatedAt || null,
  };
}

async function saveConfig(shopId, userId, input, req) {
  const raw = await readRawSettings(shopId);
  const api = object(raw.api);
  const previous = object(api.googleSheets);
  // The screen generates a secret when it has none to show, so a page that
  // failed to load and was then saved would replace a working secret with a
  // fresh one — silently breaking a sheet that is already holding the old
  // value. Nothing in the UI edits this field, so what is stored always wins.
  const secret = clean(previous.secret, 500) || clean(input.secret, 500);
  const next = {
    ...previous,
    enabled: input.enabled,
    postUrl: validateGoogleUrl(input.postUrl, input.enabled),
    getUrl: validateGoogleUrl(input.getUrl, false),
    secret,
    timeoutMs: input.timeoutMs,
    // A field the client did not send is a field it does not know about — an
    // older tab still open, a page loaded before this existed. Absent leaves
    // what is stored alone; only an empty string that was actually sent clears
    // it. The sheet link was wiped this way once already.
    repairSheetTab: input.repairSheetTab === undefined ? clean(previous.repairSheetTab, 200) : clean(input.repairSheetTab, 200),
    sheetId: input.sheetId === undefined ? clean(previous.sheetId, 400) : clean(input.sheetId, 400),
    updatedAt: new Date().toISOString(),
  };
  if (next.enabled && !next.secret) {
    throw Object.assign(new Error('Shared Secret is required when Google Sheet sync is enabled'), { status: 400 });
  }
  await prisma.$transaction(async (tx) => {
    await tx.shopSettings.upsert({
      where: { shopId },
      create: { shopId, settings: { ...raw, api: { ...api, googleSheets: next } } },
      update: { settings: { ...raw, api: { ...api, googleSheets: next } } },
    });
    await tx.auditLog.create({
      data: {
        shopId,
        userId,
        action: 'PROJECT_GOOGLE_SHEET_INTEGRATION_UPDATED',
        entityType: 'project_settings',
        entityId: shopId,
        details: {
          enabled: next.enabled,
          hasPostUrl: Boolean(next.postUrl),
          hasGetUrl: Boolean(next.getUrl),
          secretConfigured: Boolean(next.secret),
        },
        ipAddress: req?.ip || null,
        userAgent: req?.headers?.['user-agent'] || null,
      },
    }).catch(() => {});
  });
  return next;
}

// The same four bytes the Apps Script reports from doGet, so a mismatched
// POS_SYNC_SECRET can be seen rather than inferred from a failed sync.
function secretFingerprint(secret) {
  if (!secret) return '';
  return crypto.createHash('sha256').update(String(secret), 'utf8').digest('hex').slice(0, 8);
}

function publicConfig(config) {
  return {
    enabled: config.enabled,
    postUrl: config.postUrl,
    getUrl: config.getUrl,
    timeoutMs: config.timeoutMs,
    repairSheetTab: config.repairSheetTab || '',
    sheetId: config.sheetId || '',
    secret: config.secret || '',
    secretConfigured: Boolean(config.secret),
    secretMasked: config.secret ? `••••••${config.secret.slice(-4)}` : '',
    secretFingerprint: secretFingerprint(config.secret),
    lastTest: config.lastTest || null,
    updatedAt: config.updatedAt || null,
  };
}

// The screen must never invent a secret. It did, on every load, and the shop
// pasted that invented value into Script Properties while the server kept a
// different one — so the sync failed with "Invalid secret" and both sides
// looked correct to whoever was reading them. Minting it here means what is
// shown is always what is stored.
async function ensureSecret(shopId) {
  const config = await loadConfig(shopId);
  if (config.secret) return config;
  const raw = await readRawSettings(shopId);
  const api = object(raw.api);
  const next = { ...object(api.googleSheets), secret: crypto.randomBytes(24).toString('hex'), updatedAt: new Date().toISOString() };
  await prisma.shopSettings.upsert({
    where: { shopId },
    create: { shopId, settings: { ...raw, api: { ...api, googleSheets: next } } },
    update: { settings: { ...raw, api: { ...api, googleSheets: next } } },
  });
  return loadConfig(shopId);
}

async function shopIdentity(shopId) {
  const shop = await prisma.shop.findUnique({ where: { id: shopId }, select: { id: true, slug: true, name: true } });
  if (!shop) return shop;
  // The Apps Script needs the voucher prefix to report repair numbers back; the
  // tab is named for the branch, so it cannot be inferred there.
  const rows = await prisma.$queryRawUnsafe(
    'SELECT repair_prefix AS "repairPrefix" FROM shop_settings WHERE shop_id=$1::uuid LIMIT 1',
    shopId,
  ).catch(() => []);
  return { ...shop, repairPrefix: rows[0]?.repairPrefix || '' };
}

async function deliverRow(row) {
  const config = await loadConfig(row.shopId);
  if (!config.enabled || !config.postUrl || !config.secret || typeof fetch !== 'function') {
    return { sent: false, configured: false };
  }
  const shop = await shopIdentity(row.shopId);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const response = await fetch(config.postUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        secret: config.secret,
        eventId: row.id,
        dataset: row.dataset,
        tab: DATASETS[row.dataset] || row.dataset,
        action: row.action,
        entityId: row.entityId,
        shopSlug: shop?.slug || '',
        shopName: shop?.name || '',
        createdAt: row.createdAt,
        payload: row.payload || {},
      }),
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`Google Sheet webhook ${response.status}: ${text.slice(0, 300)}`);
    const result = parseGoogleSheetResponse(text);
    if (!result.accepted) throw new Error(`Google Sheet rejected sync: ${result.message || text.slice(0, 300)}`);
    await prisma.$executeRawUnsafe(
      `UPDATE google_sheet_sync_outbox SET status='SENT',attempts=attempts+1,last_error=NULL,sent_at=NOW() WHERE id=$1::uuid`,
      row.id,
    );
    return { sent: true, configured: true };
  } catch (error) {
    await prisma.$executeRawUnsafe(
      `UPDATE google_sheet_sync_outbox SET status='FAILED',attempts=attempts+1,last_error=$2 WHERE id=$1::uuid`,
      row.id,
      clean(error.name === 'AbortError' ? 'Request timeout' : error.message, 1000),
    ).catch(() => {});
    return { sent: false, configured: true, error: error.message };
  } finally {
    clearTimeout(timeout);
  }
}

async function deliverPending(limit = 25, shopId = null) {
  await ensureSchema();
  const take = Math.min(100, Math.max(1, Number(limit || 25)));
  const rows = shopId
    ? await prisma.$queryRawUnsafe(
      `SELECT id,shop_id AS "shopId",dataset,action,entity_id AS "entityId",payload,created_at AS "createdAt"
         FROM google_sheet_sync_outbox
        WHERE shop_id=$1::uuid AND status IN ('PENDING','FAILED') AND attempts < 20
        ORDER BY created_at ASC LIMIT $2`,
      shopId,
      take,
    )
    : await prisma.$queryRawUnsafe(
      `SELECT o.id,o.shop_id AS "shopId",o.dataset,o.action,o.entity_id AS "entityId",o.payload,o.created_at AS "createdAt"
         FROM google_sheet_sync_outbox o
         JOIN shop_settings ss ON ss.shop_id = o.shop_id
        WHERE o.status IN ('PENDING','FAILED')
          AND o.attempts < 20
          AND (ss.settings->'api'->'googleSheets'->>'enabled')::boolean = true
          AND (ss.settings->'api'->'googleSheets'->>'postUrl') IS NOT NULL
          AND (ss.settings->'api'->'googleSheets'->>'postUrl') <> ''
          AND (ss.settings->'api'->'googleSheets'->>'secret') IS NOT NULL
          AND (ss.settings->'api'->'googleSheets'->>'secret') <> ''
        ORDER BY o.created_at ASC LIMIT $1`,
      take,
    );

  let sent = 0;
  let configured = 0;
  for (const row of rows) {
    const result = await deliverRow(row);
    if (result.configured) configured += 1;
    if (result.sent) sent += 1;
  }
  return { checked: rows.length, sent, configured: configured > 0 };
}

function startGoogleSheetProjectSettingsRunner() {
  if (runner) return runner;
  runner = setInterval(() => {
    deliverPending(25).catch((error) => console.warn('Project Settings Google Sheet runner:', error.message));
  }, 30000);
  runner.unref?.();
  return runner;
}

async function testConfig(shopId, method = 'POST') {
  const config = await loadConfig(shopId);
  const target = validateGoogleUrl(method === 'GET' ? config.getUrl : config.postUrl, true);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  let response;
  let preview = '';
  try {
    response = await fetch(target, {
      method,
      signal: controller.signal,
      headers: method === 'POST'
        ? { 'content-type': 'application/json', accept: 'application/json,text/plain,*/*' }
        : { accept: 'application/json,text/plain,*/*' },
      ...(method === 'POST'
        ? { body: JSON.stringify({ secret: config.secret, source: 'Mahar POS Project Settings Test', shopId, testedAt: new Date().toISOString() }) }
        : {}),
    });
    preview = (await response.text()).slice(0, 1000);
  } catch (error) {
    preview = error.name === 'AbortError' ? 'Request timeout' : error.message;
  } finally {
    clearTimeout(timeout);
  }
  const parsedResponse = parseGoogleSheetResponse(preview);
  return {
    method,
    ok: Boolean(response?.ok) && parsedResponse.accepted,
    status: response?.status || 0,
    testedAt: new Date().toISOString(),
    responsePreview: preview,
    message: parsedResponse.accepted ? '' : (parsedResponse.message || 'Google Apps Script rejected the request'),
  };
}

async function persistLastTest(shopId, test) {
  const raw = await readRawSettings(shopId);
  const api = object(raw.api);
  const googleSheets = { ...object(api.googleSheets), lastTest: test };
  await prisma.shopSettings.upsert({
    where: { shopId },
    create: { shopId, settings: { ...raw, api: { ...api, googleSheets } } },
    update: { settings: { ...raw, api: { ...api, googleSheets } } },
  });
}

function attachGoogleSheetProjectSettingsApi(app) {
  const read = [requireAuth, requireShopUser];
  const write = [requireAuth, requireShopUser, requireWritableSubscription, requireManager];

  app.get('/api/project-settings/integrations/google-sheet', ...read, async (req, res) => {
    try {
      await ensureSchema();
      const [config, counts, shop] = await Promise.all([
        ensureSecret(req.auth.shopId),
        prisma.$queryRawUnsafe(
          `SELECT status,COUNT(*)::int AS count FROM google_sheet_sync_outbox WHERE shop_id=$1::uuid GROUP BY status`,
          req.auth.shopId,
        ),
        shopIdentity(req.auth.shopId),
      ]);
      return res.json({
        ok: true,
        config: publicConfig(config),
        counts: Object.fromEntries(counts.map((row) => [row.status, Number(row.count || 0)])),
        shop: shop || null,
        tabs: Object.values(DATASETS),
      });
    } catch (error) {
      return res.status(500).json({ ok: false, message: error.message || 'Google Sheet integration load failed' });
    }
  });

  app.put('/api/project-settings/integrations/google-sheet', ...write, async (req, res) => {
    try {
      const parsed = configSchema.safeParse(req.body || {});
      if (!parsed.success) return res.status(400).json({ ok: false, message: 'Invalid Google Sheet configuration', details: parsed.error.flatten().fieldErrors });
      const config = await saveConfig(req.auth.shopId, req.auth.userId, parsed.data, req);
      return res.json({ ok: true, config: publicConfig(config), message: 'Google Sheet integration saved in PostgreSQL' });
    } catch (error) {
      return res.status(error.status || 500).json({ ok: false, message: error.message || 'Google Sheet integration save failed' });
    }
  });

  // Setting this up means holding a hash and a version number side by side in
  // two browser tabs and squinting. Every failure so far has been one of the
  // two, so the POS asks the script itself and says which.
  app.post('/api/project-settings/integrations/google-sheet/diagnose', ...write, async (req, res) => {
    try {
      const config = await ensureSecret(req.auth.shopId);
      const checks = [];
      const add = (key, ok, detail) => checks.push({ key, ok, detail: detail || '' });

      add('url', Boolean(config.postUrl), config.postUrl ? '' : 'Web App URL မထည့်ရသေးပါ');
      add('enabled', config.enabled === true, config.enabled ? '' : 'Live Sync မဖွင့်ရသေးပါ');
      add('sheet', Boolean(config.sheetId), config.sheetId ? '' : 'Google Sheet link မထည့်ရသေးပါ');
      add('tab', Boolean(config.repairSheetTab), config.repairSheetTab ? '' : 'ဖုန်းပြင် စာရင်း tab နာမည် မထည့်ရသေးပါ');

      if (!config.postUrl || typeof fetch !== 'function') {
        return res.json({ ok: true, reachable: false, checks });
      }

      let info = null;
      let failure = '';
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);
        const response = await fetch(config.postUrl, { redirect: 'follow', signal: controller.signal });
        clearTimeout(timeout);
        const text = await response.text();
        try {
          info = JSON.parse(text);
        } catch {
          failure = text.slice(0, 160);
        }
      } catch (error) {
        failure = error.name === 'AbortError' ? 'အချိန်ကုန်သွားပါပြီ' : error.message;
      }

      if (!info) {
        add('reach', false, failure || 'Apps Script က မဖြေပါ');
        return res.json({ ok: true, reachable: false, checks });
      }
      add('reach', true, String(info.service || ''));

      const expected = secretFingerprint(config.secret);
      const actual = String(info.secretFingerprint || '');
      add('secret', Boolean(actual) && actual === expected,
        !actual ? 'Script Properties မှာ POS_SYNC_SECRET မထည့်ရသေးပါ'
          : actual === expected ? '' : `Script မှာ ${actual} · POS မှာ ${expected}`);

      const version = String(info.version || '');
      add('version', version === SCRIPT_VERSION,
        !version ? 'Code အဟောင်း — version မပါပါ'
          : version === SCRIPT_VERSION ? version : `Script မှာ ${version} · အသစ်က ${SCRIPT_VERSION}`);

      return res.json({ ok: true, reachable: true, version, expectedVersion: SCRIPT_VERSION, checks });
    } catch (error) {
      return res.status(500).json({ ok: false, message: error.message || 'စစ်ဆေးမှု မအောင်မြင်ပါ' });
    }
  });

  app.post('/api/project-settings/integrations/google-sheet/test', ...write, async (req, res) => {
    try {
      const method = req.body?.method === 'GET' ? 'GET' : 'POST';
      const test = await testConfig(req.auth.shopId, method);
      await persistLastTest(req.auth.shopId, test);
      return res.status(test.ok ? 200 : 502).json({ ok: test.ok, test, message: test.message || (test.ok ? 'Connection successful' : 'Google Apps Script rejected the connection test') });
    } catch (error) {
      return res.status(error.status || 500).json({ ok: false, message: error.message || 'Google Sheet connection test failed' });
    }
  });

  app.post('/api/project-settings/integrations/google-sheet/retry', ...write, async (req, res) => {
    try {
      return res.json({ ok: true, ...(await deliverPending(100, req.auth.shopId)) });
    } catch (error) {
      return res.status(500).json({ ok: false, message: error.message || 'Google Sheet sync retry failed' });
    }
  });
}

module.exports = {
  attachGoogleSheetProjectSettingsApi,
  deliverPendingProjectSettingsGoogleSheetSync: deliverPending,
  startGoogleSheetProjectSettingsRunner,
};
