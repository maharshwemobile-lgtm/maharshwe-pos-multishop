import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Banknote,
  BarChart3,
  CalendarDays,
  CheckCircle2,
  CircleDollarSign,
  Clock3,
  CreditCard,
  Loader2,
  PackageSearch,
  PlusCircle,
  ReceiptText,
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

function MetricCard({ icon: Icon, label, value, detail, tone = 'green' }) {
  return (
    <article className={`bc-metric bc-tone-${tone}`}>
      <div className="bc-metric-icon"><Icon size={23} /></div>
      <div className="bc-metric-copy">
        <span>{label}</span>
        <strong>{money(value)}</strong>
        <small>{detail}</small>
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

export default function DashboardBusinessV2({ onNavigate }) {
  const session = getSession();
  const role = session?.user?.role || '';
  const permissions = session?.user?.permissions || {};
  const canWriteAccounting = role === 'SUPER_ADMIN' || role === 'SHOP_ADMIN' || permissions.accounting === true;
  const canClose = role === 'SUPER_ADMIN' || role === 'SHOP_ADMIN';
  const today = yangonToday();

  const [businessDate, setBusinessDate] = useState(today);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [closingNote, setClosingNote] = useState('');
  const [closing, setClosing] = useState(false);
  const [savingExpense, setSavingExpense] = useState(false);
  const [savingIncome, setSavingIncome] = useState(false);
  const [expense, setExpense] = useState({ category: '', amount: '', method: 'CASH', moneyAccountId: '', note: '' });
  const [income, setIncome] = useState({ source: '', amount: '', method: 'CASH', moneyAccountId: '', note: '' });

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

  const metrics = [
    { icon: Wallet, label: 'Today's Total Income', value: dashboard.todayTotalIncome, detail: 'Sales + Repair + Service + Other Income', tone: 'green' },
    { icon: ShoppingCart, label: 'Product Sales Income', value: dashboard.todaySaleIncome, detail: `${Number(dashboard.todayOrders || 0)} sale orders`, tone: 'blue' },
    { icon: TrendingUp, label: 'Product Sales Profit', value: dashboard.productProfit, detail: 'Product gross profit', tone: 'green' },
    { icon: Wrench, label: 'Repair Income', value: dashboard.repairIncome, detail: `${Number(dashboard.repairPayments || 0)} repair payments`, tone: 'gold' },
    { icon: PlusCircle, label: 'Other Income', value: dashboard.otherIncome, detail: `${Number(dashboard.otherIncomeCount || 0)} income records`, tone: 'blue' },
    { icon: CircleDollarSign, label: 'Today's Total Profit', value: dashboard.todayProfit, detail: 'Sales + Repair + Service + Other − Expense', tone: 'violet' },
    { icon: CreditCard, label: 'Today's Expense', value: dashboard.todayExpense, detail: `${Number(dashboard.expenseCount || 0)} expense records`, tone: 'red' },
    { icon: Users, label: 'Customer Receivable', value: dashboard.receivable, detail: `${Number(dashboard.receivableCustomers || 0)} customers owe`, tone: 'orange' },
    { icon: Truck, label: 'Supplier Payable', value: dashboard.payable, detail: `Paid today ${money(dashboard.supplierPaidToday)}`, tone: 'red' },
  ];

  const submitExpense = async (event) => {
    event.preventDefault();
    setNotice('');
    setError('');
    setSavingExpense(true);
    try {
      const response = await apiFetch('/api/business-control/expenses', {
        method: 'POST',
        body: {
          expenseDate: businessDate,
          category: expense.category,
          amount: Number(expense.amount),
          method: expense.method,
          moneyAccountId: expense.moneyAccountId || null,
          note: expense.note,
        },
      });
      setData(response);
      setExpense({ category: '', amount: '', method: 'CASH', moneyAccountId: '', note: '' });
      setNotice('Expense saved and account balance updated.');
    } catch (requestError) {
      setError(requestError?.message || 'Expense save failed');
    } finally {
      setSavingExpense(false);
    }
  };

  const submitIncome = async (event) => {
    event.preventDefault();
    setNotice('');
    setError('');
    setSavingIncome(true);
    try {
      const response = await apiFetch('/api/business-control/other-income', {
        method: 'POST',
        body: {
          incomeDate: businessDate,
          source: income.source,
          amount: Number(income.amount),
          method: income.method,
          moneyAccountId: income.moneyAccountId || null,
          note: income.note,
        },
      });
      setData(response);
      setIncome({ source: '', amount: '', method: 'CASH', moneyAccountId: '', note: '' });
      setNotice('Other Income saved and account balance updated.');
    } catch (requestError) {
      setError(requestError?.message || 'Other Income save failed');
    } finally {
      setSavingIncome(false);
    }
  };

  const closeBusinessDay = async () => {
    if (!window.confirm(`Are you sure you want to close business day ${businessDate}?`)) return;
    setClosing(true);
    setNotice('');
    setError('');
    try {
      const response = await apiFetch('/api/business-control/daily-closing', {
        method: 'POST',
        body: { businessDate, note: closingNote },
      });
      setData(response);
      setClosingNote('');
      setNotice(response.message || 'Business day closed successfully.');
    } catch (requestError) {
      setError(requestError?.message || 'Daily closing failed');
    } finally {
      setClosing(false);
    }
  };

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
        <div className={`bc-day-state ${data?.closing ? 'closed' : 'open'}`}>
          {data?.closing ? <CheckCircle2 size={18} /> : <Clock3 size={18} />}
          <div><b>{data?.closing ? 'Day Closed' : ''}</b><small>{data?.closing ? `Closed by ${data.closing.closedByName || 'Admin'}` : ''}</small></div>
        </div>
      </section>

      {error ? <div className="bc-alert error"><AlertTriangle size={18} />{error}</div> : null}
      {notice ? <div className="bc-alert success"><CheckCircle2 size={18} />{notice}</div> : null}
      {loading && !data ? <section className="bc-loading"><Loader2 className="bc-spin" size={30} /><b>Business Control data loading…</b></section> : null}

      {data ? <>
        <section className="bc-metrics">{metrics.map((item) => <MetricCard key={item.label} {...item} />)}</section>

        <section className="bc-account-grid">
          <AccountCard icon={Banknote} label="Cash Balance" value={accountBalances.CASH} />
          <AccountCard icon={Wallet} label="KBZPay Balance" value={accountBalances.KPAY} />
          <AccountCard icon={CreditCard} label="WavePay Balance" value={accountBalances.WAVE_PAY} />
          <AccountCard icon={CircleDollarSign} label="All Accounts" value={accountBalances.TOTAL} />
        </section>

        <section className="bc-main-grid">
          <article className="bc-panel bc-trend-panel">
            <header><div><span>7-DAY TREND</span><h3>Sales Performance</h3></div><BarChart3 size={23} /></header>
            <div className="bc-chart">
              {trend.map((item) => {
                const height = item.sales > 0 ? Math.max(8, Math.round((Number(item.sales) / maxTrend) * 100)) : 4;
                return <div className="bc-bar-column" key={item.day} title={`${item.day}: ${money(item.sales)}`}><b>{item.orders}</b><div><i style={{ height: `${height}%` }} /></div><span>{item.day.slice(5)}</span></div>;
              })}
            </div>
            <div className="bc-trend-summary">
              <span>Repair Profit <b>{money(dashboard.repairProfit)}</b></span>
              <span>Money Service Profit <b>{money(dashboard.moneyServiceProfit)}</b></span>
              <span>Other Income <b>{money(dashboard.otherIncome)}</b></span>
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

        <section className="bc-secondary-grid bc-secondary-grid-three">
          <article className="bc-panel bc-closing-panel">
            <header><div><span>DAILY CLOSING</span><h3>{data.closing ? 'Closed Business Day' : 'Close Business Day'}</h3></div><ReceiptText size={23} /></header>
            <div className="bc-closing-summary">
              <span>Sales Total <b>{money(dashboard.todaySaleIncome)}</b></span>
              <span>Repair Revenue <b>{money(dashboard.repairRevenue)}</b></span>
              <span>Other Income <b>{money(dashboard.otherIncome)}</b></span>
              <span>Expenses <b>{money(dashboard.todayExpense)}</b></span>
              <span>Total Profit / Loss <b className={Number(dashboard.todayProfit || 0) < 0 ? 'bc-loss-value' : ''}>{money(dashboard.todayProfit)}</b></span>
            </div>
            {data.closing ? <div className="bc-closed-box"><CheckCircle2 size={28} /><div><b>{data.closing.businessDate} Closed</b><span>{data.closing.closedAt ? new Date(data.closing.closedAt).toLocaleString() : ''}</span><p>{data.closing.note || 'No closing note.'}</p></div></div> : <>
              <textarea value={closingNote} onChange={(event) => setClosingNote(event.target.value)} placeholder="Daily closing note (optional)" maxLength={500} />
              <button className="bc-close-button" type="button" onClick={closeBusinessDay} disabled={!canClose || closing}>{closing ? <Loader2 className="bc-spin" size={18} /> : <CheckCircle2 size={18} />} {canClose ? 'Close This Business Day' : 'Shop Admin Only'}</button>
              <small className="bc-helper">Profit/Loss can be negative. Closing stores one locked PostgreSQL snapshot.</small>
            </>}
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
