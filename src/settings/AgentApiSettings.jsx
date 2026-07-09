import React, { useEffect, useState } from 'react';
import { CheckCircle2, Copy, Loader2, Save, ShieldCheck, Wand2 } from 'lucide-react';
import { apiFetch } from '../phase2Api';

const EMPTY = {
  enabled: false,
  endpointUrl: '',
  timeoutMs: 15000,
  incomingApiKey: '',
};

export default function AgentApiSettings() {
  const [form, setForm] = useState(EMPTY);
  const [meta, setMeta] = useState({ incomingEndpoint: '', sample: null, agent: {} });
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState('');

  const update = (patch) => setForm((current) => ({ ...current, ...patch }));

  const load = async () => {
    setBusy('load');
    try {
      const response = await apiFetch('/api/project-settings/api/agent');
      setMeta(response);
      setForm({
        enabled: Boolean(response.agent?.enabled),
        endpointUrl: response.agent?.endpointUrl || '',
        timeoutMs: response.agent?.timeoutMs || 15000,
        incomingApiKey: '',
      });
      setMessage(response.agent?.hasApiKey ? `Agent key saved · ****${response.agent.apiKeyLast4}` : 'Agent API key မသတ်မှတ်ရသေးပါ။');
    } catch (error) {
      setMessage(error.message || 'Agent API settings load failed');
    } finally {
      setBusy('');
    }
  };

  useEffect(() => { load(); }, []);

  const save = async () => {
    setBusy('save');
    try {
      const body = {
        enabled: form.enabled,
        endpointUrl: form.endpointUrl,
        timeoutMs: Number(form.timeoutMs || 15000),
        ...(form.incomingApiKey.trim() ? { incomingApiKey: form.incomingApiKey.trim() } : {}),
      };
      const response = await apiFetch('/api/project-settings/api/agent', { method: 'PUT', body });
      setMeta((current) => ({ ...current, agent: response.agent }));
      setForm((current) => ({ ...current, incomingApiKey: '' }));
      setMessage(response.message || 'Agent API settings saved');
    } catch (error) {
      setMessage(error.message || 'Agent API settings save failed');
    } finally {
      setBusy('');
    }
  };

  const test = async () => {
    setBusy('test');
    try {
      const response = await apiFetch('/api/project-settings/api/agent/test', { method: 'POST', body: {} });
      setMeta((current) => ({ ...current, agent: response.agent }));
      setMessage(response.test?.message || 'Agent API ready');
    } catch (error) {
      setMessage(error.message || 'Agent API test failed');
    } finally {
      setBusy('');
    }
  };

  const copy = async (value) => {
    try {
      await navigator.clipboard.writeText(value);
      setMessage('Copied');
    } catch {
      setMessage(value);
    }
  };

  const sampleJson = JSON.stringify({
    shopSlug: meta.sample?.body?.shopSlug || 'your-shop-slug',
    records: [
      { type: 'income', date: '2026-07-09', source: 'Daily sales list', amount: 250000, method: 'CASH' },
      { type: 'expense', date: '2026-07-09', category: 'Other Service Expense', amount: 12000, method: 'CASH' },
      { type: 'product', name: 'iPhone Case', variantName: 'Default', sellingPrice: 5000, openingStock: 10 },
    ],
  }, null, 2);

  return (
    <section className="ps-panel">
      <header className="ps-panel-head">
        <div>
          <Wand2 size={21} />
          <span>
            <h3>Agent API</h3>
            <p>Agent / Bot က daily income, expense, product structured JSON ပို့ရင် POS ထဲ auto record ဝင်စေရန်။</p>
          </span>
        </div>
        <button className="ps-icon-button" type="button" onClick={load} disabled={busy === 'load'}>{busy === 'load' ? <Loader2 className="ps-spin" size={18} /> : <CheckCircle2 size={18} />}</button>
      </header>

      {message ? <div className="gs-message"><ShieldCheck size={16} /> {message}</div> : null}

      <div className="ps-form ps-grid-2">
        <label className="ps-switch-row">
          <span><b>Enable Agent API</b><small>OFF ဖြစ်ရင် external agent calls အားလုံး reject လုပ်မယ်။</small></span>
          <input type="checkbox" checked={form.enabled} onChange={(event) => update({ enabled: event.target.checked })} />
        </label>
        <label className="ps-field">
          <span>Incoming API Key</span>
          <input type="password" value={form.incomingApiKey} onChange={(event) => update({ incomingApiKey: event.target.value })} placeholder={meta.agent?.hasApiKey ? `Saved · ****${meta.agent.apiKeyLast4}` : 'အနည်းဆုံး 12 characters'} />
          <small>Bot / Agent က request header `x-agent-api-key` မှာ ဒီ key ထည့်ပို့ရမယ်။ Blank ထားရင် key အဟောင်းမပြောင်းပါ။</small>
        </label>
        <label className="ps-field">
          <span>Agent Parse Endpoint URL (Optional)</span>
          <input value={form.endpointUrl} onChange={(event) => update({ endpointUrl: event.target.value })} placeholder="https://your-agent.example.com/parse" />
          <small>Product photo ကို AI Agent ဘက်မှာ parse လုပ်မယ့် URL. POS import endpoint ကို Agent က structured JSON ပြန်ပို့ပါ။</small>
        </label>
        <label className="ps-field">
          <span>Timeout (ms)</span>
          <input type="number" min="3000" max="60000" value={form.timeoutMs} onChange={(event) => update({ timeoutMs: event.target.value })} />
        </label>
      </div>

      <div className="ps-actions">
        <button className="ps-primary" type="button" onClick={save} disabled={busy === 'save'}>{busy === 'save' ? <Loader2 className="ps-spin" size={18}/> : <Save size={18}/>} Save Agent API</button>
        <button type="button" onClick={test} disabled={busy === 'test'}>{busy === 'test' ? <Loader2 className="ps-spin" size={18}/> : <CheckCircle2 size={18}/>} Test Ready</button>
      </div>

      <div className="gs-code-card">
        <div><b>Agent Import Endpoint</b><button type="button" onClick={() => copy(meta.incomingEndpoint || 'https://api.maharshwe.shop/api/agent/records')}><Copy size={15}/> Copy</button></div>
        <code>{meta.incomingEndpoint || 'https://api.maharshwe.shop/api/agent/records'}</code>
      </div>
      <div className="gs-code-card">
        <div><b>Sample JSON</b><button type="button" onClick={() => copy(sampleJson)}><Copy size={15}/> Copy</button></div>
        <pre>{sampleJson}</pre>
      </div>
    </section>
  );
}
