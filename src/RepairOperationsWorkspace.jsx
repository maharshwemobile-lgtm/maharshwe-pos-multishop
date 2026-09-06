import React, { useMemo, useState } from 'react';
import {
  Calculator,
  CheckCircle2,
  Loader2,
  Search,
  Wrench,
} from 'lucide-react';
import RepairPlatformPage from './RepairPlatformPage.jsx';
import { apiFetch, clearSession } from './phase2Api';
import './repair-operations-workspace.css';

const money = (value) => `${Number(value || 0).toLocaleString('en-US')} ကျပ်`;

// A box the shop has emptied is not zero, it is unanswered -- but it is worth
// zero when the figures are added up.
const amountOf = (value) => {
  const number = Number(String(value ?? '').trim());
  return Number.isFinite(number) && number > 0 ? number : 0;
};


export default function RepairOperationsWorkspace() {
  const [repairNumber, setRepairNumber] = useState('');
  const [finance, setFinance] = useState(null);
  // Held as typed, not as numbers. Coercing on every keystroke turned a cleared
  // box straight back into 0, so the shop could not empty a field it had filled
  // in by mistake.
  const [costForm, setCostForm] = useState({ cost: '', totalCost: '' });
  const [loadingFinance, setLoadingFinance] = useState(false);
  const [savingFinance, setSavingFinance] = useState(false);
  const [message, setMessage] = useState(null);
  const [showFinanceTool, setShowFinanceTool] = useState(false);
  const [showHistoryTool, setShowHistoryTool] = useState(false);

  const notify = (type, text) => {
    setMessage({ type, text });
    window.clearTimeout(notify.timer);
    notify.timer = window.setTimeout(() => setMessage(null), 4000);
  };

  const handleError = (error) => {
    if (error?.status === 401) {
      clearSession();
      window.location.reload();
      return;
    }
    notify('error', error?.message || 'Repair finance request failed');
  };


  const findFinance = async () => {
    if (!repairNumber.trim()) return;
    setLoadingFinance(true);
    try {
      const response = await apiFetch(`/api/repair-platform/jobs/${encodeURIComponent(repairNumber.trim().toUpperCase())}/finance`);
      setFinance(response.finance);
      // Repairs priced before this form had two boxes carry a cost split across
      // parts, commission and other. They add up to the one figure now, so
      // nothing already recorded is lost when the row is next saved.
      setCostForm({
        cost: response.finance.totalCost ? String(response.finance.totalCost) : '',
        totalCost: response.finance.finalCost ? String(response.finance.finalCost) : '',
      });
      setRepairNumber(response.finance.repairNumber);
    } catch (error) {
      setFinance(null);
      setCostForm({ cost: '', totalCost: '' });
      handleError(error);
    } finally {
      setLoadingFinance(false);
    }
  };

  const saveFinance = async () => {
    if (!finance?.repairId) return;
    setSavingFinance(true);
    try {
      const response = await apiFetch(`/api/repair-platform/jobs/${finance.repairId}/finance`, {
        method: 'PATCH',
        body: {
          finalCost: amountOf(costForm.totalCost),
          partsCost: amountOf(costForm.cost),
          // Commission and other cost are gone from the form; the server zeroes
          // them when they are not sent, which is what an unsplit cost means.
          note: 'Updated from Repair Finance workspace',
        },
      });
      setFinance(response.finance);
      setCostForm({
        cost: response.finance.totalCost ? String(response.finance.totalCost) : '',
        totalCost: response.finance.finalCost ? String(response.finance.finalCost) : '',
      });
      notify('success', `${response.finance.repairNumber} သိမ်းပြီးပါပြီ`);
    } catch (error) {
      handleError(error);
    } finally {
      setSavingFinance(false);
    }
  };

  const profit = useMemo(
    () => amountOf(costForm.totalCost) - amountOf(costForm.cost),
    [costForm.cost, costForm.totalCost],
  );


  const bottomTools = (
    <>
      <div className="repair-tool-switcher repair-bottom-tool-switcher">
        <button type="button" className={showFinanceTool ? 'active' : ''} onClick={() => setShowFinanceTool((value) => !value)}>
          <Calculator size={20} />
          <span><b>ပြင်ခ နှင့် အမြတ်</b><small>ဘောက်ချာနံပါတ် ရိုက်ပြီး ကုန်ကျစရိတ် သွင်းပါ</small></span>
        </button>
        <button type="button" className={showHistoryTool ? 'active' : ''} onClick={() => setShowHistoryTool((value) => !value)}>
          <Wrench size={20} />
          <span><b>Unique Device Repair History</b><small>IMEI / Serial history search</small></span>
        </button>
      </div>

      {showFinanceTool ? <div className="repair-finance-tools repair-finance-tools-single">
        <section className="repair-cost-editor">
          <header><Calculator size={20} /><div><b>ပြင်ခ နှင့် အမြတ်</b><small>ဘောက်ချာနံပါတ် ရိုက်ရှာပြီး ကုန်ကျစရိတ်နှင့် စုစုပေါင်း ကောက်ငွေ သွင်းပါ။</small></div></header>
          <div className="repair-finance-search"><input value={repairNumber} onChange={(event) => setRepairNumber(event.target.value.toUpperCase())} placeholder="AC4470 / MS0551" onKeyDown={(event) => { if (event.key === 'Enter') findFinance(); }} /><button type="button" onClick={findFinance} disabled={loadingFinance || !repairNumber.trim()}>{loadingFinance ? <Loader2 className="repair-finance-spin" size={17} /> : <Search size={17} />} Find</button></div>
          {finance ? <div className="repair-finance-editor-grid">
            <label>
              <span>ကုန်ကျစရိတ် (Cost)</span>
              <input type="number" min="0" inputMode="numeric" placeholder="0"
                value={costForm.cost}
                onChange={(event) => setCostForm({ ...costForm, cost: event.target.value })} />
              <small>ဆိုင်က ကုန်ကျတဲ့ ငွေ — ပစ္စည်းဖိုး၊ ဆရာခ အားလုံးပေါင်း</small>
            </label>
            <label>
              <span>စုစုပေါင်း (Total Cost)</span>
              <input type="number" min="0" inputMode="numeric" placeholder="0"
                value={costForm.totalCost}
                onChange={(event) => setCostForm({ ...costForm, totalCost: event.target.value })} />
              <small>ဖောက်သည်ဆီက ကောက်တဲ့ ငွေ</small>
            </label>
            <div className={profit >= 0 ? 'profit-value' : 'loss-value'}>
              <span>အမြတ်</span>
              <b>{money(profit)}</b>
            </div>
            <button type="button" className="save-finance" onClick={saveFinance} disabled={savingFinance}>{savingFinance ? <Loader2 className="repair-finance-spin" size={17} /> : <CheckCircle2 size={17} />} သိမ်းမည်</button>
          </div> : null}
        </section>
      </div> : null}
    </>
  );

  return (
    <div className="repair-operations-workspace">
      <RepairPlatformPage showHistoryTool={showHistoryTool} setShowHistoryTool={setShowHistoryTool} bottomTools={bottomTools} />
      {message ? <div className={`repair-finance-toast ${message.type}`}>{message.text}</div> : null}
    </div>
  );
}
