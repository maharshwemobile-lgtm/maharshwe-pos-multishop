import React, { useState } from 'react';
import { Loader2, Printer, Search, Wrench } from 'lucide-react';
import { apiFetch } from '../phase2Api';
import { hasPermission } from '../settings/projectAccess';
import { printRepairVoucher } from './projectPrintUtils';

export default function RepairVoucherPrintPanel({ notify }) {
  const [repairId, setRepairId] = useState('');
  const [loading, setLoading] = useState(false);
  const allowed = hasPermission('repairPrint', false);

  if (!allowed) return null;

  const print = async () => {
    const value = repairId.trim().toUpperCase();
    if (!value) return;
    const popup = window.open('', '_blank', 'width=430,height=760');
    if (!popup) {
      notify?.('error', 'Browser popup blocked. Popups ကို Allow လုပ်ပါ။');
      return;
    }
    popup.document.write('<!doctype html><html><body style="font-family:Arial;padding:30px;text-align:center">Preparing repair voucher…</body></html>');
    popup.document.close();
    setLoading(true);
    try {
      const response = await apiFetch(`/api/repair-platform/jobs/${encodeURIComponent(value)}`);
      await printRepairVoucher(response.repair, popup);
      setRepairId(response.repair.repairNumber || value);
    } catch (error) {
      popup.close();
      notify?.('error', error.message || 'Repair voucher failed');
    } finally {
      setLoading(false);
    }
  };

  return <section className="repair-export-panel" data-permission="repairPrint">
    <header><Printer size={20}/><div><b>Repair Voucher Print</b><small>PostgreSQL Slip Settings ထဲက Logo, Header, Footer နဲ့ Footer Tag ကို တကယ့် Repair Voucher မှာသုံးပါမယ်။</small></div></header>
    <div className="repair-finance-search">
      <input value={repairId} onChange={(event) => setRepairId(event.target.value.toUpperCase())} placeholder="MS0551 / AC0001" onKeyDown={(event) => { if (event.key === 'Enter') print(); }}/>
      <button type="button" onClick={print} disabled={loading || !repairId.trim()}>{loading ? <Loader2 className="repair-finance-spin" size={17}/> : <><Search size={17}/><Wrench size={15}/></>} Print Voucher</button>
    </div>
  </section>;
}
