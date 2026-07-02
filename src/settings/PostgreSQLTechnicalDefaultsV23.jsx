import React, { useEffect, useState } from 'react';
import { Loader2, Save, Settings2 } from 'lucide-react';
import { apiFetch } from '../phase2Api';

const EMPTY = { defaultPageSize: 20, sessionTimeoutMinutes: 720, maintenanceMode: false, timezone: 'Asia/Yangon' };

export default function PostgreSQLTechnicalDefaultsV23({ initial, canManage, onSaved }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ ...EMPTY, ...(initial || {}) });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => setForm({ ...EMPTY, ...(initial || {}) }), [initial]);

  const save = async (event) => {
    event.preventDefault();
    setSaving(true);
    setMessage('');
    try {
      await apiFetch('/api/project-settings/postgresql/system', {
        method: 'PUT',
        body: {
          defaultPageSize: Number(form.defaultPageSize || 20),
          sessionTimeoutMinutes: Number(form.sessionTimeoutMinutes || 720),
          maintenanceMode: Boolean(form.maintenanceMode),
          timezone: form.timezone || 'Asia/Yangon',
        },
      });
      setMessage('Technical defaults saved');
      setOpen(false);
      await onSaved?.();
    } catch (error) {
      setMessage(error?.message || 'Technical defaults save failed');
    } finally {
      setSaving(false);
    }
  };

  return <section className={`postgresql-technical-card ${open ? 'open' : ''}`}>
    <button type="button" className="postgresql-technical-toggle" onClick={() => setOpen((value) => !value)}>
      <span><Settings2 size={19}/><span><b>Technical Defaults</b><small>Session, timezone, page size နဲ့ maintenance mode</small></span></span>
      <strong>{open ? '−' : '+'}</strong>
    </button>
    {message ? <div className="postgresql-hub-message">{message}</div> : null}
    {open ? <form onSubmit={save} className="postgresql-technical-form">
      <label><span>Default Page Size</span><select value={form.defaultPageSize} onChange={(event) => setForm({ ...form, defaultPageSize: Number(event.target.value) })} disabled={!canManage}>{[10,20,50,100].map((item) => <option key={item}>{item}</option>)}</select></label>
      <label><span>Session Timeout (minutes)</span><input type="number" min="15" max="1440" value={form.sessionTimeoutMinutes} onChange={(event) => setForm({ ...form, sessionTimeoutMinutes: Number(event.target.value) })} disabled={!canManage}/></label>
      <label><span>Timezone</span><input value={form.timezone} onChange={(event) => setForm({ ...form, timezone: event.target.value })} disabled={!canManage}/></label>
      <label className="postgresql-maintenance-toggle"><span><b>Maintenance Mode</b><small>Normal user writes ကိုယာယီပိတ်ရန်</small></span><input type="checkbox" checked={Boolean(form.maintenanceMode)} onChange={(event) => setForm({ ...form, maintenanceMode: event.target.checked })} disabled={!canManage}/></label>
      <button className="postgresql-technical-save" disabled={!canManage || saving}>{saving ? <Loader2 className="postgresql-hub-spin" size={17}/> : <Save size={17}/>} Save Technical Defaults</button>
    </form> : null}
  </section>;
}
