import React, { useEffect, useMemo, useState } from 'react';
import { Loader2, RotateCcw, Truck } from 'lucide-react';
import { apiFetch } from './phase2Api';
import { loadAllOrders, money, normalizeQuantity, today } from './phase10PurchasingUtils';

export default function Phase10ReturnsPanel({ notify, onError }) {
  const [orders, setOrders] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [detail, setDetail] = useState(null);
  const [quantities, setQuantities] = useState({});
  const [returnDate, setReturnDate] = useState(today());
  const [reason, setReason] = useState('Damaged or incorrect goods');
  const [saving, setSaving] = useState(false);

  const available = useMemo(() => orders.filter((row) => ['PARTIALLY_RECEIVED', 'RECEIVED'].includes(row.status)), [orders]);
  const selectedLines = useMemo(() => (detail?.items || []).map((item) => ({ ...item, returnQuantity: normalizeQuantity(quantities[item.id]) })).filter((item) => item.returnQuantity > 0), [detail, quantities]);
  const total = selectedLines.reduce((sum, item) => sum + item.returnQuantity * Number(item.unitCost || 0), 0);

  const load = async () => { try { setOrders(await loadAllOrders()); } catch (error) { onError(error); } };
  useEffect(() => { load(); }, []);

  const choose = async (id) => {
    setSelectedId(id); setDetail(null); setQuantities({});
    if (!id) return;
    try {
      const data = await apiFetch(`/api/purchasing/orders/${id}`);
      setDetail(data.order);
      setQuantities(Object.fromEntries((data.order.items || []).map((item) => [item.id, 0])));
    } catch (error) { onError(error); }
  };

  const submit = async () => {
    if (!detail?.id || !selectedLines.length) return notify('error', 'Return quantity ထည့်ပါ။');
    if (!reason.trim()) return notify('error', 'Return reason ထည့်ပါ။');
    if (!window.confirm(`${detail.orderNumber} မှ ${money(total)} တန်ဖိုးရှိ goods ပြန်ပို့မလား? Stock လျော့သွားပါမယ်။`)) return;
    setSaving(true);
    try {
      const data = await apiFetch('/api/purchasing/returns', { method: 'POST', body: { purchaseOrderId: detail.id, returnDate, reason, items: selectedLines.map((item) => ({ purchaseOrderItemId: item.id, quantity: item.returnQuantity })) } });
      notify('success', `${data.purchaseReturn?.returnNumber || 'Return'} completed. Stock reduced.`);
      setSelectedId(''); setDetail(null); setQuantities({}); await load();
    } catch (error) { onError(error); } finally { setSaving(false); }
  };

  return <section className="purchasing-card p10-wide-card">
    <header><div><RotateCcw size={20}/></div><span><h3>Supplier Returns</h3><p>Received goods ကို supplier ဆီပြန်ပို့ပြီး Stock နဲ့ Payable ကိုလျှော့ပါမယ်။</p></span></header>
    <div className="p10-form-body">
      <div className="p10-three-col"><label className="p10-field"><span>Purchase Order</span><select value={selectedId} onChange={(e) => choose(e.target.value)}><option value="">Select received order</option>{available.map((row) => <option key={row.id} value={row.id}>{row.orderNumber} · {row.supplierName}</option>)}</select></label><label className="p10-field"><span>Return Date</span><input type="date" value={returnDate} onChange={(e) => setReturnDate(e.target.value)}/></label><label className="p10-field"><span>Reason</span><input value={reason} onChange={(e) => setReason(e.target.value)}/></label></div>
      {detail ? <>
        <div className="p10-order-meta"><span><small>Supplier</small><b>{detail.supplierCode} · {detail.supplierName}</b></span><span><small>Status</small><b>{detail.status}</b></span><span><small>Returned</small><b>{detail.returnedQuantity || 0}</b></span></div>
        <div className="p10-table-wrap"><table className="p10-table"><thead><tr><th>Product</th><th>Received</th><th>Returned</th><th>Returnable</th><th>Return Now</th><th>Cost</th></tr></thead><tbody>{(detail.items || []).map((item) => { const returnable = Number(item.returnableQuantity ?? (item.receivedQuantity - (item.returnedQuantity || 0))) || 0; return <tr key={item.id}><td><b>{item.productName}</b><small>{item.variantName || '-'}{item.sku ? ` · ${item.sku}` : ''}</small></td><td>{item.receivedQuantity}</td><td>{item.returnedQuantity || 0}</td><td>{returnable}</td><td><input className="p10-qty-input" type="number" min="0" max={returnable} value={quantities[item.id] ?? 0} onChange={(e) => setQuantities((v) => ({ ...v, [item.id]: Math.min(returnable, normalizeQuantity(e.target.value)) }))}/></td><td>{money(item.unitCost)}</td></tr>; })}</tbody></table></div>
        <div className="p10-submit-bar"><span>Return Total <b>{money(total)}</b></span><button type="button" onClick={submit} disabled={saving || !selectedLines.length}>{saving ? <Loader2 className="purchasing-spin" size={18}/> : <RotateCcw size={18}/>} Confirm Return</button></div>
      </> : <div className="purchasing-empty"><Truck size={34}/><b>Select a received Purchase Order</b></div>}
    </div>
  </section>;
}
