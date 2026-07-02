const DEFAULT_TITLE = 'Mahar POS';
const DEFAULT_BODY = 'Open Mahar POS to review.';
const DEFAULT_URL = '/';

function safeJsonFromPush(event) {
  if (!event?.data) return {};
  try {
    return event.data.json() || {};
  } catch {
    try {
      const text = event.data.text();
      return text ? { data: { body: text } } : {};
    } catch {
      return {};
    }
  }
}

function payloadValue(payload, key, fallback = '') {
  return payload?.notification?.[key]
    || payload?.data?.[key]
    || payload?.fcmOptions?.[key]
    || fallback;
}

function notificationUrl(payload) {
  const dataUrl = payload?.data?.url
    || payload?.notification?.click_action
    || payload?.fcmOptions?.link
    || DEFAULT_URL;
  try {
    if (/^https?:\/\//i.test(dataUrl)) return dataUrl;
    return new URL(dataUrl || DEFAULT_URL, self.location.origin).href;
  } catch {
    return self.location.origin;
  }
}

self.addEventListener('push', (event) => {
  const payload = safeJsonFromPush(event);
  const title = payloadValue(payload, 'title', DEFAULT_TITLE);
  const body = payloadValue(payload, 'body', DEFAULT_BODY);
  const url = notificationUrl(payload);
  const tag = payload?.data?.eventType || payload?.collapse_key || 'mahar-pos';

  event.waitUntil(self.registration.showNotification(title, {
    body,
    icon: '/maharshwe-logo.png',
    badge: '/maharshwe-logo.png',
    tag,
    data: { url },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification?.data?.url || self.location.origin;
  event.waitUntil((async () => {
    const clientsList = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = clientsList.find((client) => client.url.startsWith(self.location.origin));
    if (existing) {
      await existing.focus();
      existing.postMessage({ type: 'MAHAR_PUSH_OPEN', url: targetUrl });
      return;
    }
    await clients.openWindow(targetUrl);
  })());
});

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
