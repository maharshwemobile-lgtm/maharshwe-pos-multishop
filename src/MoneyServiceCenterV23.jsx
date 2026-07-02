import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Banknote,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  Download,
  Eye,
  FileText,
  History,
  Loader2,
  Search,
  Settings2,
  Wallet,
  X,
} from 'lucide-react';
import { apiFetch } from './phase2Api';
import FinanceCatalogSettingsV23 from './FinanceCatalogSettingsV23.jsx';
import './money-service-center-v23.css';

const EMPTY = {
  mode: 'TRANSFER',
  paymentMethodId: '',
  cashAccountId: '',
  amount: '',
  feeMode: 'AUTO',
  feeAmount: '',
  senderName: '',
  senderPhone: '',
  receiverName: '',
  receiverPhone: '',
  withdrawerName: '',
  withdrawerPhone: '',
  paymentTiming: 'PAID_NOW',
  paidAmount: '',
  dueDate: '',
  reference: '',
  note: '',
};

const money = (value) => `${Number(value || 0).toLocaleString('en-US')} MMK`;
const formatDate = (value) => value ? new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '-';
const serviceTitle = (mode) => (mode === 'CASH_OUT' ? 'Cash Out' : 'Transfer');
const paymentText = (status) => ({ PAID: 'Done', PARTIAL: 'Partial', PENDING: 'Pending' }[status] || status || 'Done');

function StatusPill({ value }) {
  const text = paymentText(value);
  const tone = value === 'PAID' ? 'paid' : value === 'PARTIAL' ? 'partial' : 'pending';
  return <span className={`msc-status ${tone}`}>{text}</span>;
}

function computeFee(settings, method, form) {
  const amount = Number(form.amount || 0);
  const rate = Number(settings.rates?.[`${method?.code}_${form.mode}`] ?? settings.rates?.[`${method?.accountType}_${form.mode}`] ?? 0);
  const roundTo = Math.max(1, Number(settings.rates?.roundTo || 100));
  const minimumFee = Number(settings.rates?.minimumFee || 0);
  const autoFee = amount > 0 ? Math.max(minimumFee, Math.ceil((amount * rate / 100) / roundTo) * roundTo) : 0;
  const fee = form.feeMode === 'CUSTOM' ? Number(form.feeAmount || 0) : autoFee;
  return { rate, autoFee, fee, total: amount + fee };
}

function TransactionDetail({ id, settings, onClose, onChanged }) {
  const [data, setData] = useState(null);
  const [amount, setAmount] = useState('');
  const [accountId, setAccountId] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const load = async () => {
    const response = await apiFetch(`/api/money-service/transactions/${id}`);
    setData(response);
    const due = Number(response.transaction?.dueAmount || 0);
    setAmount(due > 0 ? String(due) : '');
    if (!accountId) {
      const cash = settings.accounts?.find((item) => item.type === 'CASH') || settings.accounts?.[0];
      setAccountId(cash?.id || '');
    }
  };

  useEffect(() => { load().catch((error) => setMessage(error.message)); }, [id]);

  const collect = async (event) => {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      await apiFetch(`/api/money-service/transactions/${id}/collect`, {
        method: 'POST',
        body: { amount: Number(amount), accountId, note },
      });
      setMessage('Payment updated');
      await load();
      await onChanged?.();
    } catch (error) {
      setMessage(error.message || 'Collection failed');
    } finally {
      setBusy(false);
    }
  };

  const t = data?.transaction;
  return <div className="msc-modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section className="msc-detail-modal">
      <header>
        <div><FileText size={22}/><span><b>PostgreSQL Transaction Detail</b><small>{t?.transactionNumber || 'Loading...'}</small></span></div>
        <button type="button" onClick={onClose}><X size={19}/></button>
      </header>
      {!t ? <div className="msc-loading"><Loader2 className="msc-spin"/> Loading...</div> : <>
        {message ? <div className="msc-message">{message}</div> : null}
        <div className="msc-detail-summary">
          <div><span>Status</span><StatusPill value={t.paymentStatus}/></div>
          <div><span>Wallet</span><b>{t.walletName || '-'}</b></div>
          <div><span>Amount</span><b>{money(t.amount)}</b></div>
          <div><span>Fee</span><b>{money(t.feeAmount)}</b></div>
          <div><span>Paid</span><b>{money(t.paidAmount)}</b></div>
          <div><span>Due</span><b>{money(t.dueAmount)}</b></div>
        </div>
        <div className="msc-detail-grid">
          <div><span>Service Type</span><b>{serviceTitle(t.mode)}</b></div>
          <div><span>Date</span><b>{formatDate(t.createdAt)}</b></div>
          <div><span>Sender / Withdrawer</span><b>{t.mode === 'TRANSFER' ? (t.senderName || '-') : (t.withdrawerName || '-')}</b><small>{t.mode === 'TRANSFER' ? t.senderPhone : t.withdrawerPhone}</small></div>
          <div><span>Receiver</span><b>{t.receiverName || '-'}</b><small>{t.receiverPhone || ''}</small></div>
          <div><span>Reference</span><b>{t.reference || '-'}</b></div>
          <div><span>Staff</span><b>{t.staffName || t.staffUsername || '-'}</b></div>
        </div>
        {Number(t.dueAmount || 0) > 0 ? <form className="msc-collect" onSubmit={collect}>
          <h4>{t.mode === 'CASH_OUT' ? 'Complete Cash Payout' : 'Collect Remaining Payment'}</h4>
          <div>
            <label><span>Amount</span><input type="number" min="1" max={t.dueAmount} required value={amount} onChange={(event) => setAmount(event.target.value)}/></label>
            <label><span>{t.mode === 'CASH_OUT' ? 'Pay out from' : 'Receive into'}</span><select required value={accountId} onChange={(event) => setAccountId(event.target.value)}><option value="">Choose account</option>{(settings.accounts || []).map((account) => <option key={account.id} value={account.id}>{account.name} · {money(account.balance)}</option>)}</select></label>
          </div>
          <label><span>Note</span><input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Optional"/></label>
          <button disabled={busy || !accountId}>{busy ? <Loader2 className="msc-spin" size={17}/> : <CircleDollarSign size={17}/>} Save Payment</button>
        </form> : null}
        <section className="msc-payment-history">
          <h4>PostgreSQL Payment Records</h4>
          {(data.payments || []).length ? data.payments.map((payment) => <article key={payment.id}>
            <div><b>{money(payment.amount)}</b><small>{payment.accountName || payment.paymentMethodName || '-'}</small></div>
            <div><span>{formatDate(payment.createdAt)}</span><small>{payment.collectedBy || '-'}</small></div>
          </article>) : <p>No payment records</p>}
        </section>
      </>}
    </section>
  </div>;
}

function MoneyServiceForm({ settings, onSaved }) {
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const methods = useMemo(() => (settings.paymentMethods || []).filter((method) => method.supportsMoneyService !== false && method.kind !== 'CASH' && method.accountId), [settings.paymentMethods]);
  const accounts = settings.accounts || [];
  const cashAccounts = accounts.filter((account) => account.type === 'CASH');
  const method = methods.find((item) => item.id === form.paymentMethodId);
  const { rate, autoFee, fee, total } = computeFee(settings, method, form);
  const amount = Number(form.amount || 0);
  const isPending = form.paymentTiming === 'PAY_LATER';
  const due = isPending ? (form.mode === 'CASH_OUT' ? amount : total) : 0;

  useEffect(() => {
    setForm((current) => ({
      ...current,
      paymentMethodId: current.paymentMethodId || methods[0]?.id || '',
      cashAccountId: current.cashAccountId || cashAccounts[0]?.id || accounts[0]?.id || '',
    }));
  }, [methods.length, accounts.length]);

  const changeMode = (mode) => setForm((current) => ({ ...current, mode, paymentTiming: 'PAID_NOW', dueDate: '' }));

  const reset = () => setForm((current) => ({
    ...EMPTY,
    mode: current.mode,
    paymentMethodId: current.paymentMethodId,
    cashAccountId: current.cashAccountId,
  }));

  const submit = async (event) => {
    event.preventDefault();
    setMessage('');
    if (!form.paymentMethodId) return setMessage('Wallet account ရွေးရန်လိုပါတယ်');
    if (!form.cashAccountId) return setMessage('Cash account မရှိသေးပါ');
    if (amount <= 0) return setMessage('Amount is required');
    if (form.mode === 'TRANSFER' && (!form.receiverName.trim() || !form.receiverPhone.trim())) return setMessage('Receiver name and phone are required');

    setBusy(true);
    try {
      const response = await apiFetch('/api/money-service/transactions', {
        method: 'POST',
        body: {
          ...form,
          amount,
          feeAmount: form.feeMode === 'CUSTOM' ? fee : undefined,
          dueDate: form.paymentTiming === 'PAY_LATER' ? (form.dueDate || undefined) : undefined,
        },
      });
      setMessage(response.message || 'Saved in PostgreSQL');
      reset();
      await onSaved?.(response.transaction);
    } catch (error) {
      setMessage(error.message || 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  return <section className="msc-clean-card msc-entry-card">
    <header>
      <div><span>MONEY SERVICE</span><h3>New Transaction</h3><p>{form.mode === 'CASH_OUT' ? 'Customer wallet ဝင်ငွေကိုယူပြီး Cash ထုတ်ပေးပါမယ်။' : 'ကိုယ့် Wallet ထဲကငွေထွက်ပြီး Customer ဆီက Cash ဝင်ပါမယ်။'}</p></div>
      <div className="msc-db-badge">PostgreSQL Only</div>
    </header>
    {message ? <div className="msc-message">{message}</div> : null}
    <form onSubmit={submit} className="msc-clean-form">
      <div className="msc-service-switch">
        <button type="button" className={form.mode === 'TRANSFER' ? 'active' : ''} onClick={() => changeMode('TRANSFER')}><ArrowUpFromLine size={18}/> Transfer</button>
        <button type="button" className={form.mode === 'CASH_OUT' ? 'active cashout' : ''} onClick={() => changeMode('CASH_OUT')}><ArrowDownToLine size={18}/> Cash Out</button>
      </div>

      <div className="msc-form-row">
        <label>
          <span>{form.mode === 'CASH_OUT' ? 'Customer Transfer Wallet' : 'Sending Wallet'} *</span>
          <select value={form.paymentMethodId} onChange={(event) => setForm({ ...form, paymentMethodId: event.target.value })}>
            {methods.map((item) => <option key={item.id} value={item.id}>{item.name} · {money(item.balance)}</option>)}
          </select>
          <small>{form.mode === 'CASH_OUT' ? 'Customer က ဒီ Wallet ထဲကို လွှဲပေးပါမယ်။' : 'ဒီ Wallet ထဲကနေ ငွေလွှဲထွက်ပါမယ်။'}</small>
        </label>
        <label>
          <span>{form.mode === 'CASH_OUT' ? 'Receiving Wallet' : 'Cash Receiving Account'} *</span>
          <input value={`${cashAccounts[0]?.name || 'Cash'} · ${money(cashAccounts[0]?.balance || 0)}`} readOnly />
          <small>{form.mode === 'CASH_OUT' ? 'Cash Out ဖြစ်လို့ Cash account ကနေ အလိုအလျောက်ထုတ်ပေးပါမယ်။' : 'Transfer ဖြစ်လို့ Customer ဆီက Cash ဝင်ပါမယ်။'}</small>
        </label>
      </div>

      <div className="msc-form-row">
        <label><span>Amount *</span><input type="number" min="1" value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} placeholder="0"/></label>
        <label><span>Service Fee</span><div className="msc-fee-input"><input type="number" min="0" value={form.feeMode === 'CUSTOM' ? form.feeAmount : autoFee} onChange={(event) => setForm({ ...form, feeMode: 'CUSTOM', feeAmount: event.target.value })}/><button type="button" onClick={() => setForm({ ...form, feeMode: 'AUTO', feeAmount: '' })}>Auto {rate}%</button></div></label>
      </div>

      {form.mode === 'TRANSFER' ? <div className="msc-form-row">
        <label><span>Receiver Name *</span><input value={form.receiverName} onChange={(event) => setForm({ ...form, receiverName: event.target.value })} placeholder="Receiver name"/></label>
        <label><span>Receiver Phone *</span><input value={form.receiverPhone} onChange={(event) => setForm({ ...form, receiverPhone: event.target.value })} placeholder="09..."/></label>
      </div> : <div className="msc-form-row">
        <label><span>Withdrawer Name</span><input value={form.withdrawerName} onChange={(event) => setForm({ ...form, withdrawerName: event.target.value })} placeholder="Optional"/></label>
        <label><span>Withdrawer Phone</span><input value={form.withdrawerPhone} onChange={(event) => setForm({ ...form, withdrawerPhone: event.target.value })} placeholder="Optional"/></label>
      </div>}

      <details className="msc-optional-clean">
        <summary>Optional sender / reference fields</summary>
        <div className="msc-form-row">
          <label><span>Sender Name</span><input value={form.senderName} onChange={(event) => setForm({ ...form, senderName: event.target.value })}/></label>
          <label><span>Sender Phone</span><input value={form.senderPhone} onChange={(event) => setForm({ ...form, senderPhone: event.target.value })}/></label>
          <label><span>Reference</span><input value={form.reference} onChange={(event) => setForm({ ...form, reference: event.target.value })}/></label>
          <label><span>Note</span><input value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })}/></label>
        </div>
      </details>

      <div className="msc-payment-line">
        <label className={form.paymentTiming === 'PAID_NOW' ? 'active' : ''}><input type="radio" checked={form.paymentTiming === 'PAID_NOW'} onChange={() => setForm({ ...form, paymentTiming: 'PAID_NOW', dueDate: '' })}/> Done now</label>
        <label className={form.paymentTiming === 'PAY_LATER' ? 'active warning' : ''}><input type="radio" checked={form.paymentTiming === 'PAY_LATER'} onChange={() => setForm({ ...form, paymentTiming: 'PAY_LATER' })}/> Pending / Debt</label>
        {form.paymentTiming === 'PAY_LATER' ? <input type="date" value={form.dueDate} onChange={(event) => setForm({ ...form, dueDate: event.target.value })}/> : null}
      </div>

      <div className="msc-total-strip">
        <div><span>Amount</span><b>{money(amount)}</b></div>
        <div><span>Fee</span><b>{money(fee)}</b></div>
        <div><span>{form.mode === 'CASH_OUT' ? 'Wallet Received' : 'Customer Pays'}</span><b>{money(total)}</b></div>
        {due > 0 ? <div className="due"><span>Due</span><b>{money(due)}</b></div> : null}
      </div>

      <footer>
        <button type="button" onClick={reset}>Clear</button>
        <button className="primary" disabled={busy}>{busy ? <Loader2 className="msc-spin" size={17}/> : <CheckCircle2 size={17}/>} Save to PostgreSQL</button>
      </footer>
    </form>
  </section>;
}

function TransactionTable({ rows, onOpen }) {
  return <section className="msc-clean-card msc-table-card">
    <header><div><span>POSTGRESQL HISTORY</span><h3>Transactions</h3><p>All rows are loaded from money_service_transactions_v2.</p></div></header>
    <div className="msc-table-wrap">
      <table>
        <thead><tr><th>Date</th><th>Type</th><th>Customer</th><th>Wallet</th><th>Amount</th><th>Fee</th><th>Status</th><th></th></tr></thead>
        <tbody>{rows.length ? rows.map((row) => <tr key={row.id} onClick={() => onOpen(row.id)}>
          <td><b>{formatDate(row.createdAt)}</b><small>{row.transactionNumber}</small></td>
          <td><b>{serviceTitle(row.mode)}</b><small>{row.mode === 'CASH_OUT' ? 'Wallet → Cash' : 'Cash → Wallet'}</small></td>
          <td>{row.receiverName || row.withdrawerName || row.senderName || '-'}</td>
          <td>{row.walletName || '-'}</td>
          <td>{money(row.amount)}</td>
          <td className="msc-fee-cell">+{money(row.feeAmount)}</td>
          <td><StatusPill value={row.paymentStatus}/>{Number(row.dueAmount || 0) > 0 ? <small>{money(row.dueAmount)} due</small> : null}</td>
          <td><Eye size={17}/></td>
        </tr>) : <tr><td colSpan="8" className="msc-empty">No PostgreSQL transactions yet</td></tr>}</tbody>
      </table>
    </div>
  </section>;
}

export default function MoneyServiceCenterV23() {
  const [view, setView] = useState('ledger');
  const [settings, setSettings] = useState({ rates: {}, paymentMethods: [], accounts: [] });
  const [dashboard, setDashboard] = useState({ summary: {}, recent: [] });
  const [history, setHistory] = useState({ transactions: [], totalPages: 1 });
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [detailId, setDetailId] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [exporting, setExporting] = useState(false);

  const loadSettings = async () => setSettings(await apiFetch('/api/money-service/settings'));
  const loadDashboard = async () => setDashboard(await apiFetch('/api/money-service/dashboard'));
  const loadHistory = async () => {
    const params = new URLSearchParams({ page: String(page), limit: '20' });
    if (query.trim()) params.set('q', query.trim());
    if (status) params.set('status', status);
    setHistory(await apiFetch(`/api/money-service/transactions?${params}`));
  };

  const refresh = async () => {
    setLoading(true);
    setMessage('');
    try {
      await Promise.all([loadSettings(), loadDashboard(), loadHistory()]);
    } catch (error) {
      setMessage(error.message || 'Load failed');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); }, []);
  useEffect(() => { const timer = setTimeout(() => loadHistory().catch((error) => setMessage(error.message)), 180); return () => clearTimeout(timer); }, [query, status, page]);
  useEffect(() => setPage(1), [query, status]);

  const rows = history.transactions || [];
  const summary = dashboard.summary || {};

  const exportHistory = async () => {
    setExporting(true);
    try {
      const header = ['Date', 'Type', 'Customer', 'Wallet', 'Amount', 'Fee', 'Status', 'Transaction Number'];
      const csv = [
        header.join(','),
        ...rows.map((row) => [
          `"${formatDate(row.createdAt).replaceAll('"', '""')}"`,
          `"${serviceTitle(row.mode).replaceAll('"', '""')}"`,
          `"${String(row.receiverName || row.withdrawerName || row.senderName || '-').replaceAll('"', '""')}"`,
          `"${String(row.walletName || '-').replaceAll('"', '""')}"`,
          Number(row.amount || 0),
          Number(row.feeAmount || 0),
          `"${paymentText(row.paymentStatus).replaceAll('"', '""')}"`,
          `"${String(row.transactionNumber || '').replaceAll('"', '""')}"`,
        ].join(',')),
      ].join('\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const href = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = href;
      link.download = `money-service-postgresql-${new Date().toISOString().slice(0, 10)}.csv`;
      link.click();
      URL.revokeObjectURL(href);
    } finally {
      setExporting(false);
    }
  };

  return <section className="money-service-center">
    <header className="msc-heading">
      <div><span>MONEY SERVICE</span><h2>Money Service Ledger</h2><p>Transfer နဲ့ Cash Out ကို တစ်နေရာတည်းကနေ စာရင်းသွင်းပါ။</p></div>
      <button type="button" onClick={refresh} disabled={loading}>{loading ? <Loader2 className="msc-spin" size={17}/> : <Clock3 size={17}/>} Refresh</button>
    </header>

    <nav className="msc-nav clean">
      <button className={view === 'ledger' ? 'active' : ''} onClick={() => setView('ledger')}><CircleDollarSign size={18}/><span>Ledger</span></button>
      <button className={view === 'history' ? 'active' : ''} onClick={() => setView('history')}><History size={18}/><span>History</span></button>
      <button className={view === 'settings' ? 'active' : ''} onClick={() => setView('settings')}><Settings2 size={18}/><span>Wallet Link</span></button>
    </nav>

    {message ? <div className="msc-message">{message}</div> : null}

    {view !== 'settings' ? <section className="msc-postgres-summary">
      <article><Banknote/><span>Today Fees</span><b>{money(summary.todayFee)}</b><small>{summary.todayCount || 0} PostgreSQL rows</small></article>
      <article><ArrowUpFromLine/><span>Transfer</span><b>{money(summary.todayTransferAmount)}</b><small>Wallet out / Cash in</small></article>
      <article><ArrowDownToLine/><span>Cash Out</span><b>{money(summary.todayCashOutAmount)}</b><small>Customer wallet in / Cash out</small></article>
      <article><Wallet/><span>Pending Due</span><b>{money(summary.totalDue)}</b><small>{summary.pendingCount || 0} pending</small></article>
    </section> : null}

    {view === 'ledger' ? <div className="msc-clean-layout">
      <MoneyServiceForm settings={settings} onSaved={async (transaction) => { setDetailId(transaction.id); await refresh(); }}/>
      <div className="msc-clean-side">
        <section className="msc-clean-card">
          <header><div><span>RECENT POSTGRESQL ROWS</span><h3>Latest Transactions</h3><p>Directly from money_service_transactions_v2.</p></div></header>
        </section>
        <TransactionTable rows={dashboard.recent || []} onOpen={setDetailId}/>
      </div>
    </div> : null}

    {view === 'history' ? <section className="msc-history">
      <div className="msc-history-tools">
        <div><Search size={17}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Transaction no, name, phone"/></div>
        <select value={status} onChange={(event) => setStatus(event.target.value)}><option value="">All Status</option><option value="PENDING">Pending</option><option value="PARTIAL">Partial</option><option value="PAID">Done</option></select>
        <button type="button" onClick={exportHistory} disabled={exporting}>{exporting ? <Loader2 className="msc-spin" size={17}/> : <Download size={17}/>} Export</button>
      </div>
      <TransactionTable rows={rows} onOpen={setDetailId}/>
      <div className="msc-pagination"><button disabled={page <= 1} onClick={() => setPage(page - 1)}><ChevronLeft/></button><span>Page {page} / {history.totalPages || 1}</span><button disabled={page >= (history.totalPages || 1)} onClick={() => setPage(page + 1)}><ChevronRight/></button></div>
    </section> : null}

    {view === 'settings' ? <FinanceCatalogSettingsV23 embedded/> : null}
    {detailId ? <TransactionDetail id={detailId} settings={settings} onClose={() => setDetailId('')} onChanged={refresh}/> : null}
  </section>;
}
