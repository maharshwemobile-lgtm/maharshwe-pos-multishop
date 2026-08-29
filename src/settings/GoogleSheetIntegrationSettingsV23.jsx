import React, { useEffect, useMemo, useState } from 'react';
import { Code2, Globe2, Loader2, Save, Send, ShieldCheck } from 'lucide-react';
import { apiFetch, getSession } from '../phase2Api';
import './project-operations-v23.css';
import './google-sheet-integration.css';
import { APP_URL } from '../projectBrand';

const EMPTY = {
  enabled: false,
  postUrl: '',
  getUrl: '',
  secret: '',
  timeoutMs: 10000,
  repairSheetTab: '',
  sheetId: '',
  repairOnly: false,
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
  const copyPullScript = async () => {
    setTesting('COPYPULL');
    try {
      const response = await apiFetch('/api/project-settings/integrations/google-sheet/script');
      if (!response.pullReady) {
        setMessage('Secret မရသေးပါ — စာမျက်နှာ refresh လုပ်ပါ။');
        return;
      }
      const copied = await copyText(response.pullCode);
      setMessage(copied ? 'နေ့ချုပ် Script ကူးပြီးပါပြီ။' : 'ကူးလို့ မရပါ။');
    } catch (error) {
      setMessage(error.message || 'Script ကူး၍ မရပါ');
    } finally {
      setTesting('');
    }
  };

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
          repairOnly: Boolean(form.repairOnly),
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
    sheet: 'Google Sheet link',
    url: 'Web App URL',
    enabled: 'Live Sync',
    tab: 'ဖုန်းပြင် စာရင်း tab',
    reach: 'Apps Script တုံ့ပြန်မှု',
    secret: 'Secret ကိုက်ညီမှု',
    version: 'Script code version',
  };
  const checks = diagnosis?.checks || [];
  const passed = checks.filter((check) => check.ok).length;
  // A warn still counts as ready — the sync works, the check just could not
  // read that one value.
  const allGood = checks.length > 0 && passed === checks.length;
  const busy = Boolean(testing);

  return <section className="gs-card">
    <header className="gs-card-head">
      <div className="gs-card-title">
        <span className="gs-card-icon"><Globe2 size={19}/></span>
        <div>
          <h3>Google Sheet ချိတ်ဆက်ခြင်း</h3>
          <p>ဖုန်းပြင် ဘောက်ချာနဲ့ ရောင်းအား မှတ်တမ်းများကို ဆိုင်၏ Google Sheet ထဲသို့ တိုက်ရိုက် ရေးသွင်းပါသည်။</p>
        </div>
      </div>
      <span className={`gs-badge ${allGood ? 'is-good' : checks.length ? 'is-warn' : 'is-idle'}`}>
        {allGood ? 'ချိတ်ဆက်ပြီး' : checks.length ? `${passed}/${checks.length} အဆင်သင့်` : 'မစစ်ဆေးရသေး'}
      </span>
    </header>

    <div className="gs-body">
      {/* Status first: on every visit after the first, this is the only part
          that matters, and the setup steps were burying it. */}
      <section className="gs-section">
        <div className="gs-section-head">
          <h4>အခြေအနေ</h4>
          <button type="button" className="gs-btn gs-btn-ghost" onClick={diagnose} disabled={busy}>
            {testing === 'CHECK' ? <Loader2 className="project-operations-spin" size={15}/> : <ShieldCheck size={15}/>}
            စစ်ဆေးမည်
          </button>
        </div>
        {checks.length ? (
          <ul className="gs-status">
            {checks.map((check) => (
              <li key={check.key} className={check.warn ? 'is-warn' : check.ok ? 'is-ok' : 'is-bad'}>
                <span className="gs-status-mark">{check.warn ? '!' : check.ok ? '✓' : '✕'}</span>
                <span className="gs-status-name">{CHECK_LABELS[check.key] || check.key}</span>
                {check.detail ? <span className="gs-status-note">{check.detail}</span> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="gs-empty">စစ်ဆေးမည် ကို နှိပ်ပါ — လိုအပ်ချက်များကို တစ်ခုချင်း ဖော်ပြပါမည်။</p>
        )}
      </section>

      <section className="gs-section">
        <div className="gs-section-head"><h4>ဆက်တင်</h4></div>
        <form className="gs-form" onSubmit={save}>
          <div className="gs-row">
            <div className="gs-col-12">
              <label className="gs-label" htmlFor="gs-sheet">Google Sheet link</label>
              <input id="gs-sheet" className="gs-input" type="text" value={form.sheetId || ''}
                placeholder="https://docs.google.com/spreadsheets/d/..."
                onChange={(event) => update({ sheetId: event.target.value })}/>
              <p className="gs-help">ဖြည့်ရန်လိုသည်မှာ ဤတစ်ကွက်သာ ဖြစ်ပါသည်။ ကျန်အချက်များကို script မှ အလိုအလျောက် ပေးပို့ပါမည်။</p>
            </div>

            <div className="gs-col-6">
              <label className="gs-label" htmlFor="gs-tab">ဖုန်းပြင် စာရင်း tab</label>
              {form.availableTabs?.length ? (
                <select id="gs-tab" className="gs-input" value={form.repairSheetTab || ''}
                  onChange={(event) => update({ repairSheetTab: event.target.value })}>
                  <option value="">— ရွေးချယ်ပါ —</option>
                  {form.availableTabs.map((tab) => <option key={tab} value={tab}>{tab}</option>)}
                </select>
              ) : (
                <input id="gs-tab" className="gs-input" type="text" value={form.repairSheetTab || ''}
                  placeholder="ချိတ်ဆက်ပြီးမှ ရွေးနိုင်ပါမည်"
                  onChange={(event) => update({ repairSheetTab: event.target.value })}/>
              )}
              <p className="gs-help">ဘောက်ချာနံပါတ် prefix — <b>{repairPrefix || 'RP'}</b></p>
            </div>

            <div className="gs-col-6">
              <label className="gs-label" htmlFor="gs-url">Apps Script Web App URL</label>
              <input id="gs-url" className="gs-input" type="url" value={form.postUrl || ''}
                placeholder="https://script.google.com/macros/s/.../exec"
                onChange={(event) => update({ postUrl: event.target.value, getUrl: event.target.value })}/>
              <p className="gs-help">
                {/* getUrl() from the editor returns the /dev address, which only
                    answers its owner — so this one cannot always be filled in
                    for them. */}
                <b>/exec</b> နှင့် ဆုံးရပါမည်။ Deploy → Manage deployments တွင် ရှိပါသည်။
                {form.scriptVersion ? ` · ${form.scriptVersion}` : ''}
              </p>
            </div>
          </div>

          <div className="gs-switch">
            <div>
              <b>Live Sync</b>
              <span>ဘောက်ချာ၊ ရောင်းအား၊ ဝင်ငွေ၊ အသုံးစရိတ်၊ ကုန်ပစ္စည်း — အလိုအလျောက် ပေးပို့ပါမည်။</span>
            </div>
            <input type="checkbox" checked={form.enabled} onChange={(event) => update({ enabled: event.target.checked })}/>
          </div>

          <div className="gs-switch">
            <div>
              <b>ဖုန်းပြင် ဘောက်ချာ တစ်ခုတည်းသာ</b>
              <span>
                ဖွင့်ထားလျှင် ဖုန်းပြင် စာရင်း tab သို့သာ ရေးပါမည်။ ပိတ်ထားလျှင် ရောင်းအား၊ ဝင်ငွေ၊
                ကုန်ပစ္စည်း စသည့် tab များကိုပါ Sheet ထဲတွင် ဖန်တီး၍ ရေးပါမည်။
              </span>
            </div>
            <input type="checkbox" checked={Boolean(form.repairOnly)}
              onChange={(event) => update({ repairOnly: event.target.checked })}/>
          </div>

          <div className="gs-btn-row">
            <button className="gs-btn gs-btn-primary" disabled={saving}>
              {saving ? <Loader2 className="project-operations-spin" size={15}/> : <Save size={15}/>} သိမ်းမည်
            </button>
            <button type="button" className="gs-btn" onClick={() => test('POST')} disabled={busy}>
              {testing === 'POST' ? <Loader2 className="project-operations-spin" size={15}/> : <Send size={15}/>} စမ်းပို့မည်
            </button>
          </div>
        </form>
      </section>

      <section className="gs-section">
        <div className="gs-section-head"><h4>ချိတ်ဆက်နည်း</h4><span className="gs-section-note">တစ်ကြိမ်သာ</span></div>
        <ol className="gs-steps">
          <li>
            <span className="gs-step-n">1</span>
            <div><b>Google Sheet link</b> ကို အပေါ်တွင် ထည့်ပြီး <b>သိမ်းမည်</b> နှိပ်ပါ။</div>
          </li>
          <li>
            <span className="gs-step-n">2</span>
            <div>
              <a href="https://script.google.com/home/projects/create" target="_blank" rel="noreferrer">script.google.com</a> တွင်
              <b> New project</b> ဖွင့်ပါ။ အောက်ပါခလုတ်ဖြင့် ကူးယူပြီး အထဲတွင် paste လုပ်ကာ Save ပါ။
              <button type="button" className="gs-btn gs-btn-primary gs-btn-inline" onClick={copyScript} disabled={busy}>
                {testing === 'COPY' ? <Loader2 className="project-operations-spin" size={15}/> : <Code2 size={15}/>} Script Code ကူးမည်
              </button>
            </div>
          </li>
          <li>
            <span className="gs-step-n">3</span>
            <div>
              <b>Deploy → New deployment → Web app</b> · Execute as <b>Me</b> · Access <b>Anyone</b> → Deploy။
              ရလာသော <b>/exec</b> URL ကို အပေါ်က ကွက်ထဲ ထည့်ပြီး <b>သိမ်းမည်</b> နှိပ်ပါ။
            </div>
          </li>
          <li>
            <span className="gs-step-n">4</span>
            <div>function စာရင်းမှ <b>ချိတ်မည်</b> ကို ရွေးပြီး <b>▶ Run</b> နှိပ်ပါ။ ခွင့်ပြုချက်တောင်းလျှင် <i>Advanced → Go to … → Allow</i>။</div>
          </li>
        </ol>
        <div className="gs-note is-warn">
          Sheet တွင် Apps Script <b>ရှိပြီးသား</b> ဖြစ်ပါက (ဥပမာ Telegram bot) အဲဒီအထဲသို့ <b>မထည့်ပါနှင့်</b> — project အသစ် ဖွင့်ပါ။
        </div>
        <div className="gs-note">
          Code ပြန်ကူးထည့်တိုင်း <b>Deploy → Manage deployments → ✏️ → New version</b> ကို လုပ်ပါ။
        </div>
      </section>

      {/* Separate script, separate project, separate job — it pulls the daily
          close into the sheet rather than pushing records out. Folded away so
          it does not read as a step in the setup above. */}
      <details className="gs-section gs-collapse">
        <summary>နေ့ချုပ် အစီရင်ခံစာ Script (ရွေးချယ်ခွင့်)</summary>
        <p className="gs-note">
          နေ့စဉ် ပိတ်ချိန် စာရင်းနှင့် ဘီလ် / Eload လက်ကျန်ကို Sheet ထဲသို့ <b>ဆွဲယူ</b>ရန် script ဖြစ်သည်။
          အထက်ပါ ချိတ်ဆက်မှုနှင့် မသက်ဆိုင်ဘဲ <b>သီးခြား project</b> တစ်ခုတွင် ထားပါ။
          ထည့်ပြီးလျှင် Sheet ၏ menu မှ <b>Mahar POS Sync → Pull Today</b> ဖြင့် ဆွဲနိုင်သည်။
        </p>
        <div className="gs-btn-row" style={{ marginTop: 12 }}>
          <button type="button" className="gs-btn" onClick={copyPullScript} disabled={busy}>
            {testing === 'COPYPULL' ? <Loader2 className="project-operations-spin" size={15}/> : <Code2 size={15}/>} နေ့ချုပ် Script ကူးမည်
          </button>
        </div>
      </details>

      <details className="gs-section gs-collapse">
        <summary>ဘယ်ဘက်မှ ဘယ်ဘက်သို့ သွားသည်</summary>
        <ul className="gs-flow">
          <li><b>POS</b> တွင် ဘောက်ချာ print → <b>Sheet</b> တွင် အတန်းအသစ်</li>
          <li><b>POS</b> တွင် status ပြောင်း / ဖျက် → <b>Sheet</b> တွင် လိုက်ပြောင်း / လိုက်ပျက်</li>
          <li><b>Sheet</b> တွင် အတန်းအသစ် → <b>POS</b> တွင် ဖုန်းပြင် မှတ်တမ်းအသစ်</li>
          <li><b>Sheet</b> တွင် status / ယူပြီး / စျေး ပြင် → <b>POS</b> တွင် လိုက်ပြောင်း</li>
        </ul>
        <div className="gs-note">လက်ဖြင့် ဖြည့်ထားသော ကွက်လပ်များကို POS မှ ဗလာဖြင့် ဖျက်မည် မဟုတ်ပါ။</div>
      </details>
    </div>

    {(counts.PENDING || counts.FAILED || message) ? (
      <footer className="gs-card-foot">
        {counts.PENDING ? <span>ပို့ရန်ကျန် <b>{counts.PENDING}</b></span> : null}
        {counts.FAILED ? <span>မအောင်မြင် <b>{counts.FAILED}</b></span> : null}
        {message ? <span className="gs-msg">{message}</span> : null}
        {(counts.PENDING || counts.FAILED)
          ? <button type="button" className="gs-btn gs-btn-ghost" onClick={retry} disabled={busy}>ပြန်ပို့မည်</button>
          : null}
      </footer>
    ) : null}
  </section>;
}
