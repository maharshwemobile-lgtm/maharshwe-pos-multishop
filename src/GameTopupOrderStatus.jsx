import React, { useEffect, useState } from 'react';
import { CheckCircle2, Clock3, Loader2, XCircle } from 'lucide-react';
import { PROJECT_LOGO_URL } from './projectBrand';
import './game-topup-storefront.css';

const API_BASE_URL = String(import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '');
const money = (value) => `${Number(value || 0).toLocaleString('en-US')} MMK`;

const STATUS = {
  PENDING_APPROVAL: { label: 'ငွေစစ်ဆေးနေပါသည်', tone: 'pending', icon: Clock3, help: 'ငွေလက်ခံရရှိမှု အတည်ပြုပြီးပါက ချက်ချင်း ဖြည့်ပေးပါမယ်။' },
  COMPLETED: { label: 'ဖြည့်ပြီးပါပြီ', tone: 'done', icon: CheckCircle2, help: 'ဂိမ်းအကောင့်ထဲ ရောက်ပြီးပါပြီ။ မရသေးရင် ဆိုင်သို့ ဆက်သွယ်ပါ။' },
  REJECTED: { label: 'ငြင်းပယ်ခံရသည်', tone: 'failed', icon: XCircle, help: 'ငွေလက်ခံရရှိမှု အတည်မပြုနိုင်ပါ။' },
  FAILED: { label: 'မအောင်မြင်ပါ', tone: 'failed', icon: XCircle, help: 'ငွေပြန်အမ်းရန် ဆိုင်သို့ ဆက်သွယ်ပါ။' },
};

function formatDate(value) {
  if (!value) return '-';
  try {
    return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
  } catch {
    return String(value);
  }
}

export default function GameTopupOrderStatus() {
  const params = new URLSearchParams(window.location.search);
  const [orderNumber, setOrderNumber] = useState(params.get('order') || '');
  const [shareKey] = useState(params.get('key') || '');
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    if (!orderNumber || !shareKey) {
      setError('Link မပြည့်စုံပါ — ဆိုင်မှပေးထားသော link ကို ပြန်ဖွင့်ပါ။');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const query = new URLSearchParams({ order: orderNumber, key: shareKey });
      const response = await fetch(`${API_BASE_URL}/api/public/game-topup/orders/status?${query}`, { headers: { Accept: 'application/json' } });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.ok === false) throw new Error(data.message || 'Order မတွေ့ပါ');
      setOrder(data.order);
    } catch (requestError) {
      setOrder(null);
      setError(requestError.message || 'Order မတွေ့ပါ');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const meta = order ? (STATUS[order.status] || { label: order.status, tone: 'pending', icon: Clock3, help: '' }) : null;
  const StatusIcon = meta?.icon;

  return (
    <main className="gts-page">
      <header className="gts-header">
        <div className="gts-brand">
          <img src={PROJECT_LOGO_URL} alt="Mahar POS" />
          <div><b>အော်ဒါ အခြေအနေ</b><span>Game Top-up</span></div>
        </div>
        <a className="gts-status-link" href="/topup">ဆက်ဝယ်မည်</a>
      </header>

      {loading ? <div className="gts-loading"><Loader2 className="gts-spin" size={22} /> စစ်ဆေးနေပါသည်…</div> : null}
      {error ? <div className="gts-alert error">{error}</div> : null}

      {order && meta ? (
        <div className="gts-card">
          <div className={`gts-status-hero ${meta.tone}`}>
            <StatusIcon size={38} />
            <div><b>{meta.label}</b><span>{meta.help}</span></div>
          </div>

          <dl className="gts-detail-list">
            <div><dt>အော်ဒါနံပါတ်</dt><dd>{order.orderNumber}</dd></div>
            <div><dt>ပစ္စည်း</dt><dd>{order.productName} · {order.variationName} × {order.quantity}</dd></div>
            {order.playerId ? <div><dt>Player ID</dt><dd>{order.playerId}{order.serverId ? ` · Server ${order.serverId}` : ''}</dd></div> : null}
            <div><dt>ပမာဏ</dt><dd>{money(order.retailPrice)}</dd></div>
            <div><dt>တင်သည့်အချိန်</dt><dd>{formatDate(order.createdAt)}</dd></div>
            {order.reviewedAt ? <div><dt>စစ်ဆေးပြီးချိန်</dt><dd>{formatDate(order.reviewedAt)}</dd></div> : null}
            {order.rejectReason ? <div><dt>အကြောင်းပြချက်</dt><dd>{order.rejectReason}</dd></div> : null}
            {order.failureReason ? <div><dt>အမှား</dt><dd>{order.failureReason}</dd></div> : null}
          </dl>

          <button type="button" className="gts-secondary" onClick={load} disabled={loading}>
            {loading ? <Loader2 className="gts-spin" size={16} /> : null} ပြန်စစ်မည်
          </button>
        </div>
      ) : null}

      {!order && !loading ? (
        <div className="gts-card">
          <h2>အော်ဒါ ရှာမည်</h2>
          <p className="gts-muted">အော်ဒါနံပါတ် ထည့်ပြီး ရှာနိုင်ပါတယ် (ဆိုင်မှပေးထားသော link ရှိမှသာ)။</p>
          <label><span>အော်ဒါနံပါတ်</span>
            <input value={orderNumber} onChange={(event) => setOrderNumber(event.target.value)} placeholder="PT00001" />
          </label>
          <button type="button" className="gts-primary" onClick={load}>ရှာမည်</button>
        </div>
      ) : null}
    </main>
  );
}
