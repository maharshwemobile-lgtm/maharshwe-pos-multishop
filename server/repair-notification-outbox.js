const crypto = require('crypto');
const { prisma } = require('./prisma');
const { ensureRepairPlatformSchema } = require('./repair-platform-schema');

function statusText(status) {
  const map = {
    RECEIVED: 'ဖုန်းကို လက်ခံပြီးပါပြီ။',
    CHECKING: 'ဖုန်းကို စစ်ဆေးနေပါပြီ။',
    IN_PROGRESS: 'ဖုန်းကို ပြင်ဆင်နေပါပြီ။',
    WAITING_PART: 'ပြင်ဆင်ရန် ပစ္စည်းစောင့်နေပါသည်။',
    COMPLETED: 'ဖုန်းပြင်ပြီးပါပြီ။ လာယူနိုင်ပါပြီ။',
    CANNOT_REPAIR: 'ဖုန်းကို ပြင်ဆင်၍ မရပါ။ ဆိုင်သို့ ဆက်သွယ်ပါ။',
    DELIVERED: 'ဖုန်းကို Customer ထံ ပေးအပ်ပြီးပါပြီ။',
  };
  return map[status] || `Repair status: ${status}`;
}

function keyFor(parts) {
  return crypto.createHash('sha256').update(parts.join('|')).digest('hex');
}

async function enqueueRepairNotification({ shopId, repairId, eventType, status, title, body, actionUrl, payload = {}, nonce = '' }) {
  await ensureRepairPlatformSchema();
  const rows = await prisma.$queryRawUnsafe(
    `SELECT r.repair_number AS "repairNumber",
            r.customer_telegram_chat_id AS "telegramChatId",
            r.customer_fcm_token AS "appPushToken",
            s.name AS "shopName",
            s.slug AS "shopSlug"
       FROM repairs r
       JOIN shops s ON s.id = r.shop_id
      WHERE r.shop_id = $1::uuid AND r.id = $2::uuid
      LIMIT 1`,
    shopId,
    repairId,
  );
  const repair = rows[0];
  if (!repair) return { queued: 0 };

  const targets = [];
  if (repair.telegramChatId) targets.push({ channel: 'TELEGRAM', destination: repair.telegramChatId });
  if (repair.appPushToken) targets.push({ channel: 'APP_PUSH', destination: repair.appPushToken });

  let queued = 0;
  for (const target of targets) {
    const notificationKey = keyFor([
      repairId,
      target.channel,
      eventType,
      status || '',
      target.destination,
      nonce,
    ]);
    const inserted = await prisma.$executeRawUnsafe(
      `INSERT INTO repair_notification_queue (
         id, shop_id, repair_id, notification_key, channel, destination,
         event_type, repair_status, title, body, action_url, payload,
         state, attempts, max_attempts, next_attempt_at, created_at, updated_at
       ) VALUES (
         $1::uuid, $2::uuid, $3::uuid, $4, $5, $6,
         $7, $8, $9, $10, $11, $12::jsonb,
         'PENDING', 0, 5, NOW(), NOW(), NOW()
       ) ON CONFLICT (notification_key) DO NOTHING`,
      crypto.randomUUID(),
      shopId,
      repairId,
      notificationKey,
      target.channel,
      target.destination,
      eventType,
      status || null,
      title || `${repair.shopName} · ${repair.repairNumber}`,
      body || statusText(status),
      actionUrl || null,
      JSON.stringify({ repairNumber: repair.repairNumber, shopSlug: repair.shopSlug, ...payload }),
    );
    queued += Number(inserted || 0);
  }
  return { queued };
}

async function listRepairNotifications(shopId, repairId, limit = 20) {
  await ensureRepairPlatformSchema();
  return prisma.$queryRawUnsafe(
    `SELECT id, channel, event_type AS "eventType", repair_status AS "repairStatus",
            title, body, state, attempts, max_attempts AS "maxAttempts",
            sent_at AS "sentAt", last_error AS "lastError", created_at AS "createdAt"
       FROM repair_notification_queue
      WHERE shop_id = $1::uuid AND repair_id = $2::uuid
      ORDER BY created_at DESC
      LIMIT $3`,
    shopId,
    repairId,
    Math.min(100, Math.max(1, Number(limit || 20))),
  );
}

module.exports = { enqueueRepairNotification, listRepairNotifications, statusText };
