import React, { useEffect, useState } from 'react';
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
  { id: 'suppliers', label: '1. Supplier', icon: Users },
  { id: 'orders', label: '2. Order', icon: ClipboardList },
  { id: 'receiving', label: '3. Receive', icon: PackageCheck },
  { id: 'settlement', label: '4. Pay / Return', icon: CreditCard },
  { id: 'reports', label: '5. Report', icon: BarChart3 },
];

function businessTypeOf() {
  const session = getSession();
  return String(session?.shop?.businessType || session?.user?.shop?.businessType || session?.businessType || 'PHONE_SHOP').toUpperCase();
}

export default function PurchasingWorkspaceV2({ initialTab = 'suppliers' }) {
  const [tab, setTab] = useState(initialTab);
  const [settlementTab, setSettlementTab] = useState('payables');
  const [message, setMessage] = useState(null);
  const isMiniMart = businessTypeOf() === 'MINI_MART';
  const visibleTabs = isMiniMart ? miniMartTabs : tabs;

  useEffect(() => {
    setTab(initialTab);
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
      {visibleTabs.map((item) => <button key={item.id} type="button" className={tab === item.id ? 'active' : ''} onClick={() => setTab(item.id)}><item.icon size={18}/><span>{item.label}</span></button>)}
    </nav>
    {tab === 'suppliers' ? <SupplierManagementPanel onOpenOrders={() => setTab('orders')}/> : null}
    {tab === 'orders' ? <Phase10PurchaseOrders/> : null}
    {!isMiniMart && tab === 'operations' ? <Phase10PurchasingCompletion/> : null}
    {isMiniMart && tab === 'receiving' ? <Phase10ReceivingPanel notify={notify} onError={onError}/> : null}
    {isMiniMart && tab === 'settlement' ? (
      <section className="purchasing-settlement-panel">
        <nav className="purchasing-subtabs" aria-label="Payment and return sections">
          <button type="button" className={settlementTab === 'payables' ? 'active' : ''} onClick={() => setSettlementTab('payables')}><CreditCard size={16}/><span>Supplier Payment</span></button>
          <button type="button" className={settlementTab === 'returns' ? 'active' : ''} onClick={() => setSettlementTab('returns')}><RotateCcw size={16}/><span>Return</span></button>
        </nav>
        {settlementTab === 'payables' ? <Phase10PayablesPanel notify={notify} onError={onError}/> : null}
        {settlementTab === 'returns' ? <Phase10ReturnsPanel notify={notify} onError={onError}/> : null}
      </section>
    ) : null}
    {isMiniMart && tab === 'reports' ? <Phase10PurchasingReports notify={notify} onError={onError}/> : null}
    {tab === 'legacy' ? <PurchaseStockPage/> : null}
  </div>;
}
