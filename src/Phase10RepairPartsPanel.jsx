import React, { useEffect, useMemo, useState } from 'react';
import { Loader2, RefreshCw, Search, Undo2, Wrench } from 'lucide-react';
import { apiFetch } from './phase2Api';
import { loadAllVariants, money } from './phase10PurchasingUtils';

export default function Phase10RepairPartsPanel({ notify, onError }) {
  const [repairInput, setRepairInput] = useState('');
  const [repair, setRepair] = useState(null);
  const [usages, setUsages] = useState([]);
  const [variants, setVariants] = useState([]);
  const [search, setSearch] = useState('');
  const [variantId, setVariantId] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => { loadAllVariants().then(setVariants).catch(onError); }, []);
  const filtered = useMemo(() => variants.filter((item) => {
    const text = `${item.productName || ''} ${item.variantName || ''} ${item.sku || ''}`.toLowerCase();
    return text.includes(search.trim().toLowerCase()) && Number(item.quantity || 0) > 0;
  }).slice(0, 100), [variants, search]);
  const selected = variants.find((item) => item.id === variantId);

  const loadRepair = async () => {
    if (!repairInput.trim()) return notify('error', 'Repair ID ထည့်ပါ။');
    setLoading(true);
    try {
      const data = await apiFetch(`/api/purchasing/repair-parts/${encodeURIComponent(repairInput.trim())}`);
      setRepair(data.repair); setUsages(data.usages || []);
    } catch (error) { setRepair(null); setUsages([]); onError(error); } finally { setLoading(false); }
  };

  const addPart = async () => {
    if (!repair || !variantId || Number(quantity || 0) <= 0) return notify('error', 'Repair နဲ့ Part ကိုရွေးပါ။');
    setSaving(true);
    try {
      const data = await apiFetch('/api/purchasing/repair-parts', { method: 'POST', body: { repairId: repair.id, items: [{ productVariantId: variantId, quantity: Number(quantity), note: note || null }] } });
      setRepair(data.repair); setUsages(data.usages || []); setVariantId(''); setQuantity(1); setNote('');
      notify('success', 'Repair part saved. Stock and Parts Cost updated.');
      setVariants(await loadAllVariants());
    } catch (error) { onError(error); } finally { setSaving(false); }
  };

  const reverse = async (usage) => {
    const reason = window.prompt('Reversal reason', 'Part not used');
    if (!reason) return;
    try {
      const data = await apiFetch(`/api/purchasing/repair-parts/usages/${usage.id}/reverse`, { method: 'POST', body: { reason } });
      setRepair(data.repair); setUsages(data.usages || []); setVariants(await loadAllVariants());
      notify('success', 'Part usage reversed. Stock restored.');
    } catch (error) { onError(error); }
  };

  return <div className="p10-op-grid">
    <section className="purchasing-card p10-op-form-card">
      <header><div><Wrench size={20}/></div><span><h3>Repair Parts Costing</h3><p>Repair ID နဲ့ Stock Part ကိုချိတ်ပြီး Parts Cost တွက်ပါမယ်။</p></span></header>
      <div className="p10-form-body">
        <div className="p10-search-line"><input value={repairInput} onChange={(e) => setRepairInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && loadRepair()} placeholder="Repair ID e.g. MS0551"/><button type="button" onClick={loadRepair}>{loading ? <Loader2 className="purchasing-spin" size={18}/> : <Search size={18}/>} Load</button></div>
        {repair ? <div className="p10-repair-card"><b>{repair.repairNumber}</b><span>{repair.customerName} · {[repair.deviceBrand, repair.deviceModel].filter(Boolean).join(' ')}</span><small>Status: {repair.status} · Parts Cost: {money(repair.partsCost)}</small></div> : null}
        <label className="p10-field"><span>Search Part</span><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Product, variant or SKU"/></label>
        <label className="p10-field"><span>Stock Part</span><select value={variantId} onChange={(e) => setVariantId(e.target.value)}><option value="">Select part</option>{filtered.map((item) => <option key={item.id} value={item.id}>{item.productName} · {item.variantName} · Stock {item.quantity}</option>)}</select></label>
        <div className="p10-two-col"><label className="p10-field"><span>Quantity</span><input type="number" min="1" max={selected?.quantity || 1} value={quantity} onChange={(e) => setQuantity(e.target.value)}/></label><label className="p10-field"><span>Cost</span><input readOnly value={money((selected?.costPrice || 0) * Number(quantity || 0))}/></label></div>
        <label className="p10-field"><span>Note</span><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional note"/></label>
        <button type="button" className="p10-primary-button" disabled={!repair || !variantId || saving} onClick={addPart}>{saving ? <Loader2 className="purchasing-spin" size={18}/> : <Wrench size={18}/>} Use Part</button>
      </div>
    </section>

    <section className="purchasing-card p10-op-list-card">
      <header><div><RefreshCw size={20}/></div><span><h3>Used Parts</h3><p>{repair ? repair.repairNumber : 'Load a repair'}</p></span></header>
      <div className="p10-list">{usages.map((usage) => <article key={usage.id} className={usage.reversedAt ? 'muted' : ''}><div><b>{usage.productName} · {usage.variantName}</b><span>{usage.quantity} × {money(usage.unitCost)}</span><small>{usage.reversedAt ? `Reversed · ${usage.reversalReason || ''}` : usage.note || 'Active usage'}</small></div><div><strong>{money(usage.totalCost)}</strong>{!usage.reversedAt ? <button className="p10-icon-danger" onClick={() => reverse(usage)} title="Reverse"><Undo2 size={16}/></button> : null}</div></article>)}{repair && !usages.length ? <div className="purchasing-empty"><Wrench size={32}/><b>No parts used yet</b></div> : null}</div>
    </section>
  </div>;
}
