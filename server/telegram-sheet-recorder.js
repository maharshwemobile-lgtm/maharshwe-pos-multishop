function clean(value, max = 1000) {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function telegramSheetConfig() {
  const url = clean(process.env.TELEGRAM_SHEET_API_URL, 1200);
  const apiKey = clean(process.env.TELEGRAM_API_KEY || process.env.TELEGRAM_BOT_TOKEN, 500);
  if (!url || !apiKey) return null;

  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return null;
    return { url: parsed.toString(), apiKey };
  } catch {
    return null;
  }
}

async function recordTelegramSheet(eventType, payload = {}) {
  const config = telegramSheetConfig();
  if (!config) return { skipped: true, reason: 'TELEGRAM_SHEET_API_URL or TELEGRAM_API_KEY is not configured' };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(config.url, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'x-api-key': config.apiKey,
      },
      body: JSON.stringify({
        apiKey: config.apiKey,
        eventType: clean(eventType, 120),
        source: 'maharshwe-pos-admin',
        createdAt: new Date().toISOString(),
        payload,
      }),
    });
    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text ? { text: text.slice(0, 500) } : null;
    }
    if (!response.ok) {
      return { ok: false, status: response.status, response: data };
    }
    return { ok: true, status: response.status, response: data };
  } catch (error) {
    return { ok: false, message: error.message || 'Telegram sheet record failed' };
  } finally {
    clearTimeout(timeout);
  }
}

async function recordTelegramSheetSafe(eventType, payload = {}) {
  const result = await recordTelegramSheet(eventType, payload);
  if (result?.ok === false) {
    console.warn('Telegram sheet record failed:', result.message || result.status || 'unknown');
  }
  return result;
}

module.exports = {
  recordTelegramSheet,
  recordTelegramSheetSafe,
};
