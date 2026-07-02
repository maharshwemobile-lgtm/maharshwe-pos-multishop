import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowDownCircle,
  ArrowLeftRight,
  ArrowUpCircle,
  Banknote,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  CreditCard,
  FileText,
  History,
  Landmark,
  Loader2,
  Search,
  SlidersHorizontal,
  Smartphone,
  WalletCards,
  X,
} from 'lucide-react';
import { apiFetch, clearSession } from './phase2Api';
import './payments-accounts.css';

const money = (value) => `${Number(value || 0).toLocaleString('en-US')} MMK`;

const ACCOUNT_META = {
  CASH: { label: 'Cash', tone: 'green', icon: Banknote },
  KPAY: { label: 'KPay', tone: 'blue', icon: WalletCards },
  WAVE_PAY: { label: 'Wave Pay', tone: 'purple', icon: Smartphone },
  OTHER: { label: 'Other', tone: 'orange', icon: Landmark },
};

const SOURCE_META = {
  SALE: { label: 'Sale', tone: 'green' },
  REPAIR: { label: 'Repair', tone: 'blue' },
  ADJUSTMENT: { label: 'Adjustment', tone: 'orange' },
  TRANSFER: { label: 'Transfer', tone: 'purple' },
};

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

function AdjustmentModal({ account, onClose, onSaved }) {
  const [direction, setDirection] = useState('increase');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const value = Math.max(0, Number(amount || 0));
  const delta = direction === 'decrease' ? -value : value;
  const before = Number(account.balance || 0);
  const after = before + delta;
  const MetaIcon = ACCOUNT_META[account.type]?.icon || CreditCard;

  const submit = async (event) => {
    event.preventDefault();
    if (value <= 0) return setError('Amount must be greater than zero.');
    if (!note.trim()) return setError('Adjustment reason ထည့်ပါ။');
    if (after < 0) return setError('Account balance cannot be negative.');
    setBusy(true);
    setError('');
    try {
      await apiFetch(`/api/payments/accounts/${account.id}/adjust`, {
        method: 'POST',
        body: { direction, amount: value, note: note.trim(), reference: reference.trim() || null },
      });
      await onSaved(`${account.name} account adjusted`);
    } catch (requestError) {
      setError(requestError.message || 'Account adjustment failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="payments-modal-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !busy) onClose();
    }}>
      <section className="payments-modal" role="dialog" aria-modal="true">
        <header>
          <div className={`payments-modal-icon payments-tone-${ACCOUNT_META[account.type]?.tone || 'blue'}`}><MetaIcon size={24} /></div>
          <div><h3>Adjust Account</h3><p>{account.name} · {money(account.balance)}</p></div>
          <button type="button" className="payments-icon-button" onClick={onClose} disabled={busy}><X size={20} /></button>
        </header>

        <form onSubmit={submit} className="payments-form">
          <div className="payments-balance-preview">
            <div><span>Before</span><b>{money(before)}</b></div>
            <div className={delta >= 0 ? 'payments-change-positive' : 'payments-change-negative'}><span>Change</span><b>{delta >= 0 ? '+' : ''}{money(delta)}</b></div>
            <div className={after < 0 ? 'payments-after-warning' : ''}><span>After</span><b>{money(after)}</b></div>
          </div>

          <div className="payments-direction-switch">
            <button type="button" className={direction === 'increase' ? 'active increase' : ''} onClick={() => setDirection('increase')}><ArrowUpCircle size={18} /> Increase</button>
            <button type="button" className={direction === 'decrease' ? 'active decrease' : ''} onClick={() => setDirection('decrease')}><ArrowDownCircle size={18} /> Decrease</button>
          </div>

          <label className="payments-field"><span>Amount *</span><input type="number" min="1" step="1" value={amount} onChange={(event) => setAmount(event.target.value)} autoFocus required /></label>
          <label className="payments-field"><span>Reference</span><input value={reference} onChange={(event) => setReference(event.target.value)} placeholder="Voucher / transaction ID" /></label>
          <label className="payments-field"><span>Reason *</span><textarea rows="3" value={note} onChange={(event) => setNote(event.target.value)} placeholder="Cash count correction, opening balance..." required /></label>
          {error ? <div className="payments-form-error">{error}</div> : null}
          <footer>
            <button type="button" onClick={onClose} disabled={busy}>Cancel</button>
            <button type="submit" className="payments-submit" disabled={busy}>{busy ? <Loader2 className="payments-spin" size={18} /> : <CheckCircle2 size={18} />} Save Adjustment</button>
          </footer>
        </form>
      </section>
    </div>
  );
}

function TransferModal({ accounts, defaultFrom, onClose, onSaved }) {
  const available = accounts.filter((account) => account.active !== false);
  const initialFrom = defaultFrom?.id || available[0]?.id || '';
  const initialTo = available.find((account) => account.id !== initialFrom)?.id || '';
  const [fromId, setFromId] = useState(initialFrom);
  const [toId, setToId] = useState(initialTo);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const from = available.find((account) => account.id === fromId);
  const to = available.find((account) => account.id === toId);
  const value = Math.max(0, Number(amount || 0));

  const submit = async (event) => {
    event.preventDefault();
    if (!from || !to) return setError('Choose source and destination accounts.');
    if (from.id === to.id) return setError('Choose two different accounts.');
    if (value <= 0) return setError('Amount must be greater than zero.');
    if (value > Number(from.balance || 0)) return setError('Transfer amount is greater than source balance.');
    setBusy(true);
    setError('');
    try {
      await apiFetch('/api/payments/accounts/transfer', {
        method: 'POST',
        body: { fromAccountId: from.id, toAccountId: to.id, amount: value, note: note.trim() || null },
      });
      await onSaved(`${from.name} → ${to.name} transfer completed`);
    } catch (requestError) {
      setError(requestError.message || 'Account transfer failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="payments-modal-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !busy) onClose();
    }}>
      <section className="payments-modal" role="dialog" aria-modal="true">
        <header>
          <div className="payments-modal-icon payments-tone-purple"><ArrowLeftRight size={24} /></div>
          <div><h3>Transfer Between Accounts</h3><p>Cash, KPay, Wave Pay account balances</p></div>
          <button type="button" className="payments-icon-button" onClick={onClose} disabled={busy}><X size={20} /></button>
        </header>

        <form onSubmit={submit} className="payments-form">
          <div className="payments-transfer-preview">
            <div><span>From</span><b>{from?.name || '-'}</b><small>{money(from?.balance)}</small><em>-{money(value)}</em></div>
            <ArrowLeftRight size={24} />
            <div><span>To</span><b>{to?.name || '-'}</b><small>{money(to?.balance)}</small><em>+{money(value)}</em></div>
          </div>
          <label className="payments-field"><span>From Account</span><select value={fromId} onChange={(event) => setFromId(event.target.value)}>{available.map((account) => <option key={account.id} value={account.id}>{account.name} — {money(account.balance)}</option>)}</select></label>
          <label className="payments-field"><span>To Account</span><select value={toId} onChange={(event) => setToId(event.target.value)}>{available.filter((account) => account.id !== fromId).map((account) => <option key={account.id} value={account.id}>{account.name} — {money(account.balance)}</option>)}</select></label>
          <label className="payments-field"><span>Amount *</span><input type="number" min="1" max={Number(from?.balance || 0)} step="1" value={amount} onChange={(event) => setAmount(event.target.value)} autoFocus required /></label>
          <label className="payments-field"><span>Note</span><textarea rows="2" value={note} onChange={(event) => setNote(event.target.value)} placeholder="Bank deposit, wallet top-up..." /></label>
          {error ? <div className="payments-form-error">{error}</div> : null}
          <footer>
            <button type="button" onClick={onClose} disabled={busy}>Cancel</button>
            <button type="submit" className="payments-submit payments-submit-purple" disabled={busy}>{busy ? <Loader2 className="payments-spin" size={18} /> : <ArrowLeftRight size={18} />} Transfer</button>
          </footer>
        </form>
      </section>
    </div>
  );
}

export default function PaymentsAccountsPage({ onNavigate }) {
  const [data, setData] = useState({ accounts: [], transactions: [], summary: {}, total: 0, totalPages: 1 });
  const [query, setQuery] = useState('');
  const [accountType, setAccountType] = useState('');
  const [source, setSource] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState(null);
  const [adjustAccount, setAdjustAccount] = useState(null);
  const [transferFrom, setTransferFrom] = useState(null);

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
      if (accountType) params.set('accountType', accountType);
      if (source) params.set('source', source);
      if (fromDate) params.set('from', fromDate);
      if (toDate) params.set('to', toDate);
      const response = await apiFetch(`/api/payments/accounts?${params.toString()}`);
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
  }, [query, accountType, source, fromDate, toDate, page]);

  useEffect(() => setPage(1), [query, accountType, source, fromDate, toDate]);

  const afterSaved = async (text) => {
    setAdjustAccount(null);
    setTransferFrom(null);
    notify('success', text);
    await load();
  };

  const openRelated = (row) => {
    if (row.source === 'SALE' && row.reference) {
      window.sessionStorage.setItem('mahar-pos-sales-history-query', row.reference);
      onNavigate?.('Sales History');
    } else if (row.source === 'REPAIR') {
      onNavigate?.('Repairs');
    }
  };

  const summary = data.summary || {};
  const cards = useMemo(() => [
    { label: 'Total Account Balance', value: money(summary.totalBalance), icon: Landmark, tone: 'green' },
    { label: 'Today Received', value: money(summary.todayReceived), icon: CircleDollarSign, tone: 'blue', hint: `${Number(summary.todayCount || 0)} payments` },
    { label: 'Customer Receivable', value: money(summary.receivable), icon: CreditCard, tone: 'orange' },
    { label: 'Active Accounts', value: Number(summary.activeAccounts || 0).toLocaleString(), icon: WalletCards, tone: 'purple' },
  ], [summary]);

  return (
    <section className="payments-page">
      <div className="payments-page-heading">
        <div><span className="payments-eyebrow">PAYMENTS</span><h2>Payments & Accounts</h2><p>Sale / repair / customer credit and wallet account balances are managed here.</p></div>
        <div className="payments-heading-actions">
          <button type="button" className="payments-transfer-button" onClick={() => setTransferFrom(data.accounts?.[0] || null)} disabled={(data.accounts?.length || 0) < 2}><ArrowLeftRight size={18} /> Transfer</button>
        </div>
      </div>

      <div className="payments-summary-grid">
        {cards.map((card) => <article key={card.label}><div className={`payments-summary-icon payments-tone-${card.tone}`}><card.icon size={23} /></div><span>{card.label}</span><b>{card.value}</b>{card.hint ? <small>{card.hint}</small> : null}</article>)}
      </div>

      <section className="payments-wallet-section">
        <header>
          <div><span>ACCOUNTS WALLET</span><h3>Accounts / Wallet Balances</h3><p>Cash, KPay, Wave Pay နှင့် အခြား wallet account များကို ဒီနေရာမှာသီးသန့်ကြည့်/ပြင်ပါ။</p></div>
        </header>
        <div className="payments-account-grid">
          {(data.accounts || []).map((account) => {
            const meta = ACCOUNT_META[account.type] || { label: account.name, tone: 'blue', icon: CreditCard };
            const Icon = meta.icon;
            return <article key={account.id} className="payments-account-card"><div className={`payments-account-icon payments-tone-${meta.tone}`}><Icon size={23} /></div><div><span>{account.name}</span><b>{money(account.balance)}</b><small>{meta.label} account</small></div><div className="payments-account-actions"><button type="button" onClick={() => setAdjustAccount(account)}><SlidersHorizontal size={15} /> Adjust</button><button type="button" onClick={() => setTransferFrom(account)} disabled={(data.accounts?.length || 0) < 2}><ArrowLeftRight size={15} /> Transfer</button></div></article>;
          })}
        </div>
      </section>

      <section className="payments-card payments-history-card">
        <header className="payments-card-title"><div><span>TRANSACTION HISTORY</span><h3>Payment / Account Records</h3><p>Sale, Repair, Adjustment, Transfer record များကို သီးသန့်စစ်ပါ။</p></div></header>
        <div className="payments-toolbar">
          <div className="payments-search-box"><Search size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search invoice, customer, reference or account" /></div>
          <input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} aria-label="From date" />
          <input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} aria-label="To date" />
          <select value={accountType} onChange={(event) => setAccountType(event.target.value)}><option value="">All Accounts</option><option value="CASH">Cash</option><option value="KPAY">KPay</option><option value="WAVE_PAY">Wave Pay</option><option value="OTHER">Other</option></select>
          <select value={source} onChange={(event) => setSource(event.target.value)}><option value="">All Sources</option><option value="SALE">Sale</option><option value="REPAIR">Repair</option><option value="ADJUSTMENT">Adjustment</option><option value="TRANSFER">Transfer</option></select>
        </div>

        <div className="payments-table-wrap">
          <table className="payments-table">
            <thead><tr><th>Date</th><th>Source</th><th>Account</th><th>Description</th><th>Reference</th><th>Staff</th><th>Amount</th><th>Status</th><th>Action</th></tr></thead>
            <tbody>
              {(data.transactions || []).map((row) => {
                const sourceMeta = SOURCE_META[row.source] || { label: row.source, tone: 'blue' };
                const positive = row.direction === 'IN';
                return <tr key={row.id}><td>{formatDate(row.date)}</td><td><span className={`payments-type-badge payments-type-${sourceMeta.tone}`}>{sourceMeta.label}</span></td><td><b>{row.accountName}</b><small>{ACCOUNT_META[row.accountType]?.label || row.accountType}</small></td><td className="payments-description-cell">{row.description}</td><td>{row.reference || '-'}</td><td>{row.actor || '-'}</td><td className={positive ? 'payments-amount-positive' : row.direction === 'OUT' ? 'payments-amount-negative' : 'payments-amount-muted'}>{positive ? '+' : row.direction === 'OUT' ? '-' : ''}{money(row.amount)}</td><td><span className={`payments-status ${row.status === 'PAID' || row.status === 'POSTED' ? 'posted' : 'voided'}`}>{row.status}</span></td><td>{row.source === 'SALE' || row.source === 'REPAIR' ? <button type="button" className="payments-open-button" onClick={() => openRelated(row)}><History size={15} /> Open</button> : '—'}</td></tr>;
              })}
              {!data.transactions?.length && !loading ? <tr><td colSpan="9"><div className="payments-empty"><FileText size={30} /><span>No payment transactions found.</span></div></td></tr> : null}
            </tbody>
          </table>
          {loading ? <div className="payments-loading"><Loader2 className="payments-spin" /> Loading payments and account balances…</div> : null}
        </div>

        <div className="payments-pagination">
          <span>Showing {data.transactions?.length || 0} of {data.total || 0} transactions</span>
          <div><button type="button" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}><ChevronLeft size={17} /> Previous</button><b>Page {page} / {Math.max(1, data.totalPages || 1)}</b><button type="button" disabled={page >= Math.max(1, data.totalPages || 1)} onClick={() => setPage((value) => value + 1)}>Next <ChevronRight size={17} /></button></div>
        </div>
      </section>

      {message ? <div className={`payments-toast payments-toast-${message.type}`}>{message.text}</div> : null}
      {adjustAccount ? <AdjustmentModal account={adjustAccount} onClose={() => setAdjustAccount(null)} onSaved={afterSaved} /> : null}
      {transferFrom ? <TransferModal accounts={data.accounts || []} defaultFrom={transferFrom} onClose={() => setTransferFrom(null)} onSaved={afterSaved} /> : null}
    </section>
  );
}

