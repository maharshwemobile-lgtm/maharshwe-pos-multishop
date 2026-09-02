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
          <PanelHead icon={Building2} title="Shop Info" description="ဆိုင်အမည်၊ ဆက်သွယ်ရန်၊ လိပ်စာနဲ့ payment နံပါတ်များ" onRefresh={load} busy={loading}/>

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
            <div className="psc-lic-card psc-lic-renew">
              <small>{isPremium ? 'Plan' : 'Renew'}</small>
              <b>{isPremium ? 'Premium' : 'Plan Renew'}</b>
              <button type="button" onClick={() => window.open('https://t.me/+2gc9ml7iMgk1ZThl', '_blank', 'noopener,noreferrer')}>{isPremium ? 'Community' : 'Renew on Telegram'}</button>
              <span>{license.renewedAt ? `Renewed ${formatDate(license.renewedAt)}` : 'Telegram community for renew support'}</span>
            </div>
          </div>

          <div className="psc-form psc-grid-2">
            <Divider>Identity</Divider>
            <Field label="Business Name"><input value={forms.business.name || ''} onChange={(e) => updateForm('business', { name: e.target.value })} disabled={!canManage}/></Field>
            <Field label="Subtitle"><input value={forms.business.subtitle || ''} onChange={(e) => updateForm('business', { subtitle: e.target.value })} disabled={!canManage}/></Field>
            <Field label="Logo URL"><input value={forms.business.logoUrl || ''} onChange={(e) => updateForm('business', { logoUrl: e.target.value })} placeholder="https://..." disabled={!canManage}/></Field>
            <Field label="Slip Logo URL" hint="ဗလာထားလျှင် အပေါ်က Logo ကိုပဲ slip မှာ သုံးပါမည်။ ဖြည့်ထားလျှင် slip အတွက် ဒါကို ဦးစားပေးပါမည်။">
              <input value={forms.business.printLogoUrl || ''} onChange={(e) => updateForm('business', { printLogoUrl: e.target.value })} placeholder="https://... (ရွေးချယ်ခွင့်)" disabled={!canManage}/>
            </Field>
            <Field label="Shop Slug" hint="Read only tenant identity"><input readOnly value={forms.business.slug || ''}/></Field>

            <Divider>Contact</Divider>
            <Field label="Primary Phone"><input value={forms.business.phone || ''} onChange={(e) => updateForm('business', { phone: e.target.value })} disabled={!canManage}/></Field>
            <Field label="Secondary Phone"><input value={forms.business.secondaryPhone || ''} onChange={(e) => updateForm('business', { secondaryPhone: e.target.value })} disabled={!canManage}/></Field>
            <Field label="Address"><textarea rows="2" value={forms.business.address || ''} onChange={(e) => updateForm('business', { address: e.target.value })} disabled={!canManage}/></Field>
            <Field label="Township / Region"><input value={forms.business.townshipRegion || ''} onChange={(e) => updateForm('business', { townshipRegion: e.target.value })} disabled={!canManage}/></Field>
            <Field label="Website"><input value={forms.business.website || ''} onChange={(e) => updateForm('business', { website: e.target.value })} placeholder="https://..." disabled={!canManage}/></Field>
            <Field label="Google Map URL"><input value={forms.business.googleMapUrl || ''} onChange={(e) => updateForm('business', { googleMapUrl: e.target.value })} placeholder="https://maps.google.com/..." disabled={!canManage}/></Field>

            <Divider>Payment & Numbering</Divider>
            <Field label="KBZ Pay Number"><input value={forms.business.kbzPayNumber || ''} onChange={(e) => updateForm('business', { kbzPayNumber: e.target.value })} disabled={!canManage}/></Field>
            <Field label="Wave Pay Number"><input value={forms.business.wavePayNumber || ''} onChange={(e) => updateForm('business', { wavePayNumber: e.target.value })} disabled={!canManage}/></Field>
            <Field label="Repair Prefix" hint="Optional. Blank = auto-generate from shop code.">
              <input value={forms.business.repairPrefix || ''} onChange={(e) => updateForm('business', { repairPrefix: e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 8) })} placeholder="Auto" disabled={!canManage}/>
            </Field>
          </div>

          <SaveBar name="business" saving={saving} onSave={() => save('business')} disabled={!canManage} label="Save Shop Info"/>
        </section> : null}

        {/* ── Slip & Print ──────────────────────────────────── */}
        {data && section === 'slip' ? <div className="psc-two-col">
          <section className="psc-panel">
            <PanelHead icon={FileText} title="Slip & Print" description="Sale Slip နဲ့ Repair Voucher အတွက် logo၊ header၊ footer"/>
            <div className="psc-form">
              <Toggle label="Show Business Logo" checked={forms.slip.showLogo} onChange={(v) => updateForm('slip', { showLogo: v })} disabled={!canManage}/>

              <div className="psc-form psc-grid-2" style={{ padding: 0 }}>
                <Divider>Sale Slip</Divider>
                <Field label="Sale Header"><textarea rows="2" value={forms.slip.saleHeader || ''} onChange={(e) => updateForm('slip', { saleHeader: e.target.value })} disabled={!canManage}/></Field>
                <Field label="Sale Footer"><textarea rows="2" value={forms.slip.saleFooter || ''} onChange={(e) => updateForm('slip', { saleFooter: e.target.value })} disabled={!canManage}/></Field>
                <Field label="Footer Tag"><textarea rows="2" value={forms.slip.footerTag || ''} onChange={(e) => updateForm('slip', { footerTag: e.target.value })} placeholder="Thank you / warranty / contact" disabled={!canManage}/></Field>
                <Field label="Warranty Text"><textarea rows="2" value={forms.slip.warrantyText || ''} onChange={(e) => updateForm('slip', { warrantyText: e.target.value })} disabled={!canManage}/></Field>
                <Field label="Sale Paper Size"><select value={forms.slip.salePaperSize} onChange={(e) => updateForm('slip', { salePaperSize: e.target.value })} disabled={!canManage}><option>58mm</option><option>80mm</option></select></Field>

                <Divider>Repair Voucher</Divider>
                  <Field label="Repair Paper Size"><select value={forms.slip.repairPaperSize} onChange={(e) => updateForm('slip', { repairPaperSize: e.target.value })} disabled={!canManage}><option>58mm</option><option>80mm</option></select></Field>
                  <Field label="Voucher Header"><textarea rows="2" value={forms.slip.repairVoucherHeader || ''} onChange={(e) => updateForm('slip', { repairVoucherHeader: e.target.value })} disabled={!canManage}/></Field>
                  <Field label="Voucher Footer"><textarea rows="2" value={forms.slip.repairVoucherFooter || ''} onChange={(e) => updateForm('slip', { repairVoucherFooter: e.target.value })} disabled={!canManage}/></Field>
              </div>

              <Divider>Show on Slip</Divider>
              <div className="psc-toggle-grid">
                <Toggle label="Customer Phone" checked={forms.slip.showCustomerPhone} onChange={(v) => updateForm('slip', { showCustomerPhone: v })} disabled={!canManage}/>
                <Toggle label="Payment Type" checked={forms.slip.showPaymentType} onChange={(v) => updateForm('slip', { showPaymentType: v })} disabled={!canManage}/>
                <Toggle label="Cashier Name" checked={forms.slip.showCashierName} onChange={(v) => updateForm('slip', { showCashierName: v })} disabled={!canManage}/>
              </div>
            </div>
            <SaveBar name="slip" saving={saving} onSave={() => save('slip')} disabled={!canManage} label="Save Slip Settings"/>
          </section>

          <section className="psc-panel psc-slip-sticky">
            <PanelHead icon={FileText} title="Preview" description={`${forms.slip.salePaperSize} sale slip`}/>
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
            <PanelHead icon={Palette} title="My Preference" description="ဤ user အတွက်သာ သက်ရောက်သည်။ Shop default ကို override လုပ်သည်။"/>
            <div className="psc-form psc-grid-2">
              <Field label="Language"><select value={forms.preferences.language} onChange={(e) => updateForm('preferences', { language: e.target.value })}><option value="my">မြန်မာ</option><option value="en">English</option></select></Field>
              <Field label="Theme"><select value={forms.preferences.theme} onChange={(e) => updateForm('preferences', { theme: e.target.value })}><option value="light">Light</option><option value="dark">Dark</option><option value="system">System</option></select></Field>
              <Field label="Opening Page"><select value={forms.preferences.openingPage} onChange={(e) => updateForm('preferences', { openingPage: e.target.value })}>{openingPages.map((item) => <option key={item}>{item}</option>)}</select></Field>
              <Field label="Sidebar"><select value={forms.preferences.sidebarMode} onChange={(e) => updateForm('preferences', { sidebarMode: e.target.value })}><option value="expanded">Expanded</option><option value="compact">Compact</option></select></Field>
              <Field label="Table Density"><select value={forms.preferences.tableDensity} onChange={(e) => updateForm('preferences', { tableDensity: e.target.value })}><option value="comfortable">Comfortable</option><option value="compact">Compact</option></select></Field>
              <Field label="Page Size"><select value={forms.preferences.pageSize} onChange={(e) => updateForm('preferences', { pageSize: Number(e.target.value) })}>{[10,20,50,100].map((item) => <option key={item} value={item}>{item}</option>)}</select></Field>
              <Field label="Date Format"><select value={forms.preferences.dateFormat} onChange={(e) => updateForm('preferences', { dateFormat: e.target.value })}><option>DD/MM/YYYY</option><option>YYYY-MM-DD</option><option>MM/DD/YYYY</option></select></Field>
              <Field label="Time Format"><select value={forms.preferences.timeFormat} onChange={(e) => updateForm('preferences', { timeFormat: e.target.value })}><option value="12h">12 Hour</option><option value="24h">24 Hour</option></select></Field>
            </div>
            <SaveBar name="preferences" saving={saving} onSave={() => save('preferences')} label="Save My Preference"/>
          </section>

          <section className="psc-panel">
            <PanelHead icon={Building2} title="Shop Default" description="ဆိုင်တစ်ခုလုံးအတွက် default။ User က My Preference နဲ့ override နိုင်သည်။"/>
            <div className="psc-form psc-grid-2">
              <Field label="Default Language"><select value={forms.appearance.language} onChange={(e) => updateForm('appearance', { language: e.target.value })} disabled={!canManage}><option value="my">မြန်မာ</option><option value="en">English</option></select></Field>
              <Field label="Default Theme"><select value={forms.appearance.theme} onChange={(e) => updateForm('appearance', { theme: e.target.value })} disabled={!canManage}><option value="light">Light</option><option value="dark">Dark</option><option value="system">System</option></select></Field>
              <Field label="Accent Colour"><select value={forms.appearance.accent} onChange={(e) => updateForm('appearance', { accent: e.target.value })} disabled={!canManage}><option value="green">Green</option><option value="blue">Blue</option><option value="purple">Purple</option><option value="orange">Orange</option></select></Field>
              <Field label="Font Size"><select value={forms.appearance.fontScale} onChange={(e) => updateForm('appearance', { fontScale: e.target.value })} disabled={!canManage}><option value="normal">Normal</option><option value="large">Large</option></select></Field>
              <Field label="Table Density"><select value={forms.appearance.tableDensity} onChange={(e) => updateForm('appearance', { tableDensity: e.target.value })} disabled={!canManage}><option value="comfortable">Comfortable</option><option value="compact">Compact</option></select></Field>
              <Field label="Timezone"><input value={forms.appearance.timezone} onChange={(e) => updateForm('appearance', { timezone: e.target.value })} disabled={!canManage}/></Field>
              <Field label="Date Format"><select value={forms.appearance.dateFormat} onChange={(e) => updateForm('appearance', { dateFormat: e.target.value })} disabled={!canManage}><option>DD/MM/YYYY</option><option>YYYY-MM-DD</option><option>MM/DD/YYYY</option></select></Field>
              <Field label="Time Format"><select value={forms.appearance.timeFormat} onChange={(e) => updateForm('appearance', { timeFormat: e.target.value })} disabled={!canManage}><option value="12h">12 Hour</option><option value="24h">24 Hour</option></select></Field>
              <Field label="Currency"><input readOnly value="MMK"/></Field>
            </div>
            <SaveBar name="appearance" saving={saving} onSave={() => save('appearance')} disabled={!canManage} label="Save Shop Default"/>
          </section>
        </> : null}

        {/* ── Delegated sections ────────────────────────────── */}
        {data && section === 'operations' ? <PostgreSQLSettingsHubV23/> : null}
        {data && section === 'users' ? <ProjectUserAccessSettings notify={notify}/> : null}
        {data && section === 'integrations' ? <><TelegramAutomationSettings/><GoogleSheetIntegrationSettingsV23/></> : null}

        {/* ── System ────────────────────────────────────────── */}
        {data && section === 'system' ? <section className="psc-panel">
          <PanelHead icon={Database} title="System" description="Database status၊ session နဲ့ default page size" onRefresh={load} busy={loading}/>

          <div className="psc-db-status">
            <div className="psc-db-card"><Database size={20}/><span><small>Database</small><b>{data.database.provider}</b></span></div>
            <div className="psc-db-card"><CheckCircle2 size={20}/><span><small>Connection</small><b>{data.database.connected ? 'Connected' : 'Offline'}</b></span></div>
            <div className="psc-db-card"><ShieldCheck size={20}/><span><small>Tenant Scope</small><b>{data.database.tenantScoped ? 'Protected' : 'Check Required'}</b></span></div>
            <div className="psc-db-card"><code>{data.database.shopSlug}</code></div>
          </div>

          <div className="psc-form psc-grid-2">
            <Field label="Default Page Size"><select value={forms.system.defaultPageSize} onChange={(e) => updateForm('system', { defaultPageSize: Number(e.target.value) })} disabled={!canManage}>{[10,20,50,100].map((item) => <option key={item} value={item}>{item}</option>)}</select></Field>
            <Field label="Session Timeout (minutes)"><input type="number" min="15" max="1440" value={forms.system.sessionTimeoutMinutes} onChange={(e) => updateForm('system', { sessionTimeoutMinutes: Number(e.target.value) })} disabled={!canManage}/></Field>
            <Field label="Timezone"><input value={forms.system.timezone} onChange={(e) => updateForm('system', { timezone: e.target.value })} disabled={!canManage}/></Field>
            <Field label="Settings Version"><input readOnly value={data.settingsVersion}/></Field>
            <div style={{ gridColumn: '1 / -1' }}>
              <Toggle label="Maintenance Mode" hint="ဖွင့်ထားပါက normal user များ write operation မလုပ်နိုင်ပါ။" checked={forms.system.maintenanceMode} onChange={(v) => updateForm('system', { maintenanceMode: v })} disabled={!canManage}/>
            </div>
          </div>

          <SaveBar name="system" saving={saving} onSave={() => save('system')} disabled={!canManage} label="Save System Settings"/>
        </section> : null}
      </main>
    </div>
  </section>;
}
