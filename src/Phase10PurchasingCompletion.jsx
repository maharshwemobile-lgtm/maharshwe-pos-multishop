import React, { useState } from 'react';
import { BarChart3, CreditCard, PackageCheck, RotateCcw, Wrench } from 'lucide-react';
import { clearSession } from './phase2Api';
import Phase10ReceivingPanel from './Phase10ReceivingPanel.jsx';
import Phase10PayablesPanel from './Phase10PayablesPanel.jsx';
import Phase10ReturnsPanel from './Phase10ReturnsPanel.jsx';
import Phase10RepairPartsPanel from './Phase10RepairPartsPanel.jsx';
import Phase10PurchasingReports from './Phase10PurchasingReports.jsx';
import './phase10-purchasing-completion.css';

const tabs = [
  { id: 'receiving', label: 'Goods Receiving', icon: PackageCheck },
  { id: 'payables', label: 'Payables', icon: CreditCard },
  { id: 'returns', label: 'Supplier Returns', icon: RotateCcw },
  { id: 'repair', label: 'Repair Parts', icon: Wrench },
  { id: 'reports', label: 'Reports', icon: BarChart3 },
];

export default function Phase10PurchasingCompletion() {
  const [tab, setTab] = useState('receiving');
  const [message, setMessage] = useState(null);

  const notify = (type, text) => {
    setMessage({ type, text });
    window.clearTimeout(notify.timer);
    notify.timer = window.setTimeout(() => setMessage(null), 4500);
  };

  const onError = (error) => {
    if (error?.status === 401) {
      clearSession();
      window.location.reload();
      return;
    }
    notify('error', error?.message || 'Request failed');
  };

  return <section className="purchasing-panel p10-completion">
    {message ? <div className={`purchasing-toast ${message.type}`}>{message.text}</div> : null}
    <nav className="p10-operation-tabs">
      {tabs.map((item) => <button key={item.id} type="button" className={tab === item.id ? 'active' : ''} onClick={() => setTab(item.id)}><item.icon size={17}/><span>{item.label}</span></button>)}
    </nav>
    {tab === 'receiving' ? <Phase10ReceivingPanel notify={notify} onError={onError}/> : null}
    {tab === 'payables' ? <Phase10PayablesPanel notify={notify} onError={onError}/> : null}
    {tab === 'returns' ? <Phase10ReturnsPanel notify={notify} onError={onError}/> : null}
    {tab === 'repair' ? <Phase10RepairPartsPanel notify={notify} onError={onError}/> : null}
    {tab === 'reports' ? <Phase10PurchasingReports notify={notify} onError={onError}/> : null}
  </section>;
}
