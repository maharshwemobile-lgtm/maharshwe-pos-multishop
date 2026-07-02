import React, { useEffect, useState } from 'react';
import { Banknote, Edit3, ExternalLink, Eye, EyeOff, Loader2, Plus, RefreshCw, Save, Tags, Trash2, WalletCards, X } from 'lucide-react';
import { apiFetch, getSession } from './phase2Api';
import './finance-catalog-settings-v23.css';

const EMPTY_METHOD = { name: '', code: '', kind: 'WALLET', openingBalance: '', supportsMoneyService: false };
const PAYMENT_EVENT = 'mahar:payment-methods-changed';

function Section({ icon: Icon, title, hint, count, children, open, onToggle }) {
  return <section className={`finance-catalog-section ${open ? 'open' : ''}`}>
    <button type="button" className="finance-catalog-section-head" onClick={onToggle}>
      <span><Icon size={20}/><b>{title}</b><small>{hint}</small></span>
      <span className="finance-section-meta">{Number.isFinite(count) ? <em>{count}</em> : null}<strong>{open ? '−' : '+'}</strong></span>
    </button>
    {open ? <div className="finance-catalog-section-body">{children}</div> : null}
  </section>;
}

function CategoryManager({ title, rows, endpoint, onReload }) {
  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState('');
  const [editId, setEditId] = useState('');
  const [editName, setEditName] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const run = async (request, text) => {
    setBusy(true); setMessage('');
    try { await request(); setMessage(text); await onReload(); return true; }
    catch (error) { setMessage(error.message || 'Request failed'); return false; }
    finally { setBusy(false); }
  };
  const add = async (event) => {
    event.preventDefault();
    if (!name.trim()) return;
    const ok = await run(() => apiFetch(endpoint, { method: 'POST', body: { name: name.trim() } }), `${title} added`);
    if (ok) { setName(''); setShowAdd(false); }
  };
  const save = async (row) => {
    if (!editName.trim()) return;
    const ok = await run(() => apiFetch(`${endpoint}/${row.id}`, { method: 'PATCH', body: { name: editName.trim() } }), `${title} updated`);
    if (ok) { setEditId(''); setEditName(''); }
  };
  const archive = (row) => {
    if (!window.confirm(`${row.name} ကို future selection မှာ မပြတော့ဘူးလား? History မပျက်ပါ။`)) return;
    run(() => apiFetch(`${endpoint}/${row.id}`, { method: 'DELETE' }), `${title} hidden`);
  };
  const restore = (row) => run(() => apiFetch(`${endpoint}/${row.id}`, { method: 'PATCH', body: { active: true } }), `${title} restored`);

  return <div className="finance-category-manager">
    {message ? <div className="finance-catalog-message">{message}</div> : null}
    <div className="finance-config-toolbar">
      <div><b>{rows.filter((row) => row.active !== false).length} active</b><small>Forms မှာ ဒီ active list ကိုသာရွေးနိုင်မယ်</small></div>
      <button type="button" onClick={() => setShowAdd((value) => !value)}><Plus size={16}/> {showAdd ? 'Close' : 'Add Category'}</button>
    </div>
    {showAdd ? <form onSubmit={add} className="finance-catalog-add-row">
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder={`New ${title.toLowerCase()} name`} autoFocus/>
      <button disabled={busy || !name.trim()}>{busy ? <Loader2 className="finance-catalog-spin" size={17}/> : <Plus size={17}/>} Add</button>
    </form> : null}
    <div className="finance-catalog-list">
      {rows.map((row) => <article key={row.id} className={row.active === false ? 'inactive' : ''}>
        {editId === row.id ? <input value={editName} onChange={(e) => setEditName(e.target.value)} autoFocus/> : <div><b>{row.name}</b><small>{row.active === false ? 'Hidden from future forms' : 'Available in business forms'}</small></div>}
        <div className="finance-catalog-actions">
          {editId === row.id ? <><button type="button" onClick={() => save(row)} title="Save"><Save size={16}/></button><button type="button" onClick={() => setEditId('')} title="Cancel"><X size={16}/></button></> : <button type="button" onClick={() => { setEditId(row.id); setEditName(row.name); }} title="Edit"><Edit3 size={16}/></button>}
          {row.active === false ? <button type="button" onClick={() => restore(row)} title="Restore"><RefreshCw size={16}/></button> : <button type="button" onClick={() => archive(row)} title="Hide"><Trash2 size={16}/></button>}
        </div>
      </article>)}
    </div>
  </div>;
}

function openProjectSettings() {
  const button = [...document.querySelectorAll('.sidebar button')]
    .find((node) => /Project Settings|Settings/i.test(node.textContent || ''));
  button?.click();
}

export default function FinanceCatalogSettingsV23({ embedded = false, mode = 'all' }) {
  const session = getSession();
  const canManage = ['SUPER_ADMIN', 'SHOP_ADMIN'].includes(session?.user?.role || '') || session?.user?.permissions?.settings === true;
  const [data, setData] = useState({ paymentMethods: [], incomeCategories: [], expenseCategories: [] });
  const [open, setOpen] = useState(mode === 'payments' ? 'wallets' : '');
  const [showWalletForm, setShowWalletForm] = useState(false);
  const [method, setMethod] = useState(EMPTY_METHOD);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const showPayments = mode === 'all' || mode === 'payments';
  const showCategories = mode === 'all' || mode === 'categories';

  useEffect(() => {
    if (mode === 'payments') setOpen('wallets');
  }, [mode]);

  const announce = (payload) => {
    window.dispatchEvent(new CustomEvent(PAYMENT_EVENT, { detail: payload || [] }));
  };

  const load = async () => {
    const [catalogs, pos] = await Promise.all([
      apiFetch('/api/finance/settings/catalogs'),
      apiFetch('/api/pos/payment-methods').catch(() => ({ paymentMethods: [] })),
    ]);
    const map = new Map();
    [...(catalogs.paymentMethods || []), ...(pos.paymentMethods || [])].forEach((row) => map.set(row.id || row.code, { ...map.get(row.id || row.code), ...row }));
    const paymentMethods = [...map.values()];
    const response = { ...catalogs, paymentMethods };
    setData(response);
    announce(paymentMethods);
    window.dispatchEvent(new CustomEvent('mahar:income-categories-changed', { detail: response.incomeCategories || [] }));
    window.dispatchEvent(new CustomEvent('mahar:expense-categories-changed', { detail: response.expenseCategories || [] }));
  };
  useEffect(() => { if (!embedded) load().catch((error) => setMessage(error.message)); }, [embedded]);

  const addMethod = async (event) => {
    event.preventDefault(); setBusy(true); setMessage('');
    try {
      await apiFetch('/api/finance/settings/payment-methods', { method: 'POST', body: { ...method, openingBalance: Number(method.openingBalance || 0) } });
      setMethod(EMPTY_METHOD); setShowWalletForm(false); setMessage('Payment type added for POS checkout.'); await load();
    } catch (error) { setMessage(error.message || 'Payment method add failed'); }
    finally { setBusy(false); }
  };
  const toggleMethod = async (row) => {
    setBusy(true); setMessage('');
    try {
      if (row.active === false) {
        await apiFetch(`/api/finance/settings/payment-methods/${row.id}`, { method: 'PATCH', body: { active: true } });
      } else {
        await apiFetch(`/api/finance/settings/payment-methods/${row.id}`, { method: 'DELETE' });
      }
      await load();
    }
    catch (error) { setMessage(error.message); }
    finally { setBusy(false); }
  };
  const renameMethod = async (row) => {
    const name = window.prompt('Payment method / wallet name', row.name);
    if (!name?.trim() || name.trim() === row.name) return;
    setBusy(true);
    try { await apiFetch(`/api/finance/settings/payment-methods/${row.id}`, { method: 'PATCH', body: { name: name.trim() } }); await load(); }
    catch (error) { setMessage(error.message); }
    finally { setBusy(false); }
  };

  if (embedded) {
    return <div className="finance-catalog-readonly finance-catalog-project-link"><div><WalletCards size={22}/><span><b>Configure in Project Settings</b><small>POS Payment Types are managed here. Cash In / Out wallets stay in the Fees tab.</small></span></div><button type="button" onClick={openProjectSettings}><ExternalLink size={16}/> Project Settings</button></div>;
  }
  if (!canManage) return <div className="finance-catalog-readonly">Shop Admin can manage payment methods and categories.</div>;

  return <div className="finance-catalog-settings">
    {mode === 'all' ? <header><div><WalletCards size={23}/><span><b>Payment Types & Categories</b><small>POS checkout payment methods and business form categories.</small></span></div></header> : null}
    {message ? <div className="finance-catalog-message">{message}</div> : null}

    {showPayments ? <Section icon={Banknote} title="POS Payment Type Configure" hint="Sale POS checkout မှာပေါ်မယ့် Cash / KBZ Pay / Wave Pay / Bank payment methods တွေကို ဒီနေရာမှာပဲစီမံပါ." count={(data.paymentMethods || []).filter((row) => row.active !== false).length} open={open === 'wallets'} onToggle={() => setOpen(open === 'wallets' ? '' : 'wallets')}>
      <div className="finance-pos-accept-note">
        <b>Sale POS Payment မှာပေါ်မယ့် payment type ကိုရွေးတာပါ</b>
        <small>ဒီနေရာက POS Sale checkout မှာ payment option ပေါ်/မပေါ်ကိုပဲပြောင်းမယ်။ Cash In / Cash Out wallet balance link ကို Fees → Wallet Link မှာ သီးသန့်စီမံပါ။</small>
      </div>
      <div className="finance-config-toolbar">
        <div><b>{(data.paymentMethods || []).filter((row) => row.active !== false).length} POS checkout payment types</b><small>ပြထားသော payment type များသာ Sale POS Payment မှာပေါ်မယ်။ Cash In / Out link ကိုမထိပါ။</small></div>
        <button type="button" onClick={() => setShowWalletForm((value) => !value)}><Plus size={16}/> {showWalletForm ? 'Close Form' : 'Add Payment Type'}</button>
      </div>
      {showWalletForm ? <form className="finance-wallet-form" onSubmit={addMethod}>
        <label><span>Payment Type Name</span><input required value={method.name} onChange={(e) => setMethod({ ...method, name: e.target.value })} placeholder="KBZ Pay / AYA Pay" autoFocus/></label>
        <label><span>Code</span><input required value={method.code} onChange={(e) => setMethod({ ...method, code: e.target.value })} placeholder="KBZ_PAY"/></label>
        <label><span>Account Type</span><select value={method.kind} onChange={(e) => setMethod({ ...method, kind: e.target.value })}><option value="WALLET">Wallet</option><option value="CASH">Cash</option><option value="BANK">Bank</option><option value="OTHER">Other</option></select></label>
        <label><span>Opening Balance</span><input type="number" min="0" value={method.openingBalance} onChange={(e) => setMethod({ ...method, openingBalance: e.target.value })} placeholder="0"/></label>
        <button disabled={busy}>{busy ? <Loader2 className="finance-catalog-spin" size={17}/> : <Plus size={17}/>} Add Payment Type</button>
      </form> : null}
      <div className="finance-catalog-list">
        {(data.paymentMethods || []).map((row) => {
          const hidden = row.active === false;
          return <article key={row.id || row.code} className={hidden ? 'inactive' : ''}>
            <div>
              <b>{row.name}</b>
              <small>{row.kind} · {row.code} · {Number(row.balance || 0).toLocaleString()} MMK</small>
              <div className="finance-payment-badges">
                <span className={hidden ? 'pos-hidden' : 'pos-show'}>Payment: POS မှာ{hidden ? 'မပြထား' : 'ပြထား'}</span>
              </div>
            </div>
            <div className="finance-catalog-actions text-actions">
              <button type="button" onClick={() => renameMethod(row)} title="နာမည်ပြင်ရန်"><Edit3 size={16}/><span>နာမည်ပြင်</span></button>
              <button type="button" className={`finance-pos-toggle ${hidden ? 'show-pos-action' : 'hide-pos-action'}`} onClick={() => toggleMethod(row)} title={hidden ? 'Sale POS မှာပြန်ပြရန်' : 'Sale POS မှာမပြရန်'}>{hidden ? <Eye size={16}/> : <EyeOff size={16}/>}<span>{hidden ? 'POS ပြရန်' : 'POS မပြရန်'}</span></button>
            </div>
          </article>;
        })}
      </div>
    </Section> : null}

    {showCategories ? <>
      <Section icon={Tags} title="Income Categories" hint="List ကြည့်ရန် သို့ Configure လုပ်ရန် နှိပ်ပါ" count={(data.incomeCategories || []).filter((row) => row.active !== false).length} open={open === 'income'} onToggle={() => setOpen(open === 'income' ? '' : 'income')}>
        <CategoryManager title="Income Category" rows={data.incomeCategories || []} endpoint="/api/business-control/income-categories" onReload={load}/>
      </Section>
      <Section icon={Tags} title="Expense Categories" hint="List ကြည့်ရန် သို့ Configure လုပ်ရန် နှိပ်ပါ" count={(data.expenseCategories || []).filter((row) => row.active !== false).length} open={open === 'expense'} onToggle={() => setOpen(open === 'expense' ? '' : 'expense')}>
        <CategoryManager title="Expense Category" rows={data.expenseCategories || []} endpoint="/api/business-control/expense-categories" onReload={load}/>
      </Section>
    </> : null}
  </div>;
}
