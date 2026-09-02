import React, { useEffect, useMemo, useState } from 'react';
import {
  Building2,
  CheckCircle2,
  Database,
  FileText,
  Loader2,
  Palette,
  Plug,
  RefreshCw,
  Save,
  ShieldCheck,
  UserCog,
  WalletCards,
} from 'lucide-react';
import { apiFetch, clearSession } from '../phase2Api';
import ProjectUserAccessSettings from './ProjectUserAccessSettings.jsx';
import GoogleSheetIntegrationSettingsV23 from './GoogleSheetIntegrationSettingsV23.jsx';
import TelegramAutomationSettings from './TelegramAutomationSettings.jsx';
import PostgreSQLSettingsHubV23 from './PostgreSQLSettingsHubV23.jsx';
import './project-settings.css';
import './project-settings-center.css';

const SECTIONS = [
  { id: 'business', label: 'Shop Info', icon: Building2, group: 'shop' },
  { id: 'slip', label: 'Slip & Print', icon: FileText, group: 'shop' },
  { id: 'appearance', label: 'Appearance', icon: Palette, group: 'shop' },
  { id: 'operations', label: 'POS & Payments', icon: WalletCards, group: 'ops' },
  { id: 'users', label: 'Users & Access', icon: UserCog, group: 'ops' },
  { id: 'integrations', label: 'Integrations', icon: Plug, group: 'ops' },
  { id: 'system', label: 'System', icon: Database, group: 'system' },
];

const clone = (value) => JSON.parse(JSON.stringify(value || {}));

function formatDate(value) {
  if (!value) return '-';
  try {
    const normalized = typeof value === 'object' && !Array.isArray(value)
      ? Object.keys(value).sort((a, b) => Number(a) - Number(b)).map((key) => value[key]).join('')
      : value;
    const date = new Date(normalized);
    if (Number.isNaN(date.getTime())) return '-';
    return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium' }).format(date);
  } catch {
    return '-';
  }
}

function applyAppearance(appearance, preferences) {
  if (typeof document === 'undefined') return;
  const selectedTheme = preferences?.theme || appearance?.theme || 'light';
  const dark = selectedTheme === 'dark'
    || (selectedTheme === 'system' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
  document.documentElement.dataset.theme = selectedTheme;
  document.documentElement.dataset.accent = appearance?.accent || 'green';
  document.documentElement.dataset.density = preferences?.tableDensity || appearance?.tableDensity || 'comfortable';
  document.documentElement.dataset.fontScale = appearance?.fontScale || 'normal';
  document.documentElement.lang = preferences?.language || appearance?.language || 'my';
}

function Field({ label, children, hint }) {
  return <label className="psc-field"><span>{label}</span>{children}{hint ? <small>{hint}</small> : null}</label>;
}

function Divider({ children }) {
  return <div className="psc-divider">{children}</div>;
}

function Toggle({ label, hint, checked, onChange, disabled }) {
  return <label className="psc-toggle">
    <span className="psc-toggle-text"><b>{label}</b>{hint ? <small>{hint}</small> : null}</span>
    <input type="checkbox" checked={Boolean(checked)} onChange={(event) => onChange(event.target.checked)} disabled={disabled}/>
  </label>;
}

function PanelHead({ icon: Icon, title, description, onRefresh, busy }) {
  return <header className="psc-panel-head">
    <div className="psc-panel-head-left">
      <span className="psc-panel-head-icon"><Icon size={18}/></span>
      <span className="psc-panel-head-text"><h3>{title}</h3>{description ? <p>{description}</p> : null}</span>
    </div>
    {onRefresh ? <button className="psc-icon-btn" type="button" onClick={onRefresh} disabled={busy} aria-label="Refresh"><RefreshCw className={busy ? 'psc-spin' : ''} size={16}/></button> : null}
  </header>;
}

function SaveBar({ name, saving, onSave, disabled, label }) {
  return <div className="psc-actions">
    <button className="psc-btn primary" type="button" onClick={onSave} disabled={disabled || saving === name}>
      {saving === name ? <Loader2 className="psc-spin" size={16}/> : <Save size={16}/>} {label}
    </button>
  </div>;
}

export default function ProjectSettingsCenter() {
  const [section, setSection] = useState('business');
  const [data, setData] = useState(null);
  const [forms, setForms] = useState({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState('');
  const [message, setMessage] = useState(null);

  const notify = (type, text) => {
    setMessage({ type, text });
    window.clearTimeout(notify.timer);
    notify.timer = window.setTimeout(() => setMessage(null), 4500);
  };

  const handleError = (error) => {
    if (error?.status === 401) {
      clearSession();
      window.location.reload();
      return;
    }
    notify('error', error?.message || 'Settings request failed');
  };

  const sync = (payload) => {
    setData(payload);
    setForms({
      preferences: clone(payload.preferences),
      slip: clone(payload.slip),
      business: clone(payload.business),
      appearance: clone(payload.appearance),
      api: clone(payload.api),
      system: clone(payload.system),
    });
    applyAppearance(payload.appearance, payload.preferences);
  };

  const load = async () => {
    setLoading(true);
    try {
      sync(await apiFetch('/api/project-settings'));
    } catch (error) {
      handleError(error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const updateForm = (name, patch) => {
    setForms((current) => ({ ...current, [name]: { ...current[name], ...patch } }));
  };

  const save = async (name) => {
    setSaving(name);
    try {
      sync(await apiFetch(`/api/project-settings/${name}`, { method: 'PUT', body: forms[name] }));
      notify('success', 'Settings saved');
    } catch (error) {
      handleError(error);
    } finally {
      setSaving('');
    }
  };

  const license = data?.license || {};
  const canManage = data?.canManage === true;
  const isPremium = license.status === 'ACTIVE' && (Number(license.totalDays || 0) > 7 || Boolean(license.renewedAt));
  const openingPages = ['Sale POS','Dashboard','Sales History','Repairs','Products','Stock','Purchases','Customers','Money Service','Bill / Eload','Accounting','Reports','Settings'];

  const licenseColor = useMemo(() => {
    if (license.status === 'ACTIVE' || license.status === 'TRIAL') return 'good';
    if (license.status === 'OVERDUE') return 'warning';
    return 'danger';
  }, [license.status]);

  const navItems = [];
  SECTIONS.forEach((item, index) => {
    const prev = SECTIONS[index - 1];
    if (prev && prev.group !== item.group) navItems.push({ sep: true, key: `sep-${item.group}` });
    navItems.push(item);
  });

  return <section className="psc-page">
    {message ? <div className={`psc-toast ${message.type}`}>{message.text}</div> : null}

    <div className="psc-header">
      <div>
        <span className="psc-header-eyebrow">Settings</span>
        <h2>Shop Setup</h2>
        <p>ဆိုင်အချက်အလက်၊ slip၊ appearance၊ POS payment၊ user access၊ integration နဲ့ system setup များကို တစ်နေရာတည်းမှာ စီမံပါ။</p>
      </div>
    </div>

    <div className="psc-shell">
      <nav className="psc-nav">
        {navItems.map((item) => item.sep
          ? <div key={item.key} className="psc-nav-sep"/>
          : <button key={item.id} type="button" className={`psc-nav-btn ${section === item.id ? 'active' : ''}`} onClick={() => setSection(item.id)}>
              <span className="psc-nav-icon"><item.icon size={15}/></span>
              <span>{item.label}</span>
            </button>)}
      </nav>

      <main className="psc-content">
        {loading && !data ? <div className="psc-loading"><Loader2 className="psc-spin" size={18}/> Loading settings...</div> : null}
        {!loading && !data ? <div className="psc-empty">Settings could not be loaded.</div> : null}

        {/* ── Shop Info ─────────────────────────────────────── */}
        {data && section === 'business' ? <section className="psc-panel">
          <PanelHead icon={Building2} title="ဆိုင် အချက်အလက်" description="ဆိုင်အမည်၊ လိုဂို၊ ဆက်သွယ်ရန်၊ ငွေလက်ခံနံပါတ်နှင့် ဘောက်ချာနံပါတ်" onRefresh={load} busy={loading}/>

          <div className="psc-license">
            <div className={`psc-lic-card psc-lic-status ${licenseColor}`}>
              <ShieldCheck size={22}/>
              <span><small>License</small><b>{license.status || 'NOT_CONFIGURED'}</b></span>
            </div>
            <div className="psc-lic-card">
              <div className="psc-lic-meta"><span>Used {license.usedDays || 0} / {license.totalDays || 0} days</span><b>{license.usedPercent || 0}%</b></div>
              <div className="psc-lic-bar"><i style={{ width: `${license.usedPercent || 0}%` }}/></div>
              <small>{license.remainingDays || 0} days remaining · {formatDate(license.startsAt)} → {formatDate(license.endsAt)}</small>
            </div>
            <div className="psc-lic-card">
              <small>ဆိုင် အမှတ်</small>
              <b>{forms.business.slug || '-'}</b>
              <span>ပြောင်း၍ မရပါ · ငွေကြေး MMK</span>
            </div>
            <div className="psc-lic-card psc-lic-renew">
              <small>{isPremium ? 'Plan' : 'Renew'}</small>
              <b>{isPremium ? 'Premium' : 'Plan Renew'}</b>
              <button type="button" onClick={() => window.open('https://t.me/+2gc9ml7iMgk1ZThl', '_blank', 'noopener,noreferrer')}>{isPremium ? 'Community' : 'Renew on Telegram'}</button>
              <span>{license.renewedAt ? `Renewed ${formatDate(license.renewedAt)}` : 'Telegram community for renew support'}</span>
            </div>
          </div>

          <div className="psc-form psc-grid-2">
            <Divider>ဆိုင် အမည်နှင့် လိုဂို</Divider>
            <Field label="ဆိုင်အမည်"><input value={forms.business.name || ''} onChange={(e) => updateForm('business', { name: e.target.value })} disabled={!canManage}/></Field>
            <Field label="ခေါင်းစဉ်ခွဲ" hint="ဆိုင်အမည်အောက်တွင် ပြမည့် စာကြောင်း"><input value={forms.business.subtitle || ''} onChange={(e) => updateForm('business', { subtitle: e.target.value })} disabled={!canManage}/></Field>
            <Field label="လိုဂို လိပ်စာ" hint="မျက်နှာပြင်နှင့် storefront တွင် သုံးမည်"><input value={forms.business.logoUrl || ''} onChange={(e) => updateForm('business', { logoUrl: e.target.value })} placeholder="https://..." disabled={!canManage}/></Field>
            <Field label="ဘောက်ချာ လိုဂို လိပ်စာ" hint="ဗလာထားလျှင် အပေါ်က လိုဂိုကိုပဲ သုံးပါမည်။ Thermal စက်သည် အရောင်တစ်ရောင်သာ ရိုက်နိုင်၍ အဖြူအမည်း သီးသန့် ထားလိုလျှင် ဤနေရာတွင် ထည့်ပါ။">
              <input value={forms.business.printLogoUrl || ''} onChange={(e) => updateForm('business', { printLogoUrl: e.target.value })} placeholder="https://... (ရွေးချယ်ခွင့်)" disabled={!canManage}/>
            </Field>
            

            <Divider>ဆက်သွယ်ရန်</Divider>
            <Field label="ဖုန်းနံပါတ်"><input value={forms.business.phone || ''} onChange={(e) => updateForm('business', { phone: e.target.value })} disabled={!canManage}/></Field>
            <Field label="ဖုန်းနံပါတ် (၂)"><input value={forms.business.secondaryPhone || ''} onChange={(e) => updateForm('business', { secondaryPhone: e.target.value })} disabled={!canManage}/></Field>
            <Field label="လိပ်စာ"><textarea rows="2" value={forms.business.address || ''} onChange={(e) => updateForm('business', { address: e.target.value })} disabled={!canManage}/></Field>
            <Field label="မြို့နယ် / တိုင်း"><input value={forms.business.townshipRegion || ''} onChange={(e) => updateForm('business', { townshipRegion: e.target.value })} disabled={!canManage}/></Field>
            <Field label="ဝဘ်ဆိုက်"><input value={forms.business.website || ''} onChange={(e) => updateForm('business', { website: e.target.value })} placeholder="https://..." disabled={!canManage}/></Field>
            <Field label="Google Map လိပ်စာ"><input value={forms.business.googleMapUrl || ''} onChange={(e) => updateForm('business', { googleMapUrl: e.target.value })} placeholder="https://maps.google.com/..." disabled={!canManage}/></Field>

            <Divider>ငွေလက်ခံ နံပါတ်</Divider>
            <Field label="KBZ Pay နံပါတ်"><input value={forms.business.kbzPayNumber || ''} onChange={(e) => updateForm('business', { kbzPayNumber: e.target.value })} disabled={!canManage}/></Field>
            <Field label="Wave Pay နံပါတ်"><input value={forms.business.wavePayNumber || ''} onChange={(e) => updateForm('business', { wavePayNumber: e.target.value })} disabled={!canManage}/></Field>
            <Field label="ဘောက်ချာနံပါတ် အစ" hint="ဥပမာ MS ထည့်လျှင် MS0001 မှ စမည်။ ဗလာထားလျှင် ဆိုင်ကုဒ်မှ အလိုအလျောက် ယူပါမည်။">
              <input value={forms.business.repairPrefix || ''} onChange={(e) => updateForm('business', { repairPrefix: e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 8) })} placeholder="Auto" disabled={!canManage}/>
            </Field>
          </div>

          <SaveBar name="business" saving={saving} onSave={() => save('business')} disabled={!canManage} label="သိမ်းမည်"/>
        </section> : null}

        {/* ── Slip & Print ──────────────────────────────────── */}
        {data && section === 'slip' ? <div className="psc-two-col">
          <section className="psc-panel">
            <PanelHead icon={FileText} title="ဘောက်ချာ ပုံစံ" description="ရောင်းအား slip နှင့် ဖုန်းပြင် ဘောက်ချာတွင် ပါမည့် စာသားများ"/>
            <div className="psc-form">
              <Toggle label="လိုဂို ပြမည်" hint="ပိတ်ထားလျှင် ဘောက်ချာတွင် ဆိုင်အမည်သာ ပါပါမည်။" checked={forms.slip.showLogo} onChange={(v) => updateForm('slip', { showLogo: v })} disabled={!canManage}/>

              <div className="psc-form psc-grid-2" style={{ padding: 0 }}>
                <Divider>ရောင်းအား Slip</Divider>
                <Field label="အပေါ်စာသား"><textarea rows="2" value={forms.slip.saleHeader || ''} onChange={(e) => updateForm('slip', { saleHeader: e.target.value })} disabled={!canManage}/></Field>
                <Field label="အောက်စာသား"><textarea rows="2" value={forms.slip.saleFooter || ''} onChange={(e) => updateForm('slip', { saleFooter: e.target.value })} disabled={!canManage}/></Field>
                <Field label="အောက်ဆုံး မှတ်ချက်"><textarea rows="2" value={forms.slip.footerTag || ''} onChange={(e) => updateForm('slip', { footerTag: e.target.value })} placeholder="Thank you / warranty / contact" disabled={!canManage}/></Field>
                <Field label="အာမခံ စာသား"><textarea rows="2" value={forms.slip.warrantyText || ''} onChange={(e) => updateForm('slip', { warrantyText: e.target.value })} disabled={!canManage}/></Field>
                <Field label="စက္ကူ အကျယ်"><select value={forms.slip.salePaperSize} onChange={(e) => updateForm('slip', { salePaperSize: e.target.value })} disabled={!canManage}><option>58mm</option><option>80mm</option></select></Field>

                <Divider>ဖုန်းပြင် ဘောက်ချာ</Divider>
                  <Field label="စက္ကူ အကျယ်"><select value={forms.slip.repairPaperSize} onChange={(e) => updateForm('slip', { repairPaperSize: e.target.value })} disabled={!canManage}><option>58mm</option><option>80mm</option></select></Field>
                  <Field label="အပေါ်စာသား"><textarea rows="2" value={forms.slip.repairVoucherHeader || ''} onChange={(e) => updateForm('slip', { repairVoucherHeader: e.target.value })} disabled={!canManage}/></Field>
                  <Field label="အောက်စာသား"><textarea rows="2" value={forms.slip.repairVoucherFooter || ''} onChange={(e) => updateForm('slip', { repairVoucherFooter: e.target.value })} disabled={!canManage}/></Field>
              </div>

              <Divider>ဘောက်ချာတွင် ထည့်ပြမည့် အချက်များ</Divider>
              <div className="psc-toggle-grid">
                <Toggle label="ဖောက်သည် ဖုန်းနံပါတ်" checked={forms.slip.showCustomerPhone} onChange={(v) => updateForm('slip', { showCustomerPhone: v })} disabled={!canManage}/>
                <Toggle label="ငွေပေးချေပုံ" checked={forms.slip.showPaymentType} onChange={(v) => updateForm('slip', { showPaymentType: v })} disabled={!canManage}/>
                <Toggle label="ရောင်းသူ အမည်" checked={forms.slip.showCashierName} onChange={(v) => updateForm('slip', { showCashierName: v })} disabled={!canManage}/>
              </div>
            </div>
            <SaveBar name="slip" saving={saving} onSave={() => save('slip')} disabled={!canManage} label="သိမ်းမည်"/>
          </section>

          <section className="psc-panel psc-slip-sticky">
            <PanelHead icon={FileText} title="နမူနာ" description={`ရောင်းအား slip · ${forms.slip.salePaperSize}`}/>
            <div className={`psc-paper ${forms.slip.salePaperSize === '58mm' ? 'narrow' : ''}`}>
              {forms.slip.showLogo && data.business.logoUrl
                ? <img src={data.business.logoUrl} alt="Business logo"/>
                : <div className="psc-paper-logo">{(data.business.name || 'MS').slice(0, 2).toUpperCase()}</div>}
              <h3>{data.business.name}</h3>
              <p>{forms.slip.saleHeader || data.business.subtitle}</p>
              <hr/>
              <div className="psc-paper-row"><span>Sample Product</span><b>100,000</b></div>
              <div className="psc-paper-row"><span>Total</span><b>100,000 MMK</b></div>
              <hr/>
              <p>{forms.slip.saleFooter || 'Thank you for shopping with us.'}</p>
              <strong>{forms.slip.footerTag || data.business.name}</strong>
            </div>
          </section>
        </div> : null}

        {/* ── Appearance (My Preference + Shop Default) ─────── */}
        {data && section === 'appearance' ? <>
          <section className="psc-panel">
            <PanelHead icon={Palette} title="ကျွန်ုပ်၏ ပုံစံ" description="ဤအကောင့်တွင်သာ သက်ရောက်သည်။ အောက်က ဆိုင် default ကို ကျော်၍ သုံးပါမည်။"/>
            <div className="psc-form psc-grid-2">
              <Field label="ဘာသာစကား"><select value={forms.preferences.language} onChange={(e) => updateForm('preferences', { language: e.target.value })}><option value="my">မြန်မာ</option><option value="en">English</option></select></Field>
              <Field label="အရောင် ပုံစံ"><select value={forms.preferences.theme} onChange={(e) => updateForm('preferences', { theme: e.target.value })}><option value="light">Light</option><option value="dark">Dark</option><option value="system">System</option></select></Field>
              <Field label="ဖွင့်လိုက်လျှင် ပြမည့် စာမျက်နှာ"><select value={forms.preferences.openingPage} onChange={(e) => updateForm('preferences', { openingPage: e.target.value })}>{openingPages.map((item) => <option key={item}>{item}</option>)}</select></Field>
              <Field label="ဘေးတန်း"><select value={forms.preferences.sidebarMode} onChange={(e) => updateForm('preferences', { sidebarMode: e.target.value })}><option value="expanded">Expanded</option><option value="compact">Compact</option></select></Field>
              <Field label="ဇယား သိပ်သည်းမှု"><select value={forms.preferences.tableDensity} onChange={(e) => updateForm('preferences', { tableDensity: e.target.value })}><option value="comfortable">Comfortable</option><option value="compact">Compact</option></select></Field>
              <Field label="စာမျက်နှာတစ်ခုလျှင် စာရင်း"><select value={forms.preferences.pageSize} onChange={(e) => updateForm('preferences', { pageSize: Number(e.target.value) })}>{[10,20,50,100].map((item) => <option key={item} value={item}>{item}</option>)}</select></Field>
              <Field label="ရက်စွဲ ပုံစံ"><select value={forms.preferences.dateFormat} onChange={(e) => updateForm('preferences', { dateFormat: e.target.value })}><option>DD/MM/YYYY</option><option>YYYY-MM-DD</option><option>MM/DD/YYYY</option></select></Field>
              <Field label="အချိန် ပုံစံ"><select value={forms.preferences.timeFormat} onChange={(e) => updateForm('preferences', { timeFormat: e.target.value })}><option value="12h">12 Hour</option><option value="24h">24 Hour</option></select></Field>
            </div>
            <SaveBar name="preferences" saving={saving} onSave={() => save('preferences')} label="သိမ်းမည်"/>
          </section>

          <section className="psc-panel">
            <PanelHead icon={Building2} title="ဆိုင် default" description="ဝန်ထမ်းအားလုံးအတွက် စံ။ တစ်ဦးချင်း အပေါ်က ကျွန်ုပ်၏ပုံစံဖြင့် ပြောင်းနိုင်သည်။"/>
            <div className="psc-form psc-grid-2">
              <Field label="ဘာသာစကား"><select value={forms.appearance.language} onChange={(e) => updateForm('appearance', { language: e.target.value })} disabled={!canManage}><option value="my">မြန်မာ</option><option value="en">English</option></select></Field>
              <Field label="အရောင် ပုံစံ"><select value={forms.appearance.theme} onChange={(e) => updateForm('appearance', { theme: e.target.value })} disabled={!canManage}><option value="light">Light</option><option value="dark">Dark</option><option value="system">System</option></select></Field>
              <Field label="အဓိက အရောင်"><select value={forms.appearance.accent} onChange={(e) => updateForm('appearance', { accent: e.target.value })} disabled={!canManage}><option value="green">Green</option><option value="blue">Blue</option><option value="purple">Purple</option><option value="orange">Orange</option></select></Field>
              <Field label="စာလုံး အရွယ်"><select value={forms.appearance.fontScale} onChange={(e) => updateForm('appearance', { fontScale: e.target.value })} disabled={!canManage}><option value="normal">Normal</option><option value="large">Large</option></select></Field>
              <Field label="ဇယား သိပ်သည်းမှု"><select value={forms.appearance.tableDensity} onChange={(e) => updateForm('appearance', { tableDensity: e.target.value })} disabled={!canManage}><option value="comfortable">Comfortable</option><option value="compact">Compact</option></select></Field>
              <Field label="အချိန်ဇုန်"><input value={forms.appearance.timezone} onChange={(e) => updateForm('appearance', { timezone: e.target.value })} disabled={!canManage}/></Field>
              <Field label="ရက်စွဲ ပုံစံ"><select value={forms.appearance.dateFormat} onChange={(e) => updateForm('appearance', { dateFormat: e.target.value })} disabled={!canManage}><option>DD/MM/YYYY</option><option>YYYY-MM-DD</option><option>MM/DD/YYYY</option></select></Field>
              <Field label="အချိန် ပုံစံ"><select value={forms.appearance.timeFormat} onChange={(e) => updateForm('appearance', { timeFormat: e.target.value })} disabled={!canManage}><option value="12h">12 Hour</option><option value="24h">24 Hour</option></select></Field>
              
            </div>
            <SaveBar name="appearance" saving={saving} onSave={() => save('appearance')} disabled={!canManage} label="သိမ်းမည်"/>
          </section>
        </> : null}

        {/* ── Delegated sections ────────────────────────────── */}
        {data && section === 'operations' ? <PostgreSQLSettingsHubV23/> : null}
        {data && section === 'users' ? <ProjectUserAccessSettings notify={notify}/> : null}
        {data && section === 'integrations' ? <><TelegramAutomationSettings/><GoogleSheetIntegrationSettingsV23/></> : null}

        {/* ── System ────────────────────────────────────────── */}
        {data && section === 'system' ? <section className="psc-panel">
          <PanelHead icon={Database} title="System" description="ဒေတာဘေ့စ် အခြေအနေ၊ စနစ် ဆက်တင်နှင့် ပြုပြင်ထိန်းသိမ်းမှု" onRefresh={load} busy={loading}/>

          {/* Read-only state first. It used to sit in the same grid as the
              editable fields, so Settings Version read as something you could
              type into. */}
          <Divider>အခြေအနေ</Divider>
          <div className="psc-db-status">
            <div className="psc-db-card"><Database size={20}/><span><small>ဒေတာဘေ့စ်</small><b>{data.database.provider}</b></span></div>
            <div className="psc-db-card"><CheckCircle2 size={20}/><span><small>ချိတ်ဆက်မှု</small><b>{data.database.connected ? 'ကောင်းမွန်' : 'ပြတ်တောက်'}</b></span></div>
            <div className="psc-db-card"><ShieldCheck size={20}/><span><small>ဆိုင်အလိုက် ကန့်သတ်</small><b>{data.database.tenantScoped ? 'လုံခြုံ' : 'စစ်ဆေးရန်'}</b></span></div>
            <div className="psc-db-card"><Database size={20}/><span><small>ဆိုင် အမှတ်</small><b>{data.database.shopSlug}</b></span></div>
            <div className="psc-db-card"><CheckCircle2 size={20}/><span><small>ဆက်တင် ဗားရှင်း</small><b>{data.settingsVersion}</b></span></div>
          </div>

          <Divider>ပြသမှု</Divider>
          <div className="psc-form psc-grid-2">
            <Field label="စာမျက်နှာတစ်ခုလျှင် စာရင်း" hint="စာရင်းများတွင် တစ်ကြိမ်ပြမည့် အရေအတွက်">
              <select value={forms.system.defaultPageSize} onChange={(e) => updateForm('system', { defaultPageSize: Number(e.target.value) })} disabled={!canManage}>
                {[10,20,50,100].map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </Field>
            <Field label="အချိန်ဇုန်" hint="အစီရင်ခံစာနှင့် နေ့ချုပ်များ တွက်ရာတွင် သုံးသည်">
              <input value={forms.system.timezone} onChange={(e) => updateForm('system', { timezone: e.target.value })} disabled={!canManage}/>
            </Field>
          </div>

          <Divider>လုံခြုံရေး</Divider>
          <div className="psc-form psc-grid-2">
            <Field label="အလိုအလျောက် ထွက်ချိန် (မိနစ်)" hint="ဤမိနစ်အတွင်း လှုပ်ရှားမှု မရှိပါက အကောင့်မှ ထွက်ပါမည်။ ၁၅ မှ ၁၄၄၀ အထိ">
              <input type="number" min="15" max="1440" value={forms.system.sessionTimeoutMinutes} onChange={(e) => updateForm('system', { sessionTimeoutMinutes: Number(e.target.value) })} disabled={!canManage}/>
            </Field>
          </div>

          {/* Its own block, and last. This stops every normal user from writing
              anything — it should not sit in a grid looking like a preference. */}
          <Divider>ပြုပြင်ထိန်းသိမ်းမှု</Divider>
          <div className={`psc-danger-block ${forms.system.maintenanceMode ? 'is-on' : ''}`}>
            <Toggle
              label="Maintenance Mode"
              hint="ဖွင့်ထားစဉ် ဆိုင်ပိုင်ရှင်မှလွဲ၍ မည်သူမျှ ရောင်းချ၊ မှတ်တမ်းသွင်း၊ ပြင်ဆင်၍ မရပါ။ ပြုပြင်နေချိန်တွင်သာ ဖွင့်ပါ။"
              checked={forms.system.maintenanceMode}
              onChange={(v) => updateForm('system', { maintenanceMode: v })}
              disabled={!canManage}/>
            {forms.system.maintenanceMode
              ? <p className="psc-danger-note">⚠️ ဖွင့်ထားပါသည် — ကောင်တာမှ ရောင်းချ၍ မရပါ။</p>
              : null}
          </div>

          <SaveBar name="system" saving={saving} onSave={() => save('system')} disabled={!canManage} label="သိမ်းမည်"/>
        </section> : null}
      </main>
    </div>
  </section>;
}
