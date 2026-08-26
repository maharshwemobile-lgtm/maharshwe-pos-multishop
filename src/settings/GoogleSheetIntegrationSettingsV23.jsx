import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Code2, Copy, Globe2, Loader2, RefreshCw, Save, Send, ShieldCheck } from 'lucide-react';
import { apiFetch, getSession } from '../phase2Api';
import GOOGLE_APPS_SCRIPT from '../../integrations/google-apps-script/MaharShwePosSync.gs?raw';
import PULL_SYNC_SCRIPT from '../../integrations/google-apps-script/MaharPosGSheetPullSync.gs?raw';
import './project-operations-v23.css';
import { APP_URL } from '../projectBrand';

const EMPTY = {
  enabled: false,
  postUrl: '',
  getUrl: '',
  secret: '',
  timeoutMs: 10000,
  repairSheetTab: '',
  secretConfigured: false,
  secretMasked: '',
};

function randomSecret() {
  if (window.crypto?.getRandomValues) {
    const bytes = new Uint8Array(24);
    window.crypto.getRandomValues(bytes);
    const value = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
    return `msp_${value}_${Date.now().toString(36)}`;
  }
  return `msp_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`;
}

async function copyText(value) {
  const text = String(value || '');
  if (!text.trim()) return false;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const copied = document.execCommand('copy');
    area.remove();
    return copied;
  }
}

function CopyBox({ label, value, buttonLabel = 'Copy', onCopy }) {
  return <article className="project-google-copy-box">
    <span>{label}</span>
    <code>{value}</code>
    <button type="button" onClick={() => onCopy(value, `${label} copied`)}><Copy size={15}/> {buttonLabel}</button>
  </article>;
}

export default function GoogleSheetIntegrationSettingsV23() {
  const session = getSession();
  const canManage = ['SUPER_ADMIN', 'SHOP_ADMIN'].includes(session?.user?.role || '') || session?.user?.permissions?.settings === true;
  const fallbackShopSlug = session?.user?.shopSlug || session?.user?.tenantId || '';
  const appBaseUrl = APP_URL;
  const [form, setForm] = useState(EMPTY);
  const [counts, setCounts] = useState({});
  const [tabs, setTabs] = useState([]);
  const [shop, setShop] = useState({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState('');
  const [message, setMessage] = useState('');
  const effectiveShopSlug = shop?.slug || shop?.shopSlug || fallbackShopSlug || '';

  const repairPrefix = shop?.repairPrefix || shop?.business?.repairPrefix || '';
  const configuredAppsScript = useMemo(() => GOOGLE_APPS_SCRIPT
    .replace('__POS_BASE_URL__', appBaseUrl)
    .replace('__POS_SHOP_SLUG__', effectiveShopSlug || 'YOUR_SHOP_SLUG')
    .replace('__POS_REPAIR_PREFIX__', repairPrefix || 'RP')
    .replace('__POS_SYNC_SECRET__', form.secret || 'SYNC_SECRET_WILL_APPEAR_HERE'), [appBaseUrl, effectiveShopSlug, repairPrefix, form.secret]);

  const configuredPullScript = useMemo(() => PULL_SYNC_SCRIPT
    .replace('__POS_BASE_URL__', appBaseUrl)
    .replace('__POS_PULL_KEY__', form.secret || 'SYNC_SECRET_WILL_APPEAR_HERE'), [appBaseUrl, form.secret]);

  const load = async () => {
    setLoading(true);
    try {
      const response = await apiFetch('/api/project-settings/integrations/google-sheet');
      setForm((current) => {
        const incoming = { ...EMPTY, ...(response.config || {}) };
        const nextSecret = incoming.secret || current.secret || randomSecret();
        return { ...incoming, secret: nextSecret, getUrl: incoming.getUrl || incoming.postUrl || '' };
      });
      setCounts(response.counts || {});
      setTabs(response.tabs || []);
      setShop(response.shop || {});
    } catch (error) {
      setMessage(error.message || 'Google Sheet integration load failed');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const update = (patch) => setForm((current) => ({ ...current, ...patch }));

  const notifyCopy = async (value, successMessage = 'Copied') => {
    const copied = await copyText(value);
    setMessage(copied ? successMessage : 'Copy failed. Please select and copy manually.');
  };

  const save = async (event) => {
    event.preventDefault();
    setSaving(true);
    setMessage('');
    try {
      const response = await apiFetch('/api/project-settings/integrations/google-sheet', {
        method: 'PUT',
        body: {
          enabled: form.enabled,
          postUrl: form.postUrl,
          getUrl: form.postUrl,
          secret: form.secret,
          timeoutMs: Number(form.timeoutMs || 10000),
          repairSheetTab: form.repairSheetTab || '',
        },
      });
      setForm((current) => ({ ...current, ...(response.config || {}), secret: response.config?.secret || current.secret, getUrl: response.config?.postUrl || current.postUrl }));
      setMessage(response.message || 'Google Sheet integration saved');
      await load();
    } catch (error) {
      setMessage(error.message || 'Google Sheet integration save failed');
    } finally {
      setSaving(false);
    }
  };

  const test = async (method) => {
    setTesting(method);
    setMessage('');
    try {
      const response = await apiFetch('/api/project-settings/integrations/google-sheet/test', { method: 'POST', body: { method } });
      setMessage(response.ok ? `${method} connection successful` : `${method} connection failed`);
      await load();
    } catch (error) {
      setMessage(error.message || `${method} test failed`);
      await load();
    } finally {
      setTesting('');
    }
  };

  const retry = async () => {
    setTesting('RETRY');
    setMessage('');
    try {
      const response = await apiFetch('/api/project-settings/integrations/google-sheet/retry', { method: 'POST', body: {} });
      setMessage(`Checked ${response.checked || 0}, sent ${response.sent || 0}`);
      await load();
    } catch (error) {
      setMessage(error.message || 'Retry failed');
    } finally {
      setTesting('');
    }
  };

  if (!canManage) return null;

  return <section className="project-operations-card">
    <header>
      <div>
        <Globe2 size={23}/>
        <span>
          <b>Google Sheet Configure</b>
          <small>Apps Script Code တစ်ခုပဲ Copy လုပ်ပါ။ Web App URL တစ်ခုပဲ paste လုပ်ရုံနဲ့ ချိတ်နိုင်ပါတယ်။</small>
        </span>
      </div>
      {loading ? <Loader2 className="project-operations-spin" size={20}/> : <ShieldCheck size={20}/>}
    </header>

    {message ? <div className="project-operations-message">{message}</div> : null}

    <div className="project-google-guide">
      <div>
        <b>Setup (တစ်ကြိမ်ပဲ လုပ်ဖို့လို)</b>
        <ol>
          <li>Google Sheet ဖွင့် → Extensions → Apps Script ဝင်ပါ။</li>
          <li><b>Copy Apps Script Code</b> → Apps Script ထဲ paste → <b>Deploy → Web App → Anyone</b> → Web App URL ကို မှတ်ပါ။</li>
          <li>Apps Script → <b>Project Settings → Script Properties → Add property</b>:<br/><code>POS_SYNC_SECRET</code> = အောက်က Shared Secret ကို copy ပြီး paste ပါ။</li>
          <li>Web App URL ကို ဒီမှာ paste → Enable → <b>Save → Test POST</b> နှိပ်ပါ။</li>
        </ol>
        <p style={{ marginTop: 6, fontSize: 12, opacity: 0.7 }}>
          ✅ Script Properties မှာ Secret ထည့်ပြီးရင် Apps Script ကို re-deploy မလုပ်ရတော့ပါ — Secret ပြောင်းရင် Properties ထဲမှာပဲ ပြောင်းရင် ရပြီ။
        </p>
      </div>

      <div className="project-google-guide-actions">
        <button type="button" onClick={() => notifyCopy(configuredAppsScript, 'Apps Script code copied')}><Code2 size={16}/> Copy Apps Script Code</button>
        <button type="button" onClick={() => notifyCopy(configuredPullScript, 'Pull Sync Script copied')}><Code2 size={16}/> Copy Pull Sync Script</button>
      </div>
    </div>

    <div className="project-google-copy-grid">
      <CopyBox label="Shop Slug" value={effectiveShopSlug || 'YOUR_SHOP_SLUG'} onCopy={notifyCopy}/>
      {form.secret ? <CopyBox label="Shared Secret → Script Properties: POS_SYNC_SECRET" value={form.secret} buttonLabel="Copy Secret" onCopy={notifyCopy}/> : null}
      {form.secretFingerprint ? <article className="project-google-copy-box">
        <span>Secret Fingerprint</span>
        <code>{form.secretFingerprint}</code>
        <small style={{ opacity: 0.7 }}>
          Apps Script URL ကို browser မှာ ဖွင့်ကြည့်ပါ။ <b>secretFingerprint</b> က ဒီအတိုင်း တူမှ
          POS_SYNC_SECRET မှန်ပါတယ်။ မတူရင် Copy Secret နဲ့ ပြန်ကူးပြီး Script Properties မှာ ပြန်ထည့်ပါ။
        </small>
      </article> : null}
    </div>

    <form className="project-google-form" onSubmit={save}>
      <label className="project-google-toggle">
        <span>
          <b>Enable Google Sheet Live Sync</b>
          <small>Sale, Money Service, Income, Expense, Stock, Repair Records and Audit events are sent automatically.</small>
        </span>
        <input type="checkbox" checked={form.enabled} onChange={(event) => update({ enabled: event.target.checked })}/>
      </label>

      <label>
        <span>Google Apps Script Web App URL</span>
        <input type="url" value={form.postUrl || ''} onChange={(event) => update({ postUrl: event.target.value, getUrl: event.target.value })} placeholder="https://script.google.com/macros/s/.../exec"/>
      </label>

      <label>
        <span>ဖုန်းပြင် စာရင်း Sheet Tab</span>
        <input
          type="text"
          value={form.repairSheetTab || ''}
          onChange={(event) => update({ repairSheetTab: event.target.value })}
          placeholder={shop?.name || 'Sheet tab name'}
        />
        <small style={{ opacity: 0.7 }}>
          ဘောက်ချာ print လုပ်တိုင်း ဒီ tab ထဲကို row အသစ်တစ်ကြောင်း ရေးပါမယ်။
          ဗလာထားရင် ဆိုင်နာမည် ({shop?.name || '-'}) နဲ့ တူတဲ့ tab ကို ရှာပါမယ်။
          {repairPrefix ? ` ဘောက်ချာနံပါတ် prefix — ${repairPrefix}` : ''}
        </small>
      </label>

      <label>
        <span>Timeout (milliseconds)</span>
        <input type="number" min="1000" max="60000" value={form.timeoutMs || 10000} onChange={(event) => update({ timeoutMs: Number(event.target.value) })}/>
      </label>

      <div className="project-google-status">
        <div><CheckCircle2 size={18}/><span><small>Apps Script</small><b>{form.secret ? 'Ready' : 'Preparing'}</b></span></div>
        <div><Send size={18}/><span><small>Pending</small><b>{counts.PENDING || 0}</b></span></div>
        <div><RefreshCw size={18}/><span><small>Failed</small><b>{counts.FAILED || 0}</b></span></div>
      </div>

      <div className="project-google-tabs"><b>Synced Tabs</b><div>{tabs.map((tab) => <span key={tab}>{tab}</span>)}</div></div>

      {form.lastTest ? <div className={`project-google-test-result ${form.lastTest.ok ? 'good' : 'bad'}`}><b>{form.lastTest.method} · HTTP {form.lastTest.status || 0}</b><span>{form.lastTest.ok ? 'Connection successful' : 'Connection failed'}</span><small>{form.lastTest.testedAt}</small><pre>{form.lastTest.responsePreview || '-'}</pre></div> : null}

      <div className="project-google-actions">
        <button className="primary" disabled={saving}>{saving ? <Loader2 className="project-operations-spin" size={17}/> : <Save size={17}/>} Save Integration</button>
        <button type="button" onClick={() => test('POST')} disabled={Boolean(testing)}>{testing === 'POST' ? <Loader2 className="project-operations-spin" size={17}/> : <Send size={17}/>} Test POST</button>
        <button type="button" onClick={() => test('GET')} disabled={Boolean(testing)}>{testing === 'GET' ? <Loader2 className="project-operations-spin" size={17}/> : <RefreshCw size={17}/>} Test GET</button>
        <button type="button" onClick={retry} disabled={Boolean(testing)}>{testing === 'RETRY' ? <Loader2 className="project-operations-spin" size={17}/> : <RefreshCw size={17}/>} Retry Pending</button>
      </div>
    </form>
  </section>;
}
