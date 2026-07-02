import React, { useEffect, useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { apiFetch, clearSession } from './phase2Api';
import Phase10PurchaseOrderForm from './Phase10PurchaseOrderForm.jsx';
import Phase10PurchaseOrderList from './Phase10PurchaseOrderList.jsx';

export default function Phase10PurchaseOrders() {
  const [suppliers, setSuppliers] = useState([]);
  const [variants, setVariants] = useState([]);
  const [orders, setOrders] = useState([]);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState(null);

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
    notify('error', error?.message || 'Request failed');
  };

  const loadVariants = async () => {
    const all = [];
    let page = 1;
    let pages = 1;
    do {
      const data = await apiFetch(`/api/stock?page=${page}&limit=100`);
      all.push(...(data.items || []));
      pages = Math.max(1, Number(data.totalPages || 1));
      page += 1;
    } while (page <= pages && page <= 100);
    setVariants(all.filter((item) => item.active !== false));
  };

  const loadReferences = async () => {
    const supplierData = await apiFetch('/api/purchasing/suppliers?page=1&limit=100&active=true');
    setSuppliers(supplierData.suppliers || []);
    await loadVariants();
  };

  const loadOrders = async () => {
    const params = new URLSearchParams({ page: '1', limit: '100' });
    if (search.trim()) params.set('q', search.trim());
    if (status) params.set('status', status);
    const data = await apiFetch(`/api/purchasing/orders?${params}`);
    setOrders(data.orders || []);
  };

  const load = async () => {
    setLoading(true);
    try {
      await Promise.all([loadReferences(), loadOrders()]);
    } catch (error) {
      handleError(error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => loadOrders().catch(handleError), 250);
    return () => window.clearTimeout(timer);
  }, [search, status]);

  const created = async (order) => {
    notify('success', `${order?.orderNumber || 'Purchase Order'} saved as DRAFT. Stock unchanged.`);
    await loadOrders();
  };

  const approved = async (order) => {
    notify('success', `${order?.orderNumber || 'Purchase Order'} approved. Stock unchanged.`);
    await loadOrders();
  };

  return (
    <section className="purchasing-panel">
      {message ? <div className={`purchasing-toast ${message.type}`}>{message.text}</div> : null}
      <div className="purchasing-warning"><ShieldAlert size={20} /><div><b>PO does not add stock</b><span>Stock changes only after Goods Receiving is implemented and tested.</span></div></div>
      <div className="purchasing-order-layout">
        <Phase10PurchaseOrderForm suppliers={suppliers} variants={variants} onCreated={created} onError={handleError} />
        <Phase10PurchaseOrderList
          orders={orders}
          loading={loading}
          search={search}
          status={status}
          setSearch={setSearch}
          setStatus={setStatus}
          onRefresh={load}
          onError={handleError}
          onApproved={approved}
        />
      </div>
    </section>
  );
}
