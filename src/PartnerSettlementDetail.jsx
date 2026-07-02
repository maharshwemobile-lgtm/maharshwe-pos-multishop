import React, { useState } from 'react';
import { CheckCircle2, Loader2, LockKeyhole, X } from 'lucide-react';
import { apiFetch } from './phase2Api';

const money = (v) => `${Number(v || 0).toLocaleString('en-US')} ကျပ်`;
const dateText = (v) => v ? new Date(v).toLocaleDateString('en-GB') : '—';
const badge = (v) => `psw-status psw-${String(v || '').toLowerCase().replaceAll('_', '-')}`;

export default function PartnerSettlementDetail({ data, onClose, onRefresh, onError }) {
  const [busy, setBusy] = useState('');
  const [form, setForm] = useState({ amount: '', paymentMethod: 'CASH', referenceNumber: '', note: '' });
  if (!data) return null;
  const { settlement, ledger = [], payments = [] } = data;

  async function run(key, fn) {
    setBusy(key);
    try { await fn(); } catch (e) { onError(e.message); } finally { setBusy(''); }
  }

  async function confirm() {
    if (!window.confirm('Confirm + Lock လုပ်မလား?')) return;
    await run('confirm', async () => {
      await apiFetch(`/api/partner-settlements/settlements/${settlement.id}/confirm`, { method: 'POST', body: {} });
      await onRefresh(settlement.id);
    });
  }

  async function pay(e) {
    e.preventDefault();
    await run('payment', async () => {
      await apiFetch(`/api/partner-settlements/settlements/${settlement.id}/payments`, {
        method: 'POST', body: { ...form, amount: Number(form.amount) },
      });
      setForm({ amount: '', paymentMethod: 'CASH', referenceNumber: '', note: '' });
      await onRefresh(settlement.id);
    });
  }

  return <div className="psw-drawer-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
    <aside className="psw-drawer">
      <header><div><span className="psw-eyebrow">SETTLEMENT DETAIL</span><h3>{settlement.settlementNumber}</h3><p>{settlement.partnerName} · {dateText(settlement.periodStart)} — {dateText(settlement.periodEnd)}</p></div><button onClick={onClose}><X/></button></header>
      <div className="psw-detail-summary">
        <div><span>Status</span><b className={badge(settlement.status)}>{settlement.status}</b></div>
        <div><span>Provider Due</span><b>{money(settlement.providerDue)}</b></div>
        <div><span>Paid</span><b className="psw-success-text">{money(settlement.paidAmount)}</b></div>
        <div><span>Outstanding</span><b className="psw-danger-text">{money(settlement.outstandingAmount)}</b></div>
      </div>
      {settlement.status === 'DRAFT' && settlement.accessMode === 'PROVIDER' ? <button className="psw-confirm" onClick={confirm} disabled={busy === 'confirm'}>{busy === 'confirm' ? <Loader2 className="psw-spin"/> : <LockKeyhole/>}Confirm & Lock Settlement</button> : null}
      {settlement.lockedAt ? <div className="psw-locked"><LockKeyhole size={17}/>Locked at {new Date(settlement.lockedAt).toLocaleString()}</div> : null}
      <section className="psw-detail-section"><h4>Included Repair Jobs</h4>{ledger.map((x) => <div className="psw-detail-row" key={x.id}><div><b>{x.partnerRepairNumber} → {x.providerRepairNumber}</b><span>{x.customerPaid ? 'မရှင်းရသေး / Settlement Due' : 'Hold'} · {dateText(x.completedAt)}</span></div><div><b>{money(x.providerDue)}</b><small>Profit {money(x.partnerProfit)}</small></div></div>)}</section>
      <section className="psw-detail-section"><h4>Payment History</h4>{payments.length ? payments.map((x) => <div className="psw-detail-row" key={x.id}><div><b>{x.paymentMethod}</b><span>{x.referenceNumber || 'No reference'} · {dateText(x.createdAt)}</span></div><strong className="psw-success-text">+ {money(x.amount)}</strong></div>) : <p className="psw-muted">Payment မရှိသေးပါ။</p>}</section>
      {settlement.accessMode === 'PROVIDER' && settlement.lockedAt && Number(settlement.outstandingAmount) > 0 ? <form className="psw-payment-form" onSubmit={pay}><h4>Record Payment</h4><div className="psw-form-grid"><label><span>Amount</span><input type="number" min="1" max={Number(settlement.outstandingAmount)} value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} required/></label><label><span>Method</span><select value={form.paymentMethod} onChange={(e) => setForm({ ...form, paymentMethod: e.target.value })}><option>CASH</option><option>KBZPAY</option><option>WAVEPAY</option><option>BANK</option><option>OTHER</option></select></label><label><span>Reference</span><input value={form.referenceNumber} onChange={(e) => setForm({ ...form, referenceNumber: e.target.value })}/></label><label><span>Note</span><input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })}/></label></div><button className="psw-button primary wide" disabled={busy === 'payment'}>{busy === 'payment' ? <Loader2 className="psw-spin" size={18}/> : <CheckCircle2 size={18}/>}Save Payment</button></form> : null}
    </aside>
  </div>;
}
