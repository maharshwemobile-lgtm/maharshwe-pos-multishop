const { z } = require('zod');
const { Prisma } = require('@prisma/client');
const { prisma } = require('./prisma');
const { requireAuth, requireShopUser } = require('./auth-api');
const { isFirebaseAdminConfigured, sendFcmMessages } = require('./firebase-admin');

const tokenSchema = z.object({
  token: z.string().trim().min(20).max(4096),
  platform: z.string().trim().max(40).optional(),
  browser: z.string().trim().max(80).optional(),
});

const testSchema = z.object({
  title: z.string().trim().min(1).max(100).optional(),
  body: z.string().trim().min(1).max(180).optional(),
  url: z.string().trim().max(200).optional(),
});

const uuid = z.string().uuid();

class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

function parse(schema, value, message = 'Invalid push notification request') {
  const result = schema.safeParse(value);
  if (!result.success) throw new ApiError(400, message, result.error.flatten().fieldErrors);
  return result.data;
}

function wrap(handler) {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (error) {
      if (error instanceof ApiError) {
        return res.status(error.status).json({ ok: false, message: error.message, details: error.details });
      }
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        return res.status(404).json({ ok: false, message: 'Push notification record not found' });
      }
      console.error('Push notifications API:', error);
      return res.status(500).json({ ok: false, message: error.message || 'Push notification request failed' });
    }
  };
}

function safeText(value, fallback, max = 180) {
  const text = String(value || fallback || '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.slice(0, max) || fallback;
}

function safePath(value, fallback = '/') {
  const path = String(value || fallback || '/').trim();
  if (!path || path.startsWith('//')) return fallback;
  if (/^https?:\/\//i.test(path)) {
    try {
      const url = new URL(path);
      return `${url.pathname}${url.search}${url.hash}` || fallback;
    } catch {
      return fallback;
    }
  }
  return path.startsWith('/') ? path.slice(0, 220) : fallback;
}

function publicAppBaseUrl() {
  const base = process.env.APP_PUBLIC_URL
    || process.env.PUBLIC_APP_URL
    || process.env.NEXTAUTH_URL
    || 'https://app.maharshwe.shop';
  return String(base).replace(/\/+$/, '');
}

function absoluteAppUrl(path) {
  return `${publicAppBaseUrl()}${safePath(path, '/')}`;
}

function stringData(data = {}) {
  const output = {};
  for (const [key, value] of Object.entries(data || {})) {
    if (!/^[a-zA-Z0-9_.-]{1,64}$/.test(key)) continue;
    if (value === undefined || value === null) continue;
    output[key] = String(value).slice(0, 500);
  }
  return output;
}

function invalidToken(error) {
  const code = error?.code || error?.errorInfo?.code || '';
  return [
    'messaging/invalid-registration-token',
    'messaging/registration-token-not-registered',
  ].includes(code);
}

async function deactivateFailedTokens(tokens, responses) {
  const invalidTokens = [];
  (responses || []).forEach((response, index) => {
    if (!response?.success && invalidToken(response.error)) {
      const token = tokens[index];
      if (token) invalidTokens.push(token);
    }
  });
  if (!invalidTokens.length) return 0;
  const result = await prisma.userPushToken.updateMany({
    where: { token: { in: invalidTokens } },
    data: { isActive: false, lastSeenAt: new Date() },
  });
  return result.count;
}

function buildMessage(token, notification) {
  const title = safeText(notification.title, 'Mahar POS', 100);
  const body = safeText(notification.body, 'Open Mahar POS to review.', 180);
  const path = safePath(notification.url, '/');
  const link = absoluteAppUrl(path);
  return {
    token,
    notification: { title, body },
    data: {
      eventType: safeText(notification.eventType, 'APP_NOTIFICATION', 80),
      url: path,
      ...stringData(notification.data),
    },
    webpush: {
      fcmOptions: { link },
      notification: {
        title,
        body,
        icon: '/logo-192.png',
        badge: '/logo-192.png',
        tag: safeText(notification.eventType, 'mahar-pos', 64),
        data: { url: path },
      },
    },
  };
}

async function activeShopUserIds(shopId) {
  const users = await prisma.user.findMany({
    where: { shopId, active: true },
    select: { id: true },
    take: 500,
  });
  return users.map((user) => user.id);
}

async function createInAppNotifications({ shopId, userId = null, eventType, title, body, url, data = {} }) {
  const safeNotification = {
    shopId,
    eventType: safeText(eventType, 'APP_NOTIFICATION', 80),
    title: safeText(title, 'Mahar POS', 100),
    body: safeText(body, 'Open Mahar POS to review.', 180),
    url: safePath(url, '/'),
    data: stringData(data),
  };

  if (userId) {
    const user = await prisma.user.findFirst({
      where: { id: userId, shopId, active: true },
      select: { id: true },
    });
    if (!user) return { count: 0, notification: safeNotification };
    await prisma.appNotification.create({ data: { ...safeNotification, userId } });
    return { count: 1, notification: safeNotification };
  }

  const userIds = await activeShopUserIds(shopId);
  if (!userIds.length) return { count: 0, notification: safeNotification };
  await prisma.appNotification.createMany({
    data: userIds.map((id) => ({ ...safeNotification, userId: id })),
  });
  return { count: userIds.length, notification: safeNotification };
}

async function sendToTokenRows(tokenRows, notification) {
  const tokens = [...new Set((tokenRows || []).map((row) => row.token).filter(Boolean))];
  if (!tokens.length) {
    return { sent: 0, failed: 0, skipped: false, inactiveTokens: 0 };
  }
  const result = await sendFcmMessages(tokens.map((token) => buildMessage(token, notification)));
  const inactiveTokens = result.skipped ? 0 : await deactivateFailedTokens(tokens, result.responses);
  return {
    sent: result.successCount,
    failed: result.failureCount,
    skipped: result.skipped,
    inactiveTokens,
    message: result.message || null,
  };
}

async function sendPushToUser({ shopId, userId, eventType, title, body, url = '/', data = {} }) {
  if (!shopId || !userId) return { inApp: { count: 0 }, push: { sent: 0, failed: 0, skipped: true } };
  const inApp = await createInAppNotifications({ shopId, userId, eventType, title, body, url, data });
  const tokenRows = await prisma.userPushToken.findMany({
    where: {
      shopId,
      userId,
      isActive: true,
      user: { shopId, active: true },
    },
    select: { token: true },
  });
  const push = await sendToTokenRows(tokenRows, inApp.notification);
  return { inApp, push };
}

async function sendPushToShop({ shopId, eventType, title, body, url = '/', data = {} }) {
  if (!shopId) return { inApp: { count: 0 }, push: { sent: 0, failed: 0, skipped: true } };
  const inApp = await createInAppNotifications({ shopId, eventType, title, body, url, data });
  const tokenRows = await prisma.userPushToken.findMany({
    where: {
      shopId,
      isActive: true,
      user: { shopId, active: true },
    },
    select: { token: true },
  });
  const push = await sendToTokenRows(tokenRows, inApp.notification);
  return { inApp, push };
}

function queuePush(work, label = 'push notification') {
  Promise.resolve()
    .then(work)
    .catch((error) => console.error(`${label} failed:`, error.message));
}

function attachPushNotificationsApi(app) {
  const access = [requireAuth, requireShopUser];

  app.get('/api/push/status', ...access, wrap(async (req, res) => {
    const [activeTokens, unreadCount] = await Promise.all([
      prisma.userPushToken.count({
        where: { shopId: req.auth.shopId, userId: req.auth.userId, isActive: true },
      }),
      prisma.appNotification.count({
        where: { shopId: req.auth.shopId, userId: req.auth.userId, isRead: false },
      }),
    ]);
    res.json({
      ok: true,
      firebaseAdminConfigured: isFirebaseAdminConfigured(),
      activeTokens,
      unreadCount,
      tenant: { shopId: req.auth.shopId },
    });
  }));

  app.post('/api/push/tokens', ...access, wrap(async (req, res) => {
    const input = parse(tokenSchema, req.body || {});
    const now = new Date();
    const token = await prisma.userPushToken.upsert({
      where: { token: input.token },
      update: {
        userId: req.auth.userId,
        shopId: req.auth.shopId,
        platform: input.platform || null,
        browser: input.browser || null,
        isActive: true,
        lastSeenAt: now,
      },
      create: {
        token: input.token,
        userId: req.auth.userId,
        shopId: req.auth.shopId,
        platform: input.platform || null,
        browser: input.browser || null,
        isActive: true,
        lastSeenAt: now,
      },
    });
    res.status(201).json({
      ok: true,
      token: {
        id: token.id,
        userId: token.userId,
        shopId: token.shopId,
        platform: token.platform,
        browser: token.browser,
        isActive: token.isActive,
        lastSeenAt: token.lastSeenAt,
      },
    });
  }));

  app.delete('/api/push/tokens', ...access, wrap(async (req, res) => {
    const input = parse(tokenSchema.pick({ token: true }), req.body || {});
    const result = await prisma.userPushToken.updateMany({
      where: { token: input.token, userId: req.auth.userId, shopId: req.auth.shopId },
      data: { isActive: false, lastSeenAt: new Date() },
    });
    res.json({ ok: true, deactivated: result.count });
  }));

  app.post('/api/push/tokens/deactivate', ...access, wrap(async (req, res) => {
    const input = parse(tokenSchema.pick({ token: true }), req.body || {});
    const result = await prisma.userPushToken.updateMany({
      where: { token: input.token, userId: req.auth.userId, shopId: req.auth.shopId },
      data: { isActive: false, lastSeenAt: new Date() },
    });
    res.json({ ok: true, deactivated: result.count });
  }));

  app.post('/api/push/test', ...access, wrap(async (req, res) => {
    const input = parse(testSchema, req.body || {});
    const result = await sendPushToUser({
      shopId: req.auth.shopId,
      userId: req.auth.userId,
      eventType: 'PUSH_TEST',
      title: input.title || 'Mahar POS notifications enabled',
      body: input.body || 'Browser push notification is connected for this shop.',
      url: input.url || '/dashboard',
      data: { source: 'push-test' },
    });
    res.json({ ok: true, ...result });
  }));

  app.get('/api/notifications', ...access, wrap(async (req, res) => {
    const limit = Math.min(50, Math.max(1, Number.parseInt(req.query.limit || '20', 10) || 20));
    const [notifications, unreadCount] = await Promise.all([
      prisma.appNotification.findMany({
        where: { shopId: req.auth.shopId, userId: req.auth.userId },
        orderBy: { createdAt: 'desc' },
        take: limit,
      }),
      prisma.appNotification.count({
        where: { shopId: req.auth.shopId, userId: req.auth.userId, isRead: false },
      }),
    ]);
    res.json({
      ok: true,
      unreadCount,
      notifications: notifications.map((item) => ({
        id: item.id,
        eventType: item.eventType,
        title: item.title,
        body: item.body,
        url: item.url,
        data: item.data || {},
        isRead: item.isRead,
        readAt: item.readAt,
        createdAt: item.createdAt,
      })),
    });
  }));

  app.patch('/api/notifications/:id/read', ...access, wrap(async (req, res) => {
    const id = parse(uuid, req.params.id, 'Invalid notification id');
    const result = await prisma.appNotification.updateMany({
      where: { id, shopId: req.auth.shopId, userId: req.auth.userId },
      data: { isRead: true, readAt: new Date() },
    });
    if (result.count !== 1) throw new ApiError(404, 'Notification not found');
    res.json({ ok: true, id });
  }));

  app.post('/api/notifications/read-all', ...access, wrap(async (req, res) => {
    const result = await prisma.appNotification.updateMany({
      where: { shopId: req.auth.shopId, userId: req.auth.userId, isRead: false },
      data: { isRead: true, readAt: new Date() },
    });
    res.json({ ok: true, updated: result.count });
  }));
}

module.exports = attachPushNotificationsApi;
module.exports.sendPushToUser = sendPushToUser;
module.exports.sendPushToShop = sendPushToShop;
module.exports.queuePush = queuePush;
module.exports.createInAppNotifications = createInAppNotifications;
