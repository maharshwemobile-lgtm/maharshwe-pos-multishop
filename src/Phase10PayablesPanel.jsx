import React, { useEffect, useState } from 'react';
import { CreditCard, Edit3, Loader2, Plus, RefreshCw, Trash2, Wallet } from 'lucide-react';
import { apiFetch } from './phase2Api';
import { money, today } from './phase10PurchasingUtils';

export default function Phase10PayablesPanel({ notify, onError }) {
  const [rows, setRows] = useState([]);
  const [manualRows, setManualRows] = useState([]);
  const [summary, setSummary] = useState({});
  const [manualSummary, setManualSummary] = useState({});
  const [accounts, setAccounts] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [selected, setSelected] = useState(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [form, setForm] = useState({ paymentDate: today(), amount: '', method: 'CASH', moneyAccountId: '', reference: '', note: '' });
  const [manualForm, setManualForm] = useState({ id: '', supplierId: '', payableDate: today(), amount: '', note: '' });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [manualSaving, setManualSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [payableData, accountData, supplierData, manualData] = await Promise.all([
        apiFetch(`/api/purchasing/payables?page=${page}&limit=10&outstandingOnly=true`),
        apiFetch('/api/payments/accounts?page=1&limit=50'),
        apiFetch('/api/purchasing/suppliers?page=1&limit=100&active=true'),
        apiFetch('/api/purchasing/manual-payables?page=1&limit=50'),
      ]);
      setRows(payableData.payables || []);
      setSummary(payableData.summary || {});
      setAccounts(accountData.accounts || []);
      setSuppliers(supplierData?.suppliers || []);
      setManualRows(manualData?.manualPayables || []);
      setManualSummary(manualData?.summary || {});
      setTotal(Number(payableData.total || payableData.count || payableData.payables?.length || 0));
      setTotalPages(Math.max(1, Number(payableData.totalPages || Math.ceil(Number(payableData.total || payableData.payables?.length || 0) / 10) || 1)));
    } catch (error) { onError(error); } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [page]);

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

  const resetManualForm = () => setManualForm({ id: '', supplierId: '', payableDate: today(), amount: '', note: '' });

  const editManual = (row) => {
    setManualForm({
      id: row.id,
      supplierId: row.supplierId,
      payableDate: String(row.payableDate || '').slice(0, 10) || today(),
      amount: String(Number(row.amount || 0)),
      note: row.note || '',
    });
  };

  const submitManual = async () => {
    const amount = Number(manualForm.amount || 0);
    if (!manualForm.supplierId) return notify('error', 'Supplier ရွေးပါ။');
    if (amount < 0) return notify('error', 'Payable amount must be zero or more.');
    setManualSaving(true);
    try {
      const route = manualForm.id ? `/api/purchasing/manual-payables/${manualForm.id}` : '/api/purchasing/manual-payables';
      const method = manualForm.id ? 'PATCH' : 'POST';
      await apiFetch(route, {
        method,
        body: {
          supplierId: manualForm.supplierId,
          payableDate: manualForm.payableDate,
          amount,
          note: manualForm.note || null,
        },
      });
      notify('success', manualForm.id ? 'Supplier debt updated.' : 'Supplier debt recorded.');
      resetManualForm();
      await load();
    } catch (error) { onError(error); } finally { setManualSaving(false); }
  };

  const deleteManual = async (row) => {
    if (!window.confirm(`${row.supplierName} payable record ဖျက်မလား?`)) return;
    setManualSaving(true);
    try {
      await apiFetch(`/api/purchasing/manual-payables/${row.id}`, { method: 'DELETE' });
      notify('success', 'Supplier debt record deleted.');
      if (manualForm.id === row.id) resetManualForm();
      await load();
    } catch (error) { onError(error); } finally { setManualSaving(false); }
  };

  return <div className="p10-op-grid">
    <section className="purchasing-card p10-op-list-card">
      <header><div><Wallet size={20}/></div><span><h3>Supplier Payables</h3><p>Received goods minus returns and payments</p></span><button type="button" className="icon-button" onClick={load}><RefreshCw className={loading ? 'purchasing-spin' : ''} size={18}/></button></header>
      <div className="p10-summary-row"><span><small>Net Purchases</small><b>{money(Number(summary.receivedAmount || 0) - Number(summary.returnedAmount || 0))}</b></span><span><small>Paid</small><b>{money(summary.paidAmount)}</b></span><span><small>Outstanding</small><b>{money(summary.outstanding)}</b></span></div>
      <div className="p10-table-wrap"><table className="p10-table"><thead><tr><th>PO</th><th>Supplier</th><th>Net Received</th><th>Paid</th><th>Outstanding</th><th></th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td><b>{row.orderNumber}</b><small>{String(row.orderDate || '').slice(0,10)}</small></td><td>{row.supplierCode} · {row.supplierName}</td><td>{money(row.netReceived)}</td><td>{money(row.paidAmount)}</td><td><b>{money(row.outstanding)}</b></td><td><button className="p10-small-button" onClick={() => pick(row)}>Pay</button></td></tr>)}</tbody></table></div>
      {!rows.length && !loading ? <div className="purchasing-empty"><Wallet size={32}/><b>No outstanding payables</b></div> : null}
      <footer className="stock-pagination">
        <span>Showing {rows.length} of {total}</span>
        <div>
          <button type="button" disabled={page <= 1 || loading} onClick={() => setPage((value) => Math.max(1, value - 1))}>Previous</button>
          <b>{page} / {totalPages}</b>
          <button type="button" disabled={page >= totalPages || loading} onClick={() => setPage((value) => Math.min(totalPages, value + 1))}>Next</button>
        </div>
      </footer>
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

    <section className="purchasing-card p10-op-form-card">
      <header><div><Plus size={20}/></div><span><h3>Manual Supplier Debt</h3><p>ဆိုင်က supplier ကို ပေးရန် အကြွေး amount ကို create / edit လုပ်ရန်</p></span></header>
      <div className="p10-summary-row"><span><small>Manual Supplier Payable</small><b>{money(manualSummary.outstanding)}</b></span><span><small>Records</small><b>{manualRows.length}</b></span></div>
      <div className="p10-form-body">
        <label className="p10-field"><span>Supplier</span><select value={manualForm.supplierId} onChange={(e) => setManualForm({ ...manualForm, supplierId: e.target.value })}><option value="">Select supplier</option>{suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.supplierCode} · {supplier.name}</option>)}</select></label>
        <label className="p10-field"><span>Date</span><input type="date" value={manualForm.payableDate} onChange={(e) => setManualForm({ ...manualForm, payableDate: e.target.value })}/></label>
        <label className="p10-field"><span>Supplier payable amount</span><input type="number" min="0" value={manualForm.amount} onChange={(e) => setManualForm({ ...manualForm, amount: e.target.value })} placeholder="ဆိုင်က ပေးရန် amount"/></label>
        <label className="p10-field"><span>Note</span><textarea rows="2" value={manualForm.note} onChange={(e) => setManualForm({ ...manualForm, note: e.target.value })} placeholder="Opening debt / old payable / correction"/></label>
        <button type="button" className="p10-primary-button" onClick={submitManual} disabled={manualSaving}>{manualSaving ? <Loader2 className="purchasing-spin" size={18}/> : <Plus size={18}/>} {manualForm.id ? 'Update Supplier Debt' : 'Save Supplier Debt'}</button>
        {manualForm.id ? <button type="button" className="p10-small-button" onClick={resetManualForm} disabled={manualSaving}>Cancel Edit</button> : null}
      </div>
      <div className="p10-table-wrap"><table className="p10-table"><thead><tr><th>Supplier</th><th>Date</th><th>Payable</th><th>Note</th><th></th></tr></thead><tbody>{manualRows.map((row) => <tr key={row.id}><td>{row.supplierCode} · {row.supplierName}</td><td>{String(row.payableDate || '').slice(0,10)}</td><td><b>{money(row.amount)}</b></td><td>{row.note || '-'}</td><td><div className="credit-row-actions"><button type="button" onClick={() => editManual(row)}><Edit3 size={15}/> Edit</button><button type="button" onClick={() => deleteManual(row)}><Trash2 size={15}/> Delete</button></div></td></tr>)}</tbody></table></div>
      {!manualRows.length && !loading ? <div className="purchasing-empty"><Wallet size={28}/><b>No manual supplier debt records</b></div> : null}
    </section>
  </div>;
}
