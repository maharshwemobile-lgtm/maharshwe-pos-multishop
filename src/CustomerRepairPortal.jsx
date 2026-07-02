import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  CreditCard,
  Loader2,
  PackageCheck,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Store,
  Wrench,
} from 'lucide-react';
import './customer-repair-portal.css';

const API_BASE_URL = String(import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '');

const STATUS_STEPS = [
  ['RECEIVED', 'လက်ခံပြီး'],
  ['CHECKING', 'စစ်ဆေးနေ'],
  ['IN_PROGRESS', 'ပြင်ဆင်နေ'],
  ['WAITING_PART', 'ပစ္စည်းစောင့်'],
  ['COMPLETED', 'ပြင်ပြီး'],
  ['DELIVERED', 'ယူပြီး'],
];

const STATUS_TEXT = {
  RECEIVED: 'ဖုန်းကို လက်ခံပြီးပါပြီ',
  CHECKING: 'ဖုန်းကို စစ်ဆေးနေပါပြီ',
  IN_PROGRESS: 'ဖုန်းကို ပြင်ဆင်နေပါပြီ',
  WAITING_PART: 'ပစ္စည်းစောင့်နေပါသည်',
  COMPLETED: 'ဖုန်းပြင်ပြီးပါပြီ — လာယူနိုင်ပါပြီ',
  CANNOT_REPAIR: 'ပြင်ဆင်၍ မရပါ — ဆိုင်သို့ ဆက်သွယ်ပါ',
  DELIVERED: 'Customer ထံ ပေးအပ်ပြီးပါပြီ',
};

const money = (value) => `${Number(value || 0).toLocaleString('en-US')} MMK`;

function formatDate(value, withTime = true) {
  if (!value) return '-';
  try {
    return new Intl.DateTimeFormat('my-MM', withTime
      ? { dateStyle: 'medium', timeStyle: 'short' }
      : { dateStyle: 'medium' }).format(new Date(value));
  } catch {
    return String(value);
  }
}

function StatusProgress({ status }) {
  const completedIndex = STATUS_STEPS.findIndex(([value]) => value === status);
  const cannotRepair = status === 'CANNOT_REPAIR';
  return (
    <div className={`customer-status-progress ${cannotRepair ? 'cannot-repair' : ''}`}>
      {STATUS_STEPS.map(([value, label], index) => {
        const done = !cannotRepair && completedIndex >= index;
        const active = value === status;
        return (
          <div key={value} className={`${done ? 'done' : ''} ${active ? 'active' : ''}`}>
            <span>{done ? <CheckCircle2 size={18} /> : index + 1}</span>
            <b>{label}</b>
          </div>
        );
      })}
    </div>
  );
}

export default function CustomerRepairPortal() {
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const shop = params.get('shop') || '';
  const repairId = params.get('id') || '';
  const shareKey = params.get('key') || '';
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    if (!shop || !repairId || !shareKey) {
      setError('Repair Status Link မပြည့်စုံပါ။ ဆိုင်မှပေးထားသော Link ကို ပြန်ဖွင့်ပါ။');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const query = new URLSearchParams({ shop, id: repairId, key: shareKey });
      const response = await fetch(`${API_BASE_URL}/api/public/repair?${query.toString()}`, {
        headers: { Accept: 'application/json' },
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.message || 'Repair status request failed');
      setData(result);
    } catch (requestError) {
      setData(null);
      setError(requestError.message || 'Repair status ဖွင့်၍ မရပါ');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  return (
    <main className="customer-repair-portal">
      <div className="customer-portal-shell">
        <header className="customer-portal-brand">
          <div className="customer-brand-icon"><Smartphone size={28} /></div>
          <div><span>MAHAR POS REPAIR TRACKING</span><h1>{data?.shop?.name || 'Repair Status'}</h1><p>ဖုန်းပြင်ဆင်မှုအခြေအနေကို လုံခြုံစွာ ကြည့်ရှုနိုင်ပါသည်။</p></div>
          <button type="button" onClick={load} disabled={loading}>{loading ? <Loader2 className="customer-spin" size={18} /> : <RefreshCw size={18} />}</button>
        </header>

        {loading ? <section className="customer-portal-state"><Loader2 className="customer-spin" size={30} /><b>Repair Status စစ်ဆေးနေပါသည်…</b></section> : null}
        {error ? <section className="customer-portal-state error"><AlertTriangle size={30} /><b>{error}</b></section> : null}

        {data?.repair ? <>
          <section className={`customer-status-hero status-${data.repair.status?.toLowerCase()}`}>
            <div><Wrench size={26} /><span><small>Repair ID</small><b>{data.repair.repairNumber}</b></span></div>
            <div><small>လက်ရှိအခြေအနေ</small><h2>{STATUS_TEXT[data.repair.status] || data.repair.status}</h2></div>
          </section>

          <section className="customer-portal-card">
            <StatusProgress status={data.repair.status} />
          </section>

          <section className="customer-info-grid">
            <article><Store size={21} /><span><small>Customer</small><b>{data.repair.customerName}</b></span></article>
            <article><Smartphone size={21} /><span><small>Device</small><b>{data.repair.deviceBrand || ''} {data.repair.deviceModel || '-'}</b></span></article>
            <article><Clock3 size={21} /><span><small>လက်ခံသည့်အချိန်</small><b>{formatDate(data.repair.receivedAt)}</b></span></article>
            <article><PackageCheck size={21} /><span><small>ခန့်မှန်းပြီးစီးချိန်</small><b>{formatDate(data.repair.estimatedCompletionAt)}</b></span></article>
          </section>

          <section className="customer-portal-card customer-problem-card"><span>ပြင်ဆင်ရန်အကြောင်းအရာ</span><b>{data.repair.problem}</b></section>

          <section className="customer-payment-card">
            <header><CreditCard size={21} /><b>ငွေစာရင်း</b></header>
            <div><span>ကျသင့်ငွေ<b>{money(data.repair.finalCost)}</b></span><span>ပေးပြီးငွေ<b>{money(data.repair.paidAmount)}</b></span><span className="balance">ကျန်ငွေ<b>{money(data.repair.balanceDue)}</b></span></div>
          </section>

          <section className="customer-info-grid">
            <article><ShieldCheck size={21} /><span><small>Pickup Security</small><b>{data.repair.pickupVerified ? 'Verified · ယူပြီး' : data.repair.pickupCodeIssued ? 'Pickup Code ထုတ်ပြီး' : 'မထုတ်ရသေး'}</b></span></article>
            <article><ShieldCheck size={21} /><span><small>Warranty Until</small><b>{data.repair.warrantyUntil ? formatDate(data.repair.warrantyUntil, false) : 'Warranty မသတ်မှတ်ရသေး'}</b></span></article>
          </section>

          <section className="customer-portal-card customer-timeline-card">
            <header><Clock3 size={20} /><div><b>Repair Timeline</b><small>ပြင်ဆင်မှုမှတ်တမ်း</small></div></header>
            <div className="customer-timeline">
              {(data.timeline || []).map((event, index) => <article key={`${event.eventType}-${event.occurredAt}-${index}`}><span><CheckCircle2 size={16} /></span><div><b>{String(event.eventType || '').replaceAll('_', ' ')}</b><small>{STATUS_TEXT[event.status] || event.status || ''}</small><time>{formatDate(event.occurredAt)}</time></div></article>)}
              {!data.timeline?.length ? <p>Timeline မရှိသေးပါ။</p> : null}
            </div>
          </section>

          {(data.warrantyClaims || []).length ? <section className="customer-portal-card customer-warranty-card"><header><ShieldCheck size={20} /><b>Warranty Claims</b></header>{data.warrantyClaims.map((claim) => <article key={claim.claimNumber}><span><b>{claim.claimNumber}</b><small>{claim.reason}</small></span><em>{claim.status}</em></article>)}</section> : null}
        </> : null}

        <footer className="customer-portal-footer">Repair ID နှင့် Status Link ကို အခြားသူများထံ မမျှဝေပါနှင့်။</footer>
      </div>
    </main>
  );
}
