const { prisma } = require('./prisma');
const { ensureRepairPlatformSchema } = require('./repair-platform-schema');

let timer;
let busy = false;

async function claimBatch(limit = 10) {
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRawUnsafe(
      `SELECT id,channel,destination,event_type AS "eventType",repair_status AS "repairStatus",
              title,body,action_url AS "actionUrl",payload,attempts,max_attempts AS "maxAttempts"
         FROM repair_notification_queue
        WHERE state IN ('PENDING','FAILED')
          AND attempts<max_attempts
          AND next_attempt_at<=NOW()
        ORDER BY created_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT $1`,
      limit,
    );
    for (const row of rows) {
      await tx.$executeRawUnsafe(
        `UPDATE repair_notification_queue
            SET state='SENDING',attempts=attempts+1,updated_at=NOW()
          WHERE id=$1::uuid`,
        row.id,
      );
      row.attempts = Number(row.attempts || 0) + 1;
    }
    return rows;
  });
}

async function deliver(row) {
  const endpoint = String(process.env.REPAIR_NOTIFICATION_WEBHOOK_URL || '').trim();
  if (!endpoint) throw new Error('REPAIR_NOTIFICATION_WEBHOOK_URL is not configured');
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      notificationId: row.id,
      channel: row.channel,
      destination: row.destination,
      title: row.title,
      message: row.body,
      openUrl: row.actionUrl || '',
      eventType: row.eventType,
      repairStatus: row.repairStatus || '',
      payload: row.payload || {},
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) {
    throw new Error(data.message || `Notification webhook failed (${response.status})`);
  }
}

async function runRepairOutboxOnce() {
  if (busy) return;
  busy = true;
  try {
    await ensureRepairPlatformSchema();
    const rows = await claimBatch(Math.min(50, Math.max(1, Number(process.env.REPAIR_NOTIFICATION_BATCH_SIZE || 10))));
    for (const row of rows) {
      try {
        await deliver(row);
        await prisma.$executeRawUnsafe(
          `UPDATE repair_notification_queue
              SET state='SENT',sent_at=NOW(),last_error=NULL,updated_at=NOW()
            WHERE id=$1::uuid`,
          row.id,
        );
      } catch (error) {
        const delay = Math.min(7200, 60 * (5 ** Math.max(0, row.attempts - 1)));
        await prisma.$executeRawUnsafe(
          `UPDATE repair_notification_queue
              SET state='FAILED',last_error=$2,
                  next_attempt_at=NOW()+($3::text || ' seconds')::interval,updated_at=NOW()
            WHERE id=$1::uuid`,
          row.id,
          String(error.message || error).slice(0, 2000),
          String(delay),
        );
      }
    }
  } catch (error) {
    console.error('Repair notification outbox:', error);
  } finally {
    busy = false;
  }
}

function startRepairOutboxRunner() {
  if (timer || process.env.REPAIR_NOTIFICATION_OUTBOX === 'false') return;
  const interval = Math.max(5000, Number(process.env.REPAIR_NOTIFICATION_INTERVAL_MS || 15000));
  setTimeout(runRepairOutboxOnce, 1500).unref?.();
  timer = setInterval(runRepairOutboxOnce, interval);
  timer.unref?.();
}

module.exports = { startRepairOutboxRunner, runRepairOutboxOnce };
