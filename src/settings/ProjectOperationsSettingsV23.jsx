import React, { useState } from 'react';
import { Banknote, Gauge, Globe2, Percent, Tags } from 'lucide-react';
import FinanceCatalogSettingsV23 from '../FinanceCatalogSettingsV23.jsx';
import MoneyServiceFeeSettingsV23 from '../MoneyServiceFeeSettingsV23.jsx';
import GoogleSheetIntegrationSettingsV23 from './GoogleSheetIntegrationSettingsV23.jsx';
import './project-operations-v23.css';

const TABS = [
  { id: 'overview', label: 'Overview', icon: Gauge },
  { id: 'payments', label: 'Payment Types', icon: Banknote },
  { id: 'fees', label: 'Fees', icon: Percent },
  { id: 'categories', label: 'Categories', icon: Tags },
  { id: 'google', label: 'Sheets', icon: Globe2 },
];

function OverviewCard({ icon: Icon, title, text, onOpen }) {
  return <button type="button" className="project-operations-overview-card" onClick={onOpen}>
    <span className="project-operations-overview-icon"><Icon size={22}/></span>
    <span><b>{title}</b><small>{text}</small></span>
    <strong>Configure</strong>
  </button>;
}

export default function ProjectOperationsSettingsV23() {
  const [tab, setTab] = useState('overview');
  const active = TABS.find((item) => item.id === tab) || TABS[0];

  return <section className="project-operations-settings-v23">
    <nav className="project-operations-tabs" aria-label="Business setup tabs">
      {TABS.map((item) => <button key={item.id} type="button" className={tab === item.id ? 'active' : ''} onClick={() => setTab(item.id)}><item.icon size={17}/><span>{item.label}</span></button>)}
    </nav>

    <div className="project-operations-active-title"><active.icon size={20}/><span><b>{active.label}</b><small>{tab === 'overview' ? 'Choose what you want to setup. Each card opens only one simple form.' : 'This tab changes only this setup area.'}</small></span></div>

    {tab === 'overview' ? <>
      <div className="project-cash-flow-note">
        <Banknote size={21}/>
        <div>
          <b>Money Service is now a separate sidebar tab.</b>
          <small>Use Wallets and Fees here only for Cash In / Cash Out setup.</small>
        </div>
      </div>
      <div className="project-operations-overview-grid">
        <OverviewCard icon={Banknote} title="Payment Type Configure" text="POS Sale မှာပေါ်မယ့် Cash, KBZ Pay, Wave Pay, Bank/Wallet တွေကို စီမံရန်." onOpen={() => setTab('payments')}/>
        <OverviewCard icon={Percent} title="Fees" text="Add a wallet if needed, then set Cash In % and Cash Out %." onOpen={() => setTab('fees')}/>
        <OverviewCard icon={Tags} title="Categories" text="Income and expense categories for business forms." onOpen={() => setTab('categories')}/>
        <OverviewCard icon={Globe2} title="Google Sheets" text="Sync URL, secret and retry settings." onOpen={() => setTab('google')}/>
      </div>
    </> : null}

    {tab === 'payments' ? <FinanceCatalogSettingsV23 mode="payments"/> : null}
    {tab === 'fees' ? <MoneyServiceFeeSettingsV23/> : null}
    {tab === 'categories' ? <FinanceCatalogSettingsV23 mode="categories"/> : null}
    {tab === 'google' ? <GoogleSheetIntegrationSettingsV23/> : null}
  </section>;
}
