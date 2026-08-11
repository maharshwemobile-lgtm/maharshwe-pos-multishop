import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUpFromLine,
  Banknote,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  Download,
  Eye,
  FileText,
  History,
  Loader2,
  Pencil,
  Plus,
  Search,
  Wallet,
  X,
} from 'lucide-react';
import { apiFetch } from './phase2Api';
import FinanceCatalogSettingsV23 from './FinanceCatalogSettingsV23.jsx';
import MoneyServiceFeeSettingsV23 from './MoneyServiceFeeSettingsV23.jsx';
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
const todayDate = () => new Date().toISOString().slice(0, 10);
const formatDate = (value) => value ? new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '-';
const serviceTitle = (mode) => (mode === 'CASH_OUT' ? 'Cash Out' : 'Transfer');
const paymentText = (status) => ({ PAID: 'Done', PARTIAL: 'Partial', PENDING: 'Pending', VOIDED: 'Voided' }[status] || status || 'Done');
const billerTypeText = (type) => ({ SOLD: 'Sale', REFILL: 'Refill', ADJUSTMENT: 'Balance Correction', OPENING: 'Opening Balance' }[type] || type || '-');
const dateInputValue = (value) => {
  const date = value ? new Date(value) : new Date();
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
};

function StatusPill({ value }) {
  const text = paymentText(value);
  const tone = value === 'PAID' ? 'paid' : value === 'PARTIAL' ? 'partial' : value === 'VOIDED' ? 'voided' : 'pending';
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
  const cashAccounts = useMemo(() => accounts.filter((account) => account.type === 'CASH'), [accounts]);
  const otherAccounts = useMemo(() => accounts.filter((account) => account.type !== 'CASH'), [accounts]);
  // Cash Out must settle from a CASH account (server guard). Transfer may land in any active account.
  const cashOptions = form.mode === 'CASH_OUT' ? cashAccounts : [...cashAccounts, ...otherAccounts];
  const method = methods.find((item) => item.id === form.paymentMethodId);
  const { rate, autoFee, fee, total } = computeFee(settings, method, form);
  const amount = Number(form.amount || 0);
  const isPending = form.paymentTiming === 'PAY_LATER';
  const due = isPending ? (form.mode === 'CASH_OUT' ? amount : total) : 0;

  const cashOptionIds = cashOptions.map((account) => account.id).join(',');

  useEffect(() => {
    setForm((current) => ({
      ...current,
      paymentMethodId: current.paymentMethodId || methods[0]?.id || '',
      // keep the chosen account when it is still selectable, otherwise fall back to the first valid one
      cashAccountId: cashOptions.some((account) => account.id === current.cashAccountId)
        ? current.cashAccountId
        : (cashOptions[0]?.id || ''),
    }));
  }, [methods.length, cashOptionIds]);

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
    if (!form.cashAccountId) return setMessage(cashOptions.length ? 'Cash account ရွေးရန်လိုပါတယ်' : 'Cash account မရှိသေးပါ — Money Accounts မှာ အရင်ဖန်တီးပါ');
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

  const walletName = methods.find((item) => item.id === form.paymentMethodId)?.name || 'Wallet';
  const cashName = cashOptions.find((item) => item.id === form.cashAccountId)?.name || 'Cash';

  return <section className="msc-clean-card msc-entry-card msc-simple-entry">
    <div className="msc-service-switch">
      <button type="button" className={form.mode === 'TRANSFER' ? 'active' : ''} onClick={() => changeMode('TRANSFER')}><ArrowUpFromLine size={18}/> ငွေလွှဲ Transfer</button>
      <button type="button" className={form.mode === 'CASH_OUT' ? 'active cashout' : ''} onClick={() => changeMode('CASH_OUT')}><ArrowDownToLine size={18}/> ငွေထုတ် Cash Out</button>
    </div>

    <p className="msc-flow-line">
      {form.mode === 'CASH_OUT'
        ? <><b>{walletName}</b> ထဲ ငွေဝင် <ArrowRight size={14}/> <b>{cashName}</b> ကနေ Cash ထုတ်ပေး</>
        : <><b>{walletName}</b> ကနေ ငွေလွှဲထွက် <ArrowRight size={14}/> <b>{cashName}</b> ထဲ Cash ဝင်</>}
    </p>

    {message ? <div className="msc-message">{message}</div> : null}

    <form onSubmit={submit} className="msc-clean-form">
      <div className="msc-amount-block">
        <label className="msc-amount-field">
          <span>{form.mode === 'CASH_OUT' ? 'ငွေထုတ်ပမာဏ' : 'ငွေလွှဲပမာဏ'} *</span>
          <input type="number" min="1" inputMode="numeric" value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} placeholder="0"/>
        </label>
        <div className="msc-amount-side">
          <div className="msc-fee-row">
            <span>Service Fee</span>
            {form.feeMode === 'CUSTOM'
              ? <input type="number" min="0" value={form.feeAmount} onChange={(event) => setForm({ ...form, feeAmount: event.target.value })} autoFocus/>
              : <b>{money(fee)}</b>}
            <button type="button" onClick={() => setForm({ ...form, feeMode: form.feeMode === 'CUSTOM' ? 'AUTO' : 'CUSTOM', feeAmount: form.feeMode === 'CUSTOM' ? '' : String(autoFee) })}>
              {form.feeMode === 'CUSTOM' ? `Auto ${rate}%` : 'ကိုယ်တိုင်ထည့်'}
            </button>
          </div>
          <div className="msc-total-row">
            <span>{form.mode === 'CASH_OUT' ? 'Wallet ဝင်ငွေ' : 'Customer ပေးရမည်'}</span>
            <b>{money(total)}</b>
          </div>
          {due > 0 ? <div className="msc-total-row due"><span>ကြွေးကျန်</span><b>{money(due)}</b></div> : null}
        </div>
      </div>

      <div className="msc-form-row">
        <label>
          <span>{form.mode === 'CASH_OUT' ? 'ငွေဝင်မည့် Wallet' : 'ငွေထွက်မည့် Wallet'} *</span>
          <select required value={form.paymentMethodId} onChange={(event) => setForm({ ...form, paymentMethodId: event.target.value })}>
            <option value="">{methods.length ? 'Wallet ရွေးပါ' : 'Wallet မရှိသေးပါ — Project Settings မှာ ထည့်ပါ'}</option>
            {methods.map((item) => <option key={item.id} value={item.id}>{item.name} · {money(item.balance)}</option>)}
          </select>
        </label>
        <label>
          <span>{form.mode === 'CASH_OUT' ? 'Cash ထုတ်မည့် Account' : 'Cash ဝင်မည့် Account'} *</span>
          <select value={form.cashAccountId} onChange={(event) => setForm({ ...form, cashAccountId: event.target.value })}>
            <option value="">Choose account</option>
            {cashAccounts.length ? <optgroup label="Cash">
              {cashAccounts.map((account) => <option key={account.id} value={account.id}>{account.name} · {money(account.balance)}</option>)}
            </optgroup> : null}
            {form.mode !== 'CASH_OUT' && otherAccounts.length ? <optgroup label="Other accounts">
              {otherAccounts.map((account) => <option key={account.id} value={account.id}>{account.name} · {money(account.balance)}</option>)}
            </optgroup> : null}
          </select>
        </label>
      </div>

      {form.mode === 'TRANSFER' ? <div className="msc-form-row">
        <label><span>လက်ခံသူ အမည် *</span><input value={form.receiverName} onChange={(event) => setForm({ ...form, receiverName: event.target.value })} placeholder="Receiver name"/></label>
        <label><span>လက်ခံသူ ဖုန်း *</span><input value={form.receiverPhone} onChange={(event) => setForm({ ...form, receiverPhone: event.target.value })} placeholder="09..."/></label>
      </div> : <div className="msc-form-row">
        <label><span>ငွေထုတ်သူ အမည်</span><input value={form.withdrawerName} onChange={(event) => setForm({ ...form, withdrawerName: event.target.value })} placeholder="Optional"/></label>
        <label><span>ငွေထုတ်သူ ဖုန်း</span><input value={form.withdrawerPhone} onChange={(event) => setForm({ ...form, withdrawerPhone: event.target.value })} placeholder="Optional"/></label>
      </div>}

      <div className="msc-payment-line">
        <label className={form.paymentTiming === 'PAID_NOW' ? 'active' : ''}><input type="radio" checked={form.paymentTiming === 'PAID_NOW'} onChange={() => setForm({ ...form, paymentTiming: 'PAID_NOW', dueDate: '' })}/> ပြီးပြီ</label>
        <label className={form.paymentTiming === 'PAY_LATER' ? 'active warning' : ''}><input type="radio" checked={form.paymentTiming === 'PAY_LATER'} onChange={() => setForm({ ...form, paymentTiming: 'PAY_LATER' })}/> ကြွေးကျန်</label>
        {form.paymentTiming === 'PAY_LATER' ? <input type="date" value={form.dueDate} onChange={(event) => setForm({ ...form, dueDate: event.target.value })}/> : null}
      </div>

      <details className="msc-optional-clean">
        <summary>ပေးပို့သူ / Reference (မထည့်လည်းရ)</summary>
        <div className="msc-form-row">
          <label><span>Sender Name</span><input value={form.senderName} onChange={(event) => setForm({ ...form, senderName: event.target.value })}/></label>
          <label><span>Sender Phone</span><input value={form.senderPhone} onChange={(event) => setForm({ ...form, senderPhone: event.target.value })}/></label>
          <label><span>Reference</span><input value={form.reference} onChange={(event) => setForm({ ...form, reference: event.target.value })}/></label>
          <label><span>Note</span><input value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })}/></label>
        </div>
      </details>

      <footer>
        <button type="button" onClick={reset}>Clear</button>
        <button className="primary" disabled={busy}>{busy ? <Loader2 className="msc-spin" size={17}/> : <CheckCircle2 size={17}/>} သိမ်းမည်</button>
      </footer>
    </form>
  </section>;
}

function TransactionTable({ rows, onOpen, onVoid }) {
  return <section className="msc-clean-card msc-table-card">
    <header><div><span>MONEY SERVICE HISTORY</span><h3>ငွေလွှဲ / ငွေထုတ် စာရင်းမှတ်တမ်း</h3><p>ရက်စွဲရွေးပြီး စာရင်းကြည့်၊ မှားယွင်းစာရင်းကို Void လုပ်နိုင်ပါသည်။</p></div></header>
    <div className="msc-table-wrap">
      <table>
        <thead><tr><th>Date</th><th>Type</th><th>Customer</th><th>Wallet</th><th>Amount</th><th>Fee</th><th>Status</th><th>Action</th></tr></thead>
        <tbody>{rows.length ? rows.map((row) => <tr key={row.id} className={row.voidedAt ? 'voided' : ''} onClick={() => onOpen(row.id)}>
          <td><b>{formatDate(row.createdAt)}</b><small>{row.transactionNumber}</small></td>
          <td><b>{serviceTitle(row.mode)}</b><small>{row.mode === 'CASH_OUT' ? 'Wallet → Cash' : 'Cash → Wallet'}</small></td>
          <td>{row.receiverName || row.withdrawerName || row.senderName || '-'}</td>
          <td>{row.walletName || '-'}</td>
          <td>{money(row.amount)}</td>
          <td className="msc-fee-cell">+{money(row.feeAmount)}</td>
          <td><StatusPill value={row.paymentStatus}/>{Number(row.dueAmount || 0) > 0 ? <small>{money(row.dueAmount)} due</small> : null}</td>
          <td><div className="msc-row-actions"><button type="button" onClick={(event) => { event.stopPropagation(); onOpen(row.id); }}><Eye size={15}/> View</button>{!row.voidedAt ? <button type="button" className="danger" onClick={(event) => { event.stopPropagation(); onVoid(row); }}><X size={15}/> Void</button> : null}</div></td>
        </tr>) : <tr><td colSpan="8" className="msc-empty">No PostgreSQL transactions yet</td></tr>}</tbody>
      </table>
    </div>
  </section>;
}

const BILLER_TYPES = [
  ['TOPUP_CARD', 'Top-up Card'],
  ['ELOAD', 'Eload'],
  ['BILL_PAYMENT', 'Bill Payment'],
  ['OTHER', 'Other'],
];

function AccountSelect({ accounts, value, onChange, label = 'Payment Account' }) {
  return <label><span>{label}</span><select value={value} onChange={(event) => onChange(event.target.value)}>
    <option value="">No account adjustment</option>
    {(accounts || []).map((account) => <option value={account.id} key={account.id}>{account.name} · {money(account.balance)}</option>)}
  </select></label>;
}

function BillerSaleForm({ settings, onSaved }) {
  const billers = (settings.billers || []).filter((item) => item.isActive !== false);
  const accounts = settings.accounts || [];
  const staff = settings.staff || [];
  const [form, setForm] = useState({ billerId: '', amount: '', balanceAdjustMode: 'NONE', balanceAdjustPercent: '', costAmount: '', profitAmount: '', customerPhone: '', paymentMethod: 'CASH', paymentAccountId: '', paymentTiming: 'PAID_NOW', paidAmount: '', dueDate: '', staffId: '', note: '' });
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const biller = billers.find((item) => item.id === form.billerId);
  const isAtomEload = /atom\s*eload/i.test(biller?.name || '');
  const amountValue = Number(form.amount || 0);
  const defaultAdjustMode = biller?.saleAdjustMode || 'NONE';
  const defaultAdjustPercent = Number(biller?.saleAdjustPercent || 0);
  const useCustomAdjust = form.balanceAdjustMode !== 'NONE' || Number(form.balanceAdjustPercent || 0) > 0;
  const effectiveAdjustMode = useCustomAdjust ? form.balanceAdjustMode : defaultAdjustMode;
  const adjustPercent = useCustomAdjust ? Number(form.balanceAdjustPercent || 0) : defaultAdjustPercent;
  const effectMultiplier = effectiveAdjustMode === 'ADD_PERCENT'
    ? (1 + adjustPercent / 100)
    : effectiveAdjustMode === 'SUBTRACT_PERCENT'
      ? Math.max(0, 1 - adjustPercent / 100)
      : 1;
  const balanceEffectAmount = effectiveAdjustMode === 'ADD_PERCENT'
    ? amountValue * (1 + adjustPercent / 100)
    : effectiveAdjustMode === 'SUBTRACT_PERCENT'
      ? amountValue * (1 - adjustPercent / 100)
      : amountValue;
  const currentBalance = Number(biller?.currentBalance || 0);
  const afterBalance = currentBalance - Number(balanceEffectAmount || 0);
  const afterBalanceValue = form.amount === '' ? '' : String(Math.round((afterBalance + Number.EPSILON) * 100) / 100);

  useEffect(() => setForm((current) => ({ ...current, billerId: current.billerId || billers[0]?.id || '', paymentAccountId: current.paymentAccountId || accounts[0]?.id || '' })), [billers.length, accounts.length]);

  const chooseBiller = (billerId) => setForm((current) => ({ ...current, billerId }));
  const fillAmountFromAfterBalance = (value) => {
    if (value === '') return setForm((current) => ({ ...current, amount: '' }));
    const desiredAfterBalance = Number(value);
    if (!Number.isFinite(desiredAfterBalance)) return;
    const multiplier = effectMultiplier > 0 ? effectMultiplier : 1;
    const calculatedAmount = Math.max(0, (currentBalance - desiredAfterBalance) / multiplier);
    setForm((current) => ({ ...current, amount: String(Math.round((calculatedAmount + Number.EPSILON) * 100) / 100) }));
  };

  const submit = async (event) => {
    event.preventDefault();
    setMessage('');
    const amount = Number(form.amount || 0);
    if (!form.billerId) return setMessage('Biller ရွေးပါ');
    if (amount <= 0) return setMessage('ရောင်းချသည့် ပမာဏ ထည့်ပါ');
    setBusy(true);
    try {
      await apiFetch('/api/biller-transactions/sold', {
        method: 'POST',
        body: {
          ...form,
          amount,
          balanceAdjustPercent: Number(form.balanceAdjustPercent || 0),
          paidAmount: form.paidAmount === '' ? 0 : Number(form.paidAmount),
          costAmount: form.costAmount === '' ? null : Number(form.costAmount),
          profitAmount: form.profitAmount === '' ? null : Number(form.profitAmount),
        },
      });
      setMessage('ဘေ / Eload ရောင်းချမှု သိမ်းပြီးပါပြီ');
      setForm((current) => ({ ...current, amount: '', costAmount: '', profitAmount: '', customerPhone: '', paidAmount: '', dueDate: '', note: '' }));
      await onSaved?.();
    } catch (error) {
      setMessage(error.message || 'Bill / Eload sale failed');
    } finally {
      setBusy(false);
    }
  };

  return <section className="msc-clean-card msc-biller-sale-card">
    <header><div><span>BILL / ELOAD SALE</span><h3>ဘေ / Eload ရောင်းချမှု</h3><p>ရောင်းချပမာဏနဲ့ ကျန်လက်ကျန်ကို အဓိကပြပါမယ်။ Product Sale ထဲမရောပါ။</p></div></header>
    <form className="msc-clean-form msc-biller-simple-form" onSubmit={submit}>
      {message ? <div className="msc-message">{message}</div> : null}

      <div className="msc-biller-pick-grid">
        {billers.map((item) => {
          const active = item.id === form.billerId;
          return <button type="button" key={item.id} className={active ? 'active' : ''} onClick={() => chooseBiller(item.id)}>
            <span>{item.name}</span>
            <b>{money(item.currentBalance)}</b>
            <small>{item.type}</small>
          </button>;
        })}
      </div>

      <div className="msc-biller-main-row">
        <label className="msc-biller-amount-field">
          <span>ရောင်းချသည့် ပမာဏ *</span>
          <input type="number" min="1" value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} placeholder="0" autoFocus />
        </label>
        <div className="msc-biller-live-card current"><span>ယခင်လက်ကျန်</span><b>{money(currentBalance)}</b></div>
        <label className={`msc-biller-live-card editable ${afterBalance < 0 ? 'negative' : 'after'}`}>
          <span>ရောင်းပြီး ကျန်လက်ကျန်</span>
          <input type="number" value={afterBalanceValue} onChange={(event) => fillAmountFromAfterBalance(event.target.value)} placeholder={money(currentBalance)} />
        </label>
      </div>

      {isAtomEload ? <div className="msc-message compact">ATOM Eload သည် provider က နောက်မှလာကောက်နိုင်သော အကြွေး flow ဖြစ်လို့ balance မလုံလည်း မှတ်လို့ရပါတယ်။</div> : null}
      {defaultAdjustMode !== 'NONE' && defaultAdjustPercent > 0 ? <div className="msc-message compact">
        Formula: {defaultAdjustMode === 'SUBTRACT_PERCENT' ? 'ရောင်းပြီး ပြန်ဝင် %' : 'ပိုလျော့ %'} {defaultAdjustPercent}% · Balance deduct {money(balanceEffectAmount || 0)}
      </div> : null}

      <details className="msc-advanced-panel">
        <summary>Advanced / Optional</summary>
        <div className="msc-payment-line">
          <label className={form.paymentTiming === 'PAID_NOW' ? 'active' : ''}><input type="radio" checked={form.paymentTiming === 'PAID_NOW'} onChange={() => setForm({ ...form, paymentTiming: 'PAID_NOW', paidAmount: '', dueDate: '' })}/> Paid now</label>
          <label className={form.paymentTiming === 'PAY_LATER' ? 'active warning' : ''}><input type="radio" checked={form.paymentTiming === 'PAY_LATER'} onChange={() => setForm({ ...form, paymentTiming: 'PAY_LATER', paymentMethod: 'CREDIT', paymentAccountId: '' })}/> Credit / Collect later</label>
          <label className={form.paymentTiming === 'PARTIAL' ? 'active warning' : ''}><input type="radio" checked={form.paymentTiming === 'PARTIAL'} onChange={() => setForm({ ...form, paymentTiming: 'PARTIAL' })}/> Partial</label>
        </div>
        {form.paymentTiming !== 'PAID_NOW' ? <div className="msc-form-row">
          {form.paymentTiming === 'PARTIAL' ? <label><span>Paid Amount</span><input type="number" min="0" value={form.paidAmount} onChange={(event) => setForm({ ...form, paidAmount: event.target.value })}/></label> : <label><span>Credit Amount</span><input readOnly value={form.amount ? money(form.amount) : ''} placeholder="Amount will become due"/></label>}
          <label><span>Due Date</span><input type="date" value={form.dueDate} onChange={(event) => setForm({ ...form, dueDate: event.target.value })}/></label>
        </div> : null}
        <div className="msc-form-row">
          <label><span>Payment Method</span><input value={form.paymentMethod} onChange={(event) => setForm({ ...form, paymentMethod: event.target.value })} placeholder="Cash / KPay / Wave"/></label>
          {form.paymentTiming === 'PAY_LATER' ? <label><span>Payment Account</span><input readOnly value="No cash received yet"/></label> : <AccountSelect accounts={accounts} value={form.paymentAccountId} onChange={(value) => setForm({ ...form, paymentAccountId: value })}/>}
        </div>
        <div className="msc-form-row">
          <label><span>Cost Amount</span><input type="number" min="0" value={form.costAmount} onChange={(event) => setForm({ ...form, costAmount: event.target.value })} placeholder="Optional"/></label>
          <label><span>Profit Amount</span><input type="number" value={form.profitAmount} onChange={(event) => setForm({ ...form, profitAmount: event.target.value })} placeholder="Auto from amount - cost or 0"/></label>
        </div>
        <div className="msc-form-row">
          <label><span>Balance Adjust Rule</span><select value={form.balanceAdjustMode} onChange={(event) => setForm({ ...form, balanceAdjustMode: event.target.value })}>
            <option value="NONE">No % adjust</option>
            <option value="SUBTRACT_PERCENT">Balance deduct less by %</option>
            <option value="ADD_PERCENT">Balance deduct more by %</option>
          </select></label>
          <label><span>Adjust %</span><input type="number" min="0" max="100" step="0.01" value={form.balanceAdjustPercent} onChange={(event) => setForm({ ...form, balanceAdjustPercent: event.target.value })} placeholder="0"/></label>
        </div>
        <div className="msc-form-row">
          <label><span>Staff</span><select value={form.staffId} onChange={(event) => setForm({ ...form, staffId: event.target.value })}><option value="">No staff</option>{staff.map((item) => <option value={item.id} key={item.id}>{item.label || item.name || item.username}</option>)}</select></label>
          <label><span>Phone / Reference</span><input value={form.customerPhone} onChange={(event) => setForm({ ...form, customerPhone: event.target.value })} placeholder="Optional"/></label>
        </div>
        <label className="msc-single-field"><span>Note</span><input value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })}/></label>
      </details>

      <footer><button className="primary" disabled={busy || !form.billerId || amountValue <= 0}>{busy ? <Loader2 className="msc-spin" size={17}/> : <CheckCircle2 size={17}/>} Save Sale</button></footer>
    </form>
  </section>;
}

function BillerRefillForm({ settings, onSaved }) {
  const billers = (settings.billers || []).filter((item) => item.isActive !== false);
  const accounts = settings.accounts || [];
  const [form, setForm] = useState({ billerId: '', amount: '', paymentAccountId: '', note: '' });
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => setForm((current) => ({ ...current, billerId: current.billerId || billers[0]?.id || '', paymentAccountId: current.paymentAccountId || accounts[0]?.id || '' })), [billers.length, accounts.length]);
  const submit = async (event) => {
    event.preventDefault();
    setMessage('');
    const amount = Number(form.amount || 0);
    if (!form.billerId) return setMessage('Biller ရွေးပါ');
    if (amount <= 0) return setMessage('Refill amount must be greater than 0');
    setBusy(true);
    try {
      await apiFetch('/api/biller-transactions/refill', { method: 'POST', body: { ...form, amount, note: form.note || null } });
      setMessage('Biller refill saved');
      setForm((current) => ({ ...current, amount: '', note: '' }));
      await onSaved?.();
    } catch (error) {
      setMessage(error.message || 'Refill failed');
    } finally {
      setBusy(false);
    }
  };
  return <section className="msc-clean-card">
    <header><div><span>BILL / ELOAD REFILL</span><h3>ဘေ / Eload Refill</h3><p>Refill သည် income မဟုတ်ပါ။ Selected wallet/account ထဲမှ balance လျော့မည်။</p></div></header>
    <form className="msc-clean-form" onSubmit={submit}>
      {message ? <div className="msc-message">{message}</div> : null}
      <div className="msc-form-row">
        <label><span>Biller *</span><select value={form.billerId} onChange={(event) => setForm({ ...form, billerId: event.target.value })}><option value="">Choose biller</option>{billers.map((item) => <option value={item.id} key={item.id}>{item.name} · {money(item.currentBalance)}</option>)}</select></label>
        <label><span>Refill Amount *</span><input type="number" min="1" value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })}/></label>
      </div>
      <div className="msc-form-row">
        <AccountSelect accounts={accounts} value={form.paymentAccountId} onChange={(value) => setForm({ ...form, paymentAccountId: value })} label="Pay from Account"/>
        <label><span>Note</span><input value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })}/></label>
      </div>
      <footer><button className="primary" disabled={busy}>{busy ? <Loader2 className="msc-spin" size={17}/> : <CheckCircle2 size={17}/>} Save Refill</button></footer>
    </form>
  </section>;
}

function BillerAdjustmentForm({ settings, onSaved }) {
  const billers = (settings.billers || []).filter((item) => item.isActive !== false);
  const [form, setForm] = useState({ billerId: '', amount: '', direction: 'ADD', note: '' });
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const biller = billers.find((item) => item.id === form.billerId);
  const rawAmount = Number(form.amount || 0);
  const previewBalance = Number(biller?.currentBalance || 0) + (form.direction === 'SUBTRACT' ? -rawAmount : rawAmount);
  useEffect(() => setForm((current) => ({ ...current, billerId: current.billerId || billers[0]?.id || '' })), [billers.length]);
  const submit = async (event) => {
    event.preventDefault();
    setMessage('');
    const raw = Number(form.amount || 0);
    if (!form.billerId) return setMessage('Biller ရွေးပါ');
    if (raw <= 0) return setMessage('Adjust amount must be greater than 0');
    if (!form.note.trim()) return setMessage('Reason / note လိုပါတယ်');
    const amount = form.direction === 'SUBTRACT' ? -raw : raw;
    setBusy(true);
    try {
      await apiFetch('/api/biller-transactions/adjustment', { method: 'POST', body: { billerId: form.billerId, amount, note: form.note } });
      setMessage('Balance adjustment သိမ်းပြီးပါပြီ');
      setForm((current) => ({ ...current, amount: '', note: '' }));
      await onSaved?.();
    } catch (error) {
      setMessage(error.message || 'Balance adjust failed');
    } finally {
      setBusy(false);
    }
  };
  return <section className="msc-clean-card">
    <header><div><span>CORRECTION</span><h3>မှားစာရင်းပြင် / Balance Correction</h3><p>မူရင်းမှတ်တမ်းကို မဖျက်ဘဲ လိုသလောက် ပေါင်း/နုတ်ပြီး reason ထည့်ပါ။</p></div></header>
    <form className="msc-clean-form" onSubmit={submit}>
      {message ? <div className="msc-message">{message}</div> : null}
      <div className="msc-form-row">
        <label><span>Biller</span><select value={form.billerId} onChange={(event) => setForm({ ...form, billerId: event.target.value })}>{billers.map((item) => <option value={item.id} key={item.id}>{item.name} · {money(item.currentBalance)}</option>)}</select></label>
        <label><span>Direction</span><select value={form.direction} onChange={(event) => setForm({ ...form, direction: event.target.value })}><option value="ADD">Add balance</option><option value="SUBTRACT">Subtract balance</option></select></label>
      </div>
      <div className="msc-form-row">
        <label><span>Amount</span><input type="number" min="1" value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })}/></label>
        <label><span>Reason / Note *</span><input value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} placeholder="Why adjust?"/></label>
      </div>
      <div className="msc-total-strip msc-adjust-preview">
        <div><span>Current Balance</span><b>{money(biller?.currentBalance)}</b></div>
        <div><span>Adjust</span><b>{form.direction === 'SUBTRACT' ? '-' : '+'}{money(rawAmount)}</b></div>
        <div><span>After Balance</span><b>{money(previewBalance)}</b></div>
      </div>
      <footer><button className="primary" disabled={busy || rawAmount <= 0 || !form.note.trim()}>{busy ? <Loader2 className="msc-spin" size={17}/> : <CheckCircle2 size={17}/>} Save Correction</button></footer>
    </form>
  </section>;
}

function BillerSetup({ settings, onSaved }) {
  const billers = (settings?.billers || []).filter((item) => item.isActive !== false);
  const [form, setForm] = useState({ name: '', type: 'ELOAD', openingBalance: '', saleAdjustMode: 'NONE', saleAdjustPercent: '' });
  const [formulaDrafts, setFormulaDrafts] = useState({});
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [savingId, setSavingId] = useState('');
  const formulaKey = billers.map((item) => `${item.id}:${item.saleAdjustMode || 'NONE'}:${item.saleAdjustPercent || 0}`).join('|');

  useEffect(() => {
    setFormulaDrafts(Object.fromEntries(billers.map((item) => [item.id, {
      saleAdjustMode: item.saleAdjustMode || 'NONE',
      saleAdjustPercent: String(item.saleAdjustPercent || ''),
    }])));
  }, [formulaKey]);

  const submit = async (event) => {
    event.preventDefault();
    setMessage('');
    if (!form.name.trim()) return setMessage('Biller name လိုပါတယ်');
    setBusy(true);
    try {
      await apiFetch('/api/billers', { method: 'POST', body: { ...form, openingBalance: Number(form.openingBalance || 0), saleAdjustPercent: Number(form.saleAdjustPercent || 0) } });
      setForm({ name: '', type: 'ELOAD', openingBalance: '', saleAdjustMode: 'NONE', saleAdjustPercent: '' });
      setMessage('Biller created');
      await onSaved?.();
    } catch (error) {
      setMessage(error.message || 'Biller create failed');
    } finally {
      setBusy(false);
    }
  };

  const updateFormulaDraft = (id, patch) => setFormulaDrafts((current) => ({ ...current, [id]: { ...(current[id] || {}), ...patch } }));
  const saveFormula = async (biller) => {
    const draft = formulaDrafts[biller.id] || {};
    setSavingId(biller.id);
    setMessage('');
    try {
      await apiFetch(`/api/billers/${biller.id}`, {
        method: 'PUT',
        body: {
          saleAdjustMode: draft.saleAdjustMode || 'NONE',
          saleAdjustPercent: Number(draft.saleAdjustPercent || 0),
        },
      });
      setMessage('Biller formula saved');
      await onSaved?.();
    } catch (error) {
      setMessage(error.message || 'Formula save failed');
    } finally {
      setSavingId('');
    }
  };

  return <section className="msc-clean-card">
    <header><div><span>BILLER SETUP</span><h3>Create / Manage Billers</h3><p>Biller တစ်ခုချင်းစီအတွက် ရောင်းပြီး ပြန်ဝင် % formula ကို သီးသန့်ထားနိုင်ပါတယ်။ ဥပမာ 1000 ရောင်းရင် 1 ကျပ် ပြန်ဝင် = 0.1%။</p></div></header>
    <form className="msc-clean-form" onSubmit={submit}>
      {message ? <div className="msc-message">{message}</div> : null}
      <div className="msc-form-row">
        <label><span>Biller Name</span><input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Example: NearMe"/></label>
        <label><span>Type</span><select value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value })}>{BILLER_TYPES.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
      </div>
      <div className="msc-form-row">
        <label><span>Opening Balance</span><input type="number" min="0" value={form.openingBalance} onChange={(event) => setForm({ ...form, openingBalance: event.target.value })}/></label>
        <label><span>Default Formula</span><select value={form.saleAdjustMode} onChange={(event) => setForm({ ...form, saleAdjustMode: event.target.value })}><option value="NONE">No formula</option><option value="SUBTRACT_PERCENT">ရောင်းပြီး ပြန်ဝင် %</option><option value="ADD_PERCENT">ပိုလျော့ %</option></select></label>
      </div>
      <div className="msc-form-row">
        <label><span>Formula %</span><input type="number" min="0" max="100" step="0.0001" value={form.saleAdjustPercent} onChange={(event) => setForm({ ...form, saleAdjustPercent: event.target.value })} placeholder="0.1"/></label>
        <button type="submit" className="primary" disabled={busy}>{busy ? <Loader2 className="msc-spin" size={17}/> : <Plus size={17}/>} Add Biller</button>
      </div>
    </form>
    <div className="msc-biller-formula-list">
      {billers.map((item) => {
        const draft = formulaDrafts[item.id] || { saleAdjustMode: item.saleAdjustMode || 'NONE', saleAdjustPercent: String(item.saleAdjustPercent || '') };
        return <article key={item.id}>
          <span><b>{item.name}</b><small>{item.type} · Balance {money(item.currentBalance)}</small></span>
          <select value={draft.saleAdjustMode} onChange={(event) => updateFormulaDraft(item.id, { saleAdjustMode: event.target.value })}>
            <option value="NONE">No formula</option>
            <option value="SUBTRACT_PERCENT">ရောင်းပြီး ပြန်ဝင် %</option>
            <option value="ADD_PERCENT">ပိုလျော့ %</option>
          </select>
          <input type="number" min="0" max="100" step="0.0001" value={draft.saleAdjustPercent} onChange={(event) => updateFormulaDraft(item.id, { saleAdjustPercent: event.target.value })} placeholder="0.1"/>
          <button type="button" onClick={() => saveFormula(item)} disabled={savingId === item.id}>{savingId === item.id ? <Loader2 className="msc-spin" size={15}/> : <CheckCircle2 size={15}/>} Save</button>
        </article>;
      })}
    </div>
  </section>;
}

function BillerHistory({ settings, onChanged }) {
  const accounts = settings.accounts || [];
  const [filters, setFilters] = useState({ from: todayDate(), to: todayDate(), type: '', q: '' });
  const [data, setData] = useState({ transactions: [], totalPages: 1, total: 0 });
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [editing, setEditing] = useState(null);
  const [voiding, setVoiding] = useState(null);
  const [editForm, setEditForm] = useState({ amount: '', paymentAccountId: '', transactionDate: '', note: '', reason: '' });
  const [voidReason, setVoidReason] = useState('');
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    setMessage('');
    try {
      const params = new URLSearchParams({ page: String(page), limit: '10' });
      if (filters.from) params.set('from', filters.from);
      if (filters.to) params.set('to', filters.to);
      if (filters.type) params.set('type', filters.type);
      if (filters.q.trim()) params.set('q', filters.q.trim());
      setData(await apiFetch(`/api/biller-transactions?${params}`));
    } catch (error) {
      setMessage(error.message || 'History load failed');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { const timer = setTimeout(load, 180); return () => clearTimeout(timer); }, [page, filters.from, filters.to, filters.type, filters.q]);
  useEffect(() => setPage(1), [filters.from, filters.to, filters.type, filters.q]);

  const openEdit = (row) => {
    setEditing(row);
    setEditForm({
      amount: String(row.amount || ''),
      paymentAccountId: row.paymentAccountId || accounts[0]?.id || '',
      transactionDate: dateInputValue(row.transactionDate),
      note: row.note || '',
      reason: '',
    });
  };
  const saveEdit = async (event) => {
    event.preventDefault();
    setSaving(true);
    setMessage('');
    try {
      await apiFetch(`/api/biller-transactions/${editing.id}/refill`, {
        method: 'PUT',
        body: { ...editForm, amount: Number(editForm.amount), transactionDate: new Date(editForm.transactionDate).toISOString() },
      });
      setEditing(null);
      await Promise.all([load(), onChanged?.()]);
      setMessage('Refill record and balances updated');
    } catch (error) {
      setMessage(error.message || 'Refill edit failed');
    } finally {
      setSaving(false);
    }
  };
  const confirmVoid = async (event) => {
    event.preventDefault();
    setSaving(true);
    setMessage('');
    try {
      await apiFetch(`/api/biller-transactions/${voiding.id}/void`, { method: 'POST', body: { reason: voidReason } });
      setVoiding(null);
      setVoidReason('');
      await Promise.all([load(), onChanged?.()]);
      setMessage('Sale voided and balances restored');
    } catch (error) {
      setMessage(error.message || 'Void failed');
    } finally {
      setSaving(false);
    }
  };

  return <section className="msc-history msc-biller-history">
    <header className="msc-section-title">
      <div><span>BILL / ELOAD HISTORY</span><h3>ဘေ / Eload စာရင်းမှတ်တမ်း</h3><p>ရက်စွဲ၊ အမျိုးအစား၊ Biller အလိုက် စာရင်းကြည့်နိုင်ပါသည်။</p></div>
    </header>
    <div className="msc-history-tools msc-biller-filters">
      <label><span>From</span><input type="date" value={filters.from} onChange={(event) => setFilters({ ...filters, from: event.target.value })}/></label>
      <label><span>To</span><input type="date" value={filters.to} onChange={(event) => setFilters({ ...filters, to: event.target.value })}/></label>
      <select value={filters.type} onChange={(event) => setFilters({ ...filters, type: event.target.value })}>
        <option value="">All records</option><option value="SOLD">Sale</option><option value="REFILL">Refill</option><option value="ADJUSTMENT">Balance Correction</option><option value="OPENING">Opening</option>
      </select>
      <div><Search size={17}/><input value={filters.q} onChange={(event) => setFilters({ ...filters, q: event.target.value })} placeholder="Search biller, account or note"/></div>
    </div>
    {message ? <div className="msc-message">{message}</div> : null}
    <div className="msc-table-card">
      <div className="msc-table-wrap">
        <table>
          <thead><tr><th>Date</th><th>Biller</th><th>Record</th><th>Amount</th><th>Account</th><th>Recorded / Adjusted By</th><th>Reason / Note</th><th>Action</th></tr></thead>
          <tbody>{loading ? <tr><td colSpan="8" className="msc-empty"><Loader2 className="msc-spin"/> Loading...</td></tr> : (data.transactions || []).length ? data.transactions.map((row) => {
            const voided = Boolean(row.voidedAt);
            const actor = row.transactionType === 'ADJUSTMENT' ? (row.createdBy || row.staffName || 'Previous record') : (row.editedBy || row.createdBy || row.staffName || '-');
            const reason = row.transactionType === 'ADJUSTMENT' ? row.note : (row.editReason || row.voidReason || row.note || '-');
            return <tr key={row.id} className={voided ? 'voided' : ''}>
              <td><b>{formatDate(row.transactionDate)}</b>{row.editedAt ? <small>Edited {formatDate(row.editedAt)}</small> : null}</td>
              <td><b>{row.billerName}</b><small>{row.billerType}</small></td>
              <td><span className={`msc-record-type ${String(row.transactionType).toLowerCase()}`}>{billerTypeText(row.transactionType)}</span>{voided ? <small>VOIDED</small> : null}</td>
              <td><b>{row.transactionType === 'ADJUSTMENT' && Number(row.amount) > 0 ? '+' : ''}{money(row.amount)}</b></td>
              <td>{row.paymentAccountName || '-'}</td>
              <td>{voided ? row.voidedBy || actor : actor}</td>
              <td>{reason}</td>
              <td><div className="msc-row-actions">
                {row.transactionType === 'REFILL' && !voided ? <button type="button" onClick={() => openEdit(row)}><Pencil size={15}/> Edit</button> : null}
                {row.transactionType === 'SOLD' && !voided ? <button type="button" className="danger" onClick={() => { setVoiding(row); setVoidReason(''); }}><X size={15}/> Void</button> : null}
              </div></td>
            </tr>;
          }) : <tr><td colSpan="8" className="msc-empty">ရွေးထားသောရက်အတွက် စာရင်းမရှိသေးပါ</td></tr>}</tbody>
        </table>
      </div>
    </div>
    <div className="msc-pagination"><button disabled={page <= 1} onClick={() => setPage(page - 1)}><ChevronLeft/></button><span>{data.total || 0} records · Page {page} / {data.totalPages || 1}</span><button disabled={page >= (data.totalPages || 1)} onClick={() => setPage(page + 1)}><ChevronRight/></button></div>

    {editing ? <div className="msc-modal-backdrop"><form className="msc-detail-modal msc-edit-refill" onSubmit={saveEdit}>
      <header><div><Pencil/><span><b>Edit Refill</b><small>{editing.billerName}</small></span></div><button type="button" onClick={() => setEditing(null)}><X/></button></header>
      <div className="msc-form-grid">
        <label><span>Refill Amount *</span><input type="number" min="1" value={editForm.amount} onChange={(event) => setEditForm({ ...editForm, amount: event.target.value })}/></label>
        <AccountSelect accounts={accounts} value={editForm.paymentAccountId} onChange={(value) => setEditForm({ ...editForm, paymentAccountId: value })} label="Paid from Account"/>
        <label><span>Date & Time *</span><input type="datetime-local" value={editForm.transactionDate} onChange={(event) => setEditForm({ ...editForm, transactionDate: event.target.value })}/></label>
        <label><span>Note</span><input value={editForm.note} onChange={(event) => setEditForm({ ...editForm, note: event.target.value })}/></label>
        <label className="wide"><span>Edit Reason *</span><input value={editForm.reason} onChange={(event) => setEditForm({ ...editForm, reason: event.target.value })} placeholder="ဘာကြောင့်ပြင်သည်ကို ရေးပါ"/></label>
      </div>
      <footer className="msc-modal-actions"><button type="button" onClick={() => setEditing(null)}>Cancel</button><button className="primary" disabled={saving || !editForm.reason.trim() || !editForm.paymentAccountId}>{saving ? <Loader2 className="msc-spin"/> : <CheckCircle2/>} Save Changes</button></footer>
    </form></div> : null}

    {voiding ? <div className="msc-modal-backdrop"><form className="msc-detail-modal msc-void-modal" onSubmit={confirmVoid}>
      <header><div><X/><span><b>Void Sale</b><small>{voiding.billerName} · {money(voiding.amount)}</small></span></div><button type="button" onClick={() => setVoiding(null)}><X/></button></header>
      <div className="msc-modal-body"><p>ဤရောင်းချမှုကို Void လုပ်ပါက Biller နှင့် Payment Account balance ကို အလိုအလျောက်ပြန်ညှိပါမည်။</p><label><span>Void Reason *</span><input value={voidReason} onChange={(event) => setVoidReason(event.target.value)} placeholder="မှားယွင်းသည့်အကြောင်းရင်း"/></label></div>
      <footer className="msc-modal-actions"><button type="button" onClick={() => setVoiding(null)}>Cancel</button><button className="danger" disabled={saving || voidReason.trim().length < 3}>{saving ? <Loader2 className="msc-spin"/> : <X/>} Confirm Void</button></footer>
    </form></div> : null}
  </section>;
}

function BillerBalanceReport({ settings, onSaved }) {
  const [from, setFrom] = useState(todayDate());
  const [to, setTo] = useState(todayDate());
  const [report, setReport] = useState({ rows: [], totals: {} });
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const load = async () => {
    setLoading(true);
    setMessage('');
    try {
      setReport(await apiFetch(`/api/reports/biller-balance?startDate=${from}&endDate=${to}`));
    } catch (error) {
      setMessage(error.message || 'Balance report failed');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, [from, to, settings.billers?.length]);
  return <div className="msc-clean-layout">
    <div className="msc-clean-side">
      <BillerSetup settings={settings} onSaved={async () => { await onSaved?.(); await load(); }}/>
      <BillerAdjustmentForm settings={settings} onSaved={async () => { await onSaved?.(); await load(); }}/>
      <FinanceCatalogSettingsV23 embedded/>
    </div>
    <section className="msc-clean-card msc-table-card">
      <header><div><span>BALANCE REPORT</span><h3>Bill / Eload လက်ကျန်</h3><p>Closing Balance = Opening + Refill - Sold + Adjustment</p></div><div className="msc-history-tools"><input type="date" value={from} onChange={(event) => setFrom(event.target.value)}/><input type="date" value={to} onChange={(event) => setTo(event.target.value)}/><button type="button" onClick={load}>{loading ? <Loader2 className="msc-spin" size={17}/> : <Search size={17}/>} Load</button></div></header>
      {message ? <div className="msc-message">{message}</div> : null}
      <div className="msc-table-wrap">
        <table>
          <thead><tr><th>Biller Name</th><th>Opening Balance</th><th>Refill</th><th>Sold Volume</th><th>Balance Deduct</th><th>Adjustment</th><th>Closing Balance</th><th>Profit</th></tr></thead>
          <tbody>{(report.rows || []).map((row) => <tr key={row.id}><td><b>{row.billerName}</b><small>{row.type}</small></td><td>{money(row.openingBalance)}</td><td>{money(row.refill)}</td><td>{money(row.sold)}</td><td>{money(row.balanceSold)}</td><td>{money(row.adjustment)}</td><td><b>{money(row.closingBalance)}</b></td><td className="positive">{money(row.profit)}</td></tr>)}</tbody>
          <tfoot><tr><th>Total</th><th>{money(report.totals?.openingBalance)}</th><th>{money(report.totals?.refill)}</th><th>{money(report.totals?.sold)}</th><th>{money(report.totals?.balanceSold)}</th><th>{money(report.totals?.adjustment)}</th><th>{money(report.totals?.closingBalance)}</th><th>{money(report.totals?.profit)}</th></tr></tfoot>
        </table>
      </div>
    </section>
  </div>;
}

const MONEY_VIEWS = ['transfer', 'walletSetup'];
const BILL_VIEWS = ['bill', 'refill', 'balance', 'billerHistory'];

// Two sidebar pages share this screen: Money Service keeps the transfer /
// cash out ledger, Bill / Eload owns the biller sale, refill, balance and
// history. The data they need is the same, only the tabs differ.
export default function MoneyServiceCenterV23({ module = 'money' }) {
  const billModule = module === 'bill';
  const [selectedView, setView] = useState(billModule ? 'bill' : 'transfer');
  // Each module owns its own tabs; a view belonging to the other one would
  // render an empty page, so fall back to this module's first tab.
  const moduleViews = billModule ? BILL_VIEWS : MONEY_VIEWS;
  const view = moduleViews.includes(selectedView) ? selectedView : moduleViews[0];
  const [transferTab, setTransferTab] = useState('new');
  const [settings, setSettings] = useState({ rates: {}, paymentMethods: [], accounts: [] });
  const [dashboard, setDashboard] = useState({ summary: {}, recent: [] });
  const [billerSummary, setBillerSummary] = useState({ rows: [], totals: {} });
  const [history, setHistory] = useState({ transactions: [], totalPages: 1 });
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [from, setFrom] = useState(todayDate());
  const [to, setTo] = useState(todayDate());
  const [page, setPage] = useState(1);
  const [detailId, setDetailId] = useState('');
  const [voidingTransfer, setVoidingTransfer] = useState(null);
  const [transferVoidReason, setTransferVoidReason] = useState('');
  const [voidingBusy, setVoidingBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [exporting, setExporting] = useState(false);

  const loadSettings = async () => setSettings(await apiFetch('/api/money-service/settings'));
  const loadDashboard = async () => setDashboard(await apiFetch('/api/money-service/dashboard'));
  const loadBillerSummary = async () => {
    const today = todayDate();
    setBillerSummary(await apiFetch(`/api/reports/biller-balance?startDate=${today}&endDate=${today}`));
  };
  const loadHistory = async () => {
    const params = new URLSearchParams({ page: String(page), limit: '10' });
    if (query.trim()) params.set('q', query.trim());
    if (status) params.set('status', status);
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    setHistory(await apiFetch(`/api/money-service/transactions?${params}`));
  };

  const refresh = async () => {
    setLoading(true);
    setMessage('');
    try {
      // Each page loads only what it shows. History is left to the debounced
      // effect below, which runs on mount anyway — asking twice just made the
      // first paint wait longer.
      await Promise.all(billModule
        ? [loadSettings(), loadBillerSummary()]
        : [loadSettings(), loadDashboard()]);
    } catch (error) {
      setMessage(error.message || 'Load failed');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); }, []);
  useEffect(() => {
    if (billModule) return undefined;
    const timer = setTimeout(() => loadHistory().catch((error) => setMessage(error.message)), 180);
    return () => clearTimeout(timer);
  }, [billModule, query, status, from, to, page]);
  useEffect(() => setPage(1), [query, status, from, to]);

  const rows = history.transactions || [];
  const summary = dashboard.summary || {};
  const billerTotals = billerSummary.totals || {};
  const billerRows = billerSummary.rows || [];
  const billerBalanceTotal = billerRows.reduce((total, row) => total + Number(row.closingBalance || 0), 0);
  const topBiller = billerRows
    .slice()
    .sort((left, right) => Number(right.sold || 0) - Number(left.sold || 0))[0];

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

  const voidTransfer = async (event) => {
    event.preventDefault();
    setVoidingBusy(true);
    setMessage('');
    try {
      await apiFetch(`/api/money-service/transactions/${voidingTransfer.id}/void`, { method: 'POST', body: { reason: transferVoidReason } });
      setVoidingTransfer(null);
      setTransferVoidReason('');
      await refresh();
      setMessage('Transaction voided and balances restored');
    } catch (error) {
      setMessage(error.message || 'Void failed');
    } finally {
      setVoidingBusy(false);
    }
  };

  return <section className="money-service-center">
    <nav className="msc-nav clean">
      {billModule ? <>
        <button className={view === 'bill' ? 'active' : ''} onClick={() => setView('bill')}><Banknote size={18}/><span>Bill / Eload Sale</span></button>
        <button className={view === 'refill' ? 'active' : ''} onClick={() => setView('refill')}><ArrowDownToLine size={18}/><span>Refill</span></button>
        <button className={view === 'balance' ? 'active' : ''} onClick={() => setView('balance')}><Wallet size={18}/><span>Balance & Setup</span></button>
        <button className={view === 'billerHistory' ? 'active' : ''} onClick={() => setView('billerHistory')}><History size={18}/><span>Bill / Eload History</span></button>
      </> : <>
        <button className={view === 'transfer' ? 'active' : ''} onClick={() => setView('transfer')}><CircleDollarSign size={18}/><span>ငွေလွှဲ / ငွေထုတ်</span></button>
        <button className={view === 'walletSetup' ? 'active' : ''} onClick={() => setView('walletSetup')}><Wallet size={18}/><span>Wallet Setup</span></button>
      </>}
    </nav>

    {message ? <div className="msc-message">{message}</div> : null}

    {view === 'transfer' ? <section className="msc-today-strip">
      <article><span>ယနေ့ Fee</span><b>{money(summary.todayFee)}</b><small>{summary.todayCount || 0} ကြိမ်</small></article>
      <article><span>ငွေလွှဲ Transfer</span><b>{money(summary.todayTransferAmount)}</b></article>
      <article><span>ငွေထုတ် Cash Out</span><b>{money(summary.todayCashOutAmount)}</b></article>
      <article className={Number(summary.totalDue || 0) > 0 ? 'warn' : ''}><span>ကြွေးကျန်</span><b>{money(summary.totalDue)}</b><small>{summary.pendingCount || 0} ခု</small></article>
    </section> : null}

    {billModule && view !== 'billerHistory' ? <section className="msc-postgres-summary biller-only">
      <article><Banknote/><span>Bill / Eload Sold Today</span><b>{money(billerTotals.sold)}</b><small>Separate from Product Sales</small></article>
      <article><ArrowDownToLine/><span>Bill / Eload Refill Today</span><b>{money(billerTotals.refill)}</b><small>Balance top-up only</small></article>
      <article><Wallet/><span>Total Biller Balance</span><b>{money(billerBalanceTotal)}</b><small>{billerRows.length} active billers</small></article>
      <article><History/><span>Top Biller Today</span><b>{topBiller?.billerName || '-'}</b><small>{topBiller ? money(topBiller.sold) : 'No sale yet'}</small></article>
    </section> : null}

    {view === 'transfer' ? <div className="msc-sub-switch">
      <button type="button" className={transferTab === 'new' ? 'active' : ''} onClick={() => setTransferTab('new')}><Plus size={16}/> အသစ်မှတ်မည်</button>
      <button type="button" className={transferTab === 'history' ? 'active' : ''} onClick={() => setTransferTab('history')}><History size={16}/> မှတ်တမ်း</button>
    </div> : null}

    {view === 'transfer' && transferTab === 'new' ? <div className="msc-transfer-entry">
      <MoneyServiceForm settings={settings} onSaved={async (transaction) => { setDetailId(transaction.id); await refresh(); }}/>
    </div> : null}

    {view === 'transfer' && transferTab === 'history' ? <section className="msc-history">
      <div className="msc-history-tools msc-transfer-history-filters">
        <label><span>From</span><input type="date" value={from} onChange={(event) => setFrom(event.target.value)}/></label>
        <label><span>To</span><input type="date" value={to} onChange={(event) => setTo(event.target.value)}/></label>
        <div><Search size={17}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Transaction no, name, phone"/></div>
        <select value={status} onChange={(event) => setStatus(event.target.value)}><option value="">All Status</option><option value="PENDING">Pending</option><option value="PARTIAL">Partial</option><option value="PAID">Done</option><option value="VOIDED">Voided</option></select>
        <button type="button" onClick={exportHistory} disabled={exporting}>{exporting ? <Loader2 className="msc-spin" size={17}/> : <Download size={17}/>} Export</button>
      </div>
      <TransactionTable rows={rows} onOpen={setDetailId} onVoid={(row) => { setVoidingTransfer(row); setTransferVoidReason(''); }}/>
      <div className="msc-pagination"><button disabled={page <= 1} onClick={() => setPage(page - 1)}><ChevronLeft/></button><span>{history.total || 0} records · Page {page} / {history.totalPages || 1}</span><button disabled={page >= (history.totalPages || 1)} onClick={() => setPage(page + 1)}><ChevronRight/></button></div>
    </section> : null}

    {view === 'walletSetup' ? <MoneyServiceFeeSettingsV23/> : null}
    {view === 'bill' ? <BillerSaleForm settings={settings} onSaved={refresh}/> : null}
    {view === 'refill' ? <BillerRefillForm settings={settings} onSaved={refresh}/> : null}
    {view === 'balance' ? <BillerBalanceReport settings={settings} onSaved={refresh}/> : null}
    {view === 'billerHistory' ? <BillerHistory settings={settings} onChanged={refresh}/> : null}
    {detailId ? <TransactionDetail id={detailId} settings={settings} onClose={() => setDetailId('')} onChanged={refresh}/> : null}
    {voidingTransfer ? <div className="msc-modal-backdrop"><form className="msc-detail-modal msc-void-modal" onSubmit={voidTransfer}>
      <header><div><X/><span><b>Void Money Service Transaction</b><small>{voidingTransfer.transactionNumber} · {money(voidingTransfer.amount)}</small></span></div><button type="button" onClick={() => setVoidingTransfer(null)}><X/></button></header>
      <div className="msc-modal-body"><p>Void လုပ်ပါက ဆက်စပ် Wallet/Cash Account balance များကို အလိုအလျောက်ပြန်ညှိပါမည်။</p><label><span>Void Reason *</span><input value={transferVoidReason} onChange={(event) => setTransferVoidReason(event.target.value)} placeholder="မှားယွင်းသည့်အကြောင်းရင်း"/></label></div>
      <footer className="msc-modal-actions"><button type="button" onClick={() => setVoidingTransfer(null)}>Cancel</button><button className="danger" disabled={voidingBusy || transferVoidReason.trim().length < 3}>{voidingBusy ? <Loader2 className="msc-spin"/> : <X/>} Confirm Void</button></footer>
    </form></div> : null}
  </section>;
}
