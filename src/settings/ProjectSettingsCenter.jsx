import React, { useEffect, useMemo, useState } from 'react';
import {
  Building2,
  CheckCircle2,
  Code2,
  Database,
  FileText,
  Gauge,
  Globe2,
  Languages,
  Loader2,
  RefreshCw,
  Save,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  UserCog,
} from 'lucide-react';
import { apiFetch, clearSession, getSession } from '../phase2Api';
import ProjectUserAccessSettings from './ProjectUserAccessSettings.jsx';
import './project-settings.css';

const SECTIONS = [
  { id: 'preferences', label: 'My Preference', icon: SlidersHorizontal },
  { id: 'slip', label: 'Slip Information', icon: FileText },
  { id: 'business', label: 'Shop Info', icon: Building2 },
  { id: 'appearance', label: 'Appearance & Language', icon: Languages },
  { id: 'api', label: 'API Configure', icon: Code2 },
  { id: 'users', label: 'Users & Access', icon: UserCog },
  { id: 'system', label: 'System Settings', icon: Database },
];

const clone = (value) => JSON.parse(JSON.stringify(value || {}));

function formatDate(value) {
  if (!value) return '-';
  try {
    return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium' }).format(new Date(value));
  } catch {
    return String(value);
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
  return <label className="ps-field"><span>{label}</span>{children}{hint ? <small>{hint}</small> : null}</label>;
}

function Toggle({ label, hint, checked, onChange, disabled }) {
  return <label className="ps-switch-row"><span><b>{label}</b>{hint ? <small>{hint}</small> : null}</span><input type="checkbox" checked={Boolean(checked)} onChange={(event) => onChange(event.target.checked)} disabled={disabled}/></label>;
}

function SectionHeader({ icon: Icon, title, description, onRefresh, busy }) {
  return <header className="ps-panel-head"><div><Icon size={21}/><span><h3>{title}</h3><p>{description}</p></span></div>{onRefresh ? <button className="ps-icon-button" type="button" onClick={onRefresh} disabled={busy}><RefreshCw className={busy ? 'ps-spin' : ''} size={18}/></button> : null}</header>;
}

export default function ProjectSettingsCenter() {
  const [section, setSection] = useState('preferences');
  const [data, setData] = useState(null);
  const [forms, setForms] = useState({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState('');
  const [message, setMessage] = useState(null);
  const [apiTesting, setApiTesting] = useState('');

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
    try {
      if (payload?.preferences?.showMoneyService !== undefined) {
        window.localStorage.setItem('miniMartShowMoneyService', payload.preferences.showMoneyService ? 'true' : 'false');
      }
    } catch {}
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
      const payload = await apiFetch(`/api/project-settings/${name}`, { method: 'PUT', body: forms[name] });
      sync(payload);
      notify('success', `${name} settings saved`);
    } catch (error) {
      handleError(error);
    } finally {
      setSaving('');
    }
  };

  const testApi = async (method) => {
    setApiTesting(method);
    try {
      const result = await apiFetch('/api/project-settings/api/google-sheet/test', { method: 'POST', body: { method } });
      notify(result.ok ? 'success' : 'error', `${method} test ${result.ok ? 'successful' : 'failed'}`);
      await load();
    } catch (error) {
      handleError(error);
      await load();
    } finally {
      setApiTesting('');
    }
  };

  const license = data?.license || {};
  const session = getSession();
  const canManage = data?.canManage === true;
  const activeSection = SECTIONS.find((item) => item.id === section) || SECTIONS[0];
  const isPremium = license.status === 'ACTIVE' && (Number(license.totalDays || 0) > 7 || Boolean(license.renewedAt));
  const rawBusinessType = data?.business?.businessType || session?.shop?.businessType || session?.user?.shop?.businessType || session?.businessType || 'PHONE_SHOP';
  const isMiniMart = String(rawBusinessType).toUpperCase() === 'MINI_MART';
  const showMoneyService = forms.preferences?.showMoneyService === true || forms.preferences?.showMoneyService === 'true';
  const openingPages = ['Dashboard','Sale POS','Sales History','Repairs','Products','Stock','Purchases','Customers','Money Service','Accounting','Reports','Settings']
    .filter((item) => !isMiniMart || !['Repairs'].includes(item))
    .filter((item) => item !== 'Money Service' || showMoneyService);

  const licenseColor = useMemo(() => {
    if (license.status === 'ACTIVE' || license.status === 'TRIAL') return 'good';
    if (license.status === 'OVERDUE') return 'warning';
    return 'danger';
  }, [license.status]);

  return <section className="project-settings-page">
    {message ? <div className={`ps-toast ${message.type}`}>{message.text}</div> : null}

    <div className="ps-heading">
      <div><span>SETTINGS</span><h2>Shop Setup</h2><p>ဆိုင်အချက်အလက်၊ slip၊ user၊ theme နဲ့ system setup များကို ရိုးရှင်းစွာ စီမံပါ။</p></div>
    </div>

    <div className="ps-shell">
      <nav className="ps-nav">
        {SECTIONS.map((item) => <button key={item.id} type="button" className={section === item.id ? 'active' : ''} onClick={() => setSection(item.id)}><item.icon size={18}/><span>{item.label}</span></button>)}
      </nav>

      <main className="ps-content">
        {loading && !data ? <div className="ps-loading"><Loader2 className="ps-spin"/> Loading settings...</div> : null}

        {!loading && !data ? <div className="ps-empty">Settings could not be loaded.</div> : null}

        {data && section === 'preferences' ? <section className="ps-panel">
          <SectionHeader icon={SlidersHorizontal} title="My Own Preference" description="ဒီ Login User တစ်ယောက်အတွက်ပဲ သက်ရောက်မည့် Preference များ။"/>
          <div className="ps-form ps-grid-2">
            <Field label="Language"><select value={forms.preferences.language} onChange={(event) => updateForm('preferences', { language: event.target.value })}><option value="my">မြန်မာ</option><option value="en">English</option></select></Field>
            <Field label="Theme"><select value={forms.preferences.theme} onChange={(event) => updateForm('preferences', { theme: event.target.value })}><option value="light">Light</option><option value="dark">Dark</option><option value="system">System</option></select></Field>
            <Field label="Default Opening Page"><select value={forms.preferences.openingPage} onChange={(event) => updateForm('preferences', { openingPage: event.target.value })}>{openingPages.map((item) => <option key={item}>{item}</option>)}</select></Field>
            {isMiniMart ? <Toggle label="Money Service Menu ပြမည်" hint="Mini Mart မှာ default မပြပါ။ Cash In / Cash Out သုံးချင်မှ ဖွင့်ပါ။" checked={showMoneyService} onChange={(value) => { try { window.localStorage.setItem('miniMartShowMoneyService', value ? 'true' : 'false'); } catch {} updateForm('preferences', { showMoneyService: value, openingPage: value ? forms.preferences.openingPage : (forms.preferences.openingPage === 'Money Service' ? 'Dashboard' : forms.preferences.openingPage) }); }} disabled={!canManage}/> : null}
            <Field label="Sidebar"><select value={forms.preferences.sidebarMode} onChange={(event) => updateForm('preferences', { sidebarMode: event.target.value })}><option value="expanded">Expanded</option><option value="compact">Compact</option></select></Field>
            <Field label="Table Density"><select value={forms.preferences.tableDensity} onChange={(event) => updateForm('preferences', { tableDensity: event.target.value })}><option value="comfortable">Comfortable</option><option value="compact">Compact</option></select></Field>
            <Field label="Page Size"><select value={forms.preferences.pageSize} onChange={(event) => updateForm('preferences', { pageSize: Number(event.target.value) })}>{[10,20,50,100].map((item) => <option key={item} value={item}>{item}</option>)}</select></Field>
            <Field label="Date Format"><select value={forms.preferences.dateFormat} onChange={(event) => updateForm('preferences', { dateFormat: event.target.value })}><option>DD/MM/YYYY</option><option>YYYY-MM-DD</option><option>MM/DD/YYYY</option></select></Field>
            <Field label="Time Format"><select value={forms.preferences.timeFormat} onChange={(event) => updateForm('preferences', { timeFormat: event.target.value })}><option value="12h">12 Hour</option><option value="24h">24 Hour</option></select></Field>
          </div>
          <div className="ps-actions"><button className="ps-primary" type="button" onClick={() => save('preferences')} disabled={saving === 'preferences'}>{saving === 'preferences' ? <Loader2 className="ps-spin" size={18}/> : <Save size={18}/>} Save My Preference</button></div>
        </section> : null}

        {data && section === 'slip' ? <div className="ps-two-panel">
          <section className="ps-panel">
            <SectionHeader icon={FileText} title="Slip Information" description={isMiniMart ? 'Sale Slip အတွက် Logo, Header, Footer နှင့် Footer Tag Information။' : 'Sale Slip နဲ့ Repair Voucher အတွက် Logo နှင့် Footer Tag Information။'}/>
            <div className="ps-form">
              <Toggle label="Show Business Logo" checked={forms.slip.showLogo} onChange={(value) => updateForm('slip', { showLogo: value })} disabled={!canManage}/>
              <div className="ps-grid-2">
                <Field label="Sale Header"><textarea rows="3" value={forms.slip.saleHeader || ''} onChange={(event) => updateForm('slip', { saleHeader: event.target.value })} disabled={!canManage}/></Field>
                <Field label="Sale Footer"><textarea rows="3" value={forms.slip.saleFooter || ''} onChange={(event) => updateForm('slip', { saleFooter: event.target.value })} disabled={!canManage}/></Field>
                <Field label="Footer Tag Information"><textarea rows="3" value={forms.slip.footerTag || ''} onChange={(event) => updateForm('slip', { footerTag: event.target.value })} placeholder="Thank you / warranty / contact tag" disabled={!canManage}/></Field>
                <Field label="Warranty Text"><textarea rows="3" value={forms.slip.warrantyText || ''} onChange={(event) => updateForm('slip', { warrantyText: event.target.value })} disabled={!canManage}/></Field>
                <Field label="Sale Paper Size"><select value={forms.slip.salePaperSize} onChange={(event) => updateForm('slip', { salePaperSize: event.target.value })} disabled={!canManage}><option>58mm</option><option>80mm</option></select></Field>
                {!isMiniMart ? <Field label="Repair Paper Size"><select value={forms.slip.repairPaperSize} onChange={(event) => updateForm('slip', { repairPaperSize: event.target.value })} disabled={!canManage}><option>58mm</option><option>80mm</option></select></Field> : null}
                {!isMiniMart ? <Field label="Repair Voucher Header"><textarea rows="3" value={forms.slip.repairVoucherHeader || ''} onChange={(event) => updateForm('slip', { repairVoucherHeader: event.target.value })} disabled={!canManage}/></Field> : null}
                {!isMiniMart ? <Field label="Repair Voucher Footer"><textarea rows="3" value={forms.slip.repairVoucherFooter || ''} onChange={(event) => updateForm('slip', { repairVoucherFooter: event.target.value })} disabled={!canManage}/></Field> : null}
              </div>
              <div className="ps-toggle-grid">
                <Toggle label="Show Customer Phone" checked={forms.slip.showCustomerPhone} onChange={(value) => updateForm('slip', { showCustomerPhone: value })} disabled={!canManage}/>
                <Toggle label="Show Payment Type" checked={forms.slip.showPaymentType} onChange={(value) => updateForm('slip', { showPaymentType: value })} disabled={!canManage}/>
                <Toggle label="Show Cashier Name" checked={forms.slip.showCashierName} onChange={(value) => updateForm('slip', { showCashierName: value })} disabled={!canManage}/>
              </div>
            </div>
            <div className="ps-actions"><button className="ps-primary" type="button" onClick={() => save('slip')} disabled={!canManage || saving === 'slip'}>{saving === 'slip' ? <Loader2 className="ps-spin" size={18}/> : <Save size={18}/>} Save Slip Information</button></div>
          </section>

          <section className="ps-panel ps-slip-preview">
            <SectionHeader icon={FileText} title="Slip Preview" description={`${forms.slip.salePaperSize} preview`}/>
            <div className={`ps-paper ${forms.slip.salePaperSize === '58mm' ? 'narrow' : ''}`}>
              {forms.slip.showLogo && data.business.logoUrl ? <img src={data.business.logoUrl} alt="Business logo"/> : <div className="ps-paper-logo">MS</div>}
              <h3>{data.business.name}</h3>
              <p>{forms.slip.saleHeader || data.business.subtitle}</p>
              <hr/>
              <div><span>Sample Product</span><b>100,000 MMK</b></div>
              <div><span>Total</span><b>100,000 MMK</b></div>
              <hr/>
              <p>{forms.slip.saleFooter || 'Thank you for shopping with us.'}</p>
              <strong>{forms.slip.footerTag || 'Mahar Shwe Mobile'}</strong>
            </div>
          </section>
        </div> : null}

        {data && section === 'business' ? <section className="ps-panel">
          <SectionHeader icon={Building2} title="Shop Info" description="ဆိုင်အမည်၊ ဖုန်းနံပါတ်၊ လိပ်စာနှင့် logo ကို စီမံပါ။"/>
          <div className="ps-license-block">
            <div className={`ps-license-status ${licenseColor}`}><ShieldCheck size={25}/><span><small>License Status</small><b>{license.status || 'NOT_CONFIGURED'}</b></span></div>
            <div className="ps-license-progress"><div><span>Used {license.usedDays || 0} / {license.totalDays || 0} days</span><b>{license.usedPercent || 0}% Used</b></div><div className="bar"><i style={{ width: `${license.usedPercent || 0}%` }}/></div><small>{license.remainingDays || 0} days remaining · {formatDate(license.startsAt)} → {formatDate(license.endsAt)}</small></div>
            <div className="ps-license-fee"><small>{isPremium ? 'Plan' : 'Renew'}</small><b>{isPremium ? 'Premium User' : 'Plan Renew'}</b><button type="button" onClick={() => window.open('https://t.me/+2gc9ml7iMgk1ZThl', '_blank', 'noopener,noreferrer')}>{isPremium ? 'Open Community' : 'Renew on Telegram'}</button><span>{license.renewedAt ? `Renewed ${formatDate(license.renewedAt)}` : 'Join Telegram community for renew support'}</span></div>
          </div>

          <div className="ps-form ps-grid-2">
            <Field label="Business Name"><input value={forms.business.name || ''} onChange={(event) => updateForm('business', { name: event.target.value })} disabled={!canManage}/></Field>
            <Field label="Subtitle"><input value={forms.business.subtitle || ''} onChange={(event) => updateForm('business', { subtitle: event.target.value })} disabled={!canManage}/></Field>
            <Field label="Primary Phone"><input value={forms.business.phone || ''} onChange={(event) => updateForm('business', { phone: event.target.value })} disabled={!canManage}/></Field>
            <Field label="Secondary Phone"><input value={forms.business.secondaryPhone || ''} onChange={(event) => updateForm('business', { secondaryPhone: event.target.value })} disabled={!canManage}/></Field>
            <Field label="Address"><textarea rows="3" value={forms.business.address || ''} onChange={(event) => updateForm('business', { address: event.target.value })} disabled={!canManage}/></Field>
            <Field label="Township / Region"><input value={forms.business.townshipRegion || ''} onChange={(event) => updateForm('business', { townshipRegion: event.target.value })} disabled={!canManage}/></Field>
            <Field label="Logo URL"><input value={forms.business.logoUrl || ''} onChange={(event) => updateForm('business', { logoUrl: event.target.value })} placeholder="https://..." disabled={!canManage}/></Field>
            <Field label="Website"><input value={forms.business.website || ''} onChange={(event) => updateForm('business', { website: event.target.value })} placeholder="https://..." disabled={!canManage}/></Field>
            <Field label="Google Map URL"><input value={forms.business.googleMapUrl || ''} onChange={(event) => updateForm('business', { googleMapUrl: event.target.value })} placeholder="https://maps.google.com/..." disabled={!canManage}/></Field>
            <Field label="KBZ Pay Number"><input value={forms.business.kbzPayNumber || ''} onChange={(event) => updateForm('business', { kbzPayNumber: event.target.value })} disabled={!canManage}/></Field>
            <Field label="Wave Pay Number"><input value={forms.business.wavePayNumber || ''} onChange={(event) => updateForm('business', { wavePayNumber: event.target.value })} disabled={!canManage}/></Field>
            {!isMiniMart ? <Field label="Repair Prefix" hint="Optional. Leave blank to auto-generate from shop code or shop name.">
              <input value={forms.business.repairPrefix || ''} onChange={(event) => updateForm('business', { repairPrefix: event.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 8) })} placeholder="Auto" disabled={!canManage}/>
            </Field> : null}
            <Field label="Shop Slug" hint="Read only tenant identity"><input readOnly value={forms.business.slug || ''}/></Field>
          </div>
          <div className="ps-actions"><button className="ps-primary" type="button" onClick={() => save('business')} disabled={!canManage || saving === 'business'}>{saving === 'business' ? <Loader2 className="ps-spin" size={18}/> : <Save size={18}/>} Save Shop Info</button></div>
        </section> : null}

        {data && section === 'appearance' ? <section className="ps-panel">
          <SectionHeader icon={Languages} title="Appearance & Language" description="Shop default UI settings. My Preference can override for the current user."/>
          <div className="ps-form ps-grid-2">
            <Field label="Default Language"><select value={forms.appearance.language} onChange={(event) => updateForm('appearance', { language: event.target.value })} disabled={!canManage}><option value="my">မြန်မာ</option><option value="en">English</option></select></Field>
            <Field label="Default Theme"><select value={forms.appearance.theme} onChange={(event) => updateForm('appearance', { theme: event.target.value })} disabled={!canManage}><option value="light">Light</option><option value="dark">Dark</option><option value="system">System</option></select></Field>
            <Field label="Accent"><select value={forms.appearance.accent} onChange={(event) => updateForm('appearance', { accent: event.target.value })} disabled={!canManage}><option value="green">Green</option><option value="blue">Blue</option><option value="purple">Purple</option><option value="orange">Orange</option></select></Field>
            <Field label="Font Size"><select value={forms.appearance.fontScale} onChange={(event) => updateForm('appearance', { fontScale: event.target.value })} disabled={!canManage}><option value="normal">Normal</option><option value="large">Large</option></select></Field>
            <Field label="Table Density"><select value={forms.appearance.tableDensity} onChange={(event) => updateForm('appearance', { tableDensity: event.target.value })} disabled={!canManage}><option value="comfortable">Comfortable</option><option value="compact">Compact</option></select></Field>
            <Field label="Currency"><input readOnly value="MMK"/></Field>
            <Field label="Timezone"><input value={forms.appearance.timezone} onChange={(event) => updateForm('appearance', { timezone: event.target.value })} disabled={!canManage}/></Field>
            <Field label="Date Format"><select value={forms.appearance.dateFormat} onChange={(event) => updateForm('appearance', { dateFormat: event.target.value })} disabled={!canManage}><option>DD/MM/YYYY</option><option>YYYY-MM-DD</option><option>MM/DD/YYYY</option></select></Field>
            <Field label="Time Format"><select value={forms.appearance.timeFormat} onChange={(event) => updateForm('appearance', { timeFormat: event.target.value })} disabled={!canManage}><option value="12h">12 Hour</option><option value="24h">24 Hour</option></select></Field>
          </div>
          <div className="ps-actions"><button className="ps-primary" type="button" onClick={() => save('appearance')} disabled={!canManage || saving === 'appearance'}>{saving === 'appearance' ? <Loader2 className="ps-spin" size={18}/> : <Save size={18}/>} Save Appearance</button></div>
        </section> : null}

        {data && section === 'api' ? <section className="ps-panel">
          <SectionHeader icon={Code2} title="API Configure" description="Google Sheet Auto Sync ကို dedicated webhook integration card မှာ စီမံပါ။"/>
          <div className="ps-form">
            <div className="ps-api-result good">
              <b>Google Sheet Auto Sync</b>
              <span>Legacy Google Sheet setup ကို မသုံးတော့ပါ။ Web App URL တစ်ခုတည်းဖြင့် Sale, Repair, Repair Status Update များကို auto sync ပို့ပါမည်။</span>
              <small>Settings page ထဲရှိ “Google Sheet Auto Sync” card မှာ Webhook URL ထည့်ပြီး Save Integration / Test Connection လုပ်ပါ။</small>
            </div>
          </div>
        </section> : null}

        {data && section === 'users' ? <ProjectUserAccessSettings notify={notify}/> : null}

        {data && section === 'system' ? <section className="ps-panel">
          <SectionHeader icon={Database} title="System Settings" description="Default page size၊ session timeout နှင့် timezone ကို စီမံပါ။"/>
          <div className="ps-db-status"><div><Database size={24}/><span><small>Database</small><b>{data.database.provider}</b></span></div><div><CheckCircle2 size={24}/><span><small>Connection</small><b>{data.database.connected ? 'Connected' : 'Offline'}</b></span></div><div><ShieldCheck size={24}/><span><small>Tenant Scope</small><b>{data.database.tenantScoped ? 'Protected' : 'Check Required'}</b></span></div><code>{data.database.shopSlug}</code></div>
          <div className="ps-form ps-grid-2">
            <Field label="Default Page Size"><select value={forms.system.defaultPageSize} onChange={(event) => updateForm('system', { defaultPageSize: Number(event.target.value) })} disabled={!canManage}>{[10,20,50,100].map((item) => <option key={item} value={item}>{item}</option>)}</select></Field>
            <Field label="Session Timeout (minutes)"><input type="number" min="15" max="1440" value={forms.system.sessionTimeoutMinutes} onChange={(event) => updateForm('system', { sessionTimeoutMinutes: Number(event.target.value) })} disabled={!canManage}/></Field>
            <Field label="Timezone"><input value={forms.system.timezone} onChange={(event) => updateForm('system', { timezone: event.target.value })} disabled={!canManage}/></Field>
            <Field label="Settings Version"><input readOnly value={data.settingsVersion}/></Field>
          </div>
          <Toggle label="Maintenance Mode" hint="When enabled later, normal users will be blocked from write operations." checked={forms.system.maintenanceMode} onChange={(value) => updateForm('system', { maintenanceMode: value })} disabled={!canManage}/>
          <div className="ps-actions"><button className="ps-primary" type="button" onClick={() => save('system')} disabled={!canManage || saving === 'system'}>{saving === 'system' ? <Loader2 className="ps-spin" size={18}/> : <Settings2 size={18}/>} Save System Settings</button></div>
        </section> : null}
      </main>
    </div>
  </section>;
}
