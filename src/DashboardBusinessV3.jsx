import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Banknote,
  BarChart3,
  CalendarDays,
  CheckCircle2,
  CircleDollarSign,
  CreditCard,
  Loader2,
  PackageSearch,
  PlusCircle,
  RefreshCw,
  ShoppingCart,
  TrendingUp,
  Truck,
  Users,
  Wallet,
  Wrench,
} from 'lucide-react';
import { apiFetch, getSession } from './phase2Api';
import './business-control-dashboard.css';
import './business-control-income.css';

const money = (value) => `${Number(value || 0).toLocaleString('en-US')} MMK`;
const compactMoney = (value) => new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
}).format(Number(value || 0));

function yangonToday() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Yangon',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function dateLabel(value) {
  if (!value) return '-';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Yangon',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(`${value}T00:00:00+06:30`));
}

function MetricCard({ icon: Icon, label, value, detail, tone = 'green', breakdown = [] }) {
  return (
    <article className={`bc-metric bc-tone-${tone}`}>
      <div className="bc-metric-icon"><Icon size={23} /></div>
      <div className="bc-metric-copy">
        <span>{label}</span>
        <strong>{money(value)}</strong>
        <small>{detail}</small>
        {breakdown?.length ? (
          <div className="bc-metric-breakdown">
            {breakdown.map((row) => (
              <em key={`${row.label}-${row.amount}`}>
                <span>{row.label}</span>
                <b>{money(row.amount)}</b>
              </em>
            ))}
          </div>
        ) : null}
      </div>
    </article>
  );
}

function AccountCard({ label, value, icon: Icon }) {
  return (
    <article className="bc-account-card">
      <Icon size={19} />
      <div><span>{label}</span><b>{money(value)}</b></div>
    </article>
  );
}

export default function DashboardBusinessV3({ onNavigate }) {
  const today = yangonToday();

  const [businessDate, setBusinessDate] = useState(today);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [closingNote, setClosingNote] = useState('');
  // Cash the owner is already holding, what the cashier spent, and what the
  // cashier still owes back. Recorded with the close, never added to totals.
  const [cash, setCash] = useState({ ownerCashIn: '', cashierCashOut: '', cashReturnToOwner: '' });
  const [closing, setClosing] = useState(false);
  const [notice, setNotice] = useState('');
  const role = getSession()?.user?.role || '';
  const canClose = role === 'SUPER_ADMIN' || role === 'SHOP_ADMIN';

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    setError('');
    try {
      const response = await apiFetch(`/api/business-control/overview?date=${encodeURIComponent(businessDate)}`);
      setData(response);
    } catch (requestError) {
      setError(requestError?.message || 'Business Control dashboard failed to load');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [businessDate]);

  const closeBusinessDay = async () => {
    if (!window.confirm(`Close business day ${businessDate}?`)) return;
    setClosing(true); setNotice(''); setError('');
    try {
      const response = await apiFetch('/api/business-control/daily-closing', {
        method: 'POST',
        body: {
          businessDate,
          note: closingNote,
          ownerCashIn: Number(cash.ownerCashIn || 0),
          cashierCashOut: Number(cash.cashierCashOut || 0),
          cashReturnToOwner: Number(cash.cashReturnToOwner || 0),
        },
      });
      setData(response);
      setClosingNote('');
      setCash({ ownerCashIn: '', cashierCashOut: '', cashReturnToOwner: '' });
      setNotice(response.message || 'Business day closed.');
    } catch (requestError) {
      setError(requestError?.message || 'Daily closing failed');
    } finally { setClosing(false); }
  };

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (businessDate !== today) return undefined;
    const timer = window.setInterval(() => load({ silent: true }), 30000);
    return () => window.clearInterval(timer);
  }, [businessDate, load, today]);

  const dashboard = data?.dashboard || {};
  const accountBalances = data?.accountBalances || {};
  const trend = data?.trend || [];
  const maxTrend = useMemo(() => Math.max(1, ...trend.map((item) => Number(item.sales || 0))), [trend]);
  const trendStats = useMemo(() => {
    const salesTotal = trend.reduce((sum, item) => sum + Number(item.sales || 0), 0);
    const ordersTotal = trend.reduce((sum, item) => sum + Number(item.orders || 0), 0);
    const bestDay = trend.reduce((best, item) => Number(item.sales || 0) > Number(best?.sales || 0) ? item : best, null);
    return {
      salesTotal,
      ordersTotal,
      dailyAverage: trend.length ? salesTotal / trend.length : 0,
      bestDay,
    };
  }, [trend]);

  const metrics = [
    { icon: Wallet, label: "Today's Total Income", value: dashboard.todayTotalIncome, detail: `Sales + Repair + Service + Other + TopUp (${money(dashboard.billEloadSoldVolume)})`, tone: 'green' },
    { icon: ShoppingCart, label: 'Product Sales Income', value: dashboard.todaySaleIncome, detail: `${Number(dashboard.todayOrders || 0)} sale orders`, tone: 'blue' },
    { icon: TrendingUp, label: 'Product Sales Profit', value: dashboard.productProfit, detail: 'Product gross profit', tone: 'green' },
    { icon: Wrench, label: 'Repair Income', value: dashboard.repairIncome, detail: `${Number(dashboard.repairPayments || 0)} repair payments + Service Income`, tone: 'gold' },
    { icon: PlusCircle, label: 'Other Income', value: dashboard.otherIncome, detail: `${Number(dashboard.otherIncomeCount || 0)} income records`, tone: 'blue', breakdown: dashboard.otherIncomeBreakdown || [] },
    { icon: CreditCard, label: "Today's Expense", value: dashboard.todayExpense, detail: `${Number(dashboard.expenseCount || 0)} expense records`, tone: 'red', breakdown: dashboard.expenseBreakdown || [] },
    { icon: Users, label: 'Customer Receivable', value: dashboard.receivable, detail: `${Number(dashboard.receivableCustomers || 0)} customers owe`, tone: 'orange' },
    { icon: Truck, label: 'Supplier Payable', value: dashboard.payable, detail: `Paid today ${money(dashboard.supplierPaidToday)}`, tone: 'red' },
  ].filter(Boolean);

  return (
    <div className="business-control-dashboard">
      <section className="bc-control-bar">
        <div className="bc-control-title">
          <span>LIVE POSTGRESQL CONTROL</span>
          <h2>Business Overview</h2>
          <p>{dateLabel(businessDate)} · Asia/Yangon business time</p>
        </div>
        <div className="bc-control-actions">
          <label><CalendarDays size={17} /><input type="date" value={businessDate} max={today} onChange={(event) => setBusinessDate(event.target.value || today)} /></label>
          <button type="button" onClick={() => load()} disabled={loading}>{loading ? <Loader2 className="bc-spin" size={17} /> : <RefreshCw size={17} />} Refresh</button>
        </div>
      </section>

      {error ? <div className="bc-alert error"><AlertTriangle size={18} />{error}</div> : null}
      {loading && !data ? <section className="bc-loading"><Loader2 className="bc-spin" size={30} /><b>Business Control data loading…</b></section> : null}

      {data ? <>
        <section className="bc-metrics">{metrics.map((item) => <MetricCard key={item.label} {...item} />)}</section>

        <section className="bc-close-section">
          <article className="bc-panel">
            <header><div><span>DAY CLOSE</span><h3>{dateLabel(businessDate)}</h3></div><CheckCircle2 size={23} /></header>
            {notice ? <p className="bc-close-notice">{notice}</p> : null}
            {data.closing ? (
              <div className="bc-closed-box">
                <CheckCircle2 size={26} />
                <div>
                  <b>Closed</b>
                  <span>{data.closing.closedAt ? new Date(data.closing.closedAt).toLocaleString() : ''}</span>
                  <p>{data.closing.note || 'No closing note.'}</p>
                </div>
              </div>
            ) : (
              <>
                <div className="bc-cash-summary">
                  <b>Cash Summary</b>
                  <label>Income From Owner<input type="number" min="0" step="1" placeholder="0" value={cash.ownerCashIn} onChange={(event) => setCash((current) => ({ ...current, ownerCashIn: event.target.value }))} /></label>
                  <label>Expense From Casher<input type="number" min="0" step="1" placeholder="0" value={cash.cashierCashOut} onChange={(event) => setCash((current) => ({ ...current, cashierCashOut: event.target.value }))} /></label>
                  <label>ဆိုင်ရှင်ပြန်အပ်ရမည့်ငွေ<input type="number" min="0" step="1" placeholder="0" value={cash.cashReturnToOwner} onChange={(event) => setCash((current) => ({ ...current, cashReturnToOwner: event.target.value }))} /></label>
                </div>
                <textarea value={closingNote} onChange={(event) => setClosingNote(event.target.value)} placeholder="Daily closing note (optional)" maxLength={500} />
                <button className="bc-close-button" type="button" onClick={closeBusinessDay} disabled={!canClose || closing}>
                  {closing ? <Loader2 className="bc-spin" size={18} /> : <CheckCircle2 size={18} />}
                  {canClose ? 'Close This Business Day' : 'Shop Admin Only'}
                </button>
                <small className="bc-helper">Cash Summary is reported separately and never changes the income or expense totals.</small>
              </>
            )}
          </article>
        </section>

        <section className="bc-account-grid">
          <AccountCard icon={Banknote} label="Cash Balance" value={accountBalances.CASH} />
          <AccountCard icon={Wallet} label="KBZPay Balance" value={accountBalances.KPAY} />
          <AccountCard icon={CreditCard} label="WavePay Balance" value={accountBalances.WAVE_PAY} />
          <AccountCard icon={CircleDollarSign} label="All Accounts" value={accountBalances.TOTAL} />
        </section>

        <section className="bc-main-grid">
          <article className="bc-panel bc-trend-panel">
            <header className="bc-trend-heading">
              <div><span>7-DAY TREND</span><h3>Sales Performance</h3><small>Daily revenue and completed sale orders</small></div>
              <div className="bc-trend-total"><span>7-day sales</span><b>{money(trendStats.salesTotal)}</b></div>
            </header>
            <div className="bc-chart-shell">
              <div className="bc-chart-scale" aria-hidden="true"><span>{compactMoney(maxTrend)}</span><span>{compactMoney(maxTrend / 2)}</span><span>0</span></div>
              <div className="bc-chart">
              {trend.map((item) => {
                const height = item.sales > 0 ? Math.max(8, Math.round((Number(item.sales) / maxTrend) * 100)) : 4;
                const isBest = trendStats.bestDay?.day === item.day && Number(item.sales || 0) > 0;
                return <div className={`bc-bar-column ${isBest ? 'is-best' : ''}`} key={item.day} title={`${item.day}\nSales: ${money(item.sales)}\nOrders: ${item.orders}`}>
                  <b>{compactMoney(item.sales)}</b>
                  <div><i style={{ height: `${height}%` }}><em>{item.orders}</em></i></div>
                  <span>{item.day.slice(5)}</span>
                </div>;
              })}
              </div>
            </div>
            <div className="bc-trend-summary">
              <span>Total Orders <b>{trendStats.ordersTotal.toLocaleString('en-US')}</b></span>
              <span>Daily Average <b>{money(trendStats.dailyAverage)}</b></span>
              <span>Best Day <b>{trendStats.bestDay ? `${trendStats.bestDay.day.slice(5)} · ${money(trendStats.bestDay.sales)}` : '-'}</b></span>
            </div>
          </article>

          <article className="bc-panel bc-alert-panel">
            <header><div><span>BUSINESS ALERTS</span><h3>Action Required</h3></div><AlertTriangle size={23} /></header>
            <button type="button" onClick={() => onNavigate('Repairs')} className="bc-action-alert"><Wrench size={21} /><div><b>{Number(dashboard.pendingRepairs || 0)} Pending Repairs</b><span>Received, checking, in progress or waiting part</span></div></button>
            <button type="button" onClick={() => onNavigate('Stock')} className="bc-action-alert"><PackageSearch size={21} /><div><b>{Number(dashboard.lowStockCount || 0)} Low Stock Items</b><span>Stock quantity reached minimum alert level</span></div></button>
            <div className="bc-low-stock-list">
              {(data.lowStock || []).slice(0, 5).map((item) => <div key={item.id}><span>{item.name || item.sku || 'Product'}</span><b className={item.quantity <= 0 ? 'danger' : ''}>{item.quantity}</b></div>)}
              {!data.lowStock?.length ? <p><CheckCircle2 size={17} /> No low-stock warning.</p> : null}
            </div>
          </article>
        </section>





        <section className="bc-quick-links">
          {[
            ['New Sale', ShoppingCart, 'Sale POS'],
            ['Repair Platform', Wrench, 'Repairs'],
            ['Finance', Wallet, 'Accounting'],
            ['Purchasing', Truck, 'Purchases'],
            ['Reports', BarChart3, 'Reports'],
          ].map(([label, Icon, page]) => <button type="button" key={label} onClick={() => onNavigate(page)}><Icon size={21} /><span><b>{label}</b><small>Open workspace</small></span></button>)}
        </section>
      </> : null}
    </div>
  );
}
