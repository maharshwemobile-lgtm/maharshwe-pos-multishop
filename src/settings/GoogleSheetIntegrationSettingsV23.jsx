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
  sheetId: '',
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
  const [diagnosis, setDiagnosis] = useState(null);
  const effectiveShopSlug = shop?.slug || shop?.shopSlug || fallbackShopSlug || '';

  const repairPrefix = shop?.repairPrefix || shop?.business?.repairPrefix || '';
  const configuredAppsScript = useMemo(() => GOOGLE_APPS_SCRIPT
    .replace('__POS_BASE_URL__', appBaseUrl)
    .replace('__POS_SHOP_SLUG__', effectiveShopSlug || 'YOUR_SHOP_SLUG')
    .replace('__POS_REPAIR_PREFIX__', repairPrefix || 'RP')
    .replace('__POS_SHEET_ID__', form.sheetId || 'PASTE_YOUR_SHEET_URL_HERE')
    .replace('__POS_SYNC_SECRET__', form.secret || 'SYNC_SECRET_WILL_APPEAR_HERE'), [appBaseUrl, effectiveShopSlug, repairPrefix, form.sheetId, form.secret]);

  const configuredPullScript = useMemo(() => PULL_SYNC_SCRIPT
    .replace('__POS_BASE_URL__', appBaseUrl)
    .replace('__POS_PULL_KEY__', form.secret || 'SYNC_SECRET_WILL_APPEAR_HERE'), [appBaseUrl, form.secret]);

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
        <label>
          <span>၁။ Google Sheet link</span>
          <input type="text" value={form.sheetId || ''} placeholder="https://docs.google.com/spreadsheets/d/..."
            onChange={(event) => update({ sheetId: event.target.value })}/>
          <small>ဆိုင်ရဲ့ sheet ကို ဖွင့်ပြီး လိပ်စာကို ကူးထည့်ပါ။</small>
        </label>

        <label>
          <span>၂။ ဖုန်းပြင် စာရင်း tab နာမည်</span>
          <input type="text" value={form.repairSheetTab || ''} placeholder={shop?.name || 'tab နာမည်'}
            onChange={(event) => update({ repairSheetTab: event.target.value })}/>
          <small>ဘောက်ချာတွေ ရေးမယ့် tab။ ဘောက်ချာနံပါတ် prefix — <b>{repairPrefix || 'RP'}</b></small>
        </label>

        <label className="span-2">
          <span>၃။ Apps Script Web App URL</span>
          <input type="url" value={form.postUrl || ''} placeholder="https://script.google.com/macros/s/.../exec"
            onChange={(event) => update({ postUrl: event.target.value, getUrl: event.target.value })}/>
          <small>အောက်က အဆင့်တွေ လုပ်ပြီးမှ ရလာမယ့် URL ပါ။</small>
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
        <button type="button" onClick={retry} disabled={Boolean(testing)}>{testing === 'RETRY' ? <Loader2 className="project-operations-spin" size={17}/> : <RefreshCw size={17}/>} ကျန်နေတာ ပြန်ပို့</button>
      </div>
    </form>

    <div className="gsheet-copy">
      <button type="button" className="primary" onClick={() => notifyCopy(configuredAppsScript, 'Script code ကူးပြီးပါပြီ')}>
        <Code2 size={17}/> Script Code ကူးမည်
      </button>
      {form.secret
        ? <CopyBox label="Secret — Script Properties ထဲ POS_SYNC_SECRET" value={form.secret} buttonLabel="Secret ကူးမည်" onCopy={notifyCopy}/>
        : <article className="project-google-copy-box"><span>Secret</span><code>ပြင်ဆင်နေပါသည် — စာမျက်နှာ refresh လုပ်ပါ</code></article>}
    </div>

    <details className="gsheet-steps">
      <summary>ချိတ်ဆက်နည်း — တစ်ကြိမ်ပဲ လုပ်ရပါမယ်</summary>
      <p className="gsheet-warn">
        Sheet မှာ Apps Script တစ်ခု <b>ရှိပြီးသားဆိုရင်</b> (ဥပမာ Telegram bot) အဲဒီ script ထဲ
        <b> လုံးဝ မထည့်ပါနဲ့</b> — <code>doPost</code> ချင်း ထပ်ပြီး တစ်ခုက ရပ်သွားပါမယ်။
        အောက်က အဆင့်တွေက <b>သီးခြား project အသစ်</b> ဆောက်တာမို့ ရှိပြီးသား script ကို မထိပါဘူး။
      </p>
      <ol>
        <li>အပေါ်က <b>Google Sheet link</b> ထည့် → <b>သိမ်းမည်</b></li>
        <li><a href="https://script.google.com/home/projects/create" target="_blank" rel="noreferrer">script.google.com</a> → <b>New project</b></li>
        <li><b>Script Code ကူးမည်</b> → project အသစ်ထဲ အကုန်ဖျက်ပြီး paste → 💾 Save</li>
        <li>⚙️ <b>Project Settings → Script properties → Add script property</b><br/>
          <code>POS_SYNC_SECRET</code> = <b>Secret ကူးမည်</b> နဲ့ ကူးထားတာ → Save script properties</li>
        <li><b>Deploy → New deployment → Web app</b> · Execute as: <b>Me</b> · Access: <b>Anyone</b> → Deploy</li>
        <li>ရလာတဲ့ <b>/exec URL</b> ကို အပေါ်မှာ ထည့် → Live Sync ဖွင့် → <b>သိမ်းမည်</b> → <b>စစ်ဆေးမည်</b></li>
        <li>Apps Script → ⏰ <b>Triggers → Add trigger</b> · <code>pushRepairEditsToPos</code> · From spreadsheet · <b>On edit</b></li>
      </ol>
      <p className="gsheet-hint">
        Code ပြောင်းတိုင်း <b>Deploy → Manage deployments → ✏️ → New version</b> လုပ်မှ အလုပ်လုပ်ပါမယ်။
        Secret ပြောင်းရင်တော့ Script Properties ထဲမှာပဲ ပြောင်းရင် ရပါတယ်။
      </p>
    </details>

    <details className="gsheet-steps">
      <summary>ဘယ်ဟာက ဘယ်ဘက်ကို သွားလဲ</summary>
      <ul>
        <li>POS မှာ ဘောက်ချာ print → Sheet မှာ အတန်းအသစ်</li>
        <li>POS မှာ status ပြောင်း / ဖျက် → Sheet မှာ လိုက်ပြောင်း / လိုက်ပျက်</li>
        <li>Sheet မှာ အတန်းအသစ် ထည့် → POS မှာ ဖုန်းပြင် မှတ်တမ်းအသစ်</li>
        <li>Sheet မှာ status / ယူပြီး / စျေး ပြင် → POS မှာ လိုက်ပြောင်း</li>
      </ul>
      <p className="gsheet-hint">ခင်ဗျား လက်နဲ့ ဖြည့်ထားတဲ့ ကွက်တွေကို POS က ဗလာနဲ့ မဖျက်ပါဘူး။</p>
    </details>

    <div className="gsheet-foot">
      <span>ပို့ရန် ကျန် <b>{counts.PENDING || 0}</b></span>
      <span>မအောင်မြင် <b>{counts.FAILED || 0}</b></span>
      {form.lastTest ? <span>နောက်ဆုံးစမ်းသပ် <b>{form.lastTest.ok ? 'အောင်မြင်' : 'မအောင်မြင်'}</b></span> : null}
      <button type="button" onClick={() => notifyCopy(configuredPullScript, 'Pull Sync Script ကူးပြီးပါပြီ')}>နေ့ချုပ် Script</button>
    </div>

    {message ? <div className="project-google-message">{message}</div> : null}
    {loading ? <div className="project-google-message"><Loader2 className="project-operations-spin" size={15}/> ဖတ်နေပါသည်…</div> : null}
  </section>;
}
