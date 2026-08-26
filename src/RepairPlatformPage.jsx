import React, { useEffect, useMemo, useRef, useState } from 'react';
import WebBarcodeScanner from './pos/WebBarcodeScanner.jsx';
import { cleanImei, imeiStatus } from './imeiUtils.js';
import { printRepairVoucherById } from './printing/printRepairVoucherById';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Camera,
  Clock3,
  Copy,
  Fingerprint,
  History,
  Link2,
  Loader2,
  Banknote,
  PackageCheck,
  Plus,
  Printer,
  RefreshCw,
  Search,
  Smartphone,
  Unplug,
  PackageX,
  Trash2,
  Wrench,
  X,
} from 'lucide-react';
import { apiFetch, clearSession, getSession } from './phase2Api';
import './repair-platform.css';

// The shop keeps three states in its repair book and speaks in those words at
// the counter. Seven were never used as seven — they were guessed at — so the
// three are what is offered here, matching the sheet exactly.
const STATUS_OPTIONS = [
  ['IN_PROGRESS', 'ပြင်ရန် ⏳'],
  ['COMPLETED', 'ပြင်ပြီး ✅'],
  ['CANNOT_REPAIR', 'ပြင်မရ ❌'],
];

// Repairs recorded under the older states still have to read as one of the
// three, in the list and in the timeline alike.
const STATUS_GROUP = {
  RECEIVED: 'IN_PROGRESS',
  CHECKING: 'IN_PROGRESS',
  IN_PROGRESS: 'IN_PROGRESS',
  WAITING_PART: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED',
  DELIVERED: 'COMPLETED',
  CANNOT_REPAIR: 'CANNOT_REPAIR',
};

function statusGroup(status) {
  return STATUS_GROUP[String(status || '')] || 'IN_PROGRESS';
}

const blankIntake = {
  customerName: '',
  customerPhone: '',
  deviceBrand: '',
  deviceModel: '',
  imeiSerial: '',
  problem: '',
  estimatedCost: '',
  deposit: '',
  priority: 'NORMAL',
  intakeCondition: '',
  accessoriesText: '',
  notes: '',
};

const DEVICE_SUGGESTION_KEY = 'mahar-pos-repair-device-suggestions-v1';

const money = (value) => `${Number(value || 0).toLocaleString('en-US')} MMK`;

function formatDate(value) {
  if (!value) return '-';
  try {
    return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
  } catch {
    return String(value);
  }
}

function statusLabel(status) {
  if (!status) return '-';
  return STATUS_OPTIONS.find(([value]) => value === statusGroup(status))?.[1] || String(status).replaceAll('_', ' ');
}

// The repair number is what a shop reads out over the phone and pastes into
// the voucher printer, so tapping it copies instead of only selecting.
function RepairIdCopy({ value, as: Tag = 'b', className = '' }) {
  const [copied, setCopied] = useState(false);
  if (!value) return <Tag className={className}>-</Tag>;
  const copy = async (event) => {
    event.stopPropagation();
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // http origins and old browsers have no clipboard API
      const field = document.createElement('textarea');
      field.value = value;
      field.style.position = 'fixed';
      field.style.opacity = '0';
      document.body.appendChild(field);
      field.select();
      document.execCommand('copy');
      field.remove();
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };
  return (
    <Tag
      className={`repair-id-copy ${copied ? 'copied' : ''} ${className}`.trim()}
      role="button"
      tabIndex={0}
      title="နှိပ်ပြီး Repair ID ကူးယူပါ"
      onClick={copy}
      onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') copy(event); }}
    >
      {value}
      {copied ? <CheckCircle2 size={13} /> : <Copy size={13} />}
    </Tag>
  );
}

function StatusBadge({ status }) {
  return <span className={`repair-status repair-status-${statusGroup(status).toLowerCase()}`}>{statusLabel(status)}</span>;
}

function SourceBadge({ job }) {
  if (job.providerLinked) return <span className="repair-source imported">Mahar Shwe API</span>;
  if (job.sourceType && job.sourceType !== 'LOCAL') return <span className="repair-source imported">Imported</span>;
  return <span className="repair-source local">Local</span>;
}

function Modal({ children, onClose, wide = false }) {
  return (
    <div className="repair-modal-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className={`repair-modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true">
        {children}
      </section>
    </div>
  );
}

function IntakeModal({ onClose, onSaved, notify }) {
  const [form, setForm] = useState(blankIntake);
  const [saving, setSaving] = useState(false);
  const [showOptional, setShowOptional] = useState(false);
  const [scanImei, setScanImei] = useState(false);
  const [suggestions, setSuggestions] = useState({ brands: [], models: [], pairs: [] });
  const field = (key, value) => setForm((current) => ({ ...current, [key]: value }));

  // The counter says the phone as one thing — "Oppo A3s" — and types it that
  // way. The split happens once they leave the box, not while they type: on
  // every keystroke it would cut the word in half the moment the space landed
  // and the rest would go on the end of the brand.
  const splitBrand = () => setForm((current) => {
    const parts = String(current.deviceBrand || '').trim().split(/\s+/);
    if (parts.length < 2 || String(current.deviceModel || '').trim()) return current;
    return { ...current, deviceBrand: parts[0], deviceModel: parts.slice(1).join(' ') };
  });
  const imeiHint = imeiStatus(form.imeiSerial);
  const [imeiLookup, setImeiLookup] = useState(null);
  // Held after a successful intake so the voucher can be printed from a fresh
  // click — a browser will not open the print window from a callback that has
  // already awaited the network.
  const [saved, setSaved] = useState(null);
  const [printing, setPrinting] = useState(false);

  // A full, valid IMEI identifies a model. Fill brand and model only when they
  // are still blank — never overwrite what the technician typed.
  useEffect(() => {
    if (imeiHint.state !== 'valid') { setImeiLookup(null); return undefined; }
    let active = true;
    const timer = window.setTimeout(async () => {
      try {
        const data = await apiFetch(`/api/imei/lookup?imei=${encodeURIComponent(form.imeiSerial)}`);
        if (!active || !data?.found) { if (active) setImeiLookup(data?.found === false ? { found: false } : null); return; }
        setImeiLookup(data);
        setForm((current) => ({
          ...current,
          deviceBrand: current.deviceBrand?.trim() ? current.deviceBrand : (data.brand || ''),
          deviceModel: current.deviceModel?.trim() ? current.deviceModel : (data.model || ''),
        }));
      } catch {
        if (active) setImeiLookup(null);
      }
    }, 350);
    return () => { active = false; window.clearTimeout(timer); };
  }, [form.imeiSerial, imeiHint.state]);

  useEffect(() => {
    let mounted = true;
    const readLocalSuggestions = () => {
      try {
        return JSON.parse(window.localStorage.getItem(DEVICE_SUGGESTION_KEY) || '{}');
      } catch {
        return {};
      }
    };
    const mergeUnique = (...lists) => Array.from(new Set(lists.flat().map((item) => String(item || '').trim()).filter(Boolean))).slice(0, 140);
    const mergePairs = (...lists) => {
      const map = new Map();
      lists.flat().forEach((item) => {
        const brand = String(item?.brand || '').trim();
        const model = String(item?.model || '').trim();
        if (brand && model) map.set(`${brand.toLowerCase()}::${model.toLowerCase()}`, { brand, model });
      });
      return Array.from(map.values()).slice(0, 180);
    };
    const local = readLocalSuggestions();
    const apply = (remote = {}) => {
      if (!mounted) return;
      setSuggestions({
        brands: mergeUnique(remote.brands, local.brands),
        models: mergeUnique(remote.models, local.models),
        pairs: mergePairs(remote.pairs, local.pairs),
      });
    };
    apply();
    apiFetch('/api/repair-platform/device-suggestions')
      .then((response) => apply(response || {}))
      .catch(() => apply());
    return () => { mounted = false; };
  }, []);

  const modelSuggestions = useMemo(() => {
    const brand = form.deviceBrand.trim().toLowerCase();
    if (!brand) return suggestions.models;
    const matched = suggestions.pairs
      .filter((item) => String(item.brand || '').trim().toLowerCase() === brand)
      .map((item) => item.model);
    return Array.from(new Set([...matched, ...suggestions.models])).filter(Boolean).slice(0, 120);
  }, [form.deviceBrand, suggestions]);

  const rememberDeviceSuggestion = (payload) => {
    const brand = String(payload.deviceBrand || '').trim();
    const model = String(payload.deviceModel || '').trim();
    if (!brand && !model) return;
    try {
      const existing = JSON.parse(window.localStorage.getItem(DEVICE_SUGGESTION_KEY) || '{}');
      const brands = Array.from(new Set([brand, ...(existing.brands || [])].filter(Boolean))).slice(0, 80);
      const models = Array.from(new Set([model, ...(existing.models || [])].filter(Boolean))).slice(0, 120);
      const pairs = [{ brand, model }, ...(existing.pairs || [])].filter((item) => item.brand && item.model);
      const pairMap = new Map(pairs.map((item) => [`${String(item.brand).toLowerCase()}::${String(item.model).toLowerCase()}`, item]));
      window.localStorage.setItem(DEVICE_SUGGESTION_KEY, JSON.stringify({ brands, models, pairs: Array.from(pairMap.values()).slice(0, 160) }));
    } catch {
      // Suggestions are a convenience only; never block repair intake.
    }
  };

  const submit = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      const payload = {
        ...form,
        estimatedCost: Number(form.estimatedCost || 0),
        deposit: Number(form.deposit || 0),
        accessories: form.accessoriesText.split(',').map((item) => item.trim()).filter(Boolean),
      };
      delete payload.accessoriesText;
      const response = await apiFetch('/api/repair-platform/intake', { method: 'POST', body: payload });
      rememberDeviceSuggestion(payload);
      notify('success', `ဘောက်ချာနံပါတ်: ${response.repair.repairNumber}`);
      setSaved(response.repair);
    } catch (error) {
      notify('error', error.message || 'Repair intake failed');
    } finally {
      setSaving(false);
    }
  };

  const done = () => { const record = saved; setSaved(null); onSaved(record); };

  if (saved) {
    return (
      <Modal onClose={done}>
        <div className="repair-saved-panel">
          <CheckCircle2 size={44} />
          <h3>ဘောက်ချာ ထုတ်ပြီးပါပြီ</h3>
          <div className="repair-saved-number"><span>ဘောက်ချာနံပါတ်</span><b>{saved.repairNumber}</b></div>
          <p>{saved.customerName}{saved.deviceModel ? ` · ${saved.deviceModel}` : ''}</p>
          <div className="repair-saved-actions">
            <button
              type="button"
              className="primary"
              disabled={printing}
              onClick={async () => {
                setPrinting(true);
                try { await printRepairVoucherById(saved.repairNumber, notify); } finally { setPrinting(false); }
              }}
            >
              {printing ? <Loader2 className="repair-spin" size={18} /> : <Printer size={18} />} ဘောက်ချာ ထုတ်မည်
            </button>
            <button type="button" onClick={done}>ပြီးပါပြီ</button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal onClose={onClose} wide>
      <header className="repair-modal-header">
        <div><Plus size={22} /><span><h3>ဖုန်းပြင် အသစ် လက်ခံမည်</h3><p>ဆိုင် Prefix နဲ့ Code ထဲကပုံစံအတိုင်း MS0001 / AC0001 လို ဘောက်ချာနံပါတ် တစ်ခုပဲ ထုတ်ပါမယ်။</p></span></div>
        <button type="button" onClick={onClose}><X size={20} /></button>
      </header>
      <form className="repair-form" onSubmit={submit}>
        <datalist id="repair-device-brand-suggestions">
          {suggestions.brands.map((brand) => <option key={brand} value={brand} />)}
        </datalist>
        <datalist id="repair-device-model-suggestions">
          {modelSuggestions.map((model) => <option key={model} value={model} />)}
        </datalist>
        <div className="repair-form-grid">
          <label>ပိုင်ရှင် အမည်<input value={form.customerName} onChange={(event) => field('customerName', event.target.value)} required /></label>
          <label>ဖုန်းနံပါတ်<input value={form.customerPhone} onChange={(event) => field('customerPhone', event.target.value)} /></label>
          <label>ဖုန်းအမျိုးအစား<input list="repair-device-brand-suggestions" value={form.deviceBrand} onChange={(event) => field('deviceBrand', event.target.value)} onBlur={splitBrand} placeholder="Oppo A3s လို တစ်ခါတည်း ရိုက်လို့ရ" autoComplete="off" /></label>
          <label>မော်ဒယ်<input list="repair-device-model-suggestions" value={form.deviceModel} onChange={(event) => field('deviceModel', event.target.value)} placeholder={form.deviceBrand ? `${form.deviceBrand} model` : 'Y28 / A3x / Note 13'} autoComplete="off" required /></label>
          <label>ခန့်မှန်း ကုန်ကျစရိတ်<input type="number" min="0" value={form.estimatedCost} onChange={(event) => field('estimatedCost', event.target.value)} /></label>
          <label>စရံ<input type="number" min="0" value={form.deposit} onChange={(event) => field('deposit', event.target.value)} /></label>
          <label className="span-2">ချို့ယွင်းချက်<textarea value={form.problem} onChange={(event) => field('problem', event.target.value)} required /></label>
          <button className="span-2" type="button" onClick={() => setShowOptional((value) => !value)}>{showOptional ? 'အသေးစိတ် ဖျောက်မည်' : 'အသေးစိတ် ထပ်ဖြည့်မည်'}</button>
          {showOptional ? <>
            <label>IMEI / Serial
              <span className="repair-imei-row">
                <input
                  value={form.imeiSerial}
                  onChange={(event) => field('imeiSerial', cleanImei(event.target.value))}
                  placeholder="15 ဂဏန်း — ရိုက်ပါ သို့မဟုတ် စကန်ဖတ်ပါ"
                  inputMode="numeric"
                  autoComplete="off"
                />
                <button type="button" className="repair-imei-scan" onClick={() => setScanImei(true)} aria-label="Scan IMEI"><Camera size={16} /></button>
              </span>
              {imeiHint.message ? <small className={`repair-imei-hint ${imeiHint.state}`}>{imeiHint.message}</small> : null}
              {imeiLookup?.found ? <small className="repair-imei-hint valid">📱 {[imeiLookup.brand, imeiLookup.model].filter(Boolean).join(' ')}{imeiLookup.source === 'history' ? ' — ဒီဆိုင်မှာ အရင်က တွေ့ဖူး' : ''}</small> : null}
              {imeiLookup && imeiLookup.found === false ? <small className="repair-imei-hint typing">ဒီ model ကို အရင်က မမှတ်ရသေးပါ — brand/model ရိုက်ထည့်ပါ</small> : null}
            </label>
            <label>အရေးပေါ် အဆင့်<select value={form.priority} onChange={(event) => field('priority', event.target.value)}><option>NORMAL</option><option>LOW</option><option>HIGH</option><option>URGENT</option></select></label>
            <label className="span-2">လက်ခံစဉ် အခြေအနေ<textarea value={form.intakeCondition} onChange={(event) => field('intakeCondition', event.target.value)} placeholder="မှန်ကွဲ၊ ရေစို၊ ကိုယ်ထည် အခြေအနေ..." /></label>
            <label className="span-2">ပါလာသော ပစ္စည်းများ<input value={form.accessoriesText} onChange={(event) => field('accessoriesText', event.target.value)} placeholder="SIM tray၊ အားသွင်းကြိုး၊ ဖုန်းအိတ် (ခဏနဲ့ ခြား)" /></label>
            <label className="span-2">Notes<textarea value={form.notes} onChange={(event) => field('notes', event.target.value)} /></label>
          </> : null}
        </div>
        <footer><button type="button" onClick={onClose}>Cancel</button><button className="primary" type="submit" disabled={saving}>{saving ? <Loader2 className="repair-spin" size={18} /> : <Wrench size={18} />} Create Repair</button></footer>
      </form>
      {scanImei ? <WebBarcodeScanner onClose={() => setScanImei(false)} onDetected={(code) => { field('imeiSerial', cleanImei(code)); setScanImei(false); }} /> : null}
    </Modal>
  );
}

function DetailModal({ repairId, onClose, onChanged, notify, maharApiAllowed }) {
  const [showStatusDetail, setShowStatusDetail] = useState(false);
  const [printingVoucher, setPrintingVoucher] = useState(false);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [statusForm, setStatusForm] = useState({ status: 'IN_PROGRESS', note: '', diagnosis: '', resolution: '', finalCost: '', warrantyUntil: '' });
  const canDelete = ['SUPER_ADMIN', 'SHOP_ADMIN'].includes(getSession()?.user?.role || '');
  const [maharRepairId, setMaharRepairId] = useState('');
  const [deviceId, setDeviceId] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const response = await apiFetch(`/api/repair-platform/jobs/${encodeURIComponent(repairId)}`);
      setData(response);
      setStatusForm((current) => ({ ...current, status: statusGroup(response.repair.status), finalCost: response.repair.finalCost || '' }));
    } catch (error) {
      notify('error', error.message || 'Repair detail failed');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [repairId]);

  const run = async (request, successMessage) => {
    setSaving(true);
    try {
      const response = await request();
      notify('success', successMessage || response.message || 'Updated');
      await load();
      onChanged();
      return response;
    } catch (error) {
      notify('error', error.message || 'Repair update failed');
      return null;
    } finally {
      setSaving(false);
    }
  };

  if (loading || !data) {
    return <Modal onClose={onClose}><div className="repair-modal-loading"><Loader2 className="repair-spin" /> Loading repair...</div></Modal>;
  }

  const repair = data.repair;

  return (
    <Modal onClose={onClose} wide>
      <header className="repair-modal-header">
        <div><Smartphone size={22} /><span><RepairIdCopy value={repair.repairNumber} as="h3"/><p>{repair.customerName} · {repair.deviceBrand || ''} {repair.deviceModel}</p></span></div>
        <button type="button" onClick={onClose}><X size={20} /></button>
      </header>
      <div className="repair-detail-body">
        <div className="repair-detail-summary">
          <article><span>Status</span><StatusBadge status={repair.status} /></article>
          <article><span>Source</span><SourceBadge job={repair} /></article>
          <article><span>IMEI / Serial</span><b>{repair.identityMasked || repair.imeiSerial || 'မချိတ်ရသေး'}</b></article>
          <article><span>Received</span><b>{formatDate(repair.receivedAt)}</b></article>
          <article><span>Final Cost</span><b>{money(repair.finalCost)}</b></article>
          <article><span>Balance Due</span><b>{money(repair.balanceDue)}</b></article>
        </div>

        <div className="repair-detail-grid">
          <section className="repair-detail-card">
            <h4>ဖုန်းပြင် အချက်အလက်</h4>
            <dl>
              <div><dt>ဘောက်ချာနံပါတ်</dt><dd><RepairIdCopy value={repair.repairNumber} as="span"/></dd></div>
              <div><dt>ပိုင်ရှင်</dt><dd>{repair.customerName}</dd></div>
              <div><dt>ဖုန်းနံပါတ်</dt><dd>{repair.customerPhone || '-'}</dd></div>
              <div><dt>ဖုန်း</dt><dd>{repair.deviceBrand || ''} {repair.deviceModel}</dd></div>
              <div><dt>ချို့ယွင်းချက်</dt><dd>{repair.problem}</dd></div>
              <div><dt>လက်ခံစဉ် အခြေအနေ</dt><dd>{repair.intakeCondition || '-'}</dd></div>
              <div><dt>ပါလာသော ပစ္စည်းများ</dt><dd>{repair.accessories?.join(', ') || '-'}</dd></div>
              <div><dt>စစ်ဆေးတွေ့ရှိချက်</dt><dd>{repair.diagnosis || '-'}</dd></div>
              <div><dt>ပြင်ဆင်ပုံ</dt><dd>{repair.resolution || '-'}</dd></div>
              <div><dt>ပြင်သူ ဆရာ</dt><dd>{repair.technicianName || repair.technicianUsername || '-'}</dd></div>
              <div><dt>ယူပြီး ခြေနေ</dt><dd>{repair.deliveredAt ? `ယူသွားပြီ · ${formatDate(repair.deliveredAt)}` : 'မယူရသေး ⏳'}</dd></div>
            </dl>
          </section>

          <section className="repair-detail-card">
            <h4>လုပ်ဆောင်ချက်</h4>
            <div className="repair-quick-actions">
              <label className="repair-status-pick">
                <span>အခြေအနေ</span>
                <select value={statusForm.status} onChange={(event) => setStatusForm({ ...statusForm, status: event.target.value })}>
                  {STATUS_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              <div className="repair-action-row">
                {/* Only offered when the selection actually differs — a button that
                    saves the status it already has just invites doubt. */}
                {statusForm.status !== statusGroup(repair.status) ? (
                  <button type="button" className="primary" disabled={saving} onClick={() => run(() => apiFetch(`/api/repair-platform/jobs/${repair.id}/status`, {
                    method: 'PATCH',
                    body: {
                      ...statusForm,
                      finalCost: statusForm.finalCost === '' ? undefined : Number(statusForm.finalCost),
                      warrantyUntil: statusForm.warrantyUntil || null,
                    },
                  }), 'အခြေအနေ ပြောင်းပြီးပါပြီ')}><CheckCircle2 size={17} /> အခြေအနေ ပြောင်းမည်</button>
                ) : null}

                <button type="button" disabled={printingVoucher} onClick={async () => {
                  setPrintingVoucher(true);
                  try { await printRepairVoucherById(repair.repairNumber, notify); } finally { setPrintingVoucher(false); }
                }}>{printingVoucher ? <Loader2 className="repair-spin" size={17} /> : <Printer size={17} />} ဘောက်ချာ ပြန်ထုတ်</button>

                {/* Owner only, and behind a typed confirmation: this takes the
                    repair's whole history with it and removes the sheet row. */}
                {canDelete ? (
                  <button type="button" className="repair-delete-button" disabled={saving} onClick={async () => {
                    const typed = window.prompt(`${repair.repairNumber} ကို အပြီးဖျက်ပါမည်။

ဤမှတ်တမ်းနှင့် သက်ဆိုင်သမျှ၊ Google Sheet ထဲက အတန်းပါ ပျက်သွားပါမည် — ပြန်ရလို့ မရပါ။

အတည်ပြုရန် ဘောက်ချာနံပါတ် ရိုက်ထည့်ပါ:`);
                    if (typed === null) return;
                    if (String(typed).trim().toUpperCase() !== String(repair.repairNumber).toUpperCase()) {
                      notify('error', 'ဘောက်ချာနံပါတ် မကိုက်ညီပါ — မဖျက်ပါ');
                      return;
                    }
                    setSaving(true);
                    try {
                      const response = await apiFetch(`/api/repair-platform/jobs/${repair.id}`, { method: 'DELETE' });
                      notify('success', response.message || 'ဖျက်ပြီးပါပြီ');
                      onChanged?.();
                      onClose();
                    } catch (error) {
                      handleError(error);
                    } finally {
                      setSaving(false);
                    }
                  }}><Trash2 size={17} /> ဖျက်မည်</button>
                ) : null}

                {/* Collection is separate from the repair state, the way the
                    shop's book keeps it — an unrepairable phone still gets
                    taken home. Both directions, since it gets marked by
                    mistake. */}
                {repair.deliveredAt ? (
                  <button type="button" className="repair-pickup-undo" disabled={saving} onClick={() => run(() => apiFetch(`/api/repair-platform/jobs/${repair.id}/status`, {
                    method: 'PATCH',
                    body: { status: repair.status, pickedUp: false },
                  }), 'မယူရသေး ပြန်ထားပြီးပါပြီ')}><PackageX size={17} /> မယူရသေး ⏳</button>
                ) : (
                  <button type="button" className="repair-pickup-button" disabled={saving} onClick={() => run(() => apiFetch(`/api/repair-platform/jobs/${repair.id}/status`, {
                    method: 'PATCH',
                    body: { status: repair.status, pickedUp: true },
                  }), 'ယူသွားပြီ မှတ်ပြီးပါပြီ')}><PackageCheck size={17} /> ယူပြီး ✅</button>
                )}

                {repair.paymentStatus !== 'PAID' ? (
                  <button type="button" className="repair-paid-button" disabled={saving} onClick={() => run(() => apiFetch(`/api/repair-platform/jobs/${repair.id}/status`, {
                    method: 'PATCH',
                    body: { status: repair.status, paymentStatus: 'PAID' },
                  }), 'ငွေရှင်းပြီး မှတ်ပြီးပါပြီ')}><Banknote size={17} /> ရှင်းပြီး</button>
                ) : <span className="repair-paid-flag"><CheckCircle2 size={16} /> ငွေရှင်းပြီး</span>}
              </div>

              {/* The rest is filled in once, when the repair is finished. Kept out
                  of the way until then so the common case is three buttons. */}
              <button type="button" className="repair-more-toggle" onClick={() => setShowStatusDetail((value) => !value)}>
                {showStatusDetail ? 'အသေးစိတ် ဖျောက်မည်' : 'အသေးစိတ် ဖြည့်မည် (ပြင်ခ၊ အာမခံ၊ မှတ်ချက်)'}
              </button>

              {showStatusDetail ? (
                <div className="repair-action-form">
                  <label>ပြင်ခ<input type="number" min="0" value={statusForm.finalCost} onChange={(event) => setStatusForm({ ...statusForm, finalCost: event.target.value })} /></label>
                  <label>အာမခံ ရက်<input type="date" value={statusForm.warrantyUntil} onChange={(event) => setStatusForm({ ...statusForm, warrantyUntil: event.target.value })} /></label>
                  <label>စစ်ဆေးတွေ့ရှိချက်<textarea value={statusForm.diagnosis} onChange={(event) => setStatusForm({ ...statusForm, diagnosis: event.target.value })} /></label>
                  <label>ပြင်ဆင်ပုံ<textarea value={statusForm.resolution} onChange={(event) => setStatusForm({ ...statusForm, resolution: event.target.value })} /></label>
                  <label>မှတ်ချက်<textarea value={statusForm.note} onChange={(event) => setStatusForm({ ...statusForm, note: event.target.value })} /></label>
                </div>
              ) : null}
            </div>
          </section>

          {maharApiAllowed ? <section className="repair-detail-card">
            <h4>Mahar Shwe API</h4>
            {repair.providerLinked ? (
              <>
                <p>ဒီ Repair ကို Mahar Shwe API နဲ့ ချိတ်ထားပါတယ်။ User မြင်ရမယ့် Repair ID က {repair.repairNumber} တစ်ခုပဲ ဖြစ်ပါတယ်။</p>
                <button className="secondary-action" type="button" disabled={saving} onClick={() => run(() => apiFetch(`/api/repair-platform/jobs/${repair.id}/sync`, { method: 'POST' }), 'Mahar Shwe status synced')}><RefreshCw size={17} /> Sync Now</button>
              </>
            ) : (
              <>
                <p>ဒီဆိုင်ရဲ့ Repair ID ကိုမပြောင်းဘဲ Mahar Shwe Repair ID နဲ့ data/status ချိတ်ပါမယ်။</p>
                <div className="repair-inline-action"><input value={maharRepairId} onChange={(event) => setMaharRepairId(event.target.value.toUpperCase())} placeholder="MS0551" /><button type="button" disabled={saving || !maharRepairId.trim()} onClick={() => run(() => apiFetch(`/api/repair-platform/jobs/${repair.id}/link-provider`, { method: 'POST', body: { repairId: maharRepairId.trim() } }), 'Mahar Shwe data linked')}><Link2 size={17} /> Link</button></div>
              </>
            )}
          </section> : null}

          <section className="repair-detail-card">
            <h4>Device Identity</h4>
            <p>IMEI သို့မဟုတ် Serial ကိုချိတ်ပြီး ဒီဖုန်းရဲ့ Repair History အားလုံးပြန်ကြည့်နိုင်ပါတယ်။</p>
            <div className="repair-inline-action"><input value={deviceId} onChange={(event) => setDeviceId(event.target.value)} placeholder="IMEI / Serial" /><button type="button" disabled={saving || deviceId.trim().length < 6} onClick={() => run(() => apiFetch(`/api/repair-platform/jobs/${repair.id}/device`, { method: 'POST', body: { imeiSerial: deviceId.trim(), deviceBrand: repair.deviceBrand, deviceModel: repair.deviceModel } }), 'ဖုန်း IMEI ချိတ်ပြီးပါပြီ')}><Fingerprint size={17} /> Link</button></div>
          </section>

          <section className="repair-detail-card repair-timeline-card">
            <h4>Repair Timeline</h4>
            <div className="repair-timeline">
              {(data.timeline || []).map((event) => <article key={event.id}><div><Clock3 size={15} /></div><span><b>{event.eventType.replaceAll('_', ' ')}</b><small>{event.note || statusLabel(event.status)} · {event.changedByName || event.changedByUsername || 'System'}</small><time>{formatDate(event.occurredAt)}</time></span></article>)}
              {!data.timeline?.length ? <p>No timeline events yet.</p> : null}
            </div>
          </section>
        </div>
      </div>
    </Modal>
  );
}

export default function RepairPlatformPage({ showHistoryTool: controlledShowHistoryTool, setShowHistoryTool: setControlledShowHistoryTool, bottomTools = null } = {}) {
  const [data, setData] = useState({ jobs: [], summary: {}, total: 0, totalPages: 1, maharShweApiAccess: { allowed: false } });
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [sourceType, setSourceType] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importId, setImportId] = useState('');
  const [historyIdentifier, setHistoryIdentifier] = useState('');
  const [history, setHistory] = useState(null);
  const [internalShowHistoryTool, setInternalShowHistoryTool] = useState(false);
  const [showIntake, setShowIntake] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [quickStatusJobId, setQuickStatusJobId] = useState(null);
  const [quickStatusSavingId, setQuickStatusSavingId] = useState(null);
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);

  const notify = (type, text) => {
    setToast({ type, text });
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 4000);
  };

  const handleError = (error) => {
    if (error?.status === 401) {
      clearSession();
      window.location.reload();
      return;
    }
    notify('error', error?.message || 'Repair request failed');
  };

  const load = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: '10' });
      if (query.trim()) params.set('q', query.trim());
      if (status) params.set('status', status);
      if (sourceType) params.set('sourceType', sourceType);
      setData(await apiFetch(`/api/repair-platform/jobs?${params.toString()}`));
    } catch (error) {
      handleError(error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const timer = window.setTimeout(load, 180);
    return () => window.clearTimeout(timer);
  }, [query, status, sourceType, page]);

  useEffect(() => setPage(1), [query, status, sourceType]);
  useEffect(() => () => window.clearTimeout(toastTimer.current), []);

  const importRepair = async () => {
    if (!importId.trim()) return;
    setImporting(true);
    try {
      const response = await apiFetch('/api/repair-platform/import', { method: 'POST', body: { repairId: importId.trim().toUpperCase() } });
      notify('success', `${response.message}: ${response.repair.repairNumber}`);
      setImportId('');
      setSelectedId(response.repair.id);
      await load();
    } catch (error) {
      handleError(error);
    } finally {
      setImporting(false);
    }
  };

  const searchHistory = async () => {
    if (historyIdentifier.trim().length < 6) return;
    try {
      const response = await apiFetch(`/api/repair-platform/device-history?identifier=${encodeURIComponent(historyIdentifier.trim())}`);
      setHistory(response);
      if (!response.found) notify('error', 'ဒီ IMEI / Serial နဲ့ Repair History မတွေ့ပါ');
    } catch (error) {
      handleError(error);
    }
  };

  const quickStatusUpdate = async (job, nextStatus) => {
    if (!job?.id || !nextStatus || nextStatus === statusGroup(job.status)) {
      setQuickStatusJobId(null);
      return;
    }
    setQuickStatusSavingId(job.id);
    try {
      await apiFetch(`/api/repair-platform/jobs/${job.id}/status`, {
        method: 'PATCH',
        body: {
          status: nextStatus,
          note: 'Quick status changed from repair transaction list',
        },
      });
      notify('success', `${job.repairNumber} status ပြောင်းပြီးပါပြီ`);
      setQuickStatusJobId(null);
      await load();
    } catch (error) {
      handleError(error);
    } finally {
      setQuickStatusSavingId(null);
    }
  };

  const summaryCards = useMemo(() => [
    { label: 'Total Repairs', value: data.summary?.total || 0, icon: Wrench, tone: 'blue' },
    { label: 'In Workflow', value: data.summary?.pending || 0, icon: Clock3, tone: 'orange' },
    { label: 'Completed', value: data.summary?.completed || 0, icon: CheckCircle2, tone: 'green' },
    { label: 'Delivered', value: data.summary?.delivered || 0, icon: PackageCheck, tone: 'purple' },
    { label: 'API Connected', value: data.summary?.imported || 0, icon: Link2, tone: 'teal' },
  ], [data.summary]);
  const maharApiAllowed = data.maharShweApiAccess?.allowed === true;
  const showHistoryTool = typeof controlledShowHistoryTool === 'boolean' ? controlledShowHistoryTool : internalShowHistoryTool;
  const toggleHistoryTool = () => {
    if (setControlledShowHistoryTool) setControlledShowHistoryTool((value) => !value);
    else setInternalShowHistoryTool((value) => !value);
  };

  return (
    <section className="repair-platform-page">
      <div className="repair-page-heading repair-page-actions-only">
        <div><button type="button" onClick={load}><RefreshCw size={18} /> Refresh</button><button className="primary" type="button" onClick={() => setShowIntake(true)}><Plus size={18} /> Add Repair</button></div>
      </div>

      <section className="repair-add-entry-card">
        <div>
          <span>PHONE REPAIR INTAKE</span>
          <h3>ဖုန်းပြင် စာရင်းသွင်းရန်</h3>
          <p>Customer, Brand, Model, ပြင်ရမည့်ပြဿနာကိုဖြည့်ပြီး Repair ID အသစ်ထုတ်ပါ။ Brand / Model ကို တစ်ခါထည့်ပြီးရင် နောက်တစ်ခါ suggestion အနေနဲ့ပြပါမယ်။</p>
        </div>
        <button className="primary" type="button" onClick={() => setShowIntake(true)}><Plus size={19} /> Add Repair / စာရင်းသွင်းမည်</button>
      </section>

      <div className="repair-summary-grid">
        {summaryCards.map(({ label, value, icon: Icon, tone }) => <article key={label}><div className={`tone-${tone}`}><Icon size={22} /></div><span>{label}</span><b>{Number(value).toLocaleString()}</b></article>)}
      </div>

      {maharApiAllowed ? <div className="repair-quick-grid">
        <section className="repair-quick-card">
          <header><Link2 size={20} /><span><b>Import Existing Repair ID</b><small>MS0551 / AC0001 လို Code ထဲက Repair ID ရိုက်ပြီး Customer၊ Device၊ Issue၊ Status ကို API ကနေယူပါ။</small></span></header>
          <div><input value={importId} onChange={(event) => setImportId(event.target.value.toUpperCase())} placeholder="MS0551" onKeyDown={(event) => { if (event.key === 'Enter') importRepair(); }} /><button type="button" disabled={importing || !importId.trim()} onClick={importRepair}>{importing ? <Loader2 className="repair-spin" size={17} /> : <Search size={17} />} Import</button></div>
        </section>
      </div> : null}

      <section className="repair-list-card">
        <div className="repair-toolbar">
          <div className="repair-search"><Search size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Repair ID, customer, phone, device, IMEI or issue" /></div>
          <select value={status} onChange={(event) => setStatus(event.target.value)}><option value="">All Statuses</option>{STATUS_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
          <select value={sourceType} onChange={(event) => setSourceType(event.target.value)}><option value="">All Sources</option><option value="LOCAL">Local</option><option value="MAHAR_SHWE_IMPORT">Mahar Shwe Import</option><option value="PROVIDER_IMPORT">Provider Import</option><option value="PARTNER_HANDOFF">Partner Handoff</option></select>
        </div>
        <div className="repair-table-wrap">
          <table>
            <thead><tr><th>ဘောက်ချာနံပါတ်</th><th>ပိုင်ရှင်</th><th>ဖုန်း</th><th>ချို့ယွင်းချက်</th><th>ရင်းမြစ်</th><th>အခြေအနေ</th><th>လက်ခံသည့်နေ့</th><th>ကျသင့်ငွေ</th></tr></thead>
            <tbody>
              {(data.jobs || []).map((job) => <tr key={job.id} className="repair-click-row" onClick={() => setSelectedId(job.id)}><td onClick={(event) => event.stopPropagation()}><RepairIdCopy value={job.repairNumber} className="repair-id"/></td><td><b>{job.customerName}</b><small>{job.customerPhone || '-'}</small></td><td><b>{job.deviceBrand || ''} {job.deviceModel}</b><small>{job.identityMasked || 'No IMEI/Serial'}</small></td><td><span className="repair-problem">{job.problem}</span></td><td><SourceBadge job={job} /></td><td onClick={(event) => event.stopPropagation()}>{quickStatusJobId === job.id ? <select className="repair-status-inline-select" value={statusGroup(job.status)} autoFocus disabled={quickStatusSavingId === job.id} onBlur={() => setQuickStatusJobId(null)} onChange={(event) => quickStatusUpdate(job, event.target.value)}>{STATUS_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select> : <button type="button" className="repair-status-click" onClick={() => setQuickStatusJobId(job.id)} disabled={quickStatusSavingId === job.id}>{quickStatusSavingId === job.id ? <Loader2 className="repair-spin" size={15} /> : <StatusBadge status={job.status} />}</button>}</td><td>{formatDate(job.receivedAt)}</td><td><b>{money(job.finalCost || job.estimatedCost)}</b><small>Due {money(job.balanceDue)}</small></td></tr>)}
              {!data.jobs?.length && !loading ? <tr><td colSpan="8"><div className="repair-empty"><Unplug size={28} /><span>No repair jobs found.</span></div></td></tr> : null}
            </tbody>
          </table>
          {loading ? <div className="repair-loading"><Loader2 className="repair-spin" /> Loading repairs...</div> : null}
        </div>
        <div className="repair-pagination"><span>Showing {data.jobs?.length || 0} of {data.total || 0}</span><div><button type="button" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}><ChevronLeft size={17} /> Previous</button><b>Page {page} / {Math.max(1, data.totalPages || 1)}</b><button type="button" disabled={page >= Math.max(1, data.totalPages || 1)} onClick={() => setPage((value) => value + 1)}>Next <ChevronRight size={17} /></button></div></div>
      </section>

      {bottomTools ? <section className="repair-bottom-tools">{bottomTools}</section> : null}

      {!setControlledShowHistoryTool ? <div className="repair-quick-grid repair-bottom-history-tools">
        <section className="repair-quick-card repair-quick-launcher">
          <header><Fingerprint size={20} /><span><b>ဖုန်းတစ်လုံးချင်း ပြင်ဆင်မှတ်တမ်း</b><small>နိုပ်မှ IMEI / Serial history search form ပေါ်မယ်။</small></span></header>
          <button type="button" onClick={toggleHistoryTool}>{showHistoryTool ? <X size={17} /> : <History size={17} />} {showHistoryTool ? 'Hide History Search' : 'Open History Search'}</button>
        </section>
      </div> : null}

      {showHistoryTool ? <section className="repair-quick-card repair-bottom-history-search">
        <header><Fingerprint size={20} /><span><b>ဖုန်းတစ်လုံးချင်း ပြင်ဆင်မှတ်တမ်း</b><small>IMEI / Serial တစ်ခုနဲ့ ဒီဖုန်း ဘာတွေပြင်ဖူးသလဲ ပြန်လိုက်ပါ။</small></span></header>
        <div><input value={historyIdentifier} onChange={(event) => setHistoryIdentifier(event.target.value)} placeholder="IMEI or Serial Number" onKeyDown={(event) => { if (event.key === 'Enter') searchHistory(); }} /><button type="button" onClick={searchHistory} disabled={historyIdentifier.trim().length < 6}><History size={17} /> History</button></div>
      </section> : null}

      {history?.found ? <section className="repair-device-history-result"><header><Smartphone size={20} /><div><b>{history.device?.brand || ''} {history.device?.model || 'Device'}</b><small>{history.device?.identityType} · {history.device?.identityMasked} · {history.totalRepairs} repair records</small></div><button type="button" onClick={() => setHistory(null)}><X size={18} /></button></header><div>{history.history.map((job) => <button type="button" key={job.id} onClick={() => setSelectedId(job.id)}><span><b>{job.repairNumber}</b><small>{job.problem}</small></span><StatusBadge status={job.status} /><time>{formatDate(job.receivedAt)}</time></button>)}</div></section> : null}

      {showIntake ? <IntakeModal onClose={() => setShowIntake(false)} onSaved={(repair) => { setShowIntake(false); setSelectedId(repair.id); load(); }} notify={notify} /> : null}
      {selectedId ? <DetailModal repairId={selectedId} onClose={() => setSelectedId(null)} onChanged={load} notify={notify} maharApiAllowed={maharApiAllowed} /> : null}
      {toast ? <div className={`repair-toast ${toast.type}`}>{toast.type === 'error' ? <AlertTriangle size={18} /> : <CheckCircle2 size={18} />}{toast.text}</div> : null}
    </section>
  );
}
