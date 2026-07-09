import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Copy, Loader2, Save, ShieldCheck, Wand2 } from 'lucide-react';
import { apiFetch } from '../phase2Api';

const EMPTY = {
  enabled: false,
  endpointUrl: '',
  timeoutMs: 15000,
  incomingApiKey: '',
  aiProvider: 'none',
  aiModel: '',
  aiApiKey: '',
};

const DEFAULT_PARSE_TEXT = 'Redmi Note 13 case 10 pcs selling price 5000 cost 3200';

export default function AgentApiSettings() {
  const [form, setForm] = useState(EMPTY);
  const [meta, setMeta] = useState({ incomingEndpoint: '', parseEndpoint: '', sample: null, agent: {} });
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState('');
  const [parseText, setParseText] = useState(DEFAULT_PARSE_TEXT);
  const [parseKind, setParseKind] = useState('product');
  const [parseResult, setParseResult] = useState(null);

  const update = (patch) => setForm((current) => ({ ...current, ...patch }));

  const suggestedModel = useMemo(() => {
    if (form.aiProvider === 'openai') return 'gpt-4.1-mini';
    if (form.aiProvider === 'gemini') return 'gemini-1.5-flash';
    return '';
  }, [form.aiProvider]);

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
        aiProvider: response.agent?.aiProvider || 'none',
        aiModel: response.agent?.aiModel || '',
        aiApiKey: '',
      });
      const keyStatus = response.agent?.hasApiKey ? `Agent key saved · ****${response.agent.apiKeyLast4}` : 'Agent import key မသတ်မှတ်ရသေးပါ။';
      const aiStatus = response.agent?.hasAiKey ? `AI key saved · ****${response.agent.aiKeyLast4}` : 'AI key မသတ်မှတ်ရသေးပါ။';
      setMessage(`${keyStatus} ${aiStatus}`);
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
        aiProvider: form.aiProvider,
        aiModel: form.aiModel || suggestedModel,
        ...(form.incomingApiKey.trim() ? { incomingApiKey: form.incomingApiKey.trim() } : {}),
        ...(form.aiApiKey.trim() ? { aiApiKey: form.aiApiKey.trim() } : {}),
      };
      const response = await apiFetch('/api/project-settings/api/agent', { method: 'PUT', body });
      setMeta((current) => ({ ...current, agent: response.agent }));
      setForm((current) => ({ ...current, incomingApiKey: '', aiApiKey: '' }));
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

  const testParse = async () => {
    setBusy('parse');
    setParseResult(null);
    try {
      const response = await apiFetch('/api/project-settings/api/agent/parse', {
        method: 'POST',
        body: { kind: parseKind, text: parseText },
      });
      setParseResult(response.parsed);
      setMessage('AI parse OK. JSON ကိုစစ်ပြီး /api/agent/records သို့ import လုပ်နိုင်ပါပြီ။');
    } catch (error) {
      setMessage(error.message || 'AI parse failed');
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

  const parseSampleJson = JSON.stringify({
    shopSlug: meta.sample?.body?.shopSlug || 'your-shop-slug',
    kind: 'product',
    text: 'Redmi Note 13 case 10 pcs selling price 5000',
    imageBase64: 'OPTIONAL_BASE64_IMAGE',
    mimeType: 'image/jpeg',
  }, null, 2);

  return (
    <section className="ps-panel">
      <header className="ps-panel-head">
        <div>
          <Wand2 size={21} />
          <span>
            <h3>Agent API / AI Parse</h3>
            <p>Gemini သို့ OpenAI API key ထည့်ပြီး စာ/ဓာတ်ပုံကို POS record JSON အဖြစ် ပြောင်းနိုင်ပါတယ်။ Key များကို server-side မှာပဲ သိမ်းထားပါတယ်။</p>
          </span>
        </div>
        <button className="ps-icon-button" type="button" onClick={load} disabled={busy === 'load'}>
          {busy === 'load' ? <Loader2 className="ps-spin" size={18} /> : <CheckCircle2 size={18} />}
        </button>
      </header>

      {message ? <div className="gs-message"><ShieldCheck size={16} /> {message}</div> : null}

      <div className="ps-form ps-grid-2">
        <label className="ps-switch-row">
          <span><b>Enable Agent Import API</b><small>OFF ဖြစ်ရင် external bot/agent import calls အားလုံး reject လုပ်မယ်။</small></span>
          <input type="checkbox" checked={form.enabled} onChange={(event) => update({ enabled: event.target.checked })} />
        </label>

        <label className="ps-field">
          <span>Incoming Import API Key</span>
          <input type="password" value={form.incomingApiKey} onChange={(event) => update({ incomingApiKey: event.target.value })} placeholder={meta.agent?.hasApiKey ? `Saved · ****${meta.agent.apiKeyLast4}` : 'အနည်းဆုံး 12 characters'} />
          <small>Bot / Agent က `x-agent-api-key` header မှာ ဒီ key ထည့်ပို့ရမယ်။ Blank ထားရင် key အဟောင်းမပြောင်းပါ။</small>
        </label>

        <label className="ps-field">
          <span>AI Provider</span>
          <select value={form.aiProvider} onChange={(event) => update({ aiProvider: event.target.value, aiModel: event.target.value === 'none' ? '' : (form.aiModel || (event.target.value === 'openai' ? 'gpt-4.1-mini' : 'gemini-1.5-flash')) })}>
            <option value="none">None</option>
            <option value="gemini">Gemini</option>
            <option value="openai">OpenAI</option>
          </select>
          <small>ဓာတ်ပုံ/စာသားကို product, income, expense JSON အဖြစ် ပြောင်းရန်သုံးမယ့် AI provider။</small>
        </label>

        <label className="ps-field">
          <span>AI Model</span>
          <input value={form.aiModel} onChange={(event) => update({ aiModel: event.target.value })} placeholder={suggestedModel || 'Select provider first'} disabled={form.aiProvider === 'none'} />
          <small>မဖြည့်ရင် default model သုံးမယ်။ Gemini: gemini-1.5-flash, OpenAI: gpt-4.1-mini</small>
        </label>

        <label className="ps-field">
          <span>Gemini / OpenAI API Key</span>
          <input type="password" value={form.aiApiKey} onChange={(event) => update({ aiApiKey: event.target.value })} placeholder={meta.agent?.hasAiKey ? `Saved · ****${meta.agent.aiKeyLast4}` : 'Paste Gemini/OpenAI API key'} disabled={form.aiProvider === 'none'} />
          <small>Write-only ဖြစ်ပါတယ်။ Browser ထဲကို key ပြန်မပို့ပါ။ Blank ထားရင် key အဟောင်းမပြောင်းပါ။</small>
        </label>

        <label className="ps-field">
          <span>External Agent Parse Endpoint URL (Optional)</span>
          <input value={form.endpointUrl} onChange={(event) => update({ endpointUrl: event.target.value })} placeholder="https://your-agent.example.com/parse" />
          <small>အပြင် bot/agent service ရှိရင် reference အနေနဲ့သိမ်းထားနိုင်ပါတယ်။ POS built-in AI parse က provider key ကို server-side ကနေခေါ်ပါတယ်။</small>
        </label>

        <label className="ps-field">
          <span>Timeout (ms)</span>
          <input type="number" min="3000" max="60000" value={form.timeoutMs} onChange={(event) => update({ timeoutMs: event.target.value })} />
        </label>
      </div>

      <div className="ps-actions">
        <button className="ps-primary" type="button" onClick={save} disabled={busy === 'save'}>
          {busy === 'save' ? <Loader2 className="ps-spin" size={18}/> : <Save size={18}/>} Save Agent / AI
        </button>
        <button type="button" onClick={test} disabled={busy === 'test'}>
          {busy === 'test' ? <Loader2 className="ps-spin" size={18}/> : <CheckCircle2 size={18}/>} Test Import Ready
        </button>
      </div>

      <div className="ps-form">
        <label className="ps-field">
          <span>Test AI Parse</span>
          <textarea rows={3} value={parseText} onChange={(event) => setParseText(event.target.value)} placeholder="ဥပမာ - Redmi Note 13 case 10 pcs selling price 5000" />
        </label>
        <div className="ps-actions">
          <select value={parseKind} onChange={(event) => setParseKind(event.target.value)}>
            <option value="product">Product</option>
            <option value="ledger">Income / Expense</option>
          </select>
          <button type="button" onClick={testParse} disabled={busy === 'parse' || form.aiProvider === 'none'}>
            {busy === 'parse' ? <Loader2 className="ps-spin" size={18}/> : <Wand2 size={18}/>} Test AI Parse
          </button>
        </div>
        {parseResult ? <pre className="gs-code-block">{JSON.stringify(parseResult, null, 2)}</pre> : null}
      </div>

      <div className="gs-code-card">
        <div><b>Agent Import Endpoint</b><button type="button" onClick={() => copy(meta.incomingEndpoint || 'https://api.maharshwe.shop/api/agent/records')}><Copy size={15}/> Copy</button></div>
        <code>{meta.incomingEndpoint || 'https://api.maharshwe.shop/api/agent/records'}</code>
      </div>
      <div className="gs-code-card">
        <div><b>AI Parse Endpoint</b><button type="button" onClick={() => copy(meta.parseEndpoint || 'https://api.maharshwe.shop/api/project-settings/api/agent/parse')}><Copy size={15}/> Copy</button></div>
        <code>{meta.parseEndpoint || 'https://api.maharshwe.shop/api/project-settings/api/agent/parse'}</code>
      </div>
      <div className="gs-code-card">
        <div><b>Parse Sample JSON</b><button type="button" onClick={() => copy(parseSampleJson)}><Copy size={15}/> Copy</button></div>
        <pre>{parseSampleJson}</pre>
      </div>
      <div className="gs-code-card">
        <div><b>Import Sample JSON</b><button type="button" onClick={() => copy(sampleJson)}><Copy size={15}/> Copy</button></div>
        <pre>{sampleJson}</pre>
      </div>
    </section>
  );
}
