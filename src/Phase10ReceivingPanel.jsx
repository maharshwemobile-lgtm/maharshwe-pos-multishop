import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Loader2, PackageCheck, RefreshCw } from 'lucide-react';
import { apiFetch } from './phase2Api';
import { loadAllOrders, money, normalizeQuantity, today } from './phase10PurchasingUtils';

export default function Phase10ReceivingPanel({ notify, onError }) {
  const [orders, setOrders] = useState([]);
  const [detail, setDetail] = useState(null);
  const [selectedId, setSelectedId] = useState('');
  const [quantities, setQuantities] = useState({});
  const [receivedDate, setReceivedDate] = useState(today());
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const available = useMemo(() => orders.filter((row) => ['APPROVED', 'PARTIALLY_RECEIVED'].includes(row.status)), [orders]);
  const selectedLines = useMemo(() => (detail?.items || []).map((item) => ({ ...item, receiveQuantity: normalizeQuantity(quantities[item.id]) })).filter((item) => item.receiveQuantity > 0), [detail, quantities]);
  const total = selectedLines.reduce((sum, item) => sum + item.receiveQuantity * Number(item.unitCost || 0), 0);

  const load = async () => {
    setLoading(true);
    try { setOrders(await loadAllOrders()); } catch (error) { onError(error); } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const choose = async (id) => {
    setSelectedId(id); setDetail(null); setQuantities({});
    if (!id) return;
    try {
      const data = await apiFetch(`/api/purchasing/orders/${id}`);
      setDetail(data.order);
      setQuantities(Object.fromEntries((data.order.items || []).map((item) => [item.id, Number(item.remainingQuantity ?? (item.orderedQuantity - item.receivedQuantity)) || 0])));
    } catch (error) { onError(error); }
  };

  const submit = async () => {
    if (!detail?.id || !selectedLines.length) return notify('error', 'Receive quantity ထည့်ပါ။');
    if (!window.confirm(`${detail.orderNumber} ကို receive လုပ်ပြီး Stock တိုးမလား?`)) return;
    setSaving(true);
    try {
      const data = await apiFetch(`/api/purchasing/orders/${detail.id}/receive`, { method: 'POST', body: { receivedDate, note: note || null, items: selectedLines.map((item) => ({ purchaseOrderItemId: item.id, quantity: item.receiveQuantity, unitCost: Number(item.unitCost || 0) })) } });
      notify('success', `${data.receipt?.receiptNumber || 'Goods receipt'} saved. Stock increased.`);
      setDetail(null); setSelectedId(''); setQuantities({}); setNote(''); await load();
    } catch (error) { onError(error); } finally { setSaving(false); }
  };

  return <section className="purchasing-card p10-wide-card">
    <header><div><PackageCheck size={20}/></div><span><h3>Goods Receiving</h3><p>Approved PO ကို partial/full receive လုပ်ပြီး Stock တိုးပါမယ်။</p></span><button type="button" className="icon-button" onClick={load}><RefreshCw className={loading ? 'purchasing-spin' : ''} size={18}/></button></header>
    <div className="p10-form-body">
      <div className="p10-three-col">
        <label className="p10-field"><span>Purchase Order</span><select value={selectedId} onChange={(e) => choose(e.target.value)}><option value="">Select order</option>{available.map((row) => <option key={row.id} value={row.id}>{row.orderNumber} · {row.supplierName} · {row.status}</option>)}</select></label>
        <label className="p10-field"><span>Received Date</span><input type="date" value={receivedDate} onChange={(e) => setReceivedDate(e.target.value)}/></label>
        <label className="p10-field"><span>Note</span><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional note"/></label>
      </div>
      {detail ? <>
        <div className="p10-order-meta"><span><small>Supplier</small><b>{detail.supplierCode} · {detail.supplierName}</b></span><span><small>Status</small><b>{detail.status}</b></span><span><small>Progress</small><b>{detail.receivedQuantity}/{detail.orderedQuantity}</b></span></div>
        <div className="p10-table-wrap"><table className="p10-table"><thead><tr><th>Product</th><th>Ordered</th><th>Received</th><th>Remaining</th><th>Receive Now</th><th>Cost</th></tr></thead><tbody>{(detail.items || []).map((item) => { const remaining = Number(item.remainingQuantity ?? (item.orderedQuantity - item.receivedQuantity)) || 0; return <tr key={item.id}><td><b>{item.productName}</b><small>{item.variantName || '-'}{item.sku ? ` · ${item.sku}` : ''}</small></td><td>{item.orderedQuantity}</td><td>{item.receivedQuantity}</td><td>{remaining}</td><td><input className="p10-qty-input" type="number" min="0" max={remaining} value={quantities[item.id] ?? 0} onChange={(e) => setQuantities((v) => ({ ...v, [item.id]: Math.min(remaining, normalizeQuantity(e.target.value)) }))}/></td><td>{money(item.unitCost)}</td></tr>; })}</tbody></table></div>
        <div className="p10-submit-bar"><span>Total <b>{money(total)}</b></span><button type="button" onClick={submit} disabled={saving || !selectedLines.length}>{saving ? <Loader2 className="purchasing-spin" size={18}/> : <CheckCircle2 size={18}/>} Confirm Receiving</button></div>
      </> : <div className="purchasing-empty"><PackageCheck size={34}/><b>Select an approved Purchase Order</b></div>}
    </div>
  </section>;
}
