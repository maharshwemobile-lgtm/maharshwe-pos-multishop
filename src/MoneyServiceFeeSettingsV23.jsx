import React, { useEffect, useState } from 'react';
import { Eye, EyeOff, Loader2, Percent, Plus, Save, WalletCards } from 'lucide-react';
import { apiFetch, getSession } from './phase2Api';
import './finance-catalog-settings-v23.css';
import './money-service-rate-panel.css';

const PAYMENT_EVENT = 'mahar:payment-methods-changed';
const EMPTY_WALLET = { name: '', code: '', kind: 'WALLET', openingBalance: '', supportsMoneyService: true };

export default function MoneyServiceFeeSettingsV23() {
  const session = getSession();
  const canManage = ['SUPER_ADMIN', 'SHOP_ADMIN'].includes(session?.user?.role || '') || session?.user?.permissions?.settings === true;
  const [allMethods, setAllMethods] = useState([]);
  const [methods, setMethods] = useState([]);
  const [draft, setDraft] = useState({ minimumFee: 0, roundTo: 100 });
  const [showWalletForm, setShowWalletForm] = useState(false);
  const [wallet, setWallet] = useState(EMPTY_WALLET);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const load = async () => {
    const [money, catalogs] = await Promise.all([
      apiFetch('/api/money-service/settings'),
      apiFetch('/api/finance/settings/catalogs').catch(() => ({ paymentMethods: [] })),
    ]);
    const source = catalogs.paymentMethods?.length ? catalogs.paymentMethods : money.paymentMethods || [];
    const eligible = source.filter((row) => row.kind !== 'CASH' && row.accountId);
    setAllMethods(eligible);
    setMethods(eligible.filter((row) => row.supportsMoneyService !== false));
    setDraft({ ...(money.rates || {}), minimumFee: Number(money.rates?.minimumFee || 0), roundTo: Number(money.rates?.roundTo || 100) });
  };

  useEffect(() => {
    const refresh = () => load().catch((error) => setMessage(error.message));
    refresh();
    window.addEventListener(PAYMENT_EVENT, refresh);
    return () => window.removeEventListener(PAYMENT_EVENT, refresh);
  }, []);

  const change = (key, value) => setDraft((current) => ({ ...current, [key]: value }));
  const addWallet = async (event) => {
    event.preventDefault(); setBusy(true); setMessage('');
    try {
      const code = String(wallet.code || '').trim().toUpperCase().replace(/\s+/g, '_');
      await apiFetch('/api/finance/settings/payment-methods', {
        method: 'POST',
        body: { ...wallet, code, openingBalance: Number(wallet.openingBalance || 0), supportsMoneyService: true },
      });
      setWallet(EMPTY_WALLET);
      setShowWalletForm(false);
      setMessage('New wallet added. Set Cash In / Cash Out fee below.');
      window.dispatchEvent(new CustomEvent(PAYMENT_EVENT));
      await load();
    } catch (error) { setMessage(error.message || 'Wallet add failed'); }
    finally { setBusy(false); }
  };
  const toggleMoneyService = async (row) => {
    setBusy(true); setMessage('');
    try {
      const enabled = row.supportsMoneyService === false;
      await apiFetch(`/api/finance/settings/payment-methods/${row.id}`, { method: 'PATCH', body: { supportsMoneyService: enabled } });
      setMessage(enabled ? `${row.name} will show in Cash In / Cash Out` : `${row.name} hidden from Cash In / Cash Out`);
      window.dispatchEvent(new CustomEvent(PAYMENT_EVENT));
      await load();
    } catch (error) { setMessage(error.message || 'Cash In / Cash Out visibility update failed'); }
    finally { setBusy(false); }
  };
  const save = async (event) => {
    event.preventDefault(); setBusy(true); setMessage('');
    try {
      const rates = {};
      methods.forEach((row) => {
        rates[`${row.code}_TRANSFER`] = Number(draft[`${row.code}_TRANSFER`] || 0);
        rates[`${row.code}_CASH_OUT`] = Number(draft[`${row.code}_CASH_OUT`] || 0);
      });
      await apiFetch('/api/money-service/settings/rates', { method: 'PUT', body: { rates, minimumFee: Number(draft.minimumFee || 0), roundTo: Number(draft.roundTo || 100) } });
      setMessage('Cash In / Cash Out fee settings saved'); await load();
    } catch (error) { setMessage(error.message || 'Fee settings save failed'); }
    finally { setBusy(false); }
  };

  if (!canManage) return null;
  return <section className="finance-catalog-section open">
    <div className="finance-catalog-section-head"><span><Percent size={20}/><b>Cash In / Cash Out Settings</b><small>Payment Type Configure နဲ့မရောပါ။ ဒီနေရာက Money Service visibility နဲ့ fees ကိုပဲထိန်းပါတယ်။</small></span></div>
    <div className="finance-catalog-section-body">
      {message ? <div className="finance-catalog-message">{message}</div> : null}
      <div className="finance-pos-accept-note">
        <b>Separate show/hide rule</b>
        <small>Payment Type tab က POS Sale visibility ကိုပဲထိန်းပါတယ်။ ဒီ tab က Cash In / Cash Out မှာ wallet ပေါ်/မပေါ်ကို သီးသန့်ထိန်းပြီး linked account balance ကိုဆက်သုံးပါတယ်။</small>
      </div>
      <div className="finance-money-service-visibility">
        <header>
          <div><WalletCards size={18}/><span><b>Cash In / Cash Out Wallet Visibility</b><small>ဒီနေရာမှာ Show ဖြစ်တဲ့ wallet တွေပဲ Money Service form မှာပေါ်မယ်။</small></span></div>
        </header>
        <div className="finance-catalog-list money-service-wallet-list">
          {allMethods.length ? allMethods.map((row) => {
            const enabled = row.supportsMoneyService !== false;
            return <article key={row.id || row.code} className={enabled ? '' : 'inactive'}>
              <div><b>{row.name}</b><small>{row.kind} · {row.code} · {Number(row.balance || 0).toLocaleString()} MMK</small><small>Linked account remains connected. POS visibility is managed in Payment Types.</small></div>
              <div className="finance-catalog-actions text-actions">
                <button type="button" className={enabled ? 'money-service-on' : 'money-service-off'} onClick={() => toggleMoneyService(row)}>
                  {enabled ? <Eye size={16}/> : <EyeOff size={16}/>}<span>{enabled ? 'Show Cash In/Out' : 'Hidden Cash In/Out'}</span>
                </button>
              </div>
            </article>;
          }) : <div className="finance-catalog-readonly">Payment Type Configure မှာ wallet/bank payment type အရင်ထည့်ပါ။</div>}
        </div>
      </div>
      <div className="finance-config-toolbar">
        <div><b>{methods.length} Money Service wallets</b><small>Add a wallet here, then set Cash In / Cash Out fees below.</small></div>
        <button type="button" onClick={() => setShowWalletForm((value) => !value)}><Plus size={16}/> {showWalletForm ? 'Close Form' : 'Add Wallet'}</button>
      </div>
      {showWalletForm ? <form className="finance-wallet-form" onSubmit={addWallet}>
        <label><span>Wallet Name</span><input required value={wallet.name} onChange={(event) => setWallet({ ...wallet, name: event.target.value })} placeholder="Wave Pay"/></label>
        <label><span>Code</span><input required value={wallet.code} onChange={(event) => setWallet({ ...wallet, code: event.target.value })} placeholder="WAVE_PAY"/></label>
        <label><span>Type</span><select value={wallet.kind} onChange={(event) => setWallet({ ...wallet, kind: event.target.value })}><option value="WALLET">Wallet</option><option value="BANK">Bank</option><option value="OTHER">Other</option></select></label>
        <label><span>Opening Balance</span><input type="number" min="0" value={wallet.openingBalance} onChange={(event) => setWallet({ ...wallet, openingBalance: event.target.value })} placeholder="0"/></label>
        <label className="finance-wallet-check"><input type="checkbox" checked readOnly/><span>Use in Cash In / Cash Out</span></label>
        <button disabled={busy}>{busy ? <Loader2 className="finance-catalog-spin" size={17}/> : <WalletCards size={17}/>} Add Wallet</button>
      </form> : null}
      <form className="finance-fee-settings" onSubmit={save}>
        <div className="finance-fee-global"><label><span>Minimum Fee</span><input type="number" min="0" value={draft.minimumFee ?? 0} onChange={(event) => change('minimumFee', event.target.value)}/></label><label><span>Round Up To</span><input type="number" min="1" value={draft.roundTo ?? 100} onChange={(event) => change('roundTo', event.target.value)}/></label></div>
        <div className="finance-fee-list">{methods.map((row) => <article key={row.id}><div><b>{row.name}</b><small>{row.code}</small></div><label><span>Cash In %</span><input type="number" min="0" max="100" step="0.01" value={draft[`${row.code}_TRANSFER`] ?? 0} onChange={(event) => change(`${row.code}_TRANSFER`, event.target.value)}/></label><label><span>Cash Out %</span><input type="number" min="0" max="100" step="0.01" value={draft[`${row.code}_CASH_OUT`] ?? 0} onChange={(event) => change(`${row.code}_CASH_OUT`, event.target.value)}/></label></article>)}</div>
        <button className="finance-fee-save" disabled={busy}>{busy ? <Loader2 className="finance-catalog-spin" size={17}/> : <Save size={17}/>} Save Fee Settings</button>
      </form>
    </div>
  </section>;
}
