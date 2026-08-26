import React, { useEffect, useMemo, useState } from 'react';
import { Code2, Globe2, Loader2, Save, Send, ShieldCheck } from 'lucide-react';
import { apiFetch, getSession } from '../phase2Api';
import './project-operations-v23.css';
import { APP_URL } from '../projectBrand';

const EMPTY = {
  enabled: false,
  postUrl: '',
  getUrl: '',
  secret: '',
  timeoutMs: 10000,
  repairSheetTab: '',
  sheetId: '',
  availableTabs: [],
  scriptVersion: '',
  registeredAt: null,
  secretConfigured: false,
  secretMasked: '',
};

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
  const [diagnosis, setDiagnosis] = useState(null);
  const effectiveShopSlug = shop?.slug || shop?.shopSlug || fallbackShopSlug || '';

  const repairPrefix = shop?.repairPrefix || shop?.business?.repairPrefix || '';
  const copyScript = async () => {
    setTesting('COPY');
    try {
      const response = await apiFetch('/api/project-settings/integrations/google-sheet/script');
      if (!response.ready) {
        setMessage(response.message || 'Google Sheet link ကို အရင် ထည့်ပါ။');
        return;
      }
      const copied = await copyText(response.code);
      setMessage(copied ? 'Script code ကူးပြီးပါပြီ — Apps Script ထဲ paste လုပ်ပါ။' : 'ကူးလို့ မရပါ။');
    } catch (error) {
      setMessage(error.message || 'Script ကူး၍ မရပါ');
    } finally {
      setTesting('');
    }
  };

  const load = async () => {
    setLoading(true);
    try {
      const response = await apiFetch('/api/project-settings/integrations/google-sheet');
      // Whatever the server holds, and nothing else. Showing a secret it does
      // not have is how the shop ends up pasting one that never matches.
      setForm((current) => {
        const incoming = { ...EMPTY, ...(response.config || {}) };
        return { ...incoming, getUrl: incoming.getUrl || incoming.postUrl || '' };
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
          sheetId: form.sheetId || '',
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

  const diagnose = async () => {
    setTesting('CHECK');
    setMessage('');
    try {
      const response = await apiFetch('/api/project-settings/integrations/google-sheet/diagnose', { method: 'POST', body: {} });
      setDiagnosis(response);
    } catch (error) {
      setMessage(error.message || 'စစ်ဆေးမှု မအောင်မြင်ပါ');
    } finally {
      setTesting('');
    }
  };

  if (!canManage) return null;

  const CHECK_LABELS = {
    sheet: 'Google Sheet link ထည့်ပြီး',
    url: 'Web App URL ထည့်ပြီး',
    enabled: 'Live Sync ဖွင့်ထား',
    tab: 'ဖုန်းပြင် စာရင်း tab သတ်မှတ်ပြီး',
    reach: 'Apps Script က ပြန်ဖြေတယ်',
    secret: 'Secret နှစ်ဖက် ကိုက်ညီ',
    version: 'Script code အသစ်',
  };
  const allGood = Boolean(diagnosis?.checks?.length) && diagnosis.checks.every((check) => check.ok);

  return <section className="project-operations-card gsheet-card">
    <header className="gsheet-head">
      <div>
        <h3><Globe2 size={18}/> Google Sheet ချိတ်ဆက်ခြင်း</h3>
        <p>ဖုန်းပြင် ဘောက်ချာနဲ့ ရောင်းအား မှတ်တမ်းတွေကို ဆိုင်ရဲ့ Google Sheet ထဲ တိုက်ရိုက် ရေးပါတယ်။</p>
      </div>
      <span className={`gsheet-pill ${allGood ? 'good' : diagnosis ? 'bad' : ''}`}>
        {allGood ? '✅ ချိတ်ပြီး' : diagnosis ? '⚠️ ပြင်စရာ ရှိတယ်' : '— မစစ်ရသေး'}
      </span>
    </header>

    {/* The setup used to be checked by opening a URL in another tab and
        comparing a hash by eye. Every failure so far was one of these lines. */}
    <div className="gsheet-check">
      <div className="gsheet-check-top">
        <b>အခြေအနေ စစ်ဆေးရန်</b>
        <button type="button" onClick={diagnose} disabled={Boolean(testing)}>
          {testing === 'CHECK' ? <Loader2 className="project-operations-spin" size={16}/> : <ShieldCheck size={16}/>} စစ်ဆေးမည်
        </button>
      </div>
      {diagnosis ? (
        <ul className="gsheet-check-list">
          {diagnosis.checks.map((check) => (
            <li key={check.key} className={check.ok ? 'ok' : 'no'}>
              <span>{check.ok ? '✅' : '❌'}</span>
              <b>{CHECK_LABELS[check.key] || check.key}</b>
              {check.detail ? <small>{check.detail}</small> : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="gsheet-hint">စစ်ဆေးမည် နှိပ်လိုက်ရင် ဘာလိုသေးလဲ တစ်ခုချင်း ပြပါမယ်။</p>
      )}
    </div>

    <form className="gsheet-form" onSubmit={save}>
      <div className="gsheet-grid">
        <label className="span-2">
          <span>Google Sheet link</span>
          <input type="text" value={form.sheetId || ''} placeholder="https://docs.google.com/spreadsheets/d/..."
            onChange={(event) => update({ sheetId: event.target.value })}/>
          <small>ဖြည့်ရမှာ ဒီတစ်ကွက်ပဲ ရှိပါတယ်။ ကျန်တာ script က ကိုယ်တိုင် ပို့ပေးပါမယ်။</small>
        </label>

        <label>
          <span>ဖုန်းပြင် စာရင်း tab</span>
          {form.availableTabs?.length ? (
            <select value={form.repairSheetTab || ''} onChange={(event) => update({ repairSheetTab: event.target.value })}>
              <option value="">— ရွေးပါ —</option>
              {form.availableTabs.map((tab) => <option key={tab} value={tab}>{tab}</option>)}
            </select>
          ) : (
            <input type="text" value={form.repairSheetTab || ''} placeholder={shop?.name || 'ချိတ်ပြီးရင် ရွေးလို့ရပါမယ်'}
              onChange={(event) => update({ repairSheetTab: event.target.value })}/>
          )}
          <small>ဘောက်ချာနံပါတ် prefix — <b>{repairPrefix || 'RP'}</b></small>
        </label>

        <label>
          <span>Apps Script</span>
          <input type="text" readOnly value={form.postUrl ? `ချိတ်ပြီး · ${form.scriptVersion || ''}` : 'မချိတ်ရသေးပါ'}/>
          <small>{form.postUrl ? 'Script က ကိုယ်တိုင် ချိတ်သွားတာပါ။' : 'အောက်က ၂ ဆင့် လုပ်ပြီးရင် အလိုအလျောက် ဝင်လာပါမယ်။'}</small>
        </label>
      </div>

      <label className="gsheet-toggle">
        <span>
          <b>Live Sync ဖွင့်မည်</b>
          <small>ဘောက်ချာ၊ ရောင်းအား၊ ဝင်ငွေ၊ အသုံးစရိတ်၊ ကုန်ပစ္စည်း — အလိုအလျောက် ပို့ပါမယ်။</small>
        </span>
        <input type="checkbox" checked={form.enabled} onChange={(event) => update({ enabled: event.target.checked })}/>
      </label>

      <div className="gsheet-actions">
        <button className="primary" disabled={saving}>{saving ? <Loader2 className="project-operations-spin" size={17}/> : <Save size={17}/>} သိမ်းမည်</button>
        <button type="button" onClick={() => test('POST')} disabled={Boolean(testing)}>{testing === 'POST' ? <Loader2 className="project-operations-spin" size={17}/> : <Send size={17}/>} စမ်းပို့ကြည့်မည်</button>
      </div>
    </form>

    <details className="gsheet-steps" open={!allGood}>
      <summary>ချိတ်ဆက်နည်း — ၄ ဆင့်</summary>
      <ol>
        <li>အပေါ်က <b>Google Sheet link</b> ထည့် → <b>Save</b></li>
        <li>
          <a href="https://script.google.com/home/projects/create" target="_blank" rel="noreferrer">script.google.com</a> →
          <b> New project</b> → အောက်က ခလုတ်နဲ့ ကူးပြီး အထဲမှာ paste → 💾 Save
          <div className="gsheet-copy-row">
            <button type="button" className="primary" onClick={copyScript} disabled={Boolean(testing)}>
              {testing === 'COPY' ? <Loader2 className="project-operations-spin" size={16}/> : <Code2 size={16}/>} Script Code ကူးမည်
            </button>
          </div>
        </li>
        <li><b>Deploy → New deployment → Web app</b> · Execute as <b>Me</b> · Access <b>Anyone</b> → Deploy</li>
        <li>function စာရင်းက <b>ချိတ်မည်</b> ရွေး → <b>▶ Run</b> → ခွင့်ပြုချက် တောင်းရင် <i>Advanced → Go to … → Allow</i></li>
      </ol>
      <p className="gsheet-warn">
        Sheet မှာ Apps Script <b>ရှိပြီးသားဆိုရင်</b> (ဥပမာ Telegram bot) အဲဒီထဲ <b>မထည့်ပါနဲ့</b> —
        project အသစ် ဆောက်ပါ။
      </p>
      <p className="gsheet-hint">
        Code ပြန်ကူးထည့်တိုင်း <b>Deploy → Manage deployments → ✏️ → New version</b> လုပ်ပါ။
      </p>
    </details>

    {counts.PENDING || counts.FAILED ? (
      <div className="gsheet-foot">
        {counts.PENDING ? <span>ပို့ရန် ကျန် <b>{counts.PENDING}</b></span> : null}
        {counts.FAILED ? <span>မအောင်မြင် <b>{counts.FAILED}</b></span> : null}
        <button type="button" onClick={retry} disabled={Boolean(testing)}>ပြန်ပို့</button>
      </div>
    ) : null}

    {message ? <div className="project-google-message">{message}</div> : null}
    {loading ? <div className="project-google-message"><Loader2 className="project-operations-spin" size={15}/> ဖတ်နေပါသည်…</div> : null}
  </section>;
}
