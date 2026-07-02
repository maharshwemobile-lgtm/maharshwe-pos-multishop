import React, { useEffect, useMemo, useState } from 'react';
import {
  Banknote,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  CreditCard,
  Edit3,
  FileText,
  History,
  Loader2,
  Phone,
  Plus,
  RefreshCw,
  Search,
  UserRound,
  Users,
  WalletCards,
  X,
} from 'lucide-react';
import { apiFetch, clearSession } from './phase2Api';
import './customers-credit.css';

const money = (value) => `${Number(value || 0).toLocaleString('en-US')} MMK`;
const blankCustomer = { name: '', phone: '', address: '' };
const blankCollection = { amount: '', method: 'CASH', reference: '', note: '' };

function formatDate(value) {
  if (!value) return '-';
  try {
    return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
  } catch {
    return String(value);
  }
}

function CustomerModal({ editor, onClose, onSaved }) {
  const [form, setForm] = useState(editor?.customer ? {
    name: editor.customer.name || '',
    phone: editor.customer.phone || '',
    address: editor.customer.address || '',
  } : blankCustomer);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event) => {
    event.preventDefault();
    if (!form.name.trim()) return setError('Customer name ထည့်ပါ။');
    setBusy(true);
    setError('');
    try {
      const route = editor?.customer ? `/api/customers/${editor.customer.id}` : '/api/customers';
      const method = editor?.customer ? 'PATCH' : 'POST';
      await apiFetch(route, { method, body: form });
      await onSaved(editor?.customer ? 'Customer updated' : 'Customer created');
    } catch (requestError) {
      setError(requestError.message || 'Customer save failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="credit-modal-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !busy) onClose();
    }}>
      <section className="credit-modal" role="dialog" aria-modal="true">
        <header>
          <div className="credit-modal-icon credit-tone-green"><UserRound size={24} /></div>
          <div><h3>{editor?.customer ? 'Edit Customer' : 'New Customer'}</h3><p>Customer profile information</p></div>
          <button type="button" className="credit-icon-button" onClick={onClose} disabled={busy}><X size={20} /></button>
        </header>
        <form onSubmit={submit} className="credit-form">
          <label className="credit-field"><span>Name *</span><input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} autoFocus required /></label>
          <label className="credit-field"><span>Phone</span><input value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} /></label>
          <label className="credit-field"><span>Address</span><textarea rows="3" value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })} /></label>
          {error ? <div className="credit-form-error">{error}</div> : null}
          <footer>
            <button type="button" onClick={onClose} disabled={busy}>Cancel</button>
            <button type="submit" className="credit-submit" disabled={busy}>{busy ? <Loader2 className="credit-spin" size={18} /> : <CheckCircle2 size={18} />} Save Customer</button>
          </footer>
        </form>
      </section>
    </div>
  );
}

function CollectionModal({ customer, onClose, onSaved }) {
  const [form, setForm] = useState({ ...blankCollection, amount: String(customer.balance || '') });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const amount = Number(form.amount || 0);
  const before = Number(customer.balance || 0);
  const after = Math.max(0, before - amount);

  const submit = async (event) => {
    event.preventDefault();
    if (amount <= 0) return setError('Amount must be greater than zero.');
    if (amount > before) return setError('Amount is greater than customer balance.');
    setBusy(true);
    setError('');
    try {
      await apiFetch(`/api/customers/${customer.id}/collect`, {
        method: 'POST',
        body: { ...form, amount },
      });
      await onSaved('Credit payment collected');
    } catch (requestError) {
      setError(requestError.message || 'Credit collection failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="credit-modal-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !busy) onClose();
    }}>
      <section className="credit-modal" role="dialog" aria-modal="true">
        <header>
          <div className="credit-modal-icon credit-tone-blue"><Banknote size={24} /></div>
          <div><h3>Collect Credit Payment</h3><p>{customer.name} · {customer.phone || 'No phone'}</p></div>
          <button type="button" className="credit-icon-button" onClick={onClose} disabled={busy}><X size={20} /></button>
        </header>
        <form onSubmit={submit} className="credit-form">
          <div className="credit-balance-preview">
            <div><span>Before</span><b>{money(before)}</b></div>
            <div className="credit-payment-change"><span>Payment</span><b>-{money(amount)}</b></div>
            <div><span>After</span><b>{money(after)}</b></div>
          </div>
          <label className="credit-field"><span>Amount *</span><input type="number" min="1" max={before} step="1" value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} autoFocus required /></label>
          <label className="credit-field"><span>Payment Method</span><select value={form.method} onChange={(event) => setForm({ ...form, method: event.target.value })}><option value="CASH">Cash</option><option value="KPAY">KPay</option><option value="WAVE_PAY">Wave Pay</option><option value="OTHER">Other</option></select></label>
          <label className="credit-field"><span>Reference</span><input value={form.reference} onChange={(event) => setForm({ ...form, reference: event.target.value })} placeholder="Transaction ID / note" /></label>
          <label className="credit-field"><span>Note</span><textarea rows="2" value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} /></label>
          {error ? <div className="credit-form-error">{error}</div> : null}
          <footer>
            <button type="button" onClick={onClose} disabled={busy}>Cancel</button>
            <button type="submit" className="credit-submit credit-submit-blue" disabled={busy}>{busy ? <Loader2 className="credit-spin" size={18} /> : <Banknote size={18} />} Collect Payment</button>
          </footer>
        </form>
      </section>
    </div>
  );
}

function DetailModal({ customer, loading, onClose, onCollect, onEdit, onOpenHistory }) {
  return (
    <div className="credit-modal-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="credit-modal credit-detail-modal" role="dialog" aria-modal="true">
        <header>
          <div className="credit-modal-icon credit-tone-green"><UserRound size={24} /></div>
          <div><h3>{customer?.name || 'Customer Detail'}</h3><p>{customer?.phone || 'No phone'} · {customer?.address || 'No address'}</p></div>
          <button type="button" className="credit-icon-button" onClick={onClose}><X size={20} /></button>
        </header>
        {loading || !customer ? <div className="credit-loading"><Loader2 className="credit-spin" /> Loading customer history…</div> : (
          <div className="credit-detail-body">
            <div className="credit-detail-summary">
              <article><span>Current Balance</span><b className={customer.balance > 0 ? 'owing' : ''}>{money(customer.balance)}</b></article>
              <article><span>Total Sales</span><b>{customer.sales?.length || 0}</b></article>
              <article><span>Pending Sales</span><b>{(customer.sales || []).filter((sale) => sale.outstanding > 0).length}</b></article>
            </div>
            <div className="credit-detail-actions">
              <button type="button" onClick={() => onEdit(customer)}><Edit3 size={17} /> Edit Customer</button>
              <button type="button" onClick={() => onOpenHistory(customer)}><History size={17} /> Open Sales History</button>
              <button type="button" className="primary" onClick={() => onCollect(customer)} disabled={Number(customer.balance || 0) <= 0}><Banknote size={17} /> Collect Payment</button>
            </div>
            <div className="credit-section-title">Recent Sales</div>
            <div className="credit-history-wrap">
              <table className="credit-history-table">
                <thead><tr><th>Invoice</th><th>Date</th><th>Cashier</th><th>Total</th><th>Paid</th><th>Outstanding</th><th>Status</th></tr></thead>
                <tbody>
                  {(customer.sales || []).map((sale) => (
                    <tr key={sale.id}>
                      <td><b>{sale.invoice}</b><small>{sale.itemCount} items</small></td>
                      <td>{formatDate(sale.soldAt)}</td>
                      <td>{sale.cashier}</td>
                      <td>{money(sale.total)}</td>
                      <td>{money(sale.paid)}</td>
                      <td className={sale.outstanding > 0 ? 'credit-outstanding' : ''}>{money(sale.outstanding)}</td>
                      <td><span className={`credit-status ${sale.outstanding > 0 ? 'owing' : 'clear'}`}>{sale.paymentStatus}</span></td>
                    </tr>
                  ))}
                  {!customer.sales?.length ? <tr><td colSpan="7"><div className="credit-empty"><FileText size={26} /><span>No sales history.</span></div></td></tr> : null}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

export default function CustomersCreditPage({ onNavigate }) {
  const [data, setData] = useState({ customers: [], summary: {}, total: 0, totalPages: 1 });
  const [query, setQuery] = useState('');
  const [balanceFilter, setBalanceFilter] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState(null);
  const [editor, setEditor] = useState(null);
  const [detailId, setDetailId] = useState('');
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [collectionCustomer, setCollectionCustomer] = useState(null);

  const notify = (type, text) => {
    setMessage({ type, text });
    window.clearTimeout(notify.timer);
    notify.timer = window.setTimeout(() => setMessage(null), 3500);
  };

  const handleError = (error) => {
    if (error?.status === 401) {
      clearSession();
      window.location.reload();
      return;
    }
    notify('error', error?.message || 'Request failed');
  };

  const load = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: '20' });
      if (query.trim()) params.set('q', query.trim());
      if (balanceFilter) params.set('balance', balanceFilter);
      const response = await apiFetch(`/api/customers?${params.toString()}`);
      setData(response);
    } catch (error) {
      handleError(error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const timer = window.setTimeout(load, 220);
    return () => window.clearTimeout(timer);
  }, [query, balanceFilter, page]);

  useEffect(() => setPage(1), [query, balanceFilter]);

  const openDetail = async (customer) => {
    setDetailId(customer.id);
    setDetailLoading(true);
    setDetail(null);
    try {
      const response = await apiFetch(`/api/customers/${customer.id}`);
      setDetail(response.customer);
    } catch (error) {
      handleError(error);
      setDetailId('');
    } finally {
      setDetailLoading(false);
    }
  };

  const refreshDetail = async () => {
    if (!detailId) return;
    const response = await apiFetch(`/api/customers/${detailId}`);
    setDetail(response.customer);
  };

  const afterSaved = async (text) => {
    setEditor(null);
    notify('success', text);
    await load();
    if (detailId) await refreshDetail();
  };

  const afterCollection = async (text) => {
    setCollectionCustomer(null);
    notify('success', text);
    await load();
    await refreshDetail();
  };

  const openSalesHistory = (customer) => {
    window.sessionStorage.setItem('mahar-pos-sales-history-query', customer.phone || customer.name);
    onNavigate?.('Sales History');
  };

  const summary = data.summary || {};
  const cards = useMemo(() => [
    { label: 'Total Customers', value: Number(summary.totalCustomers || 0).toLocaleString(), icon: Users, tone: 'green' },
    { label: 'Receivable', value: money(summary.receivable), icon: CircleDollarSign, tone: 'orange' },
    { label: 'Owing Customers', value: Number(summary.owingCustomers || 0).toLocaleString(), icon: WalletCards, tone: 'red' },
    { label: 'Clear Customers', value: Number(summary.clearCustomers || 0).toLocaleString(), icon: CheckCircle2, tone: 'blue' },
  ], [summary]);

  return (
    <section className="credit-page">
      <div className="credit-page-heading">
        <div><span className="credit-eyebrow">CUSTOMER CREDIT</span><h2>Customers & Credit</h2><p>Customer profile၊ credit balance၊ payment collection နဲ့ sale history ကို workflow တစ်ခုတည်းအဖြစ် ချိတ်ဆက်စီမံပါ။</p></div>
        <div className="credit-heading-actions">
          <button type="button" className="credit-refresh-button" onClick={load} disabled={loading}><RefreshCw size={18} /> Refresh</button>
          <button type="button" className="credit-new-button" onClick={() => setEditor({ customer: null })}><Plus size={18} /> New Customer</button>
        </div>
      </div>

      <div className="credit-summary-grid">
        {cards.map((card) => <article key={card.label}><div className={`credit-summary-icon credit-tone-${card.tone}`}><card.icon size={23} /></div><span>{card.label}</span><b>{card.value}</b></article>)}
      </div>

      <section className="credit-card">
        <div className="credit-toolbar">
          <div className="credit-search-box"><Search size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search customer name, phone or address" /></div>
          <select value={balanceFilter} onChange={(event) => setBalanceFilter(event.target.value)}><option value="">All Balances</option><option value="owing">Owing Only</option><option value="clear">Clear Only</option></select>
        </div>

        <div className="credit-table-wrap">
          <table className="credit-table">
            <thead><tr><th>Customer</th><th>Phone</th><th>Address</th><th>Sales</th><th>Repairs</th><th>Balance</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>
              {(data.customers || []).map((customer) => (
                <tr key={customer.id}>
                  <td><div className="credit-customer-cell"><div><UserRound size={19} /></div><span><b>{customer.name}</b><small>Updated {formatDate(customer.updatedAt)}</small></span></div></td>
                  <td>{customer.phone || '-'}</td>
                  <td>{customer.address || '-'}</td>
                  <td>{customer.saleCount}</td>
                  <td>{customer.repairCount}</td>
                  <td><b className={customer.balance > 0 ? 'credit-outstanding' : ''}>{money(customer.balance)}</b></td>
                  <td><span className={`credit-status ${customer.balance > 0 ? 'owing' : 'clear'}`}>{customer.balance > 0 ? 'Owing' : 'Clear'}</span></td>
                  <td><div className="credit-row-actions"><button type="button" onClick={() => openDetail(customer)}><History size={15} /> View</button><button type="button" onClick={() => setEditor({ customer })}><Edit3 size={15} /> Edit</button><button type="button" className="collect" onClick={() => setCollectionCustomer(customer)} disabled={customer.balance <= 0}><Banknote size={15} /> Collect</button></div></td>
                </tr>
              ))}
              {!data.customers?.length && !loading ? <tr><td colSpan="8"><div className="credit-empty"><Users size={30} /><span>No customers found.</span></div></td></tr> : null}
            </tbody>
          </table>
          {loading ? <div className="credit-loading"><Loader2 className="credit-spin" /> Loading customers…</div> : null}
        </div>

        <div className="credit-pagination">
          <span>Showing {data.customers?.length || 0} of {data.total || 0} customers</span>
          <div><button type="button" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}><ChevronLeft size={17} /> Previous</button><b>Page {page} / {Math.max(1, data.totalPages || 1)}</b><button type="button" disabled={page >= Math.max(1, data.totalPages || 1)} onClick={() => setPage((value) => value + 1)}>Next <ChevronRight size={17} /></button></div>
        </div>
      </section>

      {message ? <div className={`credit-toast credit-toast-${message.type}`}>{message.text}</div> : null}
      {editor ? <CustomerModal editor={editor} onClose={() => setEditor(null)} onSaved={afterSaved} /> : null}
      {collectionCustomer ? <CollectionModal customer={collectionCustomer} onClose={() => setCollectionCustomer(null)} onSaved={afterCollection} /> : null}
      {detailId ? <DetailModal customer={detail} loading={detailLoading} onClose={() => { setDetailId(''); setDetail(null); }} onCollect={setCollectionCustomer} onEdit={(customer) => setEditor({ customer })} onOpenHistory={openSalesHistory} /> : null}
    </section>
  );
}
