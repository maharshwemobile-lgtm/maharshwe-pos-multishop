const crypto = require('crypto');
const { prisma } = require('./prisma');
const { buildDailyCloseReport } = require('./reports-postgres-api');

const number = (v) => Number(v || 0);
const round  = (v) => Math.round((number(v) + Number.EPSILON) * 100) / 100;

function safeEqual(a, b) {
  const ba = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  return ba.length > 0 && ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

async function requirePullKey(req, res, next) {
  try {
    const key = String(req.query.key || req.headers['x-pull-key'] || '').trim();
    if (!key || key.length < 8) return res.status(401).json({ ok: false, message: 'Pull sync key required' });
    const rows = await prisma.$queryRawUnsafe(
      `SELECT shop_id::text AS "shopId" FROM shop_settings WHERE settings->'api'->'googleSheets'->>'secret' = $1 LIMIT 1`,
      key,
    );
    if (!rows.length) return res.status(403).json({ ok: false, message: 'Invalid pull sync key' });
    req.auth = { shopId: rows[0].shopId };
    next();
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message || 'Auth failed' });
  }
}

function attachGoogleSheetPullReportApi(app) {
  app.get('/api/google-sheet/pull/biller-balance', requirePullKey, async (req, res) => {
    try {
      const startDate = String(req.query.startDate || new Date().toISOString().slice(0, 10)).slice(0, 10);
      const endDate   = String(req.query.endDate   || startDate).slice(0, 10);
      const rows = await prisma.$queryRawUnsafe(
        `SELECT b.id,b.name,b.type,
          (b.opening_balance + COALESCE(SUM(CASE WHEN t.transaction_date::date < $2::date
            THEN CASE WHEN t.transaction_type IN ('REFILL','ADJUSTMENT') THEN t.amount
                      WHEN t.transaction_type='SOLD' THEN -COALESCE(NULLIF(t.balance_effect_amount,0),t.amount)
                      ELSE 0 END ELSE 0 END),0)) AS "openingBalance",
          COALESCE(SUM(CASE WHEN t.transaction_type='REFILL'     AND t.transaction_date::date BETWEEN $2::date AND $3::date THEN t.amount ELSE 0 END),0) AS refill,
          COALESCE(SUM(CASE WHEN t.transaction_type='SOLD'       AND t.transaction_date::date BETWEEN $2::date AND $3::date THEN t.amount ELSE 0 END),0) AS sold,
          COALESCE(SUM(CASE WHEN t.transaction_type='SOLD'       AND t.transaction_date::date BETWEEN $2::date AND $3::date THEN COALESCE(NULLIF(t.balance_effect_amount,0),t.amount) ELSE 0 END),0) AS "balanceSold",
          COALESCE(SUM(CASE WHEN t.transaction_type='ADJUSTMENT' AND t.transaction_date::date BETWEEN $2::date AND $3::date THEN t.amount ELSE 0 END),0) AS adjustment
        FROM billers b LEFT JOIN biller_transactions t ON t.biller_id=b.id AND t.shop_id=b.shop_id AND t.voided_at IS NULL
        WHERE b.shop_id=$1::uuid AND b.is_active=TRUE GROUP BY b.id,b.name,b.type,b.opening_balance ORDER BY LOWER(b.name)`,
        req.auth.shopId, startDate, endDate,
      );
      const reportRows = rows.map((row) => {
        const opening = number(row.openingBalance ?? row.openingbalance);
        const refill = number(row.refill);
        const sold = number(row.sold);
        const balanceSold = number(row.balanceSold ?? row.balancesold ?? row.sold);
        const adjustment = number(row.adjustment);
        return { id: row.id, billerName: row.name, type: row.type,
          openingBalance: round(opening), refill: round(refill), sold: round(sold),
          balanceSold: round(balanceSold), adjustment: round(adjustment),
          closingBalance: round(opening + refill - balanceSold + adjustment) };
      });
      const totals = reportRows.reduce((acc, r) => {
        acc.openingBalance += r.openingBalance; acc.refill += r.refill; acc.sold += r.sold;
        acc.balanceSold += r.balanceSold; acc.adjustment += r.adjustment; acc.closingBalance += r.closingBalance;
        return acc;
      }, { openingBalance: 0, refill: 0, sold: 0, balanceSold: 0, adjustment: 0, closingBalance: 0 });
      for (const k of Object.keys(totals)) totals[k] = round(totals[k]);
      return res.json({ ok: true, startDate, endDate, rows: reportRows, totals });
    } catch (err) {
      res.status(err.status || 500).json({ ok: false, message: err.message || 'Biller balance pull failed' });
    }
  });

  app.get('/api/google-sheet/pull/business', requirePullKey, async (req, res) => {
    try {
      const dateStr = String(req.query.from || req.query.date || new Date().toISOString().slice(0, 10)).slice(0, 10);
      const toStr   = String(req.query.to || dateStr).slice(0, 10);
      const from    = new Date(`${dateStr}T00:00:00.000+06:30`);
      const to      = new Date(`${toStr}T23:59:59.999+06:30`);
      const dailyCloseReport = await buildDailyCloseReport(req.auth.shopId, from, to, req.query.closePeriod || 'daily');
      return res.json({ ok: true, date: dateStr, dailyCloseReport });
    } catch (err) {
      res.status(err.status || 500).json({ ok: false, message: err.message || 'Business pull failed' });
    }
  });
}

module.exports = attachGoogleSheetPullReportApi;
