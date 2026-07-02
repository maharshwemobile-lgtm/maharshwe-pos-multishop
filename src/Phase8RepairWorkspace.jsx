import React, { useState } from 'react';
import { Download, Printer, Smartphone, X } from 'lucide-react';
import CustomerRepairAdminPanel from './CustomerRepairAdminPanel.jsx';
import RepairOperationsWorkspace from './RepairOperationsWorkspace.jsx';
import RepairExportPanel from './RepairExportPanel.jsx';
import RepairVoucherPrintPanel from './printing/RepairVoucherPrintPanel.jsx';
import './phase11-repair-heading.css';

export default function Phase8RepairWorkspace() {
  const [message, setMessage] = useState(null);
  const [activeTool, setActiveTool] = useState('');
  const notify = (type, text) => {
    setMessage({ type, text });
    window.clearTimeout(notify.timer);
    notify.timer = window.setTimeout(() => setMessage(null), 4000);
  };

  return (
    <div className="phase11-repair-root" style={{ display: 'flex', flexDirection: 'column', gap: 18, minWidth: 0 }}>
      <RepairOperationsWorkspace />

      <section className="phase11-repair-bottom-tools">
        <header className="phase11-repair-bottom-heading">
          <span>REPAIR TOOLS &amp; AFTERCARE</span>
          <h2>Voucher · Customer Portal · Export</h2>
          <p>လိုတဲ့ tool ကို button နိုပ်မှ form ဖွင့်သုံးပါ။</p>
        </header>
        <div className="phase11-repair-tool-buttons">
          <button type="button" className={activeTool === 'voucher' ? 'active' : ''} onClick={() => setActiveTool((value) => (value === 'voucher' ? '' : 'voucher'))}><Printer size={20} /><span><b>Repair Voucher ထုတ်မည်</b><small>Repair ID ရိုက်ပြီး voucher print</small></span></button>
          <button type="button" className={activeTool === 'customer' ? 'active' : ''} onClick={() => setActiveTool((value) => (value === 'customer' ? '' : 'customer'))}><Smartphone size={20} /><span><b>Customer Portal · Notification · Pickup · Warranty</b><small>Customer-facing operation form</small></span></button>
          <button type="button" className={activeTool === 'export' ? 'active' : ''} onClick={() => setActiveTool((value) => (value === 'export' ? '' : 'export'))}><Download size={20} /><span><b>Export Repair Transactions</b><small>CSV export filters</small></span></button>
          {activeTool ? <button type="button" className="clear-tool" onClick={() => setActiveTool('')}><X size={18} /> Hide</button> : null}
        </div>
        {activeTool === 'voucher' ? <RepairVoucherPrintPanel notify={notify}/> : null}
        {activeTool === 'customer' ? <CustomerRepairAdminPanel /> : null}
        {activeTool === 'export' ? <RepairExportPanel notify={notify}/> : null}
      </section>

      {message ? <div className={`repair-finance-toast ${message.type}`}>{message.text}</div> : null}
    </div>
  );
}
