import React, { useEffect, useState } from 'react';
import { CreditCard, Loader2, RefreshCw, Wallet } from 'lucide-react';
import { apiFetch } from './phase2Api';
import { money, today } from './phase10PurchasingUtils';

export default function Phase10PayablesPanel({ notify, onError }) {
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState({});
  const [accounts, setAccounts] = useState([]);
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState({ paymentDate: today(), amount: '', method: 'CASH', moneyAccountId: '', reference: '', note: '' });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [payableData, accountData] = await Promise.all([
        apiFetch('/api/purchasing/payables?page=1&limit=100&outstandingOnly=true'),
        apiFetch('/api/payments/accounts?page=1&limit=50'),
      ]);
      setRows(payableData.payables || []); setSummary(payableData.summary || {}); setAccounts(accountData.accounts || []);
    } catch (error) { onError(error); } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const pick = (row) => {
    setSelected(row);
    const account = accounts.find((item) => item.type === (form.method === 'WAVE_PAY' ? 'WAVE_PAY' : form.method));
    setForm((current) => ({ ...current, amount: String(Number(row.outstanding || 0)), moneyAccountId: account?.id || '' }));
  };

  const changeMethod = (method) => {
    const account = accounts.find((item) => item.type === method);
    setForm((current) => ({ ...current, method, moneyAccountId: account?.id || '' }));
  };

  const submit = async () => {
    if (!selected) return notify('error', 'Payable row ကိုရွေးပါ။');
    const amount = Number(form.amount || 0);
    if (amount <= 0) return notify('error', 'Payment amount ထည့်ပါ။');
    if (!window.confirm(`${selected.orderNumber} အတွက် ${money(amount)} ပေးချေမလား?`)) return;
    setSaving(true);
    try {
      const data = await apiFetch('/api/purchasing/payments', { method: 'POST', body: { supplierId: selected.supplierId, purchaseOrderId: selected.id, paymentDate: form.paymentDate, amount, method: form.method, moneyAccountId: form.moneyAccountId || null, reference: form.reference || null, note: form.note || null } });
      notify('success', `${data.payment?.paymentNumber || 'Supplier payment'} saved.`);
      setSelected(null); setForm({ paymentDate: today(), amount: '', method: 'CASH', moneyAccountId: '', reference: '', note: '' }); await load();
    } catch (error) { onError(error); } finally { setSaving(false); }
  };

  return <div className="p10-op-grid">
    <section className="purchasing-card p10-op-list-card">
      <header><div><Wallet size={20}/></div><span><h3>Supplier Payables</h3><p>Received goods minus returns and payments</p></span><button type="button" className="icon-button" onClick={load}><RefreshCw className={loading ? 'purchasing-spin' : ''} size={18}/></button></header>
      <div className="p10-summary-row"><span><small>Net Purchases</small><b>{money(Number(summary.receivedAmount || 0) - Number(summary.returnedAmount || 0))}</b></span><span><small>Paid</small><b>{money(summary.paidAmount)}</b></span><span><small>Outstanding</small><b>{money(summary.outstanding)}</b></span></div>
      <div className="p10-table-wrap"><table className="p10-table"><thead><tr><th>PO</th><th>Supplier</th><th>Net Received</th><th>Paid</th><th>Outstanding</th><th></th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td><b>{row.orderNumber}</b><small>{String(row.orderDate || '').slice(0,10)}</small></td><td>{row.supplierCode} · {row.supplierName}</td><td>{money(row.netReceived)}</td><td>{money(row.paidAmount)}</td><td><b>{money(row.outstanding)}</b></td><td><button className="p10-small-button" onClick={() => pick(row)}>Pay</button></td></tr>)}</tbody></table></div>
      {!rows.length && !loading ? <div className="purchasing-empty"><Wallet size={32}/><b>No outstanding payables</b></div> : null}
    </section>

    <section className="purchasing-card p10-op-form-card">
      <header><div><CreditCard size={20}/></div><span><h3>Record Payment</h3><p>{selected ? `${selected.orderNumber} · ${selected.supplierName}` : 'Select a payable row'}</p></span></header>
      <div className="p10-form-body">
        <label className="p10-field"><span>Payment Date</span><input type="date" value={form.paymentDate} onChange={(e) => setForm({ ...form, paymentDate: e.target.value })}/></label>
        <label className="p10-field"><span>Amount</span><input type="number" min="0" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })}/></label>
        <div className="p10-payment-buttons">{['CASH','KPAY','WAVE_PAY','OTHER'].map((method) => <button key={method} type="button" className={form.method === method ? 'active' : ''} onClick={() => changeMethod(method)}>{method.replace('_',' ')}</button>)}</div>
        <label className="p10-field"><span>Money Account</span><select value={form.moneyAccountId} onChange={(e) => setForm({ ...form, moneyAccountId: e.target.value })}><option value="">No account adjustment</option>{accounts.map((account) => <option key={account.id} value={account.id}>{account.name} · {money(account.balance)}</option>)}</select></label>
        <label className="p10-field"><span>Reference</span><input value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} placeholder="Transaction reference"/></label>
        <label className="p10-field"><span>Note</span><textarea rows="3" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })}/></label>
        <button type="button" className="p10-primary-button" onClick={submit} disabled={!selected || saving}>{saving ? <Loader2 className="purchasing-spin" size={18}/> : <CreditCard size={18}/>} Save Payment</button>
      </div>
    </section>
  </div>;
}
