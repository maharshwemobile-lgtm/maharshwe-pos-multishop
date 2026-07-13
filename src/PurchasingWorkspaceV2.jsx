import React, { useState } from 'react';
import { BarChart3, ClipboardList, CreditCard, PackageCheck, RotateCcw, Settings2, Users } from 'lucide-react';
import { clearSession, getSession } from './phase2Api';
import SupplierManagementPanel from './SupplierManagementPanel.jsx';
import Phase10PurchaseOrders from './Phase10PurchaseOrders.jsx';
import Phase10PurchasingCompletion from './Phase10PurchasingCompletion.jsx';
import Phase10ReceivingPanel from './Phase10ReceivingPanel.jsx';
import Phase10PayablesPanel from './Phase10PayablesPanel.jsx';
import Phase10ReturnsPanel from './Phase10ReturnsPanel.jsx';
import Phase10PurchasingReports from './Phase10PurchasingReports.jsx';
import PurchaseStockPage from './PurchaseStockPage.jsx';
import './purchasing-workspace.css';
import './phase10-purchasing.css';

const tabs = [
  { id: 'suppliers', label: 'Suppliers', icon: Users },
  { id: 'orders', label: 'Purchase Orders', icon: ClipboardList },
  { id: 'operations', label: 'Receiving & Accounts', icon: Settings2 },
  { id: 'legacy', label: 'Direct Receiving', icon: PackageCheck },
];

const miniMartTabs = [
  { id: 'suppliers', label: 'Suppliers / ပစ္စည်းသွင်းသူ', icon: Users },
  { id: 'orders', label: 'Purchase Orders', icon: ClipboardList },
  { id: 'receiving', label: 'Goods Receiving', icon: PackageCheck },
  { id: 'payables', label: 'Supplier Payables', icon: CreditCard },
  { id: 'returns', label: 'Purchase Returns', icon: RotateCcw },
  { id: 'reports', label: 'Purchase Reports', icon: BarChart3 },
  { id: 'legacy', label: 'Direct Receiving', icon: PackageCheck },
];

function businessTypeOf() {
  const session = getSession();
  return String(session?.shop?.businessType || session?.user?.shop?.businessType || session?.businessType || 'PHONE_SHOP').toUpperCase();
}

export default function PurchasingWorkspaceV2() {
  const [tab, setTab] = useState('suppliers');
  const [message, setMessage] = useState(null);
  const isMiniMart = businessTypeOf() === 'MINI_MART';
  const visibleTabs = isMiniMart ? miniMartTabs : tabs;

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
    {isMiniMart ? (
      <section className="purchasing-mini-intro">
        <span>MINI MART PURCHASING</span>
        <h3>StockM style purchasing flow</h3>
        <p>Supplier → Purchase Order → Goods Receiving → Payables/Returns → Reports ကို တစ်နေရာတည်းမှာ စီမံပါ။ Mobile Shop repair purchasing flow ကို မထိထားပါ။</p>
      </section>
    ) : null}
    <nav className="purchasing-tabs" aria-label="Purchasing sections">
      {visibleTabs.map((item) => <button key={item.id} type="button" className={tab === item.id ? 'active' : ''} onClick={() => setTab(item.id)}><item.icon size={18}/><span>{item.label}</span></button>)}
    </nav>
    {tab === 'suppliers' ? <SupplierManagementPanel onOpenOrders={() => setTab('orders')}/> : null}
    {tab === 'orders' ? <Phase10PurchaseOrders/> : null}
    {!isMiniMart && tab === 'operations' ? <Phase10PurchasingCompletion/> : null}
    {isMiniMart && tab === 'receiving' ? <Phase10ReceivingPanel notify={notify} onError={onError}/> : null}
    {isMiniMart && tab === 'payables' ? <Phase10PayablesPanel notify={notify} onError={onError}/> : null}
    {isMiniMart && tab === 'returns' ? <Phase10ReturnsPanel notify={notify} onError={onError}/> : null}
    {isMiniMart && tab === 'reports' ? <Phase10PurchasingReports notify={notify} onError={onError}/> : null}
    {tab === 'legacy' ? <PurchaseStockPage/> : null}
  </div>;
}
