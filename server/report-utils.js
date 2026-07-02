const ACTIVE_SALE_STATUSES = ['COMPLETED', 'PARTIAL_RETURN'];
const PAYMENT_METHODS = ['CASH', 'KPAY', 'WAVE_PAY', 'MIXED', 'OTHER'];

const number = (value) => Number(value || 0);
const round = (value) => Math.round((number(value) + Number.EPSILON) * 100) / 100;

function startOfDay(value) {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function endOfDay(value) {
  if (!value) return null;
  const date = new Date(`${value}T23:59:59.999Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function resolvePeriod(query = {}) {
  const now = new Date();
  const fallbackTo = new Date(now);
  fallbackTo.setUTCHours(23, 59, 59, 999);
  const fallbackFrom = new Date(fallbackTo);
  fallbackFrom.setUTCDate(fallbackFrom.getUTCDate() - 29);
  fallbackFrom.setUTCHours(0, 0, 0, 0);
  const from = startOfDay(query.from) || fallbackFrom;
  const to = endOfDay(query.to) || fallbackTo;
  if (from > to) throw Object.assign(new Error('From date must be before To date'), { status: 400 });
  const days = Math.max(1, Math.ceil((to.getTime() - from.getTime() + 1) / 86400000));
  if (days > 366) throw Object.assign(new Error('Report range cannot exceed 366 days'), { status: 400 });
  const previousTo = new Date(from.getTime() - 1);
  const previousFrom = new Date(previousTo);
  previousFrom.setUTCDate(previousFrom.getUTCDate() - days + 1);
  previousFrom.setUTCHours(0, 0, 0, 0);
  return { from, to, days, previousFrom, previousTo };
}

function pctChange(current, previous) {
  const now = number(current);
  const before = number(previous);
  if (before === 0) return now === 0 ? 0 : 100;
  return round(((now - before) / Math.abs(before)) * 100);
}

function isoDay(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
}

function dateSeries(from, to) {
  const rows = [];
  const cursor = new Date(from);
  cursor.setUTCHours(0, 0, 0, 0);
  const end = new Date(to);
  end.setUTCHours(0, 0, 0, 0);
  while (cursor <= end) {
    rows.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return rows;
}

module.exports = {
  ACTIVE_SALE_STATUSES,
  PAYMENT_METHODS,
  number,
  round,
  resolvePeriod,
  pctChange,
  isoDay,
  dateSeries,
};
