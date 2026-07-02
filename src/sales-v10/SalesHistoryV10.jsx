import React, { useEffect, useMemo, useState } from 'react';
import {
  Ban,
  BarChart3,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Download,
  FileText,
  History,
  Loader2,
  Printer,
  ReceiptText,
  RefreshCw,
  Search,
  TrendingUp,
  Wallet,
  X,
} from 'lucide-react';
import { apiFetch, clearSession } from '../phase2Api';
import '../stock-management.css';
import './sales-v10.css';
import { money, reprintReceipt } from './salesV10Utils';

const PAGE_SIZE = 15;
const EXPORT_PAGE_SIZE = 100;
const STATUS_OPTIONS = [
  ['', 'All Statuses'],
  ['COMPLETED', 'Completed'],
  ['VOIDED', 'Voided'],
  ['RETURNED', 'Returned'],
  ['PARTIAL_RETURN', 'Partial Return'],
];
const PAYMENT_OPTIONS = [
  ['', 'All Payments'],
  ['CASH', 'Cash'],
  ['KPAY', 'KBZ Pay'],
  ['WAVE_PAY', 'Wave Pay'],
  ['CREDIT', 'Credit'],
  ['OTHER', 'Other'],
];

function formatDate(value) {
  if (!value) return '-';
  try {
    return new Intl.DateTimeFormat('en-GB', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value));
  } catch {
    return String(value);
  }
}

function statusTone(status) {
  const key = String(status || '').toLowerCase();
  if (key.includes('void')) return 'red';
  if (key.includes('return')) return 'orange';
  return 'green';
}

function csvCell(value) {
  const text = String(value ?? '');
  return `"${text.replaceAll('"', '""')}"`;
}

function itemMeta(item) {
  return [
    item?.imeiSerial ? `Serial: ${item.imeiSerial}` : '',
    item?.unit ? `Unit: ${item.unit}` : '',
    item?.expiryDate ? `Exp: ${item.expiryDate}` : '',
  ].filter(Boolean).join(' · ');
}

function DetailModal({ sale, loading, printing, onClose, onReprint, onVoid }) {
  return (
    <div className="stock-modal-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !loading) onClose();
    }}>
      <section className="stock-modal stock-history-modal sale10-history-detail-modal" role="dialog" aria-modal="true">
        <header>
          <div className="stock-modal-icon stock-tone-blue"><ReceiptText size={24} /></div>
          <div>
            <h3>{sale?.invoice || 'Sale Detail'}</h3>
            <p>{sale ? `${formatDate(sale.dateTime || sale.date)} · ${sale.customer || 'Walk-in Customer'}` : 'Loading invoice details…'}</p>
          </div>
          <button type="button" className="stock-icon-button" onClick={onClose}><X size={20} /></button>
        </header>

        {loading || !sale ? (
          <div className="stock-loading"><Loader2 className="stock-spin" /> Loading invoice…</div>
        ) : (
          <>
            <div className="sale10-detail-meta-grid">
              <article><span>Customer</span><b>{sale.customer || 'Walk-in Customer'}</b><small>{sale.customerPhone || '-'}</small></article>
              <article><span>Cashier</span><b>{sale.cashier || '-'}</b><small>{sale.payment || '-'}</small></article>
              <article><span>Status</span><b>{sale.status}</b><small>{sale.paymentStatus || '-'}</small></article>
            </div>

            <div className="stock-history-table-wrap sale10-detail-table-wrap">
              <table className="stock-history-table sale10-detail-table">
                <thead><tr><th>Product / Variant</th><th>IMEI / Serial</th><th>Qty</th><th>Unit Price</th><th>Discount</th><th>Line Total</th></tr></thead>
                <tbody>
                  {(sale.itemRows || []).map((item) => (
                    <tr key={item.id}>
                      <td><b>{[item.productName, item.variantName].filter(Boolean).join(' · ')}</b>{itemMeta(item) ? <small>{itemMeta(item)}</small> : null}</td>
                      <td>{item.imeiSerial || '-'}</td>
                      <td>{item.quantity}{item.unit ? ` ${item.unit}` : ''}</td>
                      <td>{money(item.unitPrice)}</td>
                      <td>{money(item.discount)}</td>
                      <td><b>{money(Number(item.quantity || 0) * Number(item.unitPrice || 0))}</b></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <section className="sale10-detail-totals">
              <div><span>Subtotal</span><b>{money(sale.subtotal)}</b></div>
              <div><span>Discount</span><b>-{money(sale.discount)}</b></div>
              <div><span>Profit</span><b>{money(sale.profit)}</b></div>
              <div className="grand"><span>Total</span><b>{money(sale.amount)}</b></div>
            </section>

            {sale.voidReason ? <div className="sale10-void-note"><b>Void Reason</b><span>{sale.voidReason}</span></div> : null}
          </>
        )}

        <footer>
          <button type="button" onClick={() => onReprint(sale)} disabled={!sale || printing}><Printer size={17} /> {printing ? 'Preparing…' : 'Reprint'}</button>
          <button type="button" className="stock-submit stock-submit-red" disabled={!sale || String(sale.status).toLowerCase().includes('void')} onClick={() => onVoid(sale)}><Ban size={17} /> Void Sale</button>
        </footer>
      </section>
    </div>
  );
}

function VoidModal({ sale, reason, error, busy, onReasonChange, onClose, onConfirm }) {
  return (
    <div className="stock-modal-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !busy) onClose();
    }}>
      <section className="stock-modal sale10-void-modal" role="dialog" aria-modal="true">
        <header>
          <div className="stock-modal-icon stock-tone-red"><Ban size={24} /></div>
          <div><h3>Void Sale</h3><p>{sale.invoice} · Stock restore + payment cancellation</p></div>
          <button type="button" className="stock-icon-button" onClick={onClose} disabled={busy}><X size={20} /></button>
        </header>
        <div className="sale10-void-body">
          <label className="stock-field"><span>Reason</span><textarea rows="4" value={reason} onChange={(event) => onReasonChange(event.target.value)} placeholder="Void reason" /></label>
          {error ? <div className="stock-form-error">{error}</div> : null}
        </div>
        <footer>
          <button type="button" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="stock-submit stock-submit-red" onClick={onConfirm} disabled={busy || !reason.trim()}>{busy ? <Loader2 className="stock-spin" size={17} /> : <Ban size={17} />} Confirm Void</button>
        </footer>
      </section>
    </div>
  );
}

export default function SalesHistoryV10() {
  const [query, setQuery] = useState('');
  const [cashier, setCashier] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [status, setStatus] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState({ sales: [], total: 0, totalPages: 1, summary: {} });
  const [selected, setSelected] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [printingId, setPrintingId] = useState('');
  const [voidTarget, setVoidTarget] = useState(null);
  const [voidReason, setVoidReason] = useState('Customer cancelled');
  const [voidError, setVoidError] = useState('');
  const [voidBusy, setVoidBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState(null);

  const notify = (type, text) => {
    setToast({ type, text });
    window.clearTimeout(notify.timer);
    notify.timer = window.setTimeout(() => setToast(null), 3500);
  };

  const handleError = (error) => {
    if (error?.status === 401) {
      clearSession();
      window.location.reload();
      return;
    }
    notify('error', error?.message || 'Request failed');
  };

  const buildParams = (requestedPage, limit) => {
    const params = new URLSearchParams({ page: String(requestedPage), limit: String(limit) });
    if (query.trim()) params.set('q', query.trim());
    if (cashier.trim()) params.set('cashier', cashier.trim());
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    if (status) params.set('status', status);
    if (paymentMethod) params.set('paymentMethod', paymentMethod);
    return params;
  };

  const load = async () => {
    setLoading(true);
    try {
      const json = await apiFetch(`/api/sales?${buildParams(page, PAGE_SIZE).toString()}`);
      setData(json);
    } catch (error) {
      setData({ sales: [], total: 0, totalPages: 1, summary: {} });
      handleError(error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const timer = window.setTimeout(load, 180);
    return () => window.clearTimeout(timer);
  }, [query, cashier, from, to, status, paymentMethod, page]);

  useEffect(() => { setPage(1); }, [query, cashier, from, to, status, paymentMethod]);

  const rows = data.sales || [];
  const summary = data.summary || {};
  const totalPages = Math.max(1, Number(data.totalPages || 1));
  const activeFilterCount = useMemo(
    () => [query, cashier, from, to, status, paymentMethod].filter(Boolean).length,
    [query, cashier, from, to, status, paymentMethod],
  );

  const clearFilters = () => {
    setQuery('');
    setCashier('');
    setFrom('');
    setTo('');
    setStatus('');
    setPaymentMethod('');
    setPage(1);
  };

  const loadDetail = async (row) => {
    setSelected(null);
    setDetailLoading(true);
    try {
      const json = await apiFetch(`/api/sales/${encodeURIComponent(row.id || row.invoice)}`);
      setSelected(json.sale);
    } catch (error) {
      handleError(error);
    } finally {
      setDetailLoading(false);
    }
  };

  const reprint = async (row) => {
    if (!row) return;
    const popup = window.open('', '_blank', 'width=430,height=760');
    if (!popup) {
      notify('error', 'Browser popup blocked. Popups ကို Allow လုပ်ပြီး Reprint ပြန်နှိပ်ပါ။');
      return;
    }

    const id = row.id || row.invoice;
    setPrintingId(id);
    popup.document.write('<!doctype html><html><body style="font-family:Arial;padding:30px;text-align:center">Preparing receipt…</body></html>');
    popup.document.close();

    try {
      const detail = row.itemRows ? row : (await apiFetch(`/api/sales/${encodeURIComponent(id)}`)).sale;
      reprintReceipt(detail, popup);
    } catch (error) {
      popup.close();
      handleError(error);
    } finally {
      setPrintingId('');
    }
  };

  const exportCsv = async () => {
    setExporting(true);
    try {
      const allRows = [];
      let exportPage = 1;
      let pages = 1;
      do {
        const result = await apiFetch(`/api/sales?${buildParams(exportPage, EXPORT_PAGE_SIZE).toString()}`);
        allRows.push(...(result.sales || []));
        pages = Math.max(1, Number(result.totalPages || 1));
        exportPage += 1;
      } while (exportPage <= pages && exportPage <= 100);

      if (!allRows.length) {
        notify('error', 'Export လုပ်ရန် Sale History မရှိပါ။');
        return;
      }

      const header = ['Invoice No', 'Date / Time', 'Customer', 'Phone', 'Items', 'Item Summary', 'Subtotal', 'Discount', 'Total', 'Profit', 'Payment', 'Status', 'Cashier'];
      const lines = [header.map(csvCell).join(',')];
      allRows.forEach((row) => {
        lines.push([
          row.invoice,
          formatDate(row.dateTime || row.date),
          row.customer || 'Walk-in Customer',
          row.customerPhone || '',
          row.itemCount || 0,
          row.items || '',
          Number(row.subtotal || 0),
          Number(row.discount || 0),
          Number(row.amount || 0),
          Number(row.profit || 0),
          row.payment || '',
          row.status || '',
          row.cashier || '',
        ].map(csvCell).join(','));
      });

      const blob = new Blob([`\uFEFF${lines.join('\r\n')}`], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const date = new Date().toISOString().slice(0, 10);
      link.href = url;
      link.download = `mahar-pos-sales-history-${date}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      notify('success', `${allRows.length} sales exported successfully`);
    } catch (error) {
      handleError(error);
    } finally {
      setExporting(false);
    }
  };

  const openVoid = (sale) => {
    setVoidTarget(sale);
    setVoidReason('Customer cancelled');
    setVoidError('');
  };

  const confirmVoid = async () => {
    if (!voidTarget || !voidReason.trim()) return;
    setVoidBusy(true);
    setVoidError('');
    try {
      await apiFetch(`/api/sales/${encodeURIComponent(voidTarget.id || voidTarget.invoice)}/void`, {
        method: 'POST',
        body: { reason: voidReason.trim() },
      });
      setVoidTarget(null);
      setSelected(null);
      notify('success', 'Sale voided. Stock restored and payment cancelled.');
      await load();
    } catch (error) {
      if (error?.status === 401) handleError(error);
      else setVoidError(error?.message || 'Void Sale failed');
    } finally {
      setVoidBusy(false);
    }
  };

  return (
    <div className="stock-page sale10-history-page">
      {toast ? <div className={`stock-toast stock-toast-${toast.type}`}>{toast.text}</div> : null}

      <div className="stock-page-heading">
        <div>
          <span className="stock-eyebrow">SALES</span>
          <h2>Sales History</h2>
          <p>Invoice, Customer, Payment, Status နဲ့ Cashier အလိုက် ရှာဖွေပြီး Detail, Reprint, Export နဲ့ Void ကို စီမံပါ။</p>
        </div>
        <div className="sale10-heading-actions">
          <button type="button" className="stock-refresh-button sale10-export-button" onClick={exportCsv} disabled={exporting || loading}>
            {exporting ? <Loader2 className="stock-spin" size={18} /> : <Download size={18} />} Export CSV
          </button>
          <button type="button" className="stock-refresh-button" onClick={load} disabled={loading}><RefreshCw className={loading ? 'stock-spin' : ''} size={18} /> Refresh</button>
        </div>
      </div>

      <section className="stock-summary-grid">
        <article><div className="stock-summary-icon stock-tone-blue"><History /></div><span>Total Sales</span><b>{Number(summary.saleCount ?? data.total ?? 0).toLocaleString()}</b></article>
        <article><div className="stock-summary-icon stock-tone-green"><Wallet /></div><span>Net Sales</span><b className="sale10-summary-money">{money(summary.netSales)}</b></article>
        <article><div className="stock-summary-icon stock-tone-orange"><BarChart3 /></div><span>Total Discount</span><b className="sale10-summary-money">{money(summary.discount)}</b></article>
        <article><div className="stock-summary-icon stock-tone-red"><TrendingUp /></div><span>Total Profit</span><b className="sale10-summary-money">{money(summary.profit)}</b></article>
      </section>

      <section className="stock-card">
        <div className="stock-toolbar sale10-history-toolbar">
          <div className="stock-search-box">
            <Search size={18} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Invoice, customer, phone, product or IMEI" />
          </div>
          <input className="sale10-filter-input" value={cashier} onChange={(event) => setCashier(event.target.value)} placeholder="Cashier" />
          <label className="sale10-date-filter"><CalendarDays size={16} /><input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
          <label className="sale10-date-filter"><CalendarDays size={16} /><input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
          <select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)}>{PAYMENT_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
          <select value={status} onChange={(event) => setStatus(event.target.value)}>{STATUS_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
          {activeFilterCount ? <button type="button" className="stock-action stock-action-red sale10-clear-filter" onClick={clearFilters}><X size={15} /> Clear {activeFilterCount}</button> : null}
        </div>

        {loading && rows.length === 0 ? (
          <div className="stock-loading"><Loader2 className="stock-spin" /> Loading sales…</div>
        ) : rows.length === 0 ? (
          <div className="stock-empty"><FileText size={38} /><b>No sales found</b><span>Filter ကိုပြောင်းပြီး ပြန်ရှာပါ။</span></div>
        ) : (
          <div className="stock-table-wrap">
            <table className="stock-table sale10-history-table">
              <thead><tr><th>Invoice No</th><th>Date / Time</th><th>Customer</th><th>Items</th><th>Total</th><th>Payment</th><th>Status</th><th>Cashier</th><th>Actions</th></tr></thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id || row.invoice}>
                    <td><b>{row.invoice}</b></td>
                    <td>{formatDate(row.dateTime || row.date)}</td>
                    <td>{row.customer || 'Walk-in Customer'}</td>
                    <td>{row.itemCount || 0}</td>
                    <td><b>{money(row.amount)}</b></td>
                    <td>{row.payment || '-'}</td>
                    <td><span className={`stock-type-badge stock-type-${statusTone(row.status)}`}>{row.status}</span></td>
                    <td>{row.cashier || '-'}</td>
                    <td>
                      <div className="stock-row-actions sale10-history-actions">
                        <button type="button" className="stock-action stock-action-blue" onClick={() => loadDetail(row)}><FileText size={15} /> View</button>
                        <button type="button" className="stock-action stock-action-green" onClick={() => reprint(row)} disabled={printingId === (row.id || row.invoice)}><Printer size={15} /> {printingId === (row.id || row.invoice) ? 'Loading' : 'Reprint'}</button>
                        <button type="button" className="stock-action stock-action-red" disabled={String(row.status).toLowerCase().includes('void')} onClick={() => openVoid(row)}><Ban size={15} /> Void</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <footer className="stock-pagination">
          <span>Showing {rows.length} of {Number(data.total || 0).toLocaleString()} sales</span>
          <div>
            <button type="button" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={page <= 1}><ChevronLeft size={17} /> Previous</button>
            <b>{page} / {totalPages}</b>
            <button type="button" onClick={() => setPage((value) => Math.min(totalPages, value + 1))} disabled={page >= totalPages}>Next <ChevronRight size={17} /></button>
          </div>
        </footer>
      </section>

      {(detailLoading || selected) ? <DetailModal sale={selected} loading={detailLoading} printing={Boolean(printingId)} onClose={() => { setSelected(null); setDetailLoading(false); }} onReprint={reprint} onVoid={openVoid} /> : null}
      {voidTarget ? <VoidModal sale={voidTarget} reason={voidReason} error={voidError} busy={voidBusy} onReasonChange={setVoidReason} onClose={() => { setVoidTarget(null); setVoidError(''); }} onConfirm={confirmVoid} /> : null}
    </div>
  );
}
