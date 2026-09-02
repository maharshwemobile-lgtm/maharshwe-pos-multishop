import React, { useState } from 'react';
import { Banknote, Tags, WalletCards } from 'lucide-react';
import FinanceCatalogSettingsV23 from '../FinanceCatalogSettingsV23.jsx';
import MoneyServiceFeeSettingsV23 from '../MoneyServiceFeeSettingsV23.jsx';
import './project-operations-v23.css';

const TABS = [
  { id: 'payments', label: 'ငွေပေးချေမှု အမျိုးအစားများ', shortLabel: 'ငွေပေးချေမှု', icon: Banknote },
  { id: 'fees', label: 'ငွေလွှဲ Wallet နှင့် ဝန်ဆောင်ခ', shortLabel: 'Wallet နှင့် ဝန်ဆောင်ခ', icon: WalletCards },
  { id: 'categories', label: 'ဝင်ငွေ / ထွက်ငွေ အမျိုးအစားများ', shortLabel: 'ဝင်ငွေ / ထွက်ငွေ', icon: Tags },
];

export default function ProjectOperationsSettingsV23() {
  const [tab, setTab] = useState('payments');
  const active = TABS.find((item) => item.id === tab) || TABS[0];

  return <section className="project-operations-settings-v23">
    <nav className="project-operations-tabs" aria-label="ငွေပေးချေမှု ဆက်တင်များ">
      {TABS.map((item) => <button key={item.id} type="button" className={tab === item.id ? 'active' : ''} onClick={() => setTab(item.id)} title={item.label}>
        <item.icon size={17}/><span>{item.shortLabel}</span>
      </button>)}
    </nav>
    <div className="project-operations-active-title"><active.icon size={20}/><b>{active.label}</b></div>
    {tab === 'payments' ? <FinanceCatalogSettingsV23 mode="payments"/> : null}
    {tab === 'fees' ? <MoneyServiceFeeSettingsV23/> : null}
    {tab === 'categories' ? <FinanceCatalogSettingsV23 mode="categories"/> : null}
  </section>;
}
