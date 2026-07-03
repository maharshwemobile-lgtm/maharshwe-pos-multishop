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

function excelCell(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function TrendBadge({ value }) {
  const positive = Number(value || 0) >= 0;
  return <span className={`report-trend-badge ${positive ? 'up' : 'down'}`}>
    {positive ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
    {Math.abs(Number(value || 0)).toLocaleString()}%
  </span>;
}

export default function ReportsWorkspace({ onNavigate }) {
  const defaults = defaultDates();
  const [fromDate, setFromDate] = useState(defaults.from);
  const [toDate, setToDate] = useState(defaults.to);
  const [closePeriod, setClosePeriod] = useState('daily');
  const [closePage, setClosePage] = useState(1);
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
      const params = new URLSearchParams({ from: fromDate, to: toDate, closePeriod });
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
  }, [fromDate, toDate, closePeriod]);

  const summary = data?.summary || {};
  const miniMart = data?.miniMart || {};
  const dailyCloseReport = data?.dailyCloseReport || { rows: [], totals: {} };
  const topProductRows = useMemo(() => (data?.topProducts || []).slice(0, 10), [data?.topProducts]);
  const closeRows = dailyCloseReport.rows || [];
  const closeTotalPages = Math.max(1, Math.ceil(closeRows.length / 10));
  const closeVisibleRows = closeRows.slice((closePage - 1) * 10, closePage * 10);
  const closePeriodMeta = closePeriod === 'monthly'
    ? { name: 'Monthly', bucket: 'Month', title: 'Monthly Close စာရင်းချုပ်', range: 'Month range preview' }
    : closePeriod === 'yearly'
      ? { name: 'Yearly', bucket: 'Year', title: 'Yearly Close စာရင်းချုပ်', range: 'Year range preview' }
      : { name: 'Daily', bucket: 'Day', title: 'Daily Close စာရင်းချုပ်', range: 'Daily transaction preview' };
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
  const maxProductRevenue = Math.max(1, ...topProductRows.map((row) => Number(row.revenue || 0)));

  useEffect(() => {
    setClosePage(1);
  }, [closePeriod, closeRows.length]);

  const setCloseToday = () => {
    const today = day(new Date());
    setFromDate(today);
    setToDate(today);
  };

  const exportDailyCloseExcel = () => {
    if (!dailyCloseReport.rows?.length) return;
    const rows = [
      ['Metric', 'Value'],
      ['Period Type', closePeriodMeta.name],
      ['From', dailyCloseReport.from || fromDate],
      ['To', dailyCloseReport.to || toDate],
      ['Income Total', dailyCloseReport.totals?.incomeTotal || 0],
      ['Expense Total', dailyCloseReport.totals?.expenseTotal || 0],
      ['Net Profit', dailyCloseReport.totals?.netProfit || 0],
      [],
      [`${closePeriodMeta.name} Transactions`, dailyCloseReport.period || closePeriod],
      [closePeriodMeta.bucket, 'Sale POS Income', 'Service POS Income', 'Money Service Fee', 'Other Sale Income', 'Other Service Income', 'Other Top-up Income', 'Income Total', 'Sale POS Cost', 'Service POS Cost', 'Other Sale Expense', 'Other Service Expense', 'Other Top-up Expense', 'Expense Total', 'Net Profit', 'Closed Days'],
      ...(dailyCloseReport.rows || []).map((row) => [
        row.bucket,
        row.salePosIncome,
        row.servicePosIncome,
        row.moneyServiceFee,
        row.otherSaleIncome,
        row.otherServiceIncome,
        row.otherTopupIncome,
        row.incomeTotal,
        row.salePosExpense,
        row.servicePosExpense,
        row.otherSaleExpense,
        row.otherServiceExpense,
        row.otherTopupExpense,
        row.expenseTotal,
        row.netProfit,
        row.closedDays,
      ]),
    ];
    const html = `<!doctype html><html><head><meta charset="utf-8"></head><body><table>${rows.map((row) => `<tr>${row.map((cell) => `<td>${excelCell(cell)}</td>`).join('')}</tr>`).join('')}</table></body></html>`;
    const blob = new Blob([html], { type: 'application/vnd.ms-excel;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${closePeriod}-close-transactions-${dailyCloseReport.from || fromDate}-to-${dailyCloseReport.to || toDate}.xls`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return <section className="reports-page">
    {message ? <div className="reports-message">{message}</div> : null}

    <div className="reports-summary-grid">
      {cards.map((card) => <article key={card.label}>
        <div className={`reports-summary-icon reports-tone-${card.tone}`}><card.icon size={23} /></div>
        <span>{card.label}</span>
        <b>{card.value}</b>
        {card.trend !== undefined ? <TrendBadge value={card.trend} /> : <small>{card.note}</small>}
      </article>)}
    </div>

    <section className="reports-card reports-daily-close-card">
      <header>
        <div>
          <b>{closePeriodMeta.title}</b>
          <small>{closePeriodMeta.range} · Sale POS, Service POS, Money Service Fee နှင့် Other Records ဝင်ငွေ/ထွက်ငွေ စုစည်းချက်</small>
        </div>
        <div className="reports-close-period-switch">
          <button type="button" className={closePeriod === 'daily' ? 'active' : ''} onClick={() => setClosePeriod('daily')}>Daily</button>
          <button type="button" className={closePeriod === 'monthly' ? 'active' : ''} onClick={() => setClosePeriod('monthly')}>Monthly</button>
          <button type="button" className={closePeriod === 'yearly' ? 'active' : ''} onClick={() => setClosePeriod('yearly')}>Yearly</button>
          <button type="button" className="export" onClick={exportDailyCloseExcel} disabled={!dailyCloseReport.rows?.length}><Download size={16} /> Export to Excel</button>
        </div>
      </header>
      <div className="reports-close-filter-row">
        <button type="button" onClick={setCloseToday}>Today</button>
        <label><CalendarDays size={16} /><span>From</span><input type="date" value={fromDate} max={toDate} onChange={(event) => setFromDate(event.target.value || defaults.from)} /></label>
        <label><CalendarDays size={16} /><span>To</span><input type="date" value={toDate} min={fromDate} onChange={(event) => setToDate(event.target.value || defaults.to)} /></label>
        <small>{closePeriodMeta.name}: {fromDate} → {toDate}</small>
      </div>
      <div className="reports-close-total-grid">
        <article><span>{closePeriodMeta.name} Income Total</span><b className="positive">{money(dailyCloseReport.totals?.incomeTotal)}</b></article>
        <article><span>{closePeriodMeta.name} Expense Total</span><b className="negative">{money(dailyCloseReport.totals?.expenseTotal)}</b></article>
        <article><span>{closePeriodMeta.name} Net Profit</span><b className={Number(dailyCloseReport.totals?.netProfit || 0) >= 0 ? 'positive' : 'negative'}>{money(dailyCloseReport.totals?.netProfit)}</b></article>
        <article><span>{closePeriod === 'daily' ? 'Closed Days' : closePeriodMeta.name === 'Monthly' ? 'Closed Months' : 'Closed Years'}</span><b>{Number(dailyCloseReport.totals?.closedDays || 0).toLocaleString()}</b></article>
      </div>
      <div className="reports-table-wrap reports-wide-table-wrap">
        <table className="reports-table reports-close-table">
          <thead>
            <tr>
              <th rowSpan="2">{closePeriodMeta.bucket}</th>
              <th colSpan="7">INCOME များ</th>
              <th colSpan="6">Expense များ</th>
              <th rowSpan="2">Net Profit</th>
              <th rowSpan="2">Closed</th>
            </tr>
            <tr>
              <th>Sale POS</th>
              <th>Service POS</th>
              <th>Money Service Fee</th>
              <th>Other Sale ဝင်ငွေ</th>
              <th>Other Service ဝင်ငွေ</th>
              <th>Other ငွေဖြည့်ကဒ် ဝင်ငွေ</th>
              <th>Total</th>
              <th>Sale POS Cost</th>
              <th>Service POS Cost</th>
              <th>Other Sale အထွက်</th>
              <th>Other Service အထွက်</th>
              <th>Other ငွေဖြည့်ကဒ် အထွက်</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {closeVisibleRows.map((row) => (
              <tr key={row.bucket}>
                <td><b>{row.bucket}</b><small>{row.saleCount || 0} sales</small></td>
                <td>{money(row.salePosIncome)}</td>
                <td>{money(row.servicePosIncome)}</td>
                <td>{money(row.moneyServiceFee)}</td>
                <td>{money(row.otherSaleIncome)}</td>
                <td>{money(row.otherServiceIncome)}</td>
                <td>{money(row.otherTopupIncome)}</td>
                <td><strong className="positive">{money(row.incomeTotal)}</strong></td>
                <td>{money(row.salePosExpense)}</td>
                <td>{money(row.servicePosExpense)}</td>
                <td>{money(row.otherSaleExpense)}</td>
                <td>{money(row.otherServiceExpense)}</td>
                <td>{money(row.otherTopupExpense)}</td>
                <td><strong className="negative">{money(row.expenseTotal)}</strong></td>
                <td><strong className={Number(row.netProfit || 0) >= 0 ? 'positive' : 'negative'}>{money(row.netProfit)}</strong></td>
                <td>{Number(row.closedDays || 0) > 0 ? <CheckCircle2 size={17} /> : '-'}</td>
              </tr>
            ))}
            {!dailyCloseReport.rows?.length ? <tr><td colSpan="16"><div className="reports-empty">No Daily Close summary data in this date range.</div></td></tr> : null}
          </tbody>
        </table>
      </div>
      <div className="reports-close-pagination">
        <span>Showing {closeVisibleRows.length} of {closeRows.length} · 10 item per page</span>
        <div>
          <button type="button" disabled={closePage <= 1} onClick={() => setClosePage((value) => Math.max(1, value - 1))}>Previous</button>
          <b>Page {closePage} / {closeTotalPages}</b>
          <button type="button" disabled={closePage >= closeTotalPages} onClick={() => setClosePage((value) => Math.min(closeTotalPages, value + 1))}>Next</button>
        </div>
      </div>
    </section>

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
        <header><div><b>Top Products</b><small>ရောင်းအားကောင်းဆုံး 10 ခု</small></div><PackageSearch size={21} /></header>
        <div className="reports-table-wrap"><table className="reports-table"><thead><tr><th>Product</th><th>Qty</th><th>Revenue</th><th>Profit</th></tr></thead><tbody>
          {topProductRows.map((row) => <tr key={`${row.name}-${row.variant}`}><td><b>{row.name}</b><small>{row.variant || row.category}</small><div className="reports-product-bar"><i style={{ width: `${row.revenue / maxProductRevenue * 100}%` }} /></div></td><td>{row.quantity}</td><td>{money(row.revenue)}</td><td className="positive">{money(row.profit)}</td></tr>)}
          {!topProductRows.length ? <tr><td colSpan="4"><div className="reports-empty">No product sales.</div></td></tr> : null}
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
