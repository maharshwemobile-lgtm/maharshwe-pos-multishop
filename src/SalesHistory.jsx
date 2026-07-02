import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Ban,
  ChevronLeft,
  ChevronRight,
  FileText,
  History,
  Printer,
  RefreshCw,
  Search,
  X,
} from 'lucide-react';
import { apiFetch, clearSession } from './phase2Api';
import { printSaleReceipt } from './pos/SmartCheckoutModal';
import './sales-history-compact.css';

const PAGE_SIZE = 12;
const FETCH_LIMIT = 100;
const money = (value) => `${Number(value || 0).toLocaleString('en-US')} ကျပ်`;

function dateKey(value) {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toISOString().slice(0, 10);
}

function dateTimeLabel(value) {
  if (!value) return '-';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleString();
}

function statusClass(status) {
  const normalized = String(status || '').toLowerCase();
  if (normalized.includes('void')) return 'voided';
  if (normalized.includes('return')) return 'returned';
  return 'completed';
}

function originalTotal(sale) {
  if (!sale?.itemRows?.length) return Number(sale?.subtotal || sale?.amount || 0);
  return sale.itemRows.reduce(
    (sum, item) => sum + Number(item.standardPrice || item.unitPrice || 0) * Number(item.quantity || 0),
    0,
  );
}

export default function SalesHistory() {
  const [data, setData] = useState({ sales: [], total: 0 });
  const [query, setQuery] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [cashier, setCashier] = useState('');
  const [status, setStatus] = useState('');
  const [pageNo, setPageNo] = useState(1);
  const [selectedId, setSelectedId] = useState('');
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [printingId, setPrintingId] = useState('');
  const [message, setMessage] = useState('');
  const [voidTarget, setVoidTarget] = useState(null);
  const [voidReason, setVoidReason] = useState('Customer cancelled');
  const [voidBusy, setVoidBusy] = useState(false);

  const handleError = (error) => {
    if (error?.status === 401) {
      clearSession();
      window.location.reload();
      return;
    }
    setMessage(error?.message || 'Request failed');
  };

  const load = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: '1', limit: String(FETCH_LIMIT) });
      if (query.trim()) params.set('q', query.trim());
      const json = await apiFetch(`/api/sales?${params.toString()}`);
      setData(json);
      setMessage('');
    } catch (error) {
      setData({ sales: [], total: 0 });
      handleError(error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const timer = window.setTimeout(load, 180);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    setPageNo(1);
  }, [query, fromDate, toDate, cashier, status]);

  const rows = data.sales || [];

  const cashierOptions = useMemo(() => (
    [...new Set(rows.map((row) => row.cashier).filter(Boolean))].sort((a, b) => a.localeCompare(b))
  ), [rows]);

  const filteredRows = useMemo(() => rows.filter((row) => {
    const rowDate = dateKey(row.dateTime || row.date);
    if (fromDate && rowDate && rowDate < fromDate) return false;
    if (toDate && rowDate && rowDate > toDate) return false;
    if (cashier && row.cashier !== cashier) return false;
    if (status && statusClass(row.status) !== status) return false;
    return true;
  }), [rows, fromDate, toDate, cashier, status]);

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
  const safePage = Math.min(pageNo, totalPages);
  const start = (safePage - 1) * PAGE_SIZE;
  const visibleRows = filteredRows.slice(start, start + PAGE_SIZE);

  useEffect(() => {
    if (pageNo > totalPages) setPageNo(totalPages);
  }, [pageNo, totalPages]);

  const fetchSaleDetail = async (row) => {
    const id = row.id || row.invoice;
    const json = await apiFetch(`/api/sales/${encodeURIComponent(id)}`);
    return json.sale;
  };

  const showDetail = async (row) => {
    const id = row.id || row.invoice;
    setSelectedId(id);
    setDetailLoading(true);
    try {
      setSelected(await fetchSaleDetail(row));
      setMessage('');
    } catch (error) {
      setSelected(null);
      handleError(error);
    } finally {
      setDetailLoading(false);
    }
  };

  const reprintSale = async (row) => {
    const popup = window.open('', '_blank', 'width=430,height=760');
    if (!popup) {
      setMessage('Browser popup blocked. Popups ကို Allow လုပ်ပြီး Reprint ပြန်နှိပ်ပါ။');
      return;
    }

    const id = row.id || row.invoice;
    setPrintingId(id);
    popup.document.write('<!doctype html><html><body style="font-family:Arial;padding:30px;text-align:center">Preparing receipt…</body></html>');
    popup.document.close();

    try {
      const detail = row.itemRows ? row : await fetchSaleDetail(row);
      printSaleReceipt(detail, popup);
      setMessage(`Receipt reprint opened: ${detail.invoice}`);
    } catch (error) {
      popup.close();
      handleError(error);
    } finally {
      setPrintingId('');
    }
  };

  const confirmVoid = async () => {
    if (!voidTarget || !voidReason.trim()) return;
    setVoidBusy(true);
    try {
      await apiFetch(`/api/sales/${encodeURIComponent(voidTarget.id || voidTarget.invoice)}/void`, {
        method: 'POST',
        body: { reason: voidReason.trim() },
      });
      setMessage('Sale voided. Stock restored and payment cancelled.');
      const targetId = voidTarget.id || voidTarget.invoice;
      setVoidTarget(null);
      setSelectedId('');
      setSelected(null);
      await load();
      if (selectedId && selectedId !== targetId) setSelectedId(selectedId);
    } catch (error) {
      handleError(error);
    } finally {
      setVoidBusy(false);
    }
  };

  const selectedOriginal = originalTotal(selected);
  const selectedAmount = Number(selected?.amount || selected?.total || 0);
  const selectedAdjustment = selectedAmount - selectedOriginal;
  const overriddenItems = (selected?.itemRows || []).filter(
    (item) => Number(item.unitPrice || 0) !== Number(item.standardPrice || item.unitPrice || 0),
  );

  return (
    <main className="sale-history-page">
      <section className="sale-history-shell">
        <header className="sale-history-top">
          <div className="sale-history-title"><History size={17} /> Sale History</div>
          <div className="sale-history-filters">
            <div style={{ position: 'relative' }}>
              <Search size={13} style={{ position: 'absolute', left: 9, top: 9, color: 'var(--sh-muted)' }} />
              <input
                className="sale-history-search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Invoice, customer, phone, product"
                style={{ paddingLeft: 28 }}
              />
            </div>
            <input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} aria-label="From date" />
            <input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} aria-label="To date" />
            <select value={cashier} onChange={(event) => setCashier(event.target.value)} aria-label="Cashier">
              <option value="">ကာရှယ်အားလုံး</option>
              {cashierOptions.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
            <select value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Status">
              <option value="">Status အားလုံး</option>
              <option value="completed">Completed</option>
              <option value="voided">Voided</option>
              <option value="returned">Returned</option>
            </select>
            <button type="button" className="sale-history-refresh" onClick={load} disabled={loading}>
              <RefreshCw size={13} /> {loading ? 'Loading…' : 'Refresh'}
            </button>
          </div>
        </header>

        {message ? <div className="sale-history-message">{message}</div> : null}

        <div className="sale-history-body">
          <section className="sale-history-list">
            <div className="sale-history-head">
              <span>Invoice</span><span>ကာရှယ်</span><span>ကြိုဈေး</span><span>ကျသင့်</span><span>Status</span>
            </div>
            <div className="sale-history-rows">
              {visibleRows.map((row) => {
                const id = row.id || row.invoice;
                const rowStatus = statusClass(row.status);
                return (
                  <button
                    type="button"
                    key={id}
                    className={`sale-history-row ${selectedId === id ? 'selected' : ''} ${rowStatus === 'voided' ? 'voided' : ''}`}
                    onClick={() => showDetail(row)}
                  >
                    <span>
                      <span className="sale-history-invoice">{row.invoice}</span>
                      <span className="sale-history-date">{dateTimeLabel(row.dateTime || row.date)}</span>
                    </span>
                    <span className="sale-history-cashier">{row.cashier || '-'}</span>
                    <span className="sale-history-number">{money(row.subtotal || row.amount)}</span>
                    <span className="sale-history-number strong">{money(row.amount)}</span>
                    <span className="sale-history-status"><span className={`sale-history-pill ${rowStatus}`}>{row.status}</span></span>
                  </button>
                );
              })}
              {!visibleRows.length ? <div className="sale-history-empty">{loading ? 'Loading sales…' : 'Sale records မတွေ့ပါ။'}</div> : null}
            </div>
            <footer className="sale-history-footer">
              <span>{filteredRows.length} sales · Showing {filteredRows.length ? start + 1 : 0}-{Math.min(start + PAGE_SIZE, filteredRows.length)}</span>
              <div className="sale-history-pages">
                <button type="button" className="sale-history-page-btn" disabled={safePage <= 1} onClick={() => setPageNo((value) => Math.max(1, value - 1))}><ChevronLeft size={13} /></button>
                {Array.from({ length: totalPages }, (_, index) => index + 1)
                  .slice(Math.max(0, safePage - 3), safePage + 2)
                  .map((number) => (
                    <button type="button" key={number} className={`sale-history-page-btn ${safePage === number ? 'active' : ''}`} onClick={() => setPageNo(number)}>{number}</button>
                  ))}
                <button type="button" className="sale-history-page-btn" disabled={safePage >= totalPages} onClick={() => setPageNo((value) => Math.min(totalPages, value + 1))}><ChevronRight size={13} /></button>
              </div>
            </footer>
          </section>

          <aside className="sale-history-detail">
            {detailLoading ? (
              <div className="sale-history-detail-empty"><RefreshCw size={28} /> <span>Invoice detail loading…</span></div>
            ) : !selected ? (
              <div className="sale-history-detail-empty"><FileText size={30} /><span>Invoice တစ်ခုကို နှိပ်ပါ</span></div>
            ) : (
              <>
                <div className="sale-history-detail-top">
                  <div>
                    <div className="sale-history-detail-id">{selected.invoice} — Invoice</div>
                    <div className="sale-history-detail-meta">
                      ရက်: {dateTimeLabel(selected.dateTime || selected.date)}<br />
                      ကာရှယ်: {selected.cashier || '-'}<br />
                      Customer: {selected.customer || 'Walk-in Customer'}<br />
                      Payment: {selected.payment || '-'} · <span className={`sale-history-pill ${statusClass(selected.status)}`}>{selected.status}</span>
                    </div>
                  </div>
                  <button type="button" className="sale-history-close" onClick={() => { setSelected(null); setSelectedId(''); }} aria-label="Close detail"><X size={14} /></button>
                </div>

                <div className="sale-history-section-title">ဝယ်ယူသောပစ္စည်းများ</div>
                <div className="sale-history-items">
                  {(selected.itemRows || []).map((item) => (
                    <div className="sale-history-item" key={item.id}>
                      <div>
                        <div className="sale-history-item-name">{item.productName} {item.variantName}</div>
                        <div className="sale-history-item-sub">
                          {money(item.unitPrice)} × {item.quantity}
                          {Number(item.unitPrice) !== Number(item.standardPrice)
                            ? ` · ${Number(item.standardPrice).toLocaleString()}→${Number(item.unitPrice).toLocaleString()}`
                            : ''}
                          {item.imeiSerial ? ` · ${item.imeiSerial}` : ''}
                        </div>
                      </div>
                      <div className="sale-history-item-qty">{item.quantity}</div>
                      <div className="sale-history-item-total">{money(Number(item.unitPrice || 0) * Number(item.quantity || 0))}</div>
                    </div>
                  ))}
                </div>

                {overriddenItems.length ? (
                  <div className="sale-history-override">
                    ဈေးပြင်ထားမှု: {overriddenItems.map((item) => `${item.productName} ${Number(item.standardPrice).toLocaleString()}→${Number(item.unitPrice).toLocaleString()}`).join(', ')}
                  </div>
                ) : null}

                <div className="sale-history-summary">
                  <div className="sale-history-summary-row"><span>ကြိုတင်ဈေး</span><span>{money(selectedOriginal)}</span></div>
                  <div className="sale-history-summary-row"><span>ဈေးပြင် / လျှော့ဈေး</span><span style={{ color: selectedAdjustment < 0 ? '#dc2626' : 'var(--sh-accent-dark)' }}>{selectedAdjustment >= 0 ? '+' : ''}{money(selectedAdjustment)}</span></div>
                  <div className="sale-history-summary-row"><span>Discount</span><span>-{money(selected.discount)}</span></div>
                  <div className="sale-history-summary-row total"><span>စုစုပေါင်း</span><span>{money(selectedAmount)}</span></div>
                </div>

                {selected.voidReason ? <div className="sale-history-override" style={{ color: '#991b1b', background: '#fee2e2' }}>Void reason: {selected.voidReason}</div> : null}

                <div className="sale-history-actions">
                  <button type="button" className="sale-history-action reprint" disabled={printingId === (selected.id || selected.invoice)} onClick={() => reprintSale(selected)}>
                    <Printer size={13} /> {printingId ? 'Loading…' : 'Reprint'}
                  </button>
                  <button
                    type="button"
                    className="sale-history-action danger"
                    disabled={statusClass(selected.status) === 'voided'}
                    onClick={() => { setVoidTarget(selected); setVoidReason('Customer cancelled'); }}
                  >
                    <Ban size={13} /> {statusClass(selected.status) === 'voided' ? 'Voided' : 'Void'}
                  </button>
                </div>
              </>
            )}
          </aside>
        </div>

        {voidTarget ? (
          <div className="sale-history-void-overlay">
            <section className="sale-history-void-modal">
              <AlertTriangle size={24} color="#dc2626" />
              <h3>Sale Void လုပ်မည်</h3>
              <p>{voidTarget.invoice} ကို Void လုပ်ရင် Stock ပြန်တိုးပြီး Payment ကို cancel လုပ်ပါမယ်။</p>
              <textarea value={voidReason} onChange={(event) => setVoidReason(event.target.value)} placeholder="Void reason" autoFocus />
              <div className="sale-history-void-buttons">
                <button type="button" onClick={() => setVoidTarget(null)} disabled={voidBusy}>မလုပ်တော့</button>
                <button type="button" className="confirm" onClick={confirmVoid} disabled={voidBusy || !voidReason.trim()}>{voidBusy ? 'Processing…' : 'Void လုပ်မည်'}</button>
              </div>
            </section>
          </div>
        ) : null}
      </section>
    </main>
  );
}
