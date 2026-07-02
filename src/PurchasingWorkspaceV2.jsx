import React, { useState } from 'react';
import { ClipboardList, PackageCheck, Settings2, Truck, Users } from 'lucide-react';
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

export default function PurchasingWorkspaceV2() {
  const [tab, setTab] = useState('suppliers');
  return <div className="purchasing-hub">
    <section className="purchasing-hero">
      <div className="purchasing-hero-icon"><Truck size={28}/></div>
      <div><span>PURCHASING</span><h2>Suppliers & Purchase Orders</h2><p>Manage suppliers, orders, receiving, payables, returns, repair parts and reports.</p></div>
    </section>
    <nav className="purchasing-tabs" aria-label="Purchasing sections">
      {tabs.map((item) => <button key={item.id} type="button" className={tab === item.id ? 'active' : ''} onClick={() => setTab(item.id)}><item.icon size={18}/><span>{item.label}</span></button>)}
    </nav>
    {tab === 'suppliers' ? <SupplierManagementPanel onOpenOrders={() => setTab('orders')}/> : null}
    {tab === 'orders' ? <Phase10PurchaseOrders/> : null}
    {tab === 'operations' ? <Phase10PurchasingCompletion/> : null}
    {tab === 'legacy' ? <PurchaseStockPage/> : null}
  </div>;
}
