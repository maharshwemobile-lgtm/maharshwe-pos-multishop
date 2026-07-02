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
  Loader2,
  Percent,
  RefreshCw,
  Save,
  Search,
  Settings2,
  Smartphone,
  UserRound,
  WalletCards,
} from 'lucide-react';
import { apiFetch, getSession } from './phase2Api';
import './remittance-workspace.css';

const EMPTY_FORM = {
  channel: 'KPAY',
  amount: '',
  feeMode: 'AUTO',
  feeAmount: '',
  senderName: '',
  senderPhone: '',
  receiverName: '',
  receiverPhone: '',
  withdrawerName: '',
  withdrawerPhone: '',
  cashAccountId: '',
  walletAccountId: '',
  reference: '',
  note: '',
};

const DEFAULT_RATES = {
  KPAY_TRANSFER: 1,
  KPAY_CASH_OUT: 1,
  WAVE_PAY_TRANSFER: 1,
  WAVE_PAY_CASH_OUT: 1,
  minimumFee: 0,
  roundTo: 100,
};

const money = (value) => `${Number(value || 0).toLocaleString('en-US')} MMK`;

function formatDate(value) {
  if (!value) return '-';
  try {
    return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
  } catch {
    return String(value);
  }
}

function calculatedFee(amount, rate, minimumFee, roundTo) {
  const raw = Number(amount || 0) * Number(rate || 0) / 100;
  const step = Math.max(1, Number(roundTo || 1));
  return Math.max(Number(minimumFee || 0), Math.ceil(raw / step) * step);
}

export default function RemittanceWorkspace() {
  const session = getSession();
  const role = session?.user?.role || '';
  const canManageRates = role === 'SUPER_ADMIN' || role === 'SHOP_ADMIN';
  const [tab, setTab] = useState('TRANSFER');
  const [form, setForm] = useState(EMPTY_FORM);
  const [rates, setRates] = useState(DEFAULT_RATES);
  const [rateDraft, setRateDraft] = useState(DEFAULT_RATES);
  const [accounts, setAccounts] = useState([]);
  const [history, setHistory] = useState({ transactions: [], total: 0, totalPages: 1, summary: {} });
  const [query, setQuery] = useState('');
  const [historyMode, setHistoryMode] = useState('');
  const [historyChannel, setHistoryChannel] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savingRates, setSavingRates] = useState(false);
  const [message, setMessage] = useState(null);

  const notify = (type, text) => {
    setMessage({ type, text });
    window.clearTimeout(notify.timer);
    notify.timer = window.setTimeout(() => setMessage(null), 4000);
  };

  const loadSettings = async () => {
    const response = await apiFetch('/api/remittances/settings');
    setRates({ ...DEFAULT_RATES, ...(response.rates || {}) });
    setRateDraft({ ...DEFAULT_RATES, ...(response.rates || {}) });
    setAccounts(response.accounts || []);
  };

  const loadHistory = async () => {
    const params = new URLSearchParams({ page: String(page), limit: '20' });
    if (query.trim()) params.set('q', query.trim());
    if (historyMode) params.set('mode', historyMode);
    if (historyChannel) params.set('channel', historyChannel);
    const response = await apiFetch(`/api/remittances?${params.toString()}`);
    setHistory(response);
  };

  const loadAll = async () => {
    setLoading(true);
    try {
      await Promise.all([loadSettings(), loadHistory()]);
    } catch (error) {
      notify('error', error.message || 'Remittance data load failed');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadAll(); }, []);
  useEffect(() => {
    if (tab !== 'HISTORY') return;
    const timer = window.setTimeout(() => loadHistory().catch((error) => notify('error', error.message)), 200);
    return () => window.clearTimeout(timer);
  }, [tab, query, historyMode, historyChannel, page]);
  useEffect(() => setPage(1), [query, historyMode, historyChannel]);

  const mode = tab === 'CASH_OUT' ? 'CASH_OUT' : 'TRANSFER';
  const typeKey = `${form.channel}_${mode}`;
  const rate = Number(rates[typeKey] || 0);
  const amount = Math.max(0, Number(form.amount || 0));
  const autoFee = calculatedFee(amount, rate, rates.minimumFee, rates.roundTo);
  const fee = form.feeMode === 'CUSTOM' ? Math.max(0, Number(form.feeAmount || 0)) : autoFee;
  const customerPays = amount + fee;
  const customerReceives = amount;
  const cashAccounts = accounts.filter((item) => item.type === 'CASH');
  const walletAccounts = accounts.filter((item) => item.type === form.channel);

  const resetForm = () => setForm({ ...EMPTY_FORM, channel: form.channel });

  const submit = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      const response = await apiFetch('/api/remittances', {
        method: 'POST',
        body: {
          ...form,
          mode,
          amount,
          feeAmount: form.feeMode === 'CUSTOM' ? fee : undefined,
          cashAccountId: form.cashAccountId || null,
          walletAccountId: form.walletAccountId || null,
        },
      });
      notify('success', `${response.transaction?.transactionNumber || ''} saved successfully`);
      resetForm();
      await Promise.all([loadSettings(), loadHistory()]);
    } catch (error) {
      notify('error', error.message || 'Remittance save failed');
    } finally {
      setSaving(false);
    }
  };

  const saveRates = async (event) => {
    event.preventDefault();
    setSavingRates(true);
    try {
      const response = await apiFetch('/api/remittances/settings', { method: 'PUT', body: rateDraft });
      setRates(response.rates || rateDraft);
      notify('success', 'Fee settings saved');
    } catch (error) {
      notify('error', error.message || 'Fee settings save failed');
    } finally {
      setSavingRates(false);
    }
  };

  const tabs = [
    ['TRANSFER', 'Money Transfer', ArrowUpFromLine],
    ['CASH_OUT', 'Cash Out', ArrowDownToLine],
    ['HISTORY', 'History', Clock3],
    ['SETTINGS', 'Fee Settings', Settings2],
  ];

  return (
    <section className="remittance-workspace">
      <header className="remittance-heading">
        <div><span>MONEY SERVICE</span><h2>Remittance & Cash Out</h2><p>KPay / Wave Pay ငွေလွှဲ၊ ငွေထုတ်နှင့် service fee ကို PostgreSQL တွင်မှတ်တမ်းတင်ပါ။</p></div>
        <button type="button" onClick={loadAll} disabled={loading}>{loading ? <Loader2 className="remit-spin" size={17}/> : <RefreshCw size={17}/>} Refresh</button>
      </header>

      <nav className="remittance-tabs">
        {tabs.map(([key, label, Icon]) => <button type="button" key={key} className={tab === key ? 'active' : ''} onClick={() => setTab(key)}><Icon size={18}/><span>{label}</span></button>)}
      </nav>

      {message ? <div className={`remittance-message ${message.type}`}>{message.type === 'success' ? <CheckCircle2 size={18}/> : <CircleDollarSign size={18}/>} {message.text}</div> : null}

      {tab === 'TRANSFER' || tab === 'CASH_OUT' ? <form className="remittance-form" onSubmit={submit}>
        <div className="remittance-form-main">
          <section className="remittance-card">
            <header><div className={mode === 'TRANSFER' ? 'transfer' : 'cashout'}>{mode === 'TRANSFER' ? <ArrowUpFromLine/> : <ArrowDownToLine/>}</div><span><b>{mode === 'TRANSFER' ? 'Money Transfer' : 'Cash Out'}</b><small>{form.channel === 'KPAY' ? 'KBZPay' : 'Wave Pay'} Service</small></span></header>
            <div className="remittance-grid">
              <label><span>Service Channel</span><select value={form.channel} onChange={(event) => setForm({ ...form, channel: event.target.value, walletAccountId: '' })}><option value="KPAY">KBZPay</option><option value="WAVE_PAY">Wave Pay</option></select></label>
              <label><span>Amount *</span><input type="number" min="1" step="1" required value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} placeholder="0"/></label>
              <label><span>Cash Account</span><select value={form.cashAccountId} onChange={(event) => setForm({ ...form, cashAccountId: event.target.value })}><option value="">Auto-select Cash</option>{cashAccounts.map((item) => <option key={item.id} value={item.id}>{item.name} · {money(item.balance)}</option>)}</select></label>
              <label><span>{form.channel === 'KPAY' ? 'KBZPay' : 'Wave Pay'} Account</span><select value={form.walletAccountId} onChange={(event) => setForm({ ...form, walletAccountId: event.target.value })}><option value="">Auto-select Wallet</option>{walletAccounts.map((item) => <option key={item.id} value={item.id}>{item.name} · {money(item.balance)}</option>)}</select></label>
            </div>

            {mode === 'TRANSFER' ? <>
              <div className="remittance-subtitle"><UserRound size={17}/><b>Sender Information</b><small>Optional</small></div>
              <div className="remittance-grid"><label><span>Sender Name</span><input value={form.senderName} onChange={(event) => setForm({ ...form, senderName: event.target.value })}/></label><label><span>Sender Phone</span><input value={form.senderPhone} onChange={(event) => setForm({ ...form, senderPhone: event.target.value })}/></label></div>
              <div className="remittance-subtitle"><Smartphone size={17}/><b>Receiver Information</b><small>Required</small></div>
              <div className="remittance-grid"><label><span>Receiver Name *</span><input required value={form.receiverName} onChange={(event) => setForm({ ...form, receiverName: event.target.value })}/></label><label><span>Receiver Phone *</span><input required value={form.receiverPhone} onChange={(event) => setForm({ ...form, receiverPhone: event.target.value })}/></label></div>
            </> : <>
              <div className="remittance-subtitle"><UserRound size={17}/><b>Withdrawer Information</b><small>Optional</small></div>
              <div className="remittance-grid"><label><span>Withdrawer Name</span><input value={form.withdrawerName} onChange={(event) => setForm({ ...form, withdrawerName: event.target.value })}/></label><label><span>Withdrawer Phone</span><input value={form.withdrawerPhone} onChange={(event) => setForm({ ...form, withdrawerPhone: event.target.value })}/></label></div>
            </>}

            <div className="remittance-grid"><label><span>Reference / Transaction ID</span><input value={form.reference} onChange={(event) => setForm({ ...form, reference: event.target.value })}/></label><label><span>Note</span><input value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })}/></label></div>
          </section>

          <aside className="remittance-card remittance-fee-card">
            <header><div><Percent/></div><span><b>Service Fee</b><small>Auto percentage or custom</small></span></header>
            <div className="remittance-fee-switch"><button type="button" className={form.feeMode === 'AUTO' ? 'active' : ''} onClick={() => setForm({ ...form, feeMode: 'AUTO' })}>Auto {rate}%</button><button type="button" className={form.feeMode === 'CUSTOM' ? 'active' : ''} onClick={() => setForm({ ...form, feeMode: 'CUSTOM' })}>Custom</button></div>
            {form.feeMode === 'CUSTOM' ? <label><span>Custom Fee</span><input type="number" min="0" value={form.feeAmount} onChange={(event) => setForm({ ...form, feeAmount: event.target.value })}/></label> : <div className="remittance-auto-note">Rate {rate}% · Minimum {money(rates.minimumFee)} · Round up {money(rates.roundTo)}</div>}
            <div className="remittance-preview">
              <div><span>Service Amount</span><b>{money(amount)}</b></div>
              <div><span>Fee</span><b>{money(fee)}</b></div>
              <div className="total"><span>Customer Pays</span><b>{money(customerPays)}</b></div>
              <div><span>Customer Receives</span><b>{money(customerReceives)}</b></div>
            </div>
            <button className="remittance-submit" type="submit" disabled={saving || amount <= 0}>{saving ? <Loader2 className="remit-spin" size={18}/> : <Save size={18}/>} Save Transaction</button>
          </aside>
        </div>
      </form> : null}

      {tab === 'HISTORY' ? <section className="remittance-history-card">
        <div className="remittance-toolbar"><div><Search size={17}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Transaction no, name or phone"/></div><select value={historyMode} onChange={(event) => setHistoryMode(event.target.value)}><option value="">All Types</option><option value="TRANSFER">Transfer</option><option value="CASH_OUT">Cash Out</option></select><select value={historyChannel} onChange={(event) => setHistoryChannel(event.target.value)}><option value="">All Channels</option><option value="KPAY">KBZPay</option><option value="WAVE_PAY">Wave Pay</option></select></div>
        <div className="remittance-summary"><article><Banknote/><span>Total Amount</span><b>{money(history.summary?.amount)}</b></article><article><CircleDollarSign/><span>Total Fee</span><b>{money(history.summary?.fee)}</b></article><article><WalletCards/><span>Transactions</span><b>{Number(history.total || 0).toLocaleString()}</b></article></div>
        <div className="remittance-table-wrap"><table><thead><tr><th>Date</th><th>No.</th><th>Type</th><th>Customer / Receiver</th><th>Amount</th><th>Fee</th><th>Accounts</th><th>Staff</th></tr></thead><tbody>{(history.transactions || []).map((row) => <tr key={row.id}><td>{formatDate(row.createdAt)}</td><td><b>{row.transactionNumber}</b><small>{row.channel}</small></td><td><span className={`remittance-type ${row.mode.toLowerCase()}`}>{row.mode === 'TRANSFER' ? 'Transfer' : 'Cash Out'}</span></td><td><b>{row.mode === 'TRANSFER' ? row.receiverName : row.withdrawerName || '-'}</b><small>{row.mode === 'TRANSFER' ? row.receiverPhone : row.withdrawerPhone || '-'}</small></td><td>{money(row.amount)}</td><td><b>{money(row.feeAmount)}</b><small>{row.feeMode === 'AUTO' ? `${row.feeRate}%` : 'Custom'}</small></td><td><small>{row.cashAccountName}</small><small>{row.walletAccountName}</small></td><td>{row.staffName || '-'}</td></tr>)}{!history.transactions?.length ? <tr><td colSpan="8" className="remittance-empty">No remittance records found.</td></tr> : null}</tbody></table></div>
        <footer><span>Showing {history.transactions?.length || 0} of {history.total || 0}</span><div><button type="button" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}><ChevronLeft size={16}/> Previous</button><b>{page} / {Math.max(1, history.totalPages || 1)}</b><button type="button" disabled={page >= Math.max(1, history.totalPages || 1)} onClick={() => setPage((value) => value + 1)}>Next <ChevronRight size={16}/></button></div></footer>
      </section> : null}

      {tab === 'SETTINGS' ? <form className="remittance-settings-card" onSubmit={saveRates}>
        <header><div><Settings2 size={22}/><span><h3>Automatic Fee Configuration</h3><p>Transaction type တစ်ခုချင်းစီအတွက် percentage သတ်မှတ်ပါ။</p></span></div></header>
        {!canManageRates ? <div className="remittance-settings-disabled">Shop Admin only</div> : <><div className="remittance-settings-grid">{[['KPAY_TRANSFER','KBZPay Transfer %'],['KPAY_CASH_OUT','KBZPay Cash Out %'],['WAVE_PAY_TRANSFER','Wave Pay Transfer %'],['WAVE_PAY_CASH_OUT','Wave Pay Cash Out %'],['minimumFee','Minimum Fee'],['roundTo','Round Fee To']].map(([key,label]) => <label key={key}><span>{label}</span><input type="number" min="0" step={key.includes('TRANSFER') || key.includes('CASH_OUT') ? '0.01' : '1'} value={rateDraft[key]} onChange={(event) => setRateDraft({ ...rateDraft, [key]: event.target.value })}/></label>)}</div><button type="submit" disabled={savingRates}>{savingRates ? <Loader2 className="remit-spin" size={18}/> : <Save size={18}/>} Save Fee Settings</button></>}
      </form> : null}
    </section>
  );
}
