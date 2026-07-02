import React, { useState } from 'react';
import { CheckCircle2, ChevronDown, ClipboardList, Eye, Loader2, RefreshCw, Search } from 'lucide-react';
import { apiFetch } from './phase2Api';

const money = (value) => `${Number(value || 0).toLocaleString('en-US')} MMK`;
const statuses = ['', 'DRAFT', 'APPROVED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED'];

export default function Phase10PurchaseOrderList({ orders, loading, search, status, setSearch, setStatus, onRefresh, onError, onApproved }) {
  const [detail, setDetail] = useState(null);
  const [working, setWorking] = useState(false);

  const openDetail = async (id) => {
    try {
      const data = await apiFetch(`/api/purchasing/orders/${id}`);
      setDetail(data.order || null);
    } catch (error) {
      onError(error);
    }
  };

  const approve = async () => {
    if (!detail?.id) return;
    if (!window.confirm('Approve this Purchase Order? Stock remains unchanged until Goods Receiving.')) return;
    setWorking(true);
    try {
      const data = await apiFetch(`/api/purchasing/orders/${detail.id}/approve`, { method: 'POST', body: {} });
      setDetail(data.order || null);
      onApproved(data.order);
    } catch (error) {
      onError(error);
    } finally {
      setWorking(false);
    }
  };

  return (
    <>
      <section className="purchasing-card purchasing-orders-card">
        <header>
          <div><ClipboardList size={20} /></div>
          <span><h3>Purchase Orders</h3><p>{orders.length} visible orders</p></span>
          <button type="button" className="icon-button" onClick={onRefresh} disabled={loading}><RefreshCw className={loading ? 'purchasing-spin' : ''} size={18} /></button>
        </header>
        <div className="po-filter-row">
          <label className="purchasing-search"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search PO or supplier" /></label>
          <label className="po-status-filter"><ChevronDown size={16} /><select value={status} onChange={(event) => setStatus(event.target.value)}>{statuses.map((item) => <option key={item || 'ALL'} value={item}>{item || 'ALL STATUS'}</option>)}</select></label>
        </div>

        {loading && !orders.length ? <div className="purchasing-empty"><Loader2 className="purchasing-spin" /> Loading orders…</div> : null}
        {!loading && !orders.length ? <div className="purchasing-empty"><ClipboardList size={34} /><b>No purchase orders yet</b></div> : null}

        <div className="po-list">
          {orders.map((order) => (
            <article key={order.id}>
              <div><b>{order.orderNumber}</b><span>{order.supplierCode} · {order.supplierName}</span><small>{String(order.orderDate || '').slice(0, 10)} · {order.itemCount || 0} items</small></div>
              <div className="po-list-amount"><strong>{money(order.totalAmount)}</strong><em className={`po-status ${String(order.status || '').toLowerCase()}`}>{order.status}</em></div>
              <button type="button" className="icon-button" onClick={() => openDetail(order.id)}><Eye size={18} /></button>
            </article>
          ))}
        </div>
      </section>

      {detail ? <div className="po-modal-backdrop" onClick={() => setDetail(null)}>
        <section className="po-modal" onClick={(event) => event.stopPropagation()}>
          <header><div><ClipboardList size={22} /></div><span><h3>{detail.orderNumber}</h3><p>{detail.supplierCode} · {detail.supplierName}</p></span><button type="button" className="icon-button" onClick={() => setDetail(null)}>×</button></header>
          <div className="po-detail-meta">
            <span>Status <b className={`po-status ${String(detail.status || '').toLowerCase()}`}>{detail.status}</b></span>
            <span>Order Date <b>{String(detail.orderDate || '').slice(0, 10)}</b></span>
            <span>Total <b>{money(detail.totalAmount)}</b></span>
          </div>
          <div className="po-lines-wrap">
            <table className="po-lines-table">
              <thead><tr><th>Product</th><th>Qty</th><th>Received</th><th>Cost</th><th>Total</th></tr></thead>
              <tbody>{(detail.items || []).map((item) => <tr key={item.id}>
                <td><b>{item.productName}</b><small>{item.variantName || '-'}{item.sku ? ` · ${item.sku}` : ''}</small></td>
                <td>{item.orderedQuantity}</td><td>{item.receivedQuantity}</td><td>{money(item.unitCost)}</td><td>{money(item.lineTotal)}</td>
              </tr>)}</tbody>
            </table>
          </div>
          <footer><span>Creating or approving a PO does not change stock.</span>{detail.status === 'DRAFT' ? <button type="button" onClick={approve} disabled={working}>{working ? <Loader2 className="purchasing-spin" size={18} /> : <CheckCircle2 size={18} />} Approve PO</button> : null}</footer>
        </section>
      </div> : null}
    </>
  );
}
