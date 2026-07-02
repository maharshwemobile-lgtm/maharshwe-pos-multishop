import React, { useEffect, useState } from 'react';
import {
  BellRing,
  CheckCircle2,
  Clipboard,
  Clock3,
  KeyRound,
  Link2,
  Loader2,
  Search,
  Send,
  ShieldCheck,
  Smartphone,
} from 'lucide-react';
import { apiFetch, clearSession } from './phase2Api';
import './customer-repair-admin-panel.css';

function formatDate(value) {
  if (!value) return '-';
  try {
    return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
  } catch {
    return String(value);
  }
}

export default function CustomerRepairAdminPanel() {
  const [repairNumber, setRepairNumber] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);
  const [shareUrl, setShareUrl] = useState('');
  const [pickupCode, setPickupCode] = useState('');
  const [verifyCode, setVerifyCode] = useState('');
  const [warrantyReason, setWarrantyReason] = useState('');
  const [contact, setContact] = useState({
    telegramChatId: '',
    appPushToken: '',
    estimatedCompletionAt: '',
    publicStatusEnabled: true,
  });

  const notify = (type, text) => {
    setMessage({ type, text });
    window.clearTimeout(notify.timer);
    notify.timer = window.setTimeout(() => setMessage(null), 4500);
  };

  useEffect(() => () => window.clearTimeout(notify.timer), []);

  const handleError = (error) => {
    if (error?.status === 401) {
      clearSession();
      window.location.reload();
      return;
    }
    notify('error', error?.message || 'Customer repair operation failed');
  };

  const load = async (identifier = repairNumber) => {
    if (!identifier.trim()) return;
    setLoading(true);
    try {
      const response = await apiFetch(`/api/repair-platform/jobs/${encodeURIComponent(identifier.trim().toUpperCase())}/customer-ops`);
      setData(response);
      setRepairNumber(response.repair.repairNumber);
      setContact({
        telegramChatId: response.repair.telegramChatId || '',
        appPushToken: response.repair.appPushToken || '',
        estimatedCompletionAt: response.repair.estimatedCompletionAt
          ? new Date(response.repair.estimatedCompletionAt).toISOString().slice(0, 16)
          : '',
        publicStatusEnabled: response.repair.publicStatusEnabled !== false,
      });
    } catch (error) {
      setData(null);
      handleError(error);
    } finally {
      setLoading(false);
    }
  };

  const findRepair = () => {
    setShareUrl('');
    setPickupCode('');
    setVerifyCode('');
    setWarrantyReason('');
    load(repairNumber);
  };

  const run = async (request, successMessage, refresh = true) => {
    setSaving(true);
    try {
      const response = await request();
      notify('success', successMessage || response.message || 'Saved');
      if (refresh) await load(data?.repair?.repairNumber || repairNumber);
      return response;
    } catch (error) {
      handleError(error);
      return null;
    } finally {
      setSaving(false);
    }
  };

  const copyText = async (text, success) => {
    try {
      await navigator.clipboard.writeText(text);
      notify('success', success);
    } catch {
      window.prompt('Copy', text);
    }
  };

  const generateLink = async () => {
    const response = await run(
      () => apiFetch(`/api/repair-platform/jobs/${data.repair.id}/public-access`, { method: 'POST' }),
      'Customer Status Link အသစ်ထုတ်ပြီးပါပြီ',
      false,
    );
    if (response?.access?.url) {
      await load(data.repair.repairNumber);
      setShareUrl(response.access.url);
      await copyText(response.access.url, 'Customer Status Link ကို Copy လုပ်ပြီးပါပြီ');
    }
  };

  const saveContact = () => run(
    () => apiFetch(`/api/repair-platform/jobs/${data.repair.id}/customer-contact`, {
      method: 'PATCH',
      body: {
        telegramChatId: contact.telegramChatId || null,
        appPushToken: contact.appPushToken || null,
        estimatedCompletionAt: contact.estimatedCompletionAt
          ? new Date(contact.estimatedCompletionAt).toISOString()
          : null,
        publicStatusEnabled: contact.publicStatusEnabled,
      },
    }),
    'Customer notification settings သိမ်းပြီးပါပြီ',
  );

  const issuePickup = async () => {
    const response = await run(
      () => apiFetch(`/api/repair-platform/jobs/${data.repair.id}/pickup-code`, { method: 'POST' }),
      'Pickup Code ထုတ်ပြီးပါပြီ',
      false,
    );
    if (response?.pickupCode) {
      await load(data.repair.repairNumber);
      setPickupCode(response.pickupCode);
      await copyText(response.pickupCode, 'Pickup Code ကို Copy လုပ်ပြီးပါပြီ');
    }
  };

  const verifyPickup = async () => {
    const response = await run(
      () => apiFetch(`/api/repair-platform/jobs/${data.repair.id}/pickup-verify`, {
        method: 'POST',
        body: { code: verifyCode },
      }),
      'Pickup အတည်ပြုပြီး ယူပြီးအဖြစ် ပြောင်းပြီးပါပြီ',
    );
    if (response?.ok) {
      setVerifyCode('');
      setPickupCode('');
    }
  };

  const createWarrantyClaim = async () => {
    const response = await run(
      () => apiFetch(`/api/repair-platform/jobs/${data.repair.id}/warranty-claim`, {
        method: 'POST',
        body: { reason: warrantyReason },
      }),
      'Warranty Claim ဖွင့်ပြီးပါပြီ',
    );
    if (response?.ok) setWarrantyReason('');
  };

  return (
    <section className="customer-repair-admin-panel">
      <header>
        <div><Smartphone size={22} /><span><b>Customer Portal · Notification · Pickup · Warranty</b><small>Repair ID တစ်ခုရွေးပြီး Customer-facing operations ကို စီမံပါ။</small></span></div>
        <div className="customer-admin-search"><input value={repairNumber} onChange={(event) => setRepairNumber(event.target.value.toUpperCase())} placeholder="AC4470 / MS0551" onKeyDown={(event) => { if (event.key === 'Enter') findRepair(); }} /><button type="button" onClick={findRepair} disabled={loading || !repairNumber.trim()}>{loading ? <Loader2 className="customer-admin-spin" size={17} /> : <Search size={17} />} Find</button></div>
      </header>

      {data?.repair ? <div className="customer-admin-body">
        <div className="customer-admin-summary"><span><small>Repair ID</small><b>{data.repair.repairNumber}</b></span><span><small>Customer</small><b>{data.repair.customerName}</b></span><span><small>Device</small><b>{data.repair.deviceBrand || ''} {data.repair.deviceModel}</b></span><span><small>Status</small><b>{data.repair.status}</b></span></div>

        <div className="customer-admin-grid">
          <section>
            <h4><Link2 size={18} /> Customer Status Link</h4>
            <p>Link အသစ်ထုတ်တိုင်း အဟောင်း Link ကို အလိုအလျောက် ပိတ်ပါမယ်။</p>
            <button className="primary" type="button" onClick={generateLink} disabled={saving}><Link2 size={17} /> Generate & Copy Link</button>
            {shareUrl ? <div className="customer-share-url"><code>{shareUrl}</code><button type="button" onClick={() => copyText(shareUrl, 'Link copied')}><Clipboard size={16} /></button></div> : null}
            {data.publicAccess ? <small className="customer-meta">Key ending: ••••{data.publicAccess.keyLast4} · Expire: {formatDate(data.publicAccess.expiresAt)} · Last View: {formatDate(data.publicAccess.lastViewedAt)}</small> : null}
          </section>

          <section>
            <h4><BellRing size={18} /> Notification Targets</h4>
            <label>Telegram Chat ID<input value={contact.telegramChatId} onChange={(event) => setContact({ ...contact, telegramChatId: event.target.value })} placeholder="Customer Telegram Chat ID" /></label>
            <label>App Push Token<input value={contact.appPushToken} onChange={(event) => setContact({ ...contact, appPushToken: event.target.value })} placeholder="FCM / App token" /></label>
            <label>Estimated Completion<input type="datetime-local" value={contact.estimatedCompletionAt} onChange={(event) => setContact({ ...contact, estimatedCompletionAt: event.target.value })} /></label>
            <label className="customer-admin-check"><input type="checkbox" checked={contact.publicStatusEnabled} onChange={(event) => setContact({ ...contact, publicStatusEnabled: event.target.checked })} /> Public status enabled</label>
            <button type="button" onClick={saveContact} disabled={saving}><Send size={17} /> Save Notification Settings</button>
          </section>

          <section>
            <h4><KeyRound size={18} /> Secure Pickup</h4>
            <p>4-digit code ကို Customer ပြမှသာ ယူပြီးအဖြစ် ပြောင်းပါမယ်။ မှား ၅ ကြိမ်ဖြစ်ရင် Code အသစ်ထုတ်ရပါမယ်။</p>
            <button className="primary" type="button" onClick={issuePickup} disabled={saving}><KeyRound size={17} /> Generate Pickup Code</button>
            {pickupCode ? <div className="pickup-code-display"><small>NEW PICKUP CODE</small><b>{pickupCode}</b></div> : null}
            <div className="pickup-verify-row"><input value={verifyCode} onChange={(event) => setVerifyCode(event.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="4-digit code" inputMode="numeric" /><button type="button" onClick={verifyPickup} disabled={saving || verifyCode.length !== 4}><CheckCircle2 size={17} /> Verify</button></div>
            <small className="customer-meta">Issued: {formatDate(data.repair.pickupCodeCreatedAt)} · Verified: {formatDate(data.repair.pickupVerifiedAt)}</small>
          </section>

          <section>
            <h4><ShieldCheck size={18} /> Warranty</h4>
            <p>Warranty Until: <b>{data.repair.warrantyUntil ? formatDate(data.repair.warrantyUntil) : 'Not configured'}</b></p>
            <textarea value={warrantyReason} onChange={(event) => setWarrantyReason(event.target.value)} placeholder="Warranty ပြန်လာရတဲ့အကြောင်းရင်း" />
            <button type="button" onClick={createWarrantyClaim} disabled={saving || warrantyReason.trim().length < 3}><ShieldCheck size={17} /> Open Warranty Claim</button>
            <div className="warranty-claim-list">{(data.warrantyClaims || []).map((claim) => <article key={claim.id}><span><b>{claim.claimNumber}</b><small>{claim.reason}</small></span><em>{claim.status}</em></article>)}</div>
          </section>
        </div>

        <section className="notification-history">
          <h4><Clock3 size={18} /> Notification Outbox</h4>
          <div>{(data.notifications || []).map((item) => <article key={item.id}><span><b>{item.channel} · {item.eventType}</b><small>{item.body}</small></span><em className={`state-${item.state?.toLowerCase()}`}>{item.state}</em><time>{formatDate(item.createdAt)}</time></article>)}{!data.notifications?.length ? <p>Notification record မရှိသေးပါ။</p> : null}</div>
        </section>
      </div> : null}

      {message ? <div className={`customer-admin-toast ${message.type}`}>{message.text}</div> : null}
    </section>
  );
}
