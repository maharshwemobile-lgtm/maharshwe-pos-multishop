import React, { useEffect, useState } from 'react';
import { ClipboardList, PackageCheck, Settings2, Users } from 'lucide-react';
import { clearSession } from './phase2Api';
import SupplierManagementPanel from './SupplierManagementPanel.jsx';
import Phase10PurchaseOrders from './Phase10PurchaseOrders.jsx';
import Phase10PurchasingCompletion from './Phase10PurchasingCompletion.jsx';
import PurchaseStockPage from './PurchaseStockPage.jsx';
import './purchasing-workspace.css';
import './phase10-purchasing.css';

const tabs = [
  { id: 'suppliers', label: 'Suppliers', icon: Users },
  { id: 'orders', label: 'Purchase Orders', icon: ClipboardList },
  { id: 'operations', label: 'Receiving & Accounts', icon: Settings2 },
  { id: 'legacy', label: 'Direct Receiving', icon: PackageCheck },
];

export default function PurchasingWorkspaceV2({ initialTab = 'suppliers' }) {
  const [tab, setTab] = useState(initialTab);
  const [message, setMessage] = useState(null);

  useEffect(() => {
    // Never land on a tab this workspace cannot show — that renders empty.
    const allowed = tabs.some((item) => item.id === initialTab);
    setTab(allowed ? initialTab : tabs[0].id);
  }, [initialTab]);

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

  return <div className="purchasing-hub">
    {message ? <div className={`purchasing-toast ${message.type}`}>{message.text}</div> : null}
    <nav className="purchasing-tabs" aria-label="Purchasing sections">
      {tabs.map((item) => <button key={item.id} type="button" className={tab === item.id ? 'active' : ''} onClick={() => setTab(item.id)}><item.icon size={18}/><span>{item.label}</span></button>)}
    </nav>
    {tab === 'suppliers' ? <SupplierManagementPanel onOpenOrders={() => setTab('orders')}/> : null}
    {tab === 'orders' ? <Phase10PurchaseOrders/> : null}
    {tab === 'operations' ? <Phase10PurchasingCompletion/> : null}
    {tab === 'legacy' ? <PurchaseStockPage/> : null}
  </div>;
}
