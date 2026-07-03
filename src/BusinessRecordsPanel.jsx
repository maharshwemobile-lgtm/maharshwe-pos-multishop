import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CreditCard,
  Download,
  Eye,
  FileSpreadsheet,
  Loader2,
  Pencil,
  PlusCircle,
  RefreshCw,
  Save,
  Search,
  Wallet,
  X,
} from 'lucide-react';
import { apiDownload, apiFetch, clearSession, getSession } from './phase2Api';
import './business-records.css';

const money = (value) => `${Number(value || 0).toLocaleString('en-US')} MMK`;
const DEFAULT_INCOME_OPTIONS = [
  { name: 'အခြား Service ဝင်ငွေ', value: 'အခြား Service ဝင်ငွေ' },
  { name: 'အခြား အရောင်းပိုင် ဝင်ငွေ', value: 'အခြား အရောင်းပိုင် ဝင်ငွေ' },
  { name: 'အခြား ငွေဖြည့်ကဒ် ဝင်ငွေ', value: 'အခြား ငွေဖြည့်ကဒ် ဝင်ငွေ' },
  { name: 'အခြား အခြား ဝင်ငွေ', value: 'အခြား အခြား ဝင်ငွေ' },
];
const DEFAULT_EXPENSE_OPTIONS = [
  'အခြား Service ထွက်ငွေ',
  'အခြား အရောင်းပိုင်း ထွက်ငွေ',
  'အခြား ငွေဖြည့်ကဒ် ထွက်ငွေ',
  'အခြား အခြား ထွက်ငွေ',
];
const DEFAULT_INCOME_CATEGORY = DEFAULT_INCOME_OPTIONS[0].value;
const DEFAULT_EXPENSE_CATEGORY = DEFAULT_EXPENSE_OPTIONS[0];
const MINI_MART_HIDDEN_CATEGORIES = new Set([
  'SERVICE_INCOME',
  'Service Income',
]);
const SYSTEM_ONLY_CATEGORIES = new Set([
  'Sales Income (Auto) From POS',
  'Total Bill Sale',
  'Money Service (Auto)',
]);

function isAccountingAdminRole(role) {
  const normalized = String(role || '').trim().toUpperCase();
  return normalized === 'SUPER_ADMIN' || normalized === 'SHOP_ADMIN' || normalized === 'ADMIN';
}

function yangonToday() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Yangon', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function monthStart(value) {
  return `${String(value).slice(0, 7)}-01`;
}

function formatDateTime(value) {
  if (!value) return '-';
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Yangon',
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value));
  } catch {
    return String(value);
  }
}

function categoryLabel(record, isMiniMart = false) {
  if (record.type === 'expense') return record.category || 'Expense';
  if (record.category === 'SERVICE_INCOME') return isMiniMart ? 'Other Income' : 'Service Income';
  if (record.category && record.category !== 'OTHER_INCOME') return record.category;
  return 'Other Income';
}

function incomeCategoryValue(name) {
  if (name === 'Service Income') return 'SERVICE_INCOME';
  if (name === 'Other Income') return 'OTHER_INCOME';
  return name;
}

function categoryVisible(option, isMiniMart) {
  if (SYSTEM_ONLY_CATEGORIES.has(option.value || option.name)) return false;
  if (!isMiniMart) return true;
  return !MINI_MART_HIDDEN_CATEGORIES.has(option.value || option.name);
}

function buildIncomeOptions(rows = [], isMiniMart = false) {
  return DEFAULT_INCOME_OPTIONS.filter((option) => categoryVisible(option, isMiniMart));
}

function buildExpenseOptions(rows = [], isMiniMart = false) {
  return DEFAULT_EXPENSE_OPTIONS.map((name) => ({ name, value: name })).filter((option) => categoryVisible(option, isMiniMart));
}

function DetailModal({ record, onClose, isMiniMart = false }) {
  if (!record) return null;
  return (
    <div className="br-modal-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="br-modal" role="dialog" aria-modal="true">
        <header>
          <div><Eye size={21} /><span><b>Record Details</b><small>{record.businessDate}</small></span></div>
          <button type="button" onClick={onClose}><X size={19} /></button>
        </header>
        <div className="br-detail-grid">
          <article><span>Record Type</span><b>{record.type === 'income' ? 'Other Income' : 'Quick Expense'}</b></article>
          <article><span>Category</span><b>{categoryLabel(record, isMiniMart)}</b></article>
          <article><span>{record.type === 'income' ? 'Source' : 'Expense Name'}</span><b>{record.title || '-'}</b></article>
          <article><span>Amount</span><b>{money(record.amount)}</b></article>
          <article><span>Payment Method</span><b>{record.method || '-'}</b></article>
          <article><span>Money Account</span><b>{record.accountName || 'Auto / No account'}</b></article>
          <article><span>Created By</span><b>{record.createdByName || '-'}</b><small>{record.createdByUsername || ''}</small></article>
          <article><span>Created At</span><b>{formatDateTime(record.createdAt)}</b></article>
          {record.updatedAt ? <article><span>Updated At</span><b>{formatDateTime(record.updatedAt)}</b></article> : null}
          <article className="wide"><span>Note</span><p>{record.note || 'No note.'}</p></article>
          <article className="wide"><span>Record ID</span><code>{record.id}</code></article>
        </div>
        <footer><button type="button" onClick={onClose}>Close</button></footer>
      </section>
    </div>
  );
}

function EditModal({ record, accounts, isMiniMart, incomeOptions, expenseOptions, saving, onSave, onClose }) {
  const buildForm = (currentRecord) => ({
    businessDate: currentRecord?.businessDate || yangonToday(),
    category: currentRecord?.type === 'income' ? (currentRecord?.category || 'OTHER_INCOME') : (currentRecord?.title || currentRecord?.category || ''),
    title: currentRecord?.title || '',
    amount: String(currentRecord?.amount || ''),
    method: currentRecord?.method || 'CASH',
    moneyAccountId: currentRecord?.moneyAccountId || '',
    note: currentRecord?.note || '',
  });
  const [form, setForm] = useState(() => buildForm(record));

  useEffect(() => {
    setForm(buildForm(record));
  }, [record]);

  if (!record) return null;

  const update = (patch) => setForm((current) => ({ ...current, ...patch }));

  const submit = (event) => {
    event.preventDefault();
    const body = record.type === 'income' ? {
      incomeDate: form.businessDate,
      category: form.category,
      source: form.title,
      amount: Number(form.amount),
      method: form.method,
      moneyAccountId: form.moneyAccountId || null,
      note: form.note,
    } : {
      expenseDate: form.businessDate,
      category: form.category,
      amount: Number(form.amount),
      method: form.method,
      moneyAccountId: form.moneyAccountId || null,
      note: form.note,
    };
    onSave(record, body);
  };

  return (
    <div className="br-modal-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !saving) onClose();
    }}>
      <section className="br-modal br-edit-modal" role="dialog" aria-modal="true">
        <header>
          <div><Pencil size={21} /><span><b>Edit {record.type === 'income' ? 'Other Income' : 'Quick Expense'}</b><small>Date, category and amount can be corrected safely.</small></span></div>
          <button type="button" disabled={saving} onClick={onClose}><X size={19} /></button>
        </header>
        <form className="br-edit-form" onSubmit={submit}>
          <div className="br-form-grid">
            <label>Date<input required type="date" value={form.businessDate} onChange={(event) => update({ businessDate: event.target.value })} /></label>
            {record.type === 'income' ? (
              <label>Category<select value={form.category} onChange={(event) => update({ category: event.target.value })}>{incomeOptions.map((option) => <option key={option.value} value={option.value}>{option.name}</option>)}</select></label>
            ) : (
              <label>Category<select required value={form.category} onChange={(event) => update({ category: event.target.value })}>{expenseOptions.map((option) => <option key={option.value} value={option.value}>{option.name}</option>)}</select></label>
            )}
            {record.type === 'income' ? (
              <label>Source<input required value={form.title} onChange={(event) => update({ title: event.target.value })} maxLength={80} /></label>
            ) : null}
            <label>Amount<input required type="number" min="1" step="1" value={form.amount} onChange={(event) => update({ amount: event.target.value })} /></label>
            <label>Method<select value={form.method} onChange={(event) => update({ method: event.target.value, moneyAccountId: '' })}><option value="CASH">Cash</option><option value="KPAY">KBZPay</option><option value="WAVE_PAY">WavePay</option><option value="OTHER">Other</option></select></label>
            <label>Account<select value={form.moneyAccountId} onChange={(event) => update({ moneyAccountId: event.target.value })}><option value="">No account / Auto</option>{accounts.map((account) => <option value={account.id} key={account.id}>{account.name} · {money(account.balance)}</option>)}</select></label>
          </div>
          <label>Note<input value={form.note} onChange={(event) => update({ note: event.target.value })} placeholder="Details" maxLength={500} /></label>
          <footer>
            <button type="button" disabled={saving} onClick={onClose}>Cancel</button>
            <button type="submit" className="br-save-edit" disabled={saving}>{saving ? <Loader2 className="br-spin" size={18} /> : <Save size={18} />} Save Changes</button>
          </footer>
        </form>
      </section>
    </div>
  );
}

export default function BusinessRecordsPanel() {
  const today = yangonToday();
  const session = getSession();
  const role = session?.user?.role || '';
  const permissions = session?.user?.permissions || {};
  const rawBusinessType = session?.shop?.businessType || session?.user?.shop?.businessType || session?.businessType || 'PHONE_SHOP';
  const isMiniMart = String(rawBusinessType).toUpperCase() === 'MINI_MART';
  const canWriteAccounting = isAccountingAdminRole(role) || permissions.accounting === true;
  const [businessDate, setBusinessDate] = useState(today);
  const [type, setType] = useState('income');
  const [from, setFrom] = useState(monthStart(today));
  const [to, setTo] = useState(today);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState({ rows: [], total: 0, totalAmount: 0, totalPages: 1 });
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [selected, setSelected] = useState(null);
  const [editing, setEditing] = useState(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [context, setContext] = useState({ accounts: [], closing: null });
  const [formMode, setFormMode] = useState('income');
  const [savingIncome, setSavingIncome] = useState(false);
  const [savingExpense, setSavingExpense] = useState(false);
  const [catalogs, setCatalogs] = useState({ incomeCategories: [], expenseCategories: [] });
  const [income, setIncome] = useState({ category: DEFAULT_INCOME_CATEGORY, source: '', amount: '', method: 'CASH', moneyAccountId: '', note: '' });
  const [expense, setExpense] = useState({ category: DEFAULT_EXPENSE_CATEGORY, amount: '', method: 'CASH', moneyAccountId: '', note: '' });
  const incomeOptions = useMemo(() => buildIncomeOptions(catalogs.incomeCategories, isMiniMart), [catalogs.incomeCategories, isMiniMart]);
  const expenseOptions = useMemo(() => buildExpenseOptions(catalogs.expenseCategories, isMiniMart), [catalogs.expenseCategories, isMiniMart]);

  const params = useMemo(() => {
    const search = new URLSearchParams({
      type,
      from,
      to,
      page: String(page),
      limit: '10',
    });
    if (query.trim()) search.set('q', query.trim());
    return search;
  }, [type, from, to, page, query]);

  const handleError = (requestError) => {
    if (requestError?.status === 401) {
      clearSession();
      window.location.reload();
      return;
    }
    setError(requestError?.message || 'Records request failed');
  };

  const loadContext = async () => {
    try {
      const response = await apiFetch(`/api/business-control/overview?date=${encodeURIComponent(businessDate)}`);
      setContext({ accounts: response.accounts || [], closing: response.closing || null });
    } catch (requestError) {
      handleError(requestError);
    }
  };

  const loadCatalogs = async () => {
    try {
      const response = await apiFetch('/api/finance/settings/catalogs');
      setCatalogs({
        incomeCategories: response.incomeCategories || [],
        expenseCategories: response.expenseCategories || [],
      });
    } catch (requestError) {
      handleError(requestError);
    }
  };

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await apiFetch(`/api/business-control/records?${params.toString()}`);
      setData(response);
    } catch (requestError) {
      handleError(requestError);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const timer = window.setTimeout(load, 180);
    return () => window.clearTimeout(timer);
  }, [params.toString()]);

  useEffect(() => {
    loadContext();
  }, [businessDate]);

  useEffect(() => {
    loadCatalogs();
  }, []);

  useEffect(() => {
    if (!incomeOptions.some((option) => option.value === income.category)) {
      setIncome((current) => ({ ...current, category: incomeOptions[0]?.value || DEFAULT_INCOME_CATEGORY }));
    }
  }, [incomeOptions.map((option) => option.value).join('|')]);

  useEffect(() => {
    if (!expenseOptions.some((option) => option.value === expense.category)) {
      setExpense((current) => ({ ...current, category: expenseOptions[0]?.value || DEFAULT_EXPENSE_CATEGORY }));
    }
  }, [expenseOptions.map((option) => option.value).join('|')]);

  useEffect(() => setPage(1), [type, from, to, query]);

  const exportCsv = async () => {
    setExporting(true);
    setError('');
    try {
      const exportParams = new URLSearchParams({ type, from, to });
      if (query.trim()) exportParams.set('q', query.trim());
      await apiDownload(
        `/api/business-control/records/export?${exportParams.toString()}`,
        `${type === 'income' ? 'other-income' : 'quick-expense'}-${from}-to-${to}.csv`,
      );
    } catch (requestError) {
      handleError(requestError);
    } finally {
      setExporting(false);
    }
  };

  const submitIncome = async (event) => {
    event.preventDefault();
    setNotice('');
    setError('');
    setSavingIncome(true);
    try {
      await apiFetch('/api/business-control/other-income', {
        method: 'POST',
        body: {
          incomeDate: businessDate,
          category: income.category,
          source: income.source,
          amount: Number(income.amount),
          method: income.method,
          moneyAccountId: income.moneyAccountId || null,
          note: income.note,
        },
      });
      setIncome({ category: DEFAULT_INCOME_CATEGORY, source: '', amount: '', method: 'CASH', moneyAccountId: '', note: '' });
      setType('income');
      setNotice('Income saved and wallet balance updated.');
      await loadContext();
      await load();
    } catch (requestError) {
      handleError(requestError);
    } finally {
      setSavingIncome(false);
    }
  };

  const submitExpense = async (event) => {
    event.preventDefault();
    setNotice('');
    setError('');
    setSavingExpense(true);
    try {
      await apiFetch('/api/business-control/expenses', {
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
      setExpense({ category: expenseOptions[0]?.value || DEFAULT_EXPENSE_CATEGORY, amount: '', method: 'CASH', moneyAccountId: '', note: '' });
      setType('expense');
      setNotice('Expense saved and account balance updated.');
      await loadContext();
      await load();
    } catch (requestError) {
      handleError(requestError);
    } finally {
      setSavingExpense(false);
    }
  };

  const saveEdit = async (record, body) => {
    setSavingEdit(true);
    setError('');
    setNotice('');
    try {
      const response = await apiFetch(`/api/business-control/records/${record.type}/${record.id}`, {
        method: 'PATCH',
        body,
      });
      setEditing(null);
      setNotice(response.message || 'Record updated and account balance adjusted.');
      await loadContext();
      await load();
    } catch (requestError) {
      handleError(requestError);
    } finally {
      setSavingEdit(false);
    }
  };

  const openEdit = (record) => {
    if (!canWriteAccounting) {
      setNotice('');
      setError('Accounting permission is required');
      return;
    }
    setEditing(record);
  };

  const accounts = context.accounts || [];
  const dayClosed = Boolean(context.closing);

  return (
    <section className="br-panel">
      <section className="br-entry-panel">
        <div className="br-entry-top">
          <div>
            <span>NEW RECORD</span>
            <h4>{formMode === 'income' ? 'Add Other Income' : 'Add Expense'}</h4>
          </div>
        </div>
        <div className="br-record-actions">
          <button type="button" className={formMode === 'income' ? 'active income' : ''} onClick={() => setFormMode('income')}>
            <PlusCircle size={18} /><span><b>Other Income</b><small>Income entry form</small></span>
          </button>
          <button type="button" className={formMode === 'expense' ? 'active expense' : ''} onClick={() => setFormMode('expense')}>
            <CreditCard size={18} /><span><b>Quick Expense</b><small>Expense entry form</small></span>
          </button>
        </div>

        {notice ? <div className="br-notice"><CheckCircle2 size={18} />{notice}</div> : null}
        {dayClosed ? <div className="br-warning"><AlertTriangle size={18} />This day is already closed. New records cannot be added.</div> : null}

        {formMode === 'income' ? (
          canWriteAccounting ? <form className="br-entry-form" onSubmit={submitIncome}>
            <div className="br-form-grid">
              <label>Category<select value={income.category} onChange={(event) => setIncome({ ...income, category: event.target.value })}>{incomeOptions.map((option) => <option key={option.value} value={option.value}>{option.name}</option>)}</select></label>
              <label>Description<input required value={income.source} onChange={(event) => setIncome({ ...income, source: event.target.value })} placeholder="Income detail" maxLength={80} /></label>
              <label>Amount<input required type="number" min="1" step="1" value={income.amount} onChange={(event) => setIncome({ ...income, amount: event.target.value })} placeholder="0" /></label>
              <label>Method<select value={income.method} onChange={(event) => setIncome({ ...income, method: event.target.value, moneyAccountId: '' })}><option value="CASH">Cash</option><option value="KPAY">KBZPay</option><option value="WAVE_PAY">WavePay</option><option value="OTHER">Other</option></select></label>
              <label>Wallet<select value={income.moneyAccountId} onChange={(event) => setIncome({ ...income, moneyAccountId: event.target.value })}><option value="">Auto-select wallet</option>{accounts.map((account) => <option value={account.id} key={account.id}>{account.name} · {money(account.balance)}</option>)}</select></label>
            </div>
            <button type="submit" disabled={savingIncome || dayClosed}>{savingIncome ? <Loader2 className="br-spin" size={18} /> : <PlusCircle size={18} />} {dayClosed ? 'Closed Day Cannot Change' : 'Save Income'}</button>
          </form> : <div className="br-warning">Accounting permission is required.</div>
        ) : null}

        {formMode === 'expense' ? (
          canWriteAccounting ? <form className="br-entry-form" onSubmit={submitExpense}>
            <div className="br-form-grid">
              <label>Category<select required value={expense.category} onChange={(event) => setExpense({ ...expense, category: event.target.value })}>{expenseOptions.map((option) => <option key={option.value} value={option.value}>{option.name}</option>)}</select></label>
              <label>Description<input required value={expense.note} onChange={(event) => setExpense({ ...expense, note: event.target.value })} placeholder="Expense detail" maxLength={500} /></label>
              <label>Amount<input required type="number" min="1" step="1" value={expense.amount} onChange={(event) => setExpense({ ...expense, amount: event.target.value })} placeholder="0" /></label>
              <label>Method<select value={expense.method} onChange={(event) => setExpense({ ...expense, method: event.target.value, moneyAccountId: '' })}><option value="CASH">Cash</option><option value="KPAY">KBZPay</option><option value="WAVE_PAY">WavePay</option><option value="OTHER">Other</option></select></label>
              <label>Wallet<select value={expense.moneyAccountId} onChange={(event) => setExpense({ ...expense, moneyAccountId: event.target.value })}><option value="">Auto-select wallet</option>{accounts.map((account) => <option value={account.id} key={account.id}>{account.name} · {money(account.balance)}</option>)}</select></label>
            </div>
            <button type="submit" disabled={savingExpense || dayClosed}>{savingExpense ? <Loader2 className="br-spin" size={18} /> : <CreditCard size={18} />} {dayClosed ? 'Closed Day Cannot Change' : 'Save Expense'}</button>
          </form> : <div className="br-warning">Accounting permission is required.</div>
        ) : null}
      </section>

      <div className="br-tabs">
        <button type="button" className={type === 'income' ? 'active income' : ''} onClick={() => setType('income')}><Wallet size={18} /> Income Records</button>
        <button type="button" className={type === 'expense' ? 'active expense' : ''} onClick={() => setType('expense')}><FileSpreadsheet size={18} /> Expense Records</button>
      </div>

      <div className="br-toolbar">
        <label><CalendarDays size={17} /><span>From</span><input type="date" value={from} max={to} onChange={(event) => setFrom(event.target.value || monthStart(today))} /></label>
        <label><CalendarDays size={17} /><span>To</span><input type="date" value={to} min={from} max={today} onChange={(event) => setTo(event.target.value || today)} /></label>
        <label className="br-search"><Search size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Source, category, note, account, staff…" /></label>
        <button type="button" onClick={load} disabled={loading}>{loading ? <Loader2 className="br-spin" size={18} /> : <RefreshCw size={18} />} Refresh</button>
        <button type="button" className="br-export" onClick={exportCsv} disabled={exporting}>{exporting ? <Loader2 className="br-spin" size={18} /> : <Download size={18} />} Export CSV</button>
      </div>

      {error ? <div className="br-error">{error}</div> : null}

      <div className="br-summary">
        <article><span>Total Records</span><b>{Number(data.total || 0).toLocaleString()}</b></article>
        <article><span>Total Amount</span><b>{money(data.totalAmount)}</b></article>
        <article><span>Date Range</span><b>{from} → {to}</b></article>
      </div>

      <div className="br-table-wrap">
        <table>
          <thead>
            <tr><th>Date</th><th>Category</th><th>{type === 'income' ? 'Source' : 'Expense'}</th><th>Amount</th><th>Payment / Account</th><th>Note</th><th>Created By</th><th>Action</th></tr>
          </thead>
          <tbody>
            {(data.rows || []).map((record) => (
              <tr key={record.id}>
                <td><b>{record.businessDate}</b><small>{formatDateTime(record.createdAt)}</small></td>
                <td><span className={`br-category ${record.category === 'SERVICE_INCOME' ? 'service' : ''}`}>{categoryLabel(record, isMiniMart)}</span></td>
                <td><b>{record.title || '-'}</b></td>
                <td><strong className={type === 'expense' ? 'expense' : 'income'}>{money(record.amount)}</strong></td>
                <td><b>{record.method}</b><small>{record.accountName || 'No account'}</small></td>
                <td><span className="br-note">{record.note || '-'}</span></td>
                <td><b>{record.createdByName || '-'}</b><small>{record.createdByUsername || ''}</small></td>
                <td>
                  <div className="br-row-actions">
                    <button type="button" className="br-view" onClick={() => setSelected(record)}><Eye size={17} /> View</button>
                    <button type="button" className="br-edit" onClick={() => openEdit(record)}><Pencil size={17} /> Edit</button>
                  </div>
                </td>
              </tr>
            ))}
            {!loading && !data.rows?.length ? <tr><td colSpan="8"><div className="br-empty">No records found for this date range.</div></td></tr> : null}
          </tbody>
        </table>
        {loading ? <div className="br-loading"><Loader2 className="br-spin" /> Loading records…</div> : null}
      </div>

      <div className="br-pagination">
        <span>Showing {data.rows?.length || 0} of {data.total || 0}</span>
        <div>
          <button type="button" disabled={page <= 1 || loading} onClick={() => setPage((value) => Math.max(1, value - 1))}><ChevronLeft size={17} /> Previous</button>
          <b>Page {page} / {Math.max(1, Number(data.totalPages || 1))}</b>
          <button type="button" disabled={page >= Math.max(1, Number(data.totalPages || 1)) || loading} onClick={() => setPage((value) => value + 1)}>Next <ChevronRight size={17} /></button>
        </div>
      </div>

      <DetailModal record={selected} isMiniMart={isMiniMart} onClose={() => setSelected(null)} />
      <EditModal record={editing} accounts={accounts} isMiniMart={isMiniMart} incomeOptions={incomeOptions} expenseOptions={expenseOptions} saving={savingEdit} onSave={saveEdit} onClose={() => setEditing(null)} />
    </section>
  );
}
