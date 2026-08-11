const crypto = require('crypto');
const { z } = require('zod');
const { Prisma } = require('@prisma/client');
const { prisma } = require('./prisma');
const { apiUrl } = require('./public-urls');
const {
  requireAuth,
  requireShopUser,
  requireWritableSubscription,
} = require('./auth-api');

const SETTINGS_VERSION = 1;
const DEFAULT_AGENT = Object.freeze({
  enabled: false,
  endpointUrl: '',
  timeoutMs: 15000,
  apiKeyHash: '',
  apiKeyLast4: '',
  aiProvider: 'none',
  aiModel: '',
  aiApiKey: '',
  aiKeyLast4: '',
  lastTest: null,
});

const cleanText = (max = 500) => z.union([z.string().trim().max(max), z.literal(''), z.null()]).optional();
const urlText = z.union([
  z.string().trim().url().refine((value) => /^https?:\/\//i.test(value), 'URL must use http or https'),
  z.literal(''),
  z.null(),
]).optional();

const settingsSchema = z.object({
  enabled: z.boolean().default(false),
  endpointUrl: urlText,
  timeoutMs: z.coerce.number().int().min(3000).max(60000).default(15000),
  incomingApiKey: z.string().trim().min(12).max(200).optional().or(z.literal('')),
  clearApiKey: z.boolean().optional(),
  aiProvider: z.enum(['none', 'gemini', 'openai']).default('none'),
  aiModel: cleanText(120),
  aiApiKey: z.string().trim().min(10).max(500).optional().or(z.literal('')),
  clearAiKey: z.boolean().optional(),
});

const parseSchema = z.object({
  shopSlug: z.string().trim().min(1).max(160).optional(),
  kind: z.enum(['product', 'ledger']).default('product'),
  text: cleanText(4000),
  imageBase64: cleanText(8_000_000),
  mimeType: cleanText(80),
});

const recordSchema = z.object({
  type: z.enum(['income', 'other_income', 'expense', 'product']),
  date: cleanText(20),
  category: cleanText(100),
  source: cleanText(120),
  amount: z.coerce.number().finite().min(0).optional(),
  method: cleanText(30),
  note: cleanText(800),
  name: cleanText(180),
  brand: cleanText(120),
  model: cleanText(120),
  variantName: cleanText(160),
  sku: cleanText(100),
  barcode: cleanText(100),
  unit: cleanText(40),
  costPrice: z.coerce.number().finite().min(0).optional(),
  sellingPrice: z.coerce.number().finite().min(0).optional(),
  minimumSellingPrice: z.coerce.number().finite().min(0).optional(),
  openingStock: z.coerce.number().int().min(0).optional(),
  minAlertQuantity: z.coerce.number().int().min(0).optional(),
});

const ingestSchema = z.object({
  shopSlug: z.string().trim().min(1).max(160).optional(),
  type: z.enum(['income', 'other_income', 'expense', 'product']).optional(),
  record: recordSchema.optional(),
  records: z.array(recordSchema).max(50).optional(),
});

class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

function wrap(handler) {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (error) {
      if (error instanceof ApiError) {
        return res.status(error.status).json({ ok: false, message: error.message, details: error.details });
      }
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2002') return res.status(409).json({ ok: false, message: 'Duplicate product SKU/barcode or category' });
      }
      console.error('Agent POS API:', error);
      return res.status(500).json({ ok: false, message: error.message || 'Agent request failed' });
    }
  };
}

function plainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function mergeAgent(raw) {
  return { ...DEFAULT_AGENT, ...plainObject(raw) };
}

function clean(value, max = 500) {
  if (value === null || value === undefined) return '';
  return String(value).trim().slice(0, max);
}

function number(value) {
  const parsed = Number(String(value ?? '').replaceAll(',', '').trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

function hashKey(value) {
  return crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
}

function safeAgent(agent) {
  return {
    enabled: Boolean(agent.enabled),
    endpointUrl: agent.endpointUrl || '',
    timeoutMs: Number(agent.timeoutMs || DEFAULT_AGENT.timeoutMs),
    hasApiKey: Boolean(agent.apiKeyHash),
    apiKeyLast4: agent.apiKeyLast4 || '',
    aiProvider: agent.aiProvider || 'none',
    aiModel: agent.aiModel || '',
    hasAiKey: Boolean(agent.aiApiKey),
    aiKeyLast4: agent.aiKeyLast4 || '',
    lastTest: agent.lastTest || null,
  };
}

function yangonDate(value) {
  if (value && /^\d{4}-\d{2}-\d{2}$/.test(String(value).slice(0, 10))) return String(value).slice(0, 10);
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Yangon',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

async function currentSettings(shopId) {
  const row = await prisma.shopSettings.findUnique({ where: { shopId }, select: { settings: true } });
  return plainObject(row?.settings);
}

async function loadAgentByShopId(shopId) {
  const raw = await currentSettings(shopId);
  const api = plainObject(raw.api);
  return mergeAgent(api.agent);
}

async function saveAgent(tx, shopId, agent) {
  const raw = await currentSettings(shopId);
  const api = plainObject(raw.api);
  await tx.shopSettings.upsert({
    where: { shopId },
    create: {
      shopId,
      settings: {
        ...raw,
        api: { ...api, agent },
        system: { ...plainObject(raw.system), settingsVersion: SETTINGS_VERSION },
      },
    },
    update: {
      settings: {
        ...raw,
        api: { ...api, agent },
        system: { ...plainObject(raw.system), settingsVersion: SETTINGS_VERSION },
      },
    },
  });
}

function requireSettingsManager(req, res, next) {
  if (req.auth?.role === 'SUPER_ADMIN' || req.auth?.role === 'SHOP_ADMIN' || req.auth?.permissions?.settings === true) return next();
  return res.status(403).json({ ok: false, message: 'Settings permission is required' });
}

async function authenticateAgent(req) {
  const shopSlug = clean(req.body?.shopSlug || req.headers['x-shop-slug'], 160);
  if (!shopSlug) throw new ApiError(400, 'shopSlug is required');
  const shop = await prisma.shop.findFirst({
    where: { OR: [{ slug: shopSlug }, { code: shopSlug }, { id: /^[0-9a-f-]{36}$/i.test(shopSlug) ? shopSlug : undefined }].filter((item) => Object.values(item)[0]) },
    select: { id: true, slug: true, code: true, active: true },
  });
  if (!shop || !shop.active) throw new ApiError(404, 'Active shop was not found');
  const agent = await loadAgentByShopId(shop.id);
  if (!agent.enabled) throw new ApiError(403, 'Agent API is disabled for this shop');
  const key = clean(req.headers['x-agent-api-key'] || req.body?.apiKey, 240);
  if (!key || !agent.apiKeyHash || hashKey(key) !== agent.apiKeyHash) throw new ApiError(401, 'Invalid Agent API key');
  return { shop, agent };
}

async function insertIncome(tx, shopId, record) {
  const amount = number(record.amount);
  if (amount <= 0) throw new ApiError(400, 'Income amount must be greater than zero');
  const id = crypto.randomUUID();
  await tx.$executeRawUnsafe(
    `INSERT INTO business_other_income (id,shop_id,income_date,category,source,amount,method,money_account_id,note,created_by_id,created_at)
     VALUES ($1::uuid,$2::uuid,$3::date,$4,$5,$6,$7,NULL,$8,NULL,NOW())`,
    id,
    shopId,
    yangonDate(record.date),
    clean(record.category || 'OTHER_INCOME', 100) || 'OTHER_INCOME',
    clean(record.source || record.name || 'Agent Income', 120) || 'Agent Income',
    amount,
    clean(record.method || 'CASH', 30).toUpperCase() || 'CASH',
    clean(record.note || 'Imported by Agent API', 800) || null,
  );
  return { id, type: 'income', amount };
}

async function insertExpense(tx, shopId, record) {
  const amount = number(record.amount);
  if (amount <= 0) throw new ApiError(400, 'Expense amount must be greater than zero');
  const id = crypto.randomUUID();
  await tx.$executeRawUnsafe(
    `INSERT INTO business_expenses (id,shop_id,expense_date,category,amount,method,money_account_id,note,created_by_id,created_at)
     VALUES ($1::uuid,$2::uuid,$3::date,$4,$5,$6,NULL,$7,NULL,NOW())`,
    id,
    shopId,
    yangonDate(record.date),
    clean(record.category || record.source || 'Agent Expense', 100) || 'Agent Expense',
    amount,
    clean(record.method || 'CASH', 30).toUpperCase() || 'CASH',
    clean(record.note || 'Imported by Agent API', 800) || null,
  );
  return { id, type: 'expense', amount };
}

async function insertProduct(tx, shopId, record) {
  const name = clean(record.name || [record.brand, record.model].filter(Boolean).join(' '), 180);
  if (!name) throw new ApiError(400, 'Product name is required');
  const product = await tx.product.create({
    data: {
      shopId,
      name,
      brand: clean(record.brand, 120) || null,
      model: clean(record.model, 120) || null,
      productType: clean(record.category || 'AGENT_IMPORT', 80) || null,
      active: true,
    },
  });
  const initial = Math.max(0, Number.parseInt(record.openingStock ?? 0, 10) || 0);
  const variant = await tx.productVariant.create({
    data: {
      shopId,
      productId: product.id,
      variantName: clean(record.variantName || record.name || 'Default', 160) || 'Default',
      sku: clean(record.sku, 100) || null,
      barcode: clean(record.barcode, 100) || null,
      unit: clean(record.unit, 40) || null,
      costPrice: number(record.costPrice),
      standardSellingPrice: number(record.sellingPrice),
      minimumSellingPrice: number(record.minimumSellingPrice),
      active: true,
    },
  });
  await tx.inventoryBalance.create({
    data: {
      shopId,
      productVariantId: variant.id,
      quantity: initial,
      minAlertQuantity: Math.max(0, Number.parseInt(record.minAlertQuantity ?? 0, 10) || 0),
    },
  });
  if (initial > 0) {
    await tx.stockMovement.create({
      data: {
        shopId,
        productVariantId: variant.id,
        type: 'STOCK_IN',
        quantityChange: initial,
        beforeQuantity: 0,
        afterQuantity: initial,
        referenceType: 'AGENT_IMPORT',
        note: 'Imported by Agent API',
      },
    });
  }
  return { id: product.id, variantId: variant.id, type: 'product', name, openingStock: initial };
}

function extractJson(text) {
  const value = clean(text, 200000);
  if (!value) throw new ApiError(502, 'AI returned an empty response');
  try {
    return JSON.parse(value);
  } catch {
    const fenced = value.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const candidate = fenced?.[1] || value.slice(value.indexOf('{'), value.lastIndexOf('}') + 1);
    try {
      return JSON.parse(candidate);
    } catch {
      throw new ApiError(502, 'AI response was not valid JSON', { preview: value.slice(0, 600) });
    }
  }
}

function buildAgentPrompt(kind, text) {
  const base = [
    'You are a Mahar POS data extraction assistant.',
    'Return JSON only. No markdown. No explanation.',
    'Use numbers only for amount/price/stock fields. If unknown, use 0 or empty string.',
  ];
  if (kind === 'ledger') {
    base.push(
      'Extract income and expense records for a POS shop.',
      'Schema: {"records":[{"type":"income|expense","date":"YYYY-MM-DD","category":"","source":"","amount":0,"method":"CASH","note":""}]}',
      'Allowed type values are income and expense only.',
    );
  } else {
    base.push(
      'Extract product stock records for a mobile phone shop.',
      'Schema: {"records":[{"type":"product","name":"","brand":"","model":"","variantName":"Default","sku":"","barcode":"","category":"","unit":"","costPrice":0,"sellingPrice":0,"minimumSellingPrice":0,"openingStock":0,"minAlertQuantity":0,"note":""}]}',
      'Allowed type value is product only.',
    );
  }
  base.push(`Input text:\n${clean(text, 4000) || '(image only)'}`);
  return base.join('\n');
}

function normalizeAiRecords(parsed, kind) {
  const records = Array.isArray(parsed?.records) ? parsed.records : (parsed?.record ? [parsed.record] : []);
  const allowed = kind === 'ledger' ? new Set(['income', 'other_income', 'expense']) : new Set(['product']);
  return records.slice(0, 50).map((record) => ({
    ...record,
    type: allowed.has(record?.type) ? record.type : (kind === 'ledger' ? 'income' : 'product'),
  }));
}

async function postJson(url, options) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 30000);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
    if (!response.ok) {
      throw new ApiError(response.status >= 400 && response.status < 600 ? 502 : 500, 'AI provider request failed', {
        status: response.status,
        providerMessage: data?.error?.message || data?.message || text.slice(0, 500),
      });
    }
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

async function callOpenAi(agent, input) {
  const prompt = buildAgentPrompt(input.kind, input.text);
  const content = [{ type: 'input_text', text: prompt }];
  if (input.imageBase64) {
    content.push({
      type: 'input_image',
      image_url: `data:${clean(input.mimeType, 80) || 'image/jpeg'};base64,${input.imageBase64}`,
    });
  }
  const data = await postJson('https://api.openai.com/v1/responses', {
    method: 'POST',
    timeoutMs: Number(agent.timeoutMs || 30000),
    headers: {
      Authorization: `Bearer ${agent.aiApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: clean(agent.aiModel, 120) || 'gpt-4.1-mini',
      input: [{ role: 'user', content }],
      text: { format: { type: 'json_object' } },
    }),
  });
  const outputText = data.output_text
    || data.output?.flatMap((item) => item.content || []).find((item) => item.type === 'output_text' || item.type === 'text')?.text
    || '';
  return extractJson(outputText);
}

async function callGemini(agent, input) {
  const prompt = buildAgentPrompt(input.kind, input.text);
  const parts = [{ text: prompt }];
  if (input.imageBase64) {
    parts.push({
      inlineData: {
        mimeType: clean(input.mimeType, 80) || 'image/jpeg',
        data: input.imageBase64,
      },
    });
  }
  const model = encodeURIComponent(clean(agent.aiModel, 120) || 'gemini-1.5-flash');
  const key = encodeURIComponent(agent.aiApiKey);
  const data = await postJson(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
    method: 'POST',
    timeoutMs: Number(agent.timeoutMs || 30000),
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts }],
      generationConfig: { responseMimeType: 'application/json' },
    }),
  });
  return extractJson(data.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('\n') || '');
}

async function parseWithAi(agent, input) {
  const provider = clean(agent.aiProvider || 'none', 20);
  if (provider === 'none') throw new ApiError(400, 'Select Gemini or OpenAI first');
  if (!agent.aiApiKey) throw new ApiError(400, 'AI API key is not configured');
  if (!input.text && !input.imageBase64) throw new ApiError(400, 'Text or imageBase64 is required');
  const parsed = provider === 'gemini' ? await callGemini(agent, input) : await callOpenAi(agent, input);
  return { ...parsed, records: normalizeAiRecords(parsed, input.kind) };
}

module.exports = function attachAgentPosApi(app) {
  const settingsAccess = [requireAuth, requireShopUser, requireWritableSubscription, requireSettingsManager];

  app.get('/api/project-settings/api/agent', ...settingsAccess, wrap(async (req, res) => {
    const agent = await loadAgentByShopId(req.auth.shopId);
    res.json({
      ok: true,
      agent: safeAgent(agent),
      incomingEndpoint: `${apiUrl()}/api/agent/records`,
      parseEndpoint: `${apiUrl()}/api/project-settings/api/agent/parse`,
      sample: {
        headers: { 'x-agent-api-key': 'YOUR_AGENT_KEY' },
        body: { shopSlug: req.auth.shopSlug || 'your-shop-slug', records: [{ type: 'income', source: 'Daily sales note', amount: 10000 }] },
      },
    });
  }));

  app.put('/api/project-settings/api/agent', ...settingsAccess, wrap(async (req, res) => {
    const parsed = settingsSchema.safeParse(req.body || {});
    if (!parsed.success) throw new ApiError(400, 'Invalid Agent API settings', parsed.error.flatten().fieldErrors);
    const input = parsed.data;
    const current = await loadAgentByShopId(req.auth.shopId);
    const next = {
      ...current,
      enabled: input.enabled,
      endpointUrl: clean(input.endpointUrl, 500),
      timeoutMs: input.timeoutMs,
      aiProvider: input.aiProvider,
      aiModel: clean(input.aiModel, 120),
    };
    if (input.clearApiKey) {
      next.apiKeyHash = '';
      next.apiKeyLast4 = '';
    } else if (input.incomingApiKey) {
      next.apiKeyHash = hashKey(input.incomingApiKey);
      next.apiKeyLast4 = input.incomingApiKey.slice(-4);
    }
    if (input.clearAiKey || input.aiProvider === 'none') {
      next.aiApiKey = '';
      next.aiKeyLast4 = '';
    } else if (input.aiApiKey) {
      next.aiApiKey = input.aiApiKey;
      next.aiKeyLast4 = input.aiApiKey.slice(-4);
    }
    await prisma.$transaction(async (tx) => saveAgent(tx, req.auth.shopId, next), { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    res.json({ ok: true, agent: safeAgent(next), message: 'Agent API settings saved' });
  }));

  app.post('/api/project-settings/api/agent/test', ...settingsAccess, wrap(async (req, res) => {
    const agent = await loadAgentByShopId(req.auth.shopId);
    const lastTest = {
      ok: Boolean(agent.enabled && agent.apiKeyHash),
      testedAt: new Date().toISOString(),
      message: agent.enabled && agent.apiKeyHash ? 'Incoming Agent API is ready' : 'Enable Agent API and set an incoming API key first',
    };
    const next = { ...agent, lastTest };
    await prisma.$transaction(async (tx) => saveAgent(tx, req.auth.shopId, next), { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    res.status(lastTest.ok ? 200 : 400).json({ ok: lastTest.ok, test: lastTest, agent: safeAgent(next) });
  }));

  app.post('/api/project-settings/api/agent/parse', ...settingsAccess, wrap(async (req, res) => {
    const parsed = parseSchema.safeParse(req.body || {});
    if (!parsed.success) throw new ApiError(400, 'Invalid AI parse request', parsed.error.flatten().fieldErrors);
    const agent = await loadAgentByShopId(req.auth.shopId);
    const result = await parseWithAi(agent, parsed.data);
    res.json({ ok: true, provider: agent.aiProvider, kind: parsed.data.kind, parsed: result });
  }));

  app.post('/api/agent/parse', wrap(async (req, res) => {
    const parsed = parseSchema.safeParse(req.body || {});
    if (!parsed.success) throw new ApiError(400, 'Invalid AI parse request', parsed.error.flatten().fieldErrors);
    const { shop, agent } = await authenticateAgent(req);
    const result = await parseWithAi(agent, parsed.data);
    res.json({ ok: true, shopSlug: shop.slug, provider: agent.aiProvider, kind: parsed.data.kind, parsed: result });
  }));

  app.post('/api/agent/records', wrap(async (req, res) => {
    const parsed = ingestSchema.safeParse(req.body || {});
    if (!parsed.success) throw new ApiError(400, 'Invalid Agent payload', parsed.error.flatten().fieldErrors);
    const { shop } = await authenticateAgent(req);
    const baseRecords = parsed.data.records?.length ? parsed.data.records : (parsed.data.record ? [parsed.data.record] : []);
    if (!baseRecords.length) throw new ApiError(400, 'At least one record is required');
    const records = baseRecords.map((record) => ({ ...record, type: record.type || parsed.data.type }));
    const imported = await prisma.$transaction(async (tx) => {
      const results = [];
      for (const record of records) {
        if (record.type === 'income' || record.type === 'other_income') results.push(await insertIncome(tx, shop.id, record));
        else if (record.type === 'expense') results.push(await insertExpense(tx, shop.id, record));
        else if (record.type === 'product') results.push(await insertProduct(tx, shop.id, record));
        else throw new ApiError(400, `Unsupported record type: ${record.type}`);
      }
      return results;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5000, timeout: 20000 });
    res.status(201).json({ ok: true, shopSlug: shop.slug, importedCount: imported.length, imported });
  }));
};
