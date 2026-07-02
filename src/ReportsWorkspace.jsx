import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  Boxes,
  CalendarDays,
  CheckCircle2,
  CircleDollarSign,
  Download,
  FileSpreadsheet,
  Loader2,
  PackageSearch,
  ReceiptText,
  RefreshCw,
  Smartphone,
  TrendingUp,
  Users,
  WalletCards,
  Wrench,
} from 'lucide-react';
import { apiFetch, clearSession } from './phase2Api';
import './reports-workspace.css';

const money = (value) => `${Number(value || 0).toLocaleString('en-US')} MMK`;
const day = (value) => new Date(value).toISOString().slice(0, 10);

function defaultDates() {
  const to = new Date();
  const from = new Date(to);
  from.setDate(from.getDate() - 29);
  return { from: day(from), to: day(to) };
}

function csvCell(value) {
  return `"${String(value ?? '').replaceAll('"', '""')}"`;
}

function TrendBadge({ value }) {
  const positive = Number(value || 0) >= 0;
  return <span className={`report-trend-badge ${positive ? 'up' : 'down'}`}>
    {positive ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
    {Math.abs(Number(value || 0)).toLocaleString()}%
  </span>;
}

function setPreset(name, setFromDate, setToDate) {
  const now = new Date();
  const from = new Date(now);
  if (name === 'today') from.setHours(0, 0, 0, 0);
  if (name === '7d') from.setDate(from.getDate() - 6);
  if (name === '30d') from.setDate(from.getDate() - 29);
  if (name === 'month') from.setDate(1);
  setFromDate(day(from));
  setToDate(day(now));
}

export default function ReportsWorkspace({ onNavigate }) {
  const defaults = defaultDates();
  const [fromDate, setFromDate] = useState(defaults.from);
  const [toDate, setToDate] = useState(defaults.to);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  const handleError = (error) => {
    if (error?.status === 401) {
      clearSession();
      window.location.reload();
      return;
    }
    setMessage(error?.message || 'Report request failed');
  };

  const load = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ from: fromDate, to: toDate });
      const response = await apiFetch(`/api/reports/business?${params.toString()}`);
      setData(response);
      setMessage('');
    } catch (error) {
      handleError(error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const timer = window.setTimeout(load, 150);
    return () => window.clearTimeout(timer);
  }, [fromDate, toDate]);

  const summary = data?.summary || {};
  const miniMart = data?.miniMart || {};
  const cards = useMemo(() => [
    { label: 'Sales Revenue', value: money(summary.revenue), icon: ReceiptText, tone: 'green', trend: summary.revenueChange },
    { label: 'Sales Profit', value: money(summary.salesProfit), icon: TrendingUp, tone: 'blue', trend: summary.profitChange },
    { label: 'Payments Received', value: money(summary.totalReceived), icon: CircleDollarSign, tone: 'purple', note: `${money(summary.repairReceived)} repairs` },
    { label: 'Customer Receivable', value: money(summary.receivable), icon: WalletCards, tone: 'orange', note: `${summary.owingCustomers || 0} customers` },
    { label: 'Inventory Cost Value', value: money(summary.inventoryCostValue), icon: Boxes, tone: 'cyan', note: `${summary.lowStockCount || 0} low stock` },
    { label: 'Average Ticket', value: money(summary.averageTicket), icon: FileSpreadsheet, tone: 'red', note: `${summary.invoices || 0} invoices` },
  ], [summary]);

  const maxTrend = Math.max(1, ...(data?.trend || []).map((row) => Math.max(row.revenue, row.received)));
  const paymentTotal = (data?.paymentMix || []).reduce((sum, row) => sum + Number(row.amount || 0), 0) || 1;
  const maxProductRevenue = Math.max(1, ...(data?.topProducts || []).map((row) => Number(row.revenue || 0)));

  const exportCsv = () => {
    if (!data) return;
    const rows = [
      ['Mahar POS Business Report'],
      ['From', fromDate, 'To', toDate],
      [],
      ['Metric', 'Value'],
      ['Sales Revenue', summary.revenue],
      ['Sales Profit', summary.salesProfit],
      ['Payments Received', summary.totalReceived],
      ['Repair Received', summary.repairReceived],
      ['Customer Receivable', summary.receivable],
      ['Inventory Cost Value', summary.inventoryCostValue],
      ['Invoices', summary.invoices],
      ['Units Sold', summary.unitsSold],
      [],
      ['Top Products'],
      ['Product', 'Variant', 'Category', 'Quantity', 'Revenue', 'Profit'],
      ...(data.topProducts || []).map((row) => [row.name, row.variant, row.category, row.quantity, row.revenue, row.profit]),
      ...(miniMart.enabled ? [
        [],
        ['Mini Mart Daily Sales'],
        ['Date', 'Invoices', 'Units', 'Revenue', 'Profit'],
        ...(miniMart.dailySales || []).map((row) => [row.date, row.invoices, row.units, row.revenue, row.profit]),
        [],
        ['Mini Mart Expiry Report'],
        ['Product', 'Variant', 'Expiry Date', 'Days Until Expiry', 'Stock', 'Unit'],
        ...(miniMart.expiryReport || []).map((row) => [row.name, row.variant, row.expiryDate, row.daysUntilExpiry, row.quantity, row.unit]),
        [],
        ['Mini Mart Low Stock Report'],
        ['Product', 'Variant', 'Current Stock', 'Alert Qty', 'Unit'],
        ...(miniMart.lowStockReport || []).map((row) => [row.name, row.variant, row.quantity, row.minAlertQuantity, row.unit]),
        [],
        ['Mini Mart Supplier Purchase Report'],
        ['Supplier Code', 'Supplier', 'Receipts', 'Amount'],
        ...(miniMart.supplierPurchaseReport || []).map((row) => [row.supplierCode, row.supplierName, row.receiptCount, row.amount]),
        [],
        ['Mini Mart Profit Report'],
        ['Revenue', miniMart.profitReport?.revenue || 0],
        ['Cost', miniMart.profitReport?.cost || 0],
        ['Profit', miniMart.profitReport?.profit || 0],
        ['Margin %', miniMart.profitReport?.margin || 0],
      ] : []),
      [],
      ['Staff Performance'],
      ['Staff', 'Invoices', 'Units', 'Revenue', 'Profit'],
      ...(data.staff || []).map((row) => [row.name, row.invoices, row.units, row.revenue, row.profit]),
    ];
    const blob = new Blob([rows.map((row) => row.map(csvCell).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `mahar-pos-report-${fromDate}-${toDate}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return <section className="reports-page">
    <div className="reports-page-heading">
      <div>
        <span className="reports-eyebrow">BUSINESS INTELLIGENCE</span>
        <h2>Reports & Performance</h2>
        <p>Sales၊ profit၊ payments၊ customer credit၊ repair နဲ့ inventory health ကို ဆက်စပ်ပြီး ဆုံးဖြတ်ချက်ချနိုင်အောင် တစ်နေရာထဲကြည့်ပါ။</p>
      </div>
      <div className="reports-heading-actions">
        <button type="button" onClick={load} disabled={loading}><RefreshCw size={18} /> Refresh</button>
        <button type="button" className="primary" onClick={exportCsv} disabled={!data}><Download size={18} /> Export CSV</button>
      </div>
    </div>

    <div className="reports-period-bar">
      <div className="reports-preset-buttons">
        <button type="button" onClick={() => setPreset('today', setFromDate, setToDate)}>Today</button>
        <button type="button" onClick={() => setPreset('7d', setFromDate, setToDate)}>7 Days</button>
        <button type="button" onClick={() => setPreset('30d', setFromDate, setToDate)}>30 Days</button>
        <button type="button" onClick={() => setPreset('month', setFromDate, setToDate)}>This Month</button>
      </div>
      <label><CalendarDays size={17} /><input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} /></label>
      <span>to</span>
      <label><CalendarDays size={17} /><input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} /></label>
      {data?.period ? <small>{data.period.days} days compared with previous period</small> : null}
    </div>

    {message ? <div className="reports-message">{message}</div> : null}

    <div className="reports-summary-grid">
      {cards.map((card) => <article key={card.label}>
        <div className={`reports-summary-icon reports-tone-${card.tone}`}><card.icon size={23} /></div>
        <span>{card.label}</span>
        <b>{card.value}</b>
        {card.trend !== undefined ? <TrendBadge value={card.trend} /> : <small>{card.note}</small>}
      </article>)}
    </div>

    <div className="reports-main-grid">
      <section className="reports-card reports-trend-card">
        <header><div><b>Revenue & Cashflow Trend</b><small>Daily revenue, profit and payments received</small></div><BarChart3 size={21} /></header>
        <div className="reports-chart-legend"><span className="revenue">Revenue</span><span className="received">Received</span><span className="profit">Profit</span></div>
        <div className="reports-trend-chart">
          {(data?.trend || []).map((row) => <div className="reports-day-column" key={row.date} title={`${row.date}\nRevenue ${money(row.revenue)}\nReceived ${money(row.received)}\nProfit ${money(row.profit)}`}>
            <div className="reports-bars">
              <i className="revenue" style={{ height: `${Math.max(2, row.revenue / maxTrend * 100)}%` }} />
              <i className="received" style={{ height: `${Math.max(2, row.received / maxTrend * 100)}%` }} />
              <i className="profit" style={{ height: `${Math.max(2, row.profit / maxTrend * 100)}%` }} />
            </div>
            <small>{row.date.slice(5)}</small>
          </div>)}
          {!data?.trend?.length ? <div className="reports-empty">No trend data.</div> : null}
        </div>
      </section>

      <section className="reports-card reports-payment-card">
        <header><div><b>Payment Mix</b><small>Sale and repair payments</small></div><Smartphone size={21} /></header>
        <div className="reports-payment-list">
          {(data?.paymentMix || []).map((row) => <div key={row.method}>
            <span><b>{row.method.replaceAll('_', ' ')}</b><small>{money(row.amount)}</small></span>
            <div><i style={{ width: `${row.amount / paymentTotal * 100}%` }} /></div>
            <em>{Math.round(row.amount / paymentTotal * 100)}%</em>
          </div>)}
          {!data?.paymentMix?.length ? <div className="reports-empty">No payments in this period.</div> : null}
        </div>
      </section>
    </div>

    <div className="reports-secondary-grid">
      <section className="reports-card">
        <header><div><b>Top Products</b><small>Ranked by revenue</small></div><PackageSearch size={21} /></header>
        <div className="reports-table-wrap"><table className="reports-table"><thead><tr><th>Product</th><th>Qty</th><th>Revenue</th><th>Profit</th></tr></thead><tbody>
          {(data?.topProducts || []).map((row) => <tr key={`${row.name}-${row.variant}`}><td><b>{row.name}</b><small>{row.variant || row.category}</small><div className="reports-product-bar"><i style={{ width: `${row.revenue / maxProductRevenue * 100}%` }} /></div></td><td>{row.quantity}</td><td>{money(row.revenue)}</td><td className="positive">{money(row.profit)}</td></tr>)}
          {!data?.topProducts?.length ? <tr><td colSpan="4"><div className="reports-empty">No product sales.</div></td></tr> : null}
        </tbody></table></div>
      </section>

      <section className="reports-card">
        <header><div><b>Staff Performance</b><small>Sales ownership and profit</small></div><Users size={21} /></header>
        <div className="reports-table-wrap"><table className="reports-table"><thead><tr><th>Staff</th><th>Invoices</th><th>Units</th><th>Revenue</th><th>Profit</th></tr></thead><tbody>
          {(data?.staff || []).map((row) => <tr key={row.id}><td><b>{row.name}</b></td><td>{row.invoices}</td><td>{row.units}</td><td>{money(row.revenue)}</td><td className="positive">{money(row.profit)}</td></tr>)}
          {!data?.staff?.length ? <tr><td colSpan="5"><div className="reports-empty">No staff performance data.</div></td></tr> : null}
        </tbody></table></div>
      </section>
    </div>

    {miniMart.enabled ? <section className="reports-card">
      <header><div><b>Mini Mart Reports</b><small>Daily sales, expiry, low stock, supplier purchase and profit</small></div><Boxes size={21} /></header>
      <div className="reports-snapshot-grid">
        <div><h3>Profit Report</h3><p><span>Revenue</span><b>{money(miniMart.profitReport?.revenue)}</b></p><p><span>Cost</span><b>{money(miniMart.profitReport?.cost)}</b></p><p><span>Profit</span><b>{money(miniMart.profitReport?.profit)}</b></p><p><span>Margin</span><b>{Number(miniMart.profitReport?.margin || 0).toFixed(1)}%</b></p></div>
        <div><h3>Expiry Report</h3><p><span>Expired</span><b>{miniMart.expirySummary?.expired || 0}</b></p><p><span>Near Expiry</span><b>{miniMart.expirySummary?.nearExpiry || 0}</b></p><p><span>Tracked Items</span><b>{miniMart.expirySummary?.tracked || 0}</b></p></div>
        <div><h3>Supplier Purchase</h3><p><span>Suppliers</span><b>{miniMart.supplierPurchaseReport?.length || 0}</b></p><p><span>Total Purchased</span><b>{money((miniMart.supplierPurchaseReport || []).reduce((sum, row) => sum + Number(row.amount || 0), 0))}</b></p><p><span>Low Stock</span><b>{miniMart.lowStockReport?.length || 0}</b></p></div>
      </div>

      <div className="reports-secondary-grid" style={{ padding: '0 16px 16px' }}>
        <section className="reports-card">
          <header><div><b>Daily Sales</b><small>Latest sale days</small></div><ReceiptText size={21} /></header>
          <div className="reports-table-wrap"><table className="reports-table"><thead><tr><th>Date</th><th>Invoices</th><th>Units</th><th>Revenue</th><th>Profit</th></tr></thead><tbody>
            {(miniMart.dailySales || []).map((row) => <tr key={row.date}><td>{row.date}</td><td>{row.invoices}</td><td>{row.units}</td><td>{money(row.revenue)}</td><td className="positive">{money(row.profit)}</td></tr>)}
            {!miniMart.dailySales?.length ? <tr><td colSpan="5"><div className="reports-empty">No daily sales.</div></td></tr> : null}
          </tbody></table></div>
        </section>

        <section className="reports-card">
          <header><div><b>Expiry Report</b><small>Nearest expiry first</small></div><CalendarDays size={21} /></header>
          <div className="reports-table-wrap"><table className="reports-table"><thead><tr><th>Product</th><th>Expiry</th><th>Stock</th><th>Unit</th></tr></thead><tbody>
            {(miniMart.expiryReport || []).map((row) => <tr key={row.id}><td><b>{row.name}</b><small>{row.variant}</small></td><td>{row.expiryDate || '-'}<small>{row.daysUntilExpiry < 0 ? 'Expired' : `${row.daysUntilExpiry} day(s)`}</small></td><td>{row.quantity}</td><td>{row.unit || '-'}</td></tr>)}
            {!miniMart.expiryReport?.length ? <tr><td colSpan="4"><div className="reports-empty">No expiry tracked items.</div></td></tr> : null}
          </tbody></table></div>
        </section>

        <section className="reports-card">
          <header><div><b>Low Stock Report</b><small>Stock reached alert quantity</small></div><PackageSearch size={21} /></header>
          <div className="reports-table-wrap"><table className="reports-table"><thead><tr><th>Product</th><th>Current</th><th>Alert</th><th>Unit</th></tr></thead><tbody>
            {(miniMart.lowStockReport || []).map((row) => <tr key={row.id}><td><b>{row.name}</b><small>{row.variant}</small></td><td>{row.quantity}</td><td>{row.minAlertQuantity}</td><td>{row.unit || '-'}</td></tr>)}
            {!miniMart.lowStockReport?.length ? <tr><td colSpan="4"><div className="reports-empty">No low stock items.</div></td></tr> : null}
          </tbody></table></div>
        </section>

        <section className="reports-card">
          <header><div><b>Supplier Purchase Report</b><small>Goods received by supplier</small></div><Users size={21} /></header>
          <div className="reports-table-wrap"><table className="reports-table"><thead><tr><th>Supplier</th><th>Receipts</th><th>Amount</th></tr></thead><tbody>
            {(miniMart.supplierPurchaseReport || []).map((row) => <tr key={row.supplierId}><td><b>{row.supplierName}</b><small>{row.supplierCode || '-'}</small></td><td>{row.receiptCount}</td><td>{money(row.amount)}</td></tr>)}
            {!miniMart.supplierPurchaseReport?.length ? <tr><td colSpan="3"><div className="reports-empty">No supplier purchases.</div></td></tr> : null}
          </tbody></table></div>
        </section>
      </div>
    </section> : null}

    <div className="reports-operations-grid">
      <article><div className="reports-tone-cyan"><Boxes size={22} /></div><span><b>Inventory Health</b><small>{summary.lowStockCount || 0} low stock · {summary.outOfStockCount || 0} out of stock</small></span><button type="button" onClick={() => onNavigate?.('Stock')}>Open Stock</button></article>
      <article><div className="reports-tone-orange"><WalletCards size={22} /></div><span><b>Customer Credit</b><small>{money(summary.receivable)} · {summary.owingCustomers || 0} owing</small></span><button type="button" onClick={() => onNavigate?.('Customers')}>Open Credit</button></article>
      <article><div className="reports-tone-blue"><Wrench size={22} /></div><span><b>Repair Operations</b><small>{summary.completedRepairs || 0}/{summary.repairs || 0} completed</small></span><button type="button" onClick={() => onNavigate?.('Repairs')}>Open Repairs</button></article>
      <article><div className="reports-tone-purple"><CircleDollarSign size={22} /></div><span><b>Payments</b><small>{money(summary.totalReceived)} received</small></span><button type="button" onClick={() => onNavigate?.('Accounting')}>Open Accounts</button></article>
    </div>

    <section className="reports-card reports-snapshot-card">
      <header><div><b>Operational Snapshot</b><small>Accounts, repair status and business exceptions</small></div><CheckCircle2 size={21} /></header>
      <div className="reports-snapshot-grid">
        <div><h3>Account Balances</h3>{(data?.accounts || []).map((row) => <p key={row.id}><span>{row.name}</span><b>{money(row.balance)}</b></p>)}</div>
        <div><h3>Repair Status</h3>{(data?.repairStatuses || []).map((row) => <p key={row.status}><span>{row.status.replaceAll('_', ' ')}</span><b>{row.count}</b></p>)}</div>
        <div><h3>Exceptions</h3><p><span>Voided Sales</span><b>{summary.voidedSales || 0}</b></p><p><span>Returned Sales</span><b>{summary.returnedSales || 0}</b></p><p><span>Discount Given</span><b>{money(summary.discount)}</b></p></div>
      </div>
    </section>

    {loading ? <div className="reports-loading"><Loader2 className="reports-spin" /> Building report…</div> : null}
  </section>;
}
