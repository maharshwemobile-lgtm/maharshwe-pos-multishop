import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Ban,
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
import businessRecordCategories from '../shared/business-record-categories.json';
import { pickLanguageText as t } from './settings/ProjectLanguageRuntime.jsx';
import './business-records.css';

const money = (value) => `${Number(value || 0).toLocaleString('en-US')} MMK`;
const DEFAULT_INCOME_OPTIONS = businessRecordCategories.income.map((item) => ({ name: item.my, value: item.value }));
const DEFAULT_EXPENSE_OPTIONS = businessRecordCategories.expense.map((item) => item.value);
const DEFAULT_INCOME_CATEGORY = DEFAULT_INCOME_OPTIONS[0].value;
const DEFAULT_EXPENSE_CATEGORY = DEFAULT_EXPENSE_OPTIONS[0];

function yangonToday() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Yangon', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function formatDateTime(value) {
  if (!value) return '-';
  try {
    return new Intl.DateTimeFormat(t('en-GB', 'my-MM'), {
      timeZone: 'Asia/Yangon',
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value));
  } catch {
    return String(value);
  }
}

function methodLabel(value) {
  if (value === 'CASH') return t('Cash', 'ငွေသား');
  if (value === 'OTHER') return t('Other', 'အခြား');
  return value || '-';
}

function categoryLabel(record, isMiniMart = false) {
  const rows = record.type === 'expense' ? businessRecordCategories.expense : businessRecordCategories.income;
  const category = String(record.category || '').trim().toLowerCase();
  const exact = rows.find((item) => item.value.toLowerCase() === category
    || item.en.toLowerCase() === category
    || item.my.toLowerCase() === category);
  const match = exact || rows.find((item) => (
    (item.aliases || []).some((alias) => String(alias).toLowerCase() === category)
  ));
  if (match) return t(match.en, match.my);
  const fallback = record.type === 'expense' ? rows[0] : (isMiniMart ? rows[3] : rows[0]);
  return t(fallback.en, fallback.my);
}

function normalizedCategory(type, value) {
  const rows = type === 'expense' ? businessRecordCategories.expense : businessRecordCategories.income;
  const input = String(value || '').trim().toLowerCase();
  const exact = rows.find((item) => item.value.toLowerCase() === input
    || item.en.toLowerCase() === input
    || item.my.toLowerCase() === input);
  if (exact) return exact.value;
  return rows.find((item) => (
    (item.aliases || []).some((alias) => String(alias).toLowerCase() === input)
  ))?.value || (type === 'expense' ? rows[0].value : rows[3].value);
}

// A Mini Mart has no repair bench, so the service income/expense pair only
// clutters its category picker. Existing records keep their label either way.
const SERVICE_ALIASES = new Set(['OTHER_SERVICE_INCOME', 'OTHER_SERVICE_EXPENSE']);

function serviceCategory(item) {
  return (item.aliases || []).some((alias) => SERVICE_ALIASES.has(String(alias)));
}

function buildIncomeOptions(isMiniMart = false) {
  return businessRecordCategories.income
    .filter((item) => !isMiniMart || !serviceCategory(item))
    .map((item) => ({ name: t(item.en, item.my), value: item.value }));
}

function buildExpenseOptions(isMiniMart = false) {
  return businessRecordCategories.expense
    .filter((item) => !isMiniMart || !serviceCategory(item))
    .map((item) => ({ name: t(item.en, item.my), value: item.value }));
}

function DetailModal({ record, onClose, isMiniMart = false }) {
  if (!record) return null;
  return (
    <div className="br-modal-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="br-modal" role="dialog" aria-modal="true">
        <header>
          <div><Eye size={21} /><span><b>{t('Record Details', 'စာရင်းအသေးစိတ်')}</b><small>{record.businessDate}</small></span></div>
          <button type="button" onClick={onClose}><X size={19} /></button>
        </header>
        <div className="br-detail-grid">
          <article><span>{t('Record Type', 'စာရင်းအမျိုးအစား')}</span><b>{record.type === 'income' ? t('Other Income', 'အခြားဝင်ငွေ') : t('Quick Expense', 'အခြားထွက်ငွေ')}</b></article>
          <article><span>{t('Category', 'အမျိုးအစား')}</span><b>{categoryLabel(record, isMiniMart)}</b></article>
          <article><span>{record.type === 'income' ? t('Source', 'ဝင်ငွေအကြောင်းအရာ') : t('Expense Name', 'ထွက်ငွေအကြောင်းအရာ')}</span><b>{record.title || '-'}</b></article>
          <article><span>{t('Amount', 'ငွေပမာဏ')}</span><b>{money(record.amount)}</b></article>
          <article><span>{t('Payment Method', 'ငွေပေးချေမှုနည်းလမ်း')}</span><b>{methodLabel(record.method)}</b></article>
          <article><span>{t('Money Account', 'ငွေစာရင်း')}</span><b>{record.accountName || t('Auto / No account', 'အလိုအလျောက် / စာရင်းမရှိ')}</b></article>
          <article><span>{t('Created By', 'မှတ်တမ်းတင်သူ')}</span><b>{record.createdByName || '-'}</b><small>{record.createdByUsername || ''}</small></article>
          <article><span>{t('Created At', 'မှတ်တမ်းတင်ချိန်')}</span><b>{formatDateTime(record.createdAt)}</b></article>
          {record.updatedAt ? <article><span>{t('Updated At', 'ပြင်ဆင်ချိန်')}</span><b>{formatDateTime(record.updatedAt)}</b></article> : null}
          {record.voidedAt ? <article><span>{t('Status', 'အခြေအနေ')}</span><b className="br-void-text">{t('VOIDED', 'ပယ်ဖျက်ပြီး')}</b><small>{formatDateTime(record.voidedAt)}</small></article> : null}
          {record.voidedAt ? <article className="wide"><span>{t('Void Reason', 'ပယ်ဖျက်ရသည့်အကြောင်းရင်း')}</span><p>{record.voidReason || '-'}</p><small>{record.voidedByName || ''}</small></article> : null}
          <article className="wide"><span>{t('Note', 'မှတ်ချက်')}</span><p>{record.note || t('No note.', 'မှတ်ချက်မရှိပါ။')}</p></article>
          <article className="wide"><span>{t('Record ID', 'စာရင်း ID')}</span><code>{record.id}</code></article>
        </div>
        <footer><button type="button" onClick={onClose}>{t('Close', 'ပိတ်မည်')}</button></footer>
      </section>
    </div>
  );
}

function EditModal({ record, accounts, incomeOptions, expenseOptions, saving, onSave, onClose }) {
  const buildForm = (currentRecord) => ({
    businessDate: currentRecord?.businessDate || yangonToday(),
    category: normalizedCategory(
      currentRecord?.type || 'income',
      currentRecord?.type === 'income' ? currentRecord?.category : (currentRecord?.title || currentRecord?.category),
    ),
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
          <div><Pencil size={21} /><span><b>{record.type === 'income' ? t('Edit Other Income', 'အခြားဝင်ငွေ ပြင်ဆင်မည်') : t('Edit Quick Expense', 'အခြားထွက်ငွေ ပြင်ဆင်မည်')}</b><small>{t('Account balance will be recalculated safely.', 'ငွေစာရင်းလက်ကျန်ကို အလိုအလျောက် ပြန်တွက်ပေးပါမည်။')}</small></span></div>
          <button type="button" disabled={saving} onClick={onClose}><X size={19} /></button>
        </header>
        <form className="br-edit-form" onSubmit={submit}>
          <div className="br-form-grid">
            <label>{t('Date', 'ရက်စွဲ')}<input required type="date" value={form.businessDate} onChange={(event) => update({ businessDate: event.target.value })} /></label>
            {record.type === 'income' ? (
              <label>{t('Category', 'အမျိုးအစား')}<select value={form.category} onChange={(event) => update({ category: event.target.value })}>{incomeOptions.map((option) => <option key={option.value} value={option.value}>{option.name}</option>)}</select></label>
            ) : (
              <label>{t('Category', 'အမျိုးအစား')}<select required value={form.category} onChange={(event) => update({ category: event.target.value })}>{expenseOptions.map((option) => <option key={option.value} value={option.value}>{option.name}</option>)}</select></label>
            )}
            {record.type === 'income' ? (
              <label>{t('Source', 'ဝင်ငွေအကြောင်းအရာ')}<input required value={form.title} onChange={(event) => update({ title: event.target.value })} maxLength={80} /></label>
            ) : null}
            <label>{t('Amount', 'ငွေပမာဏ')}<input required type="number" min="1" step="1" value={form.amount} onChange={(event) => update({ amount: event.target.value })} /></label>
            <label>{t('Method', 'ငွေပေးချေမှုနည်းလမ်း')}<select value={form.method} onChange={(event) => update({ method: event.target.value, moneyAccountId: '' })}><option value="CASH">{t('Cash', 'ငွေသား')}</option><option value="KPAY">KBZPay</option><option value="WAVE_PAY">WavePay</option><option value="OTHER">{t('Other', 'အခြား')}</option></select></label>
            <label>{t('Account', 'ငွေစာရင်း')}<select value={form.moneyAccountId} onChange={(event) => update({ moneyAccountId: event.target.value })}><option value="">{t('No account / Auto', 'စာရင်းမရွေး / အလိုအလျောက်')}</option>{accounts.map((account) => <option value={account.id} key={account.id}>{account.name} · {money(account.balance)}</option>)}</select></label>
          </div>
          <label>{t('Note', 'မှတ်ချက်')}<input value={form.note} onChange={(event) => update({ note: event.target.value })} placeholder={t('Details', 'အသေးစိတ်')} maxLength={500} /></label>
          <footer>
            <button type="button" disabled={saving} onClick={onClose}>{t('Cancel', 'မလုပ်တော့ပါ')}</button>
            <button type="submit" className="br-save-edit" disabled={saving}>{saving ? <Loader2 className="br-spin" size={18} /> : <Save size={18} />} {t('Save Changes', 'ပြင်ဆင်မှုသိမ်းမည်')}</button>
          </footer>
        </form>
      </section>
    </div>
  );
}

function VoidModal({ record, saving, reason, setReason, onConfirm, onClose }) {
  if (!record) return null;
  return <div className="br-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onClose(); }}>
    <section className="br-modal br-void-modal" role="dialog" aria-modal="true">
      <header><div><Ban size={21}/><span><b>{record.type === 'income' ? t('Void Other Income', 'အခြားဝင်ငွေ ပယ်ဖျက်မည်') : t('Void Expense', 'ထွက်ငွေ ပယ်ဖျက်မည်')}</b><small>{record.businessDate} · {money(record.amount)}</small></span></div><button type="button" disabled={saving} onClick={onClose}><X size={19}/></button></header>
      <form className="br-edit-form" onSubmit={onConfirm}>
        <div className="br-warning"><AlertTriangle size={18}/>{t('Voiding automatically restores the related account balance and daily total.', 'ပယ်ဖျက်ပါက ဆက်စပ်ငွေစာရင်းလက်ကျန်နှင့် နေ့စဉ်စုစုပေါင်းကို အလိုအလျောက် ပြန်ညှိပေးပါမည်။')}</div>
        <label>{t('Void Reason', 'ပယ်ဖျက်ရသည့်အကြောင်းရင်း')} *<input required minLength={3} value={reason} onChange={(event) => setReason(event.target.value)} placeholder={t('Reason for correcting this record', 'မှားယွင်းသည့်အကြောင်းရင်း')}/></label>
        <footer><button type="button" disabled={saving} onClick={onClose}>{t('Cancel', 'မလုပ်တော့ပါ')}</button><button type="submit" className="br-confirm-void" disabled={saving || reason.trim().length < 3}>{saving ? <Loader2 className="br-spin" size={18}/> : <Ban size={18}/>} {t('Confirm Void', 'ပယ်ဖျက်မှုအတည်ပြုမည်')}</button></footer>
      </form>
    </section>
  </div>;
}

export default function BusinessRecordsPanel() {
  const today = yangonToday();
  const session = getSession();
  const role = session?.user?.role || '';
  const permissions = session?.user?.permissions || {};
  const rawBusinessType = session?.shop?.businessType || session?.user?.shop?.businessType || session?.businessType || 'PHONE_SHOP';
  const isMiniMart = String(rawBusinessType).toUpperCase() === 'MINI_MART';
  const canWriteAccounting = role === 'SUPER_ADMIN' || role === 'SHOP_ADMIN' || permissions.accounting === true;
  const [businessDate, setBusinessDate] = useState(today);
  const [type, setType] = useState('income');
  const [from, setFrom] = useState(today);
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
  const [voiding, setVoiding] = useState(null);
  const [voidReason, setVoidReason] = useState('');
  const [savingVoid, setSavingVoid] = useState(false);
  const [context, setContext] = useState({ accounts: [], closing: null });
  const [formMode, setFormMode] = useState('income');
  const [savingIncome, setSavingIncome] = useState(false);
  const [savingExpense, setSavingExpense] = useState(false);
  const [languageVersion, setLanguageVersion] = useState(0);
  const [income, setIncome] = useState({ category: DEFAULT_INCOME_CATEGORY, source: '', amount: '', method: 'CASH', moneyAccountId: '', note: '' });
  const [expense, setExpense] = useState({ category: DEFAULT_EXPENSE_CATEGORY, amount: '', method: 'CASH', moneyAccountId: '', note: '' });
  const incomeOptions = useMemo(() => buildIncomeOptions(isMiniMart), [languageVersion, isMiniMart]);
  const expenseOptions = useMemo(() => buildExpenseOptions(isMiniMart), [languageVersion, isMiniMart]);

  useEffect(() => {
    const handleLanguage = () => setLanguageVersion((value) => value + 1);
    window.addEventListener('mahar-project-language', handleLanguage);
    return () => window.removeEventListener('mahar-project-language', handleLanguage);
  }, []);

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
    setError(requestError?.message || t('Records request failed', 'စာရင်းရယူမှု မအောင်မြင်ပါ'));
  };

  const loadContext = async () => {
    try {
      const response = await apiFetch(`/api/business-control/overview?date=${encodeURIComponent(businessDate)}`);
      setContext({ accounts: response.accounts || [], closing: response.closing || null });
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
      setNotice(t('Income saved and account balance updated.', 'ဝင်ငွေစာရင်းသိမ်းပြီး ငွေစာရင်းလက်ကျန်ကို ပြင်ဆင်ပြီးပါပြီ။'));
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
      setNotice(t('Expense saved and account balance updated.', 'ထွက်ငွေစာရင်းသိမ်းပြီး ငွေစာရင်းလက်ကျန်ကို ပြင်ဆင်ပြီးပါပြီ။'));
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
      setNotice(t('Record updated and account balance adjusted.', 'စာရင်းနှင့် ငွေစာရင်းလက်ကျန်ကို ပြင်ဆင်ပြီးပါပြီ။'));
      await loadContext();
      await load();
    } catch (requestError) {
      handleError(requestError);
    } finally {
      setSavingEdit(false);
    }
  };

  const confirmVoid = async (event) => {
    event.preventDefault();
    setSavingVoid(true);
    setError('');
    setNotice('');
    try {
      const response = await apiFetch(`/api/business-control/records/${voiding.type}/${voiding.id}/void`, {
        method: 'POST',
        body: { reason: voidReason },
      });
      setVoiding(null);
      setVoidReason('');
      setNotice(t('Record voided and account balance restored.', 'စာရင်းပယ်ဖျက်ပြီး ငွေစာရင်းလက်ကျန်ကို ပြန်ညှိပြီးပါပြီ။'));
      await loadContext();
      await load();
    } catch (requestError) {
      handleError(requestError);
    } finally {
      setSavingVoid(false);
    }
  };

  const accounts = context.accounts || [];
  const dayClosed = Boolean(context.closing);

  return (
    <section className="br-panel">
      <header className="br-heading">
        <div>
          <span>{t('OTHER INCOME & EXPENSE', 'အခြားဝင်ငွေနှင့် ထွက်ငွေ')}</span>
          <h3>{t('Income and Expense Records', 'ဝင်ငွေနှင့် ထွက်ငွေစာရင်း')}</h3>
          <p>{t('Add, review, edit, void, and export income and expense records.', 'ဝင်ငွေ၊ ထွက်ငွေစာရင်းများကို ထည့်သွင်း၊ ကြည့်ရှု၊ ပြင်ဆင်၊ ပယ်ဖျက်နှင့် ထုတ်ယူနိုင်ပါသည်။')}</p>
        </div>
        <FileSpreadsheet size={26} />
      </header>

      <section className="br-entry-panel">
        <div className="br-entry-top">
          <div>
            <span>{t('NEW RECORD', 'စာရင်းအသစ်')}</span>
            <h4>{formMode === 'income' ? t('Add Other Income', 'အခြားဝင်ငွေ ထည့်မည်') : t('Add Expense', 'အခြားထွက်ငွေ ထည့်မည်')}</h4>
          </div>
          <label><CalendarDays size={17} /><span>{t('Date', 'ရက်စွဲ')}</span><input type="date" value={businessDate} max={today} onChange={(event) => {
            const selectedDate = event.target.value || today;
            setBusinessDate(selectedDate);
            setFrom(selectedDate);
            setTo(selectedDate);
            setPage(1);
          }} /></label>
        </div>
        <div className="br-record-actions">
          <button type="button" className={formMode === 'income' ? 'active income' : ''} onClick={() => setFormMode('income')}>
            <PlusCircle size={18} /><span><b>{t('Other Income', 'အခြားဝင်ငွေ')}</b><small>{t('Income entry form', 'ဝင်ငွေစာရင်းသွင်းရန်')}</small></span>
          </button>
          <button type="button" className={formMode === 'expense' ? 'active expense' : ''} onClick={() => setFormMode('expense')}>
            <CreditCard size={18} /><span><b>{t('Other Expense', 'အခြားထွက်ငွေ')}</b><small>{t('Expense entry form', 'ထွက်ငွေစာရင်းသွင်းရန်')}</small></span>
          </button>
        </div>

        {notice ? <div className="br-notice"><CheckCircle2 size={18} />{notice}</div> : null}
        {dayClosed ? <div className="br-warning"><AlertTriangle size={18} />{t('This day is already closed. New records cannot be added.', 'ဤရက်၏စာရင်းပိတ်ပြီးဖြစ်၍ စာရင်းအသစ် ထည့်မရပါ။')}</div> : null}

        {formMode === 'income' ? (
          canWriteAccounting ? <form className="br-entry-form" onSubmit={submitIncome}>
            <div className="br-form-grid">
              <label>{t('Category', 'အမျိုးအစား')}<select value={income.category} onChange={(event) => setIncome({ ...income, category: event.target.value })}>{incomeOptions.map((option) => <option key={option.value} value={option.value}>{option.name}</option>)}</select></label>
              <label>{t('Source', 'ဝင်ငွေအကြောင်းအရာ')}<input required value={income.source} onChange={(event) => setIncome({ ...income, source: event.target.value })} placeholder={isMiniMart
                ? t('Example: top-up sale or commission', 'ဥပမာ - ငွေဖြည့်ကဒ်ရောင်းချမှု သို့မဟုတ် ကော်မရှင်')
                : t('Example: repair service or commission', 'ဥပမာ - ဖုန်းပြင်ခ သို့မဟုတ် ကော်မရှင်')} maxLength={80} /></label>
              <label>{t('Amount', 'ငွေပမာဏ')}<input required type="number" min="1" step="1" value={income.amount} onChange={(event) => setIncome({ ...income, amount: event.target.value })} placeholder="0" /></label>
              <label>{t('Method', 'ငွေပေးချေမှုနည်းလမ်း')}<select value={income.method} onChange={(event) => setIncome({ ...income, method: event.target.value, moneyAccountId: '' })}><option value="CASH">{t('Cash', 'ငွေသား')}</option><option value="KPAY">KBZPay</option><option value="WAVE_PAY">WavePay</option><option value="OTHER">{t('Other', 'အခြား')}</option></select></label>
              <label>{t('Account', 'ငွေစာရင်း')}<select value={income.moneyAccountId} onChange={(event) => setIncome({ ...income, moneyAccountId: event.target.value })}><option value="">{t('Auto-select account', 'ငွေစာရင်း အလိုအလျောက်ရွေးမည်')}</option>{accounts.map((account) => <option value={account.id} key={account.id}>{account.name} · {money(account.balance)}</option>)}</select></label>
            </div>
            <label>{t('Note', 'မှတ်ချက်')}<input value={income.note} onChange={(event) => setIncome({ ...income, note: event.target.value })} placeholder={t('Income details', 'ဝင်ငွေအသေးစိတ်')} maxLength={500} /></label>
            <button type="submit" disabled={savingIncome || dayClosed}>{savingIncome ? <Loader2 className="br-spin" size={18} /> : <PlusCircle size={18} />} {dayClosed ? t('Closed Day Cannot Change', 'စာရင်းပိတ်ရက်ကို ပြင်မရပါ') : t('Save Income', 'ဝင်ငွေသိမ်းမည်')}</button>
          </form> : <div className="br-warning">{t('Accounting permission is required.', 'ငွေစာရင်းစီမံခွင့် လိုအပ်ပါသည်။')}</div>
        ) : null}

        {formMode === 'expense' ? (
          canWriteAccounting ? <form className="br-entry-form" onSubmit={submitExpense}>
            <div className="br-form-grid">
              <label>{t('Category', 'အမျိုးအစား')}<select required value={expense.category} onChange={(event) => setExpense({ ...expense, category: event.target.value })}>{expenseOptions.map((option) => <option key={option.value} value={option.value}>{option.name}</option>)}</select></label>
              <label>{t('Amount', 'ငွေပမာဏ')}<input required type="number" min="1" step="1" value={expense.amount} onChange={(event) => setExpense({ ...expense, amount: event.target.value })} placeholder="0" /></label>
              <label>{t('Method', 'ငွေပေးချေမှုနည်းလမ်း')}<select value={expense.method} onChange={(event) => setExpense({ ...expense, method: event.target.value, moneyAccountId: '' })}><option value="CASH">{t('Cash', 'ငွေသား')}</option><option value="KPAY">KBZPay</option><option value="WAVE_PAY">WavePay</option><option value="OTHER">{t('Other', 'အခြား')}</option></select></label>
              <label>{t('Account', 'ငွေစာရင်း')}<select value={expense.moneyAccountId} onChange={(event) => setExpense({ ...expense, moneyAccountId: event.target.value })}><option value="">{t('Auto-select account', 'ငွေစာရင်း အလိုအလျောက်ရွေးမည်')}</option>{accounts.map((account) => <option value={account.id} key={account.id}>{account.name} · {money(account.balance)}</option>)}</select></label>
            </div>
            <label>{t('Note', 'မှတ်ချက်')}<input value={expense.note} onChange={(event) => setExpense({ ...expense, note: event.target.value })} placeholder={t('Expense details', 'ထွက်ငွေအသေးစိတ်')} maxLength={500} /></label>
            <button type="submit" disabled={savingExpense || dayClosed}>{savingExpense ? <Loader2 className="br-spin" size={18} /> : <CreditCard size={18} />} {dayClosed ? t('Closed Day Cannot Change', 'စာရင်းပိတ်ရက်ကို ပြင်မရပါ') : t('Save Expense', 'ထွက်ငွေသိမ်းမည်')}</button>
          </form> : <div className="br-warning">{t('Accounting permission is required.', 'ငွေစာရင်းစီမံခွင့် လိုအပ်ပါသည်။')}</div>
        ) : null}
      </section>

      <div className="br-tabs">
        <button type="button" className={type === 'income' ? 'active income' : ''} onClick={() => setType('income')}><Wallet size={18} /> {t('Income Records', 'ဝင်ငွေမှတ်တမ်း')}</button>
        <button type="button" className={type === 'expense' ? 'active expense' : ''} onClick={() => setType('expense')}><FileSpreadsheet size={18} /> {t('Expense Records', 'ထွက်ငွေမှတ်တမ်း')}</button>
      </div>

      <div className="br-toolbar">
        <label className="br-search"><Search size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('Search source, category, note, account, or staff', 'အကြောင်းအရာ၊ အမျိုးအစား၊ မှတ်ချက်၊ ငွေစာရင်း သို့မဟုတ် ဝန်ထမ်း ရှာမည်')} /></label>
        <button type="button" onClick={load} disabled={loading}>{loading ? <Loader2 className="br-spin" size={18} /> : <RefreshCw size={18} />} {t('Refresh', 'ပြန်စစ်မည်')}</button>
        <button type="button" className="br-export" onClick={exportCsv} disabled={exporting}>{exporting ? <Loader2 className="br-spin" size={18} /> : <Download size={18} />} {t('Export CSV', 'CSV ထုတ်မည်')}</button>
      </div>

      {error ? <div className="br-error">{error}</div> : null}

      <div className="br-summary">
        <article><span>{t('Total Records', 'စာရင်းအရေအတွက်')}</span><b>{Number(data.total || 0).toLocaleString()}</b></article>
        <article><span>{t('Total Amount', 'စုစုပေါင်းငွေပမာဏ')}</span><b>{money(data.totalAmount)}</b></article>
        <article><span>{t('Selected Date', 'ရွေးထားသည့်ရက်')}</span><b>{businessDate === today ? `${t('Today', 'ယနေ့')} · ${businessDate}` : businessDate}</b></article>
      </div>

      <div className="br-table-wrap">
        <table>
          <thead>
            <tr><th>{t('Date', 'ရက်စွဲ')}</th><th>{t('Category', 'အမျိုးအစား')}</th><th>{type === 'income' ? t('Source', 'ဝင်ငွေအကြောင်းအရာ') : t('Expense', 'ထွက်ငွေအကြောင်းအရာ')}</th><th>{t('Amount', 'ငွေပမာဏ')}</th><th>{t('Payment / Account', 'ငွေပေးချေမှု / ငွေစာရင်း')}</th><th>{t('Note', 'မှတ်ချက်')}</th><th>{t('Created By', 'မှတ်တမ်းတင်သူ')}</th><th>{t('Action', 'လုပ်ဆောင်ချက်')}</th></tr>
          </thead>
          <tbody>
            {(data.rows || []).map((record) => (
              <tr key={record.id} className={record.voidedAt ? 'br-voided-row' : ''}>
                <td><b>{record.businessDate}</b><small>{formatDateTime(record.createdAt)}</small></td>
                <td><span className={`br-category ${record.type === 'income' && normalizedCategory('income', record.category) === businessRecordCategories.income[0].value ? 'service' : ''}`}>{categoryLabel(record, isMiniMart)}</span></td>
                <td><b>{record.title || '-'}</b></td>
                <td><strong className={type === 'expense' ? 'expense' : 'income'}>{money(record.amount)}</strong>{record.voidedAt ? <small className="br-void-text">{t('VOIDED', 'ပယ်ဖျက်ပြီး')}</small> : null}</td>
                <td><b>{methodLabel(record.method)}</b><small>{record.accountName || t('No account', 'ငွေစာရင်းမရှိ')}</small></td>
                <td><span className="br-note">{record.note || '-'}</span></td>
                <td><b>{record.createdByName || '-'}</b><small>{record.createdByUsername || ''}</small></td>
                <td>
                  <div className="br-row-actions">
                    <button type="button" className="br-view" onClick={() => setSelected(record)}><Eye size={17} /> {t('View', 'ကြည့်မည်')}</button>
                    {canWriteAccounting && !record.voidedAt ? <button type="button" className="br-edit" onClick={() => setEditing(record)}><Pencil size={17} /> {t('Edit', 'ပြင်မည်')}</button> : null}
                    {canWriteAccounting && !record.voidedAt ? <button type="button" className="br-void" onClick={() => { setVoiding(record); setVoidReason(''); }}><Ban size={17}/> {t('Void', 'ပယ်ဖျက်မည်')}</button> : null}
                  </div>
                </td>
              </tr>
            ))}
            {!loading && !data.rows?.length ? <tr><td colSpan="8"><div className="br-empty">{t('No records found for this date range.', 'ရွေးထားသည့်ရက်အတွင်း စာရင်းမရှိပါ။')}</div></td></tr> : null}
          </tbody>
        </table>
        {loading ? <div className="br-loading"><Loader2 className="br-spin" /> {t('Loading records…', 'စာရင်းများ ရယူနေသည်…')}</div> : null}
      </div>

      <div className="br-pagination">
        <span>{t('Showing', 'ပြသထားသည်')} {data.rows?.length || 0} / {data.total || 0}</span>
        <div>
          <button type="button" disabled={page <= 1 || loading} onClick={() => setPage((value) => Math.max(1, value - 1))}><ChevronLeft size={17} /> {t('Previous', 'နောက်သို့')}</button>
          <b>{t('Page', 'စာမျက်နှာ')} {page} / {Math.max(1, Number(data.totalPages || 1))}</b>
          <button type="button" disabled={page >= Math.max(1, Number(data.totalPages || 1)) || loading} onClick={() => setPage((value) => value + 1)}>{t('Next', 'ရှေ့သို့')} <ChevronRight size={17} /></button>
        </div>
      </div>

      <DetailModal record={selected} isMiniMart={isMiniMart} onClose={() => setSelected(null)} />
      <EditModal record={editing} accounts={accounts} incomeOptions={incomeOptions} expenseOptions={expenseOptions} saving={savingEdit} onSave={saveEdit} onClose={() => setEditing(null)} />
      <VoidModal record={voiding} saving={savingVoid} reason={voidReason} setReason={setVoidReason} onConfirm={confirmVoid} onClose={() => setVoiding(null)}/>
    </section>
  );
}
