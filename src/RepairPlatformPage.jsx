import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Fingerprint,
  History,
  Link2,
  Loader2,
  PackageCheck,
  Plus,
  RefreshCw,
  Search,
  Smartphone,
  Unplug,
  Wrench,
  X,
} from 'lucide-react';
import { apiFetch, clearSession } from './phase2Api';
import './repair-platform.css';

const STATUS_OPTIONS = [
  ['RECEIVED', 'Received'],
  ['CHECKING', 'Checking'],
  ['IN_PROGRESS', 'In Progress'],
  ['WAITING_PART', 'Waiting Part'],
  ['COMPLETED', 'Completed'],
  ['CANNOT_REPAIR', 'Cannot Repair'],
  ['DELIVERED', 'Delivered'],
];

const blankIntake = {
  customerName: '',
  customerPhone: '',
  deviceBrand: '',
  deviceModel: '',
  imeiSerial: '',
  problem: '',
  estimatedCost: 0,
  deposit: 0,
  priority: 'NORMAL',
  intakeCondition: '',
  accessoriesText: '',
  notes: '',
};

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
  return STATUS_OPTIONS.find(([value]) => value === status)?.[1] || String(status || '-').replaceAll('_', ' ');
}

function StatusBadge({ status }) {
  return <span className={`repair-status repair-status-${String(status || '').toLowerCase()}`}>{statusLabel(status)}</span>;
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
  const field = (key, value) => setForm((current) => ({ ...current, [key]: value }));

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
      notify('success', `Repair ID: ${response.repair.repairNumber}`);
      onSaved(response.repair);
    } catch (error) {
      notify('error', error.message || 'Repair intake failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal onClose={onClose} wide>
      <header className="repair-modal-header">
        <div><Plus size={22} /><span><h3>New Repair Intake</h3><p>ဆိုင် Prefix နဲ့ Code ထဲကပုံစံအတိုင်း MS0001 / AC0001 လို Repair ID တစ်ခုပဲ ထုတ်ပါမယ်။</p></span></div>
        <button type="button" onClick={onClose}><X size={20} /></button>
      </header>
      <form className="repair-form" onSubmit={submit}>
        <div className="repair-form-grid">
          <label>Customer Name<input value={form.customerName} onChange={(event) => field('customerName', event.target.value)} required /></label>
          <label>Customer ဖုန်းနံပါတ်<input value={form.customerPhone} onChange={(event) => field('customerPhone', event.target.value)} /></label>
          <label>Device Brand<input value={form.deviceBrand} onChange={(event) => field('deviceBrand', event.target.value)} placeholder="Vivo / Oppo / Redmi" /></label>
          <label>Device Model<input value={form.deviceModel} onChange={(event) => field('deviceModel', event.target.value)} required /></label>
          <label>Estimated Cost<input type="number" min="0" value={form.estimatedCost} onChange={(event) => field('estimatedCost', event.target.value)} /></label>
          <label>Deposit<input type="number" min="0" value={form.deposit} onChange={(event) => field('deposit', event.target.value)} /></label>
          <label className="span-2">Problem<textarea value={form.problem} onChange={(event) => field('problem', event.target.value)} required /></label>
          <button className="span-2" type="button" onClick={() => setShowOptional((value) => !value)}>{showOptional ? 'Optional Details ဖျောက်မည်' : 'Optional Details ဖြည့်မည်'}</button>
          {showOptional ? <>
            <label>IMEI / Serial<input value={form.imeiSerial} onChange={(event) => field('imeiSerial', event.target.value)} placeholder="Device history key" /></label>
            <label>Priority<select value={form.priority} onChange={(event) => field('priority', event.target.value)}><option>NORMAL</option><option>LOW</option><option>HIGH</option><option>URGENT</option></select></label>
            <label className="span-2">Intake Condition<textarea value={form.intakeCondition} onChange={(event) => field('intakeCondition', event.target.value)} placeholder="Screen crack, water mark, body condition..." /></label>
            <label className="span-2">Accessories<input value={form.accessoriesText} onChange={(event) => field('accessoriesText', event.target.value)} placeholder="SIM tray, charger, case (comma separated)" /></label>
            <label className="span-2">Notes<textarea value={form.notes} onChange={(event) => field('notes', event.target.value)} /></label>
          </> : null}
        </div>
        <footer><button type="button" onClick={onClose}>Cancel</button><button className="primary" type="submit" disabled={saving}>{saving ? <Loader2 className="repair-spin" size={18} /> : <Wrench size={18} />} Create Repair</button></footer>
      </form>
    </Modal>
  );
}

function DetailModal({ repairId, onClose, onChanged, notify, maharApiAllowed }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [statusForm, setStatusForm] = useState({ status: 'CHECKING', note: '', diagnosis: '', resolution: '', finalCost: '', warrantyUntil: '' });
  const [maharRepairId, setMaharRepairId] = useState('');
  const [deviceId, setDeviceId] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const response = await apiFetch(`/api/repair-platform/jobs/${encodeURIComponent(repairId)}`);
      setData(response);
      setStatusForm((current) => ({ ...current, status: response.repair.status, finalCost: response.repair.finalCost || '' }));
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
        <div><Smartphone size={22} /><span><h3>{repair.repairNumber}</h3><p>{repair.customerName} · {repair.deviceBrand || ''} {repair.deviceModel}</p></span></div>
        <button type="button" onClick={onClose}><X size={20} /></button>
      </header>
      <div className="repair-detail-body">
        <div className="repair-detail-summary">
          <article><span>Status</span><StatusBadge status={repair.status} /></article>
          <article><span>Source</span><SourceBadge job={repair} /></article>
          <article><span>IMEI / Serial</span><b>{repair.identityMasked || repair.imeiSerial || 'Not linked'}</b></article>
          <article><span>Received</span><b>{formatDate(repair.receivedAt)}</b></article>
          <article><span>Final Cost</span><b>{money(repair.finalCost)}</b></article>
          <article><span>Balance Due</span><b>{money(repair.balanceDue)}</b></article>
        </div>

        <div className="repair-detail-grid">
          <section className="repair-detail-card">
            <h4>Repair Information</h4>
            <dl>
              <div><dt>Repair ID</dt><dd>{repair.repairNumber}</dd></div>
              <div><dt>Customer</dt><dd>{repair.customerName}</dd></div>
              <div><dt>Phone</dt><dd>{repair.customerPhone || '-'}</dd></div>
              <div><dt>Device</dt><dd>{repair.deviceBrand || ''} {repair.deviceModel}</dd></div>
              <div><dt>Problem</dt><dd>{repair.problem}</dd></div>
              <div><dt>Condition</dt><dd>{repair.intakeCondition || '-'}</dd></div>
              <div><dt>Accessories</dt><dd>{repair.accessories?.join(', ') || '-'}</dd></div>
              <div><dt>Diagnosis</dt><dd>{repair.diagnosis || '-'}</dd></div>
              <div><dt>Resolution</dt><dd>{repair.resolution || '-'}</dd></div>
              <div><dt>Technician</dt><dd>{repair.technicianName || repair.technicianUsername || '-'}</dd></div>
            </dl>
          </section>

          <section className="repair-detail-card">
            <h4>Status ပြောင်းရန်</h4>
            <div className="repair-action-form">
              <label>Status ရွေးပါ<select value={statusForm.status} onChange={(event) => setStatusForm({ ...statusForm, status: event.target.value })}>{STATUS_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
              <label>Final Cost<input type="number" min="0" value={statusForm.finalCost} onChange={(event) => setStatusForm({ ...statusForm, finalCost: event.target.value })} /></label>
              <label>Warranty Until<input type="date" value={statusForm.warrantyUntil} onChange={(event) => setStatusForm({ ...statusForm, warrantyUntil: event.target.value })} /></label>
              <label>Diagnosis<textarea value={statusForm.diagnosis} onChange={(event) => setStatusForm({ ...statusForm, diagnosis: event.target.value })} /></label>
              <label>Resolution<textarea value={statusForm.resolution} onChange={(event) => setStatusForm({ ...statusForm, resolution: event.target.value })} /></label>
              <label>Timeline Note<textarea value={statusForm.note} onChange={(event) => setStatusForm({ ...statusForm, note: event.target.value })} /></label>
              <button type="button" className="repair-status-save-button" disabled={saving} onClick={() => run(() => apiFetch(`/api/repair-platform/jobs/${repair.id}/status`, {
                method: 'PATCH',
                body: {
                  ...statusForm,
                  finalCost: statusForm.finalCost === '' ? undefined : Number(statusForm.finalCost),
                  warrantyUntil: statusForm.warrantyUntil || null,
                },
              }), 'Status ပြောင်းပြီးပါပြီ')}><CheckCircle2 size={18} /> Status ပြောင်းရန်</button>
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
            <div className="repair-inline-action"><input value={deviceId} onChange={(event) => setDeviceId(event.target.value)} placeholder="IMEI / Serial" /><button type="button" disabled={saving || deviceId.trim().length < 6} onClick={() => run(() => apiFetch(`/api/repair-platform/jobs/${repair.id}/device`, { method: 'POST', body: { imeiSerial: deviceId.trim(), deviceBrand: repair.deviceBrand, deviceModel: repair.deviceModel } }), 'Device identity linked')}><Fingerprint size={17} /> Link</button></div>
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
      const params = new URLSearchParams({ page: String(page), limit: '20' });
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
    if (!job?.id || !nextStatus || nextStatus === job.status) {
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
      <div className="repair-page-heading">
        <div><span>REPAIR</span><h2>Status ပြောင်းရန်</h2><p>Code ထဲက Repair ID ပုံစံ MS0551၊ AC0001၊ TL0001 အတိုင်း တစ်ခုပဲသုံးပြီး Mahar Shwe API နဲ့ IMEI/Serial History ကိုချိတ်ထားပါတယ်။</p></div>
        <div><button type="button" onClick={load}><RefreshCw size={18} /> Refresh</button><button className="primary" type="button" onClick={() => setShowIntake(true)}><Plus size={18} /> New Repair</button></div>
      </div>

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
            <thead><tr><th>Repair ID</th><th>Customer</th><th>Device</th><th>Problem</th><th>Source</th><th>Status</th><th>Received</th><th>Amount</th></tr></thead>
            <tbody>
              {(data.jobs || []).map((job) => <tr key={job.id} className="repair-click-row" onClick={() => setSelectedId(job.id)}><td><b className="repair-id">{job.repairNumber}</b></td><td><b>{job.customerName}</b><small>{job.customerPhone || '-'}</small></td><td><b>{job.deviceBrand || ''} {job.deviceModel}</b><small>{job.identityMasked || 'No IMEI/Serial'}</small></td><td><span className="repair-problem">{job.problem}</span></td><td><SourceBadge job={job} /></td><td onClick={(event) => event.stopPropagation()}>{quickStatusJobId === job.id ? <select className="repair-status-inline-select" value={job.status} autoFocus disabled={quickStatusSavingId === job.id} onBlur={() => setQuickStatusJobId(null)} onChange={(event) => quickStatusUpdate(job, event.target.value)}>{STATUS_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select> : <button type="button" className="repair-status-click" onClick={() => setQuickStatusJobId(job.id)} disabled={quickStatusSavingId === job.id}>{quickStatusSavingId === job.id ? <Loader2 className="repair-spin" size={15} /> : <StatusBadge status={job.status} />}</button>}</td><td>{formatDate(job.receivedAt)}</td><td><b>{money(job.finalCost || job.estimatedCost)}</b><small>Due {money(job.balanceDue)}</small></td></tr>)}
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
          <header><Fingerprint size={20} /><span><b>Unique Device Repair History</b><small>နိုပ်မှ IMEI / Serial history search form ပေါ်မယ်။</small></span></header>
          <button type="button" onClick={toggleHistoryTool}>{showHistoryTool ? <X size={17} /> : <History size={17} />} {showHistoryTool ? 'Hide History Search' : 'Open History Search'}</button>
        </section>
      </div> : null}

      {showHistoryTool ? <section className="repair-quick-card repair-bottom-history-search">
        <header><Fingerprint size={20} /><span><b>Unique Device Repair History</b><small>IMEI / Serial တစ်ခုနဲ့ ဒီဖုန်း ဘာတွေပြင်ဖူးသလဲ ပြန်လိုက်ပါ။</small></span></header>
        <div><input value={historyIdentifier} onChange={(event) => setHistoryIdentifier(event.target.value)} placeholder="IMEI or Serial Number" onKeyDown={(event) => { if (event.key === 'Enter') searchHistory(); }} /><button type="button" onClick={searchHistory} disabled={historyIdentifier.trim().length < 6}><History size={17} /> History</button></div>
      </section> : null}

      {history?.found ? <section className="repair-device-history-result"><header><Smartphone size={20} /><div><b>{history.device?.brand || ''} {history.device?.model || 'Device'}</b><small>{history.device?.identityType} · {history.device?.identityMasked} · {history.totalRepairs} repair records</small></div><button type="button" onClick={() => setHistory(null)}><X size={18} /></button></header><div>{history.history.map((job) => <button type="button" key={job.id} onClick={() => setSelectedId(job.id)}><span><b>{job.repairNumber}</b><small>{job.problem}</small></span><StatusBadge status={job.status} /><time>{formatDate(job.receivedAt)}</time></button>)}</div></section> : null}

      {showIntake ? <IntakeModal onClose={() => setShowIntake(false)} onSaved={(repair) => { setShowIntake(false); setSelectedId(repair.id); load(); }} notify={notify} /> : null}
      {selectedId ? <DetailModal repairId={selectedId} onClose={() => setSelectedId(null)} onChanged={load} notify={notify} maharApiAllowed={maharApiAllowed} /> : null}
      {toast ? <div className={`repair-toast ${toast.type}`}>{toast.type === 'error' ? <AlertTriangle size={18} /> : <CheckCircle2 size={18} />}{toast.text}</div> : null}
    </section>
  );
}
