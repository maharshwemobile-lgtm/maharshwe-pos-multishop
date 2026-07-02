const crypto = require('crypto');
const { prisma } = require('./prisma');

function clean(value, max = 500) {
  return String(value ?? '').trim().slice(0, max);
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
}

function requireSecret(req, res, next) {
  const expected = process.env.GOOGLE_SHEET_SYNC_SECRET;
  const supplied = req.headers['x-google-sheet-secret'] || req.query.key || req.body?.secret;
  if (!expected) return res.status(503).json({ ok: false, message: 'Google Sheet sync secret is not configured' });
  if (!safeEqual(supplied, expected)) return res.status(401).json({ ok: false, message: 'Invalid sync secret' });
  next();
}

function parseSince(value) {
  const date = value ? new Date(value) : new Date('2000-01-01T00:00:00.000Z');
  if (Number.isNaN(date.getTime())) throw Object.assign(new Error('Invalid since date'), { status: 400 });
  return date;
}

async function resolveShop(slug) {
  const value = clean(slug, 120);
  if (!value) throw Object.assign(new Error('shopSlug is required'), { status: 400 });
  const shop = await prisma.shop.findUnique({ where: { slug: value }, select: { id: true, slug: true, name: true } });
  if (!shop) throw Object.assign(new Error('Shop not found'), { status: 404 });
  return shop;
}

async function exportRows(shopId, since, limit) {
  const take = Math.min(10000, Math.max(1, Number(limit || 5000)));
  return prisma.$queryRawUnsafe(
    `SELECT * FROM (
       SELECT t.id::text AS id,t.transaction_number AS "transactionNumber",t.created_at AS "createdAt",'LEGACY' AS "recordVersion",
              CASE WHEN t.type::text LIKE '%CASH_OUT' THEN 'CASH_OUT' ELSE 'TRANSFER' END AS mode,
              COALESCE(t.service_channel,t.type::text) AS wallet,t.sender_name AS "senderName",t.sender_phone AS "senderPhone",
              t.receiver_name AS "receiverName",t.receiver_phone AS "receiverPhone",t.counterparty_name AS "withdrawerName",t.counterparty_phone AS "withdrawerPhone",
              t.customer_amount AS amount,t.fee_rate AS "feeRate",t.fee_amount AS fee,t.customer_pays_amount AS "customerPays",
              t.customer_receives_amount AS "customerReceives",'PAID' AS "paymentStatus",t.customer_pays_amount AS "paidAmount",0::numeric AS "dueAmount",
              NULL::date AS "dueDate",t.reference,t.note,u.name AS "staffName",u.username AS "staffUsername"
         FROM money_service_transactions t LEFT JOIN users u ON u.id=t.user_id
        WHERE t.shop_id=$1::uuid AND t.type IN ('KPAY_TRANSFER','KPAY_CASH_OUT','WAVE_PAY_TRANSFER','WAVE_PAY_CASH_OUT') AND t.created_at >= $2
       UNION ALL
       SELECT t.id::text AS id,t.transaction_number AS "transactionNumber",t.created_at AS "createdAt",'V2' AS "recordVersion",
              t.mode,m.name AS wallet,t.sender_name AS "senderName",t.sender_phone AS "senderPhone",t.receiver_name AS "receiverName",t.receiver_phone AS "receiverPhone",
              t.withdrawer_name AS "withdrawerName",t.withdrawer_phone AS "withdrawerPhone",t.amount,t.fee_rate AS "feeRate",t.fee_amount AS fee,
              t.customer_pays AS "customerPays",t.customer_receives AS "customerReceives",t.payment_status AS "paymentStatus",t.paid_amount AS "paidAmount",
              t.due_amount AS "dueAmount",t.due_date AS "dueDate",t.reference,t.note,u.name AS "staffName",u.username AS "staffUsername"
         FROM money_service_transactions_v2 t LEFT JOIN finance_payment_methods m ON m.id=t.payment_method_id LEFT JOIN users u ON u.id=t.created_by_id
        WHERE t.shop_id=$1::uuid AND t.updated_at >= $2
     ) records ORDER BY "createdAt" ASC LIMIT $3`,
    shopId, since, take,
  );
}

function attachGoogleSheetSyncV23Extension(app) {
  const handler = async (req, res) => {
    try {
      const shop = await resolveShop(req.method === 'GET' ? req.query.shopSlug : req.body?.shopSlug);
      const since = parseSince(req.method === 'GET' ? req.query.since : req.body?.since);
      const limit = req.method === 'GET' ? req.query.limit : req.body?.limit;
      const rows = await exportRows(shop.id, since, limit);
      return res.json({ ok: true, dataset: 'remittances', tab: 'Remittances', shop, rows, count: rows.length });
    } catch (error) {
      return res.status(error.status || 500).json({ ok: false, message: error.message || 'Remittance export failed' });
    }
  };
  app.get('/api/google-sheet-sync/export-remittances-v2', requireSecret, handler);
  app.post('/api/google-sheet-sync/export-remittances-v2', requireSecret, handler);
}

module.exports = attachGoogleSheetSyncV23Extension;
