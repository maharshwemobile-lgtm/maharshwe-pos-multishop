import React, { useEffect, useMemo, useState } from 'react';
import { Building2, CheckCircle2, Edit3, Loader2, Plus, RefreshCw, Search, ToggleLeft, ToggleRight } from 'lucide-react';
import { apiFetch, clearSession } from './phase2Api';

const blankForm = { supplierCode: '', name: '', active: true };

export default function SupplierManagementPanel({ onOpenOrders }) {
  const [suppliers, setSuppliers] = useState([]);
  const [dashboard, setDashboard] = useState({});
  const [search, setSearch] = useState('');
  const [form, setForm] = useState(blankForm);
  const [editingId, setEditingId] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);

  const notify = (type, text) => {
    setMessage({ type, text });
    window.clearTimeout(notify.timer);
    notify.timer = window.setTimeout(() => setMessage(null), 3500);
  };

  const handleError = (error) => {
    if (error?.status === 401) {
      clearSession();
      window.location.reload();
      return;
    }
    notify('error', error?.message || 'Request failed');
  };

  const load = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: '1', limit: '100' });
      if (search.trim()) params.set('q', search.trim());
      const [supplierData, dashboardData] = await Promise.all([
        apiFetch(`/api/purchasing/suppliers?${params}`),
        apiFetch('/api/purchasing/dashboard'),
      ]);
      setSuppliers(supplierData.suppliers || []);
      setDashboard(dashboardData.dashboard || {});
    } catch (error) {
      handleError(error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const timer = window.setTimeout(load, 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  const activeCount = useMemo(() => suppliers.filter((item) => item.active).length, [suppliers]);

  const resetForm = () => {
    setForm(blankForm);
    setEditingId('');
  };

  const submit = async (event) => {
    event.preventDefault();
    if (!form.name.trim()) return notify('error', 'Supplier name ထည့်ပါ။');
    setSaving(true);
    try {
      const body = {
        name: form.name.trim(),
        active: Boolean(form.active),
        ...(form.supplierCode.trim() ? { supplierCode: form.supplierCode.trim() } : {}),
      };
      if (editingId) {
        await apiFetch(`/api/purchasing/suppliers/${editingId}`, { method: 'PATCH', body });
        notify('success', 'Supplier updated.');
      } else {
        const data = await apiFetch('/api/purchasing/suppliers', { method: 'POST', body });
        notify('success', `${data.supplier?.supplierCode || 'Supplier'} created.`);
      }
      resetForm();
      await load();
    } catch (error) {
      handleError(error);
    } finally {
      setSaving(false);
    }
  };

  const edit = (supplier) => {
    setEditingId(supplier.id);
    setForm({ supplierCode: supplier.supplierCode || '', name: supplier.name || '', active: supplier.active !== false });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const toggleActive = async (supplier) => {
    try {
      await apiFetch(`/api/purchasing/suppliers/${supplier.id}`, {
        method: 'PATCH',
        body: { active: !supplier.active },
      });
      notify('success', supplier.active ? 'Supplier disabled.' : 'Supplier enabled.');
      await load();
    } catch (error) {
      handleError(error);
    }
  };

  return (
    <section className="purchasing-panel">
      {message ? <div className={`purchasing-toast ${message.type}`}>{message.text}</div> : null}

      <div className="purchasing-stats">
        <article><span>Active Suppliers</span><strong>{Number(dashboard.activeSuppliers ?? activeCount)}</strong><Building2 size={22} /></article>
        <article><span>Draft Orders</span><strong>{Number(dashboard.draftOrders || 0)}</strong><Edit3 size={22} /></article>
        <article><span>Approved Orders</span><strong>{Number(dashboard.approvedOrders || 0)}</strong><CheckCircle2 size={22} /></article>
      </div>

      <div className="purchasing-two-column">
        <form className="purchasing-card purchasing-form" onSubmit={submit}>
          <header>
            <div><Plus size={20} /></div>
            <span><h3>{editingId ? 'Edit Supplier' : 'New Supplier'}</h3><p>Code can be generated automatically.</p></span>
          </header>
          <label><span>Supplier Code</span><input value={form.supplierCode} onChange={(event) => setForm({ ...form, supplierCode: event.target.value })} placeholder="Auto: SUP0001" /></label>
          <label><span>Supplier Name *</span><input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Supplier / Company name" required /></label>
          <label className="purchasing-check"><input type="checkbox" checked={form.active} onChange={(event) => setForm({ ...form, active: event.target.checked })} /><span>Active supplier</span></label>
          <footer>
            {editingId ? <button type="button" className="secondary" onClick={resetForm}>Cancel</button> : null}
            <button type="submit" disabled={saving}>{saving ? <Loader2 className="purchasing-spin" size={18} /> : <Plus size={18} />}{editingId ? 'Save Changes' : 'Create Supplier'}</button>
          </footer>
        </form>

        <section className="purchasing-card purchasing-list-card">
          <header>
            <div><Building2 size={20} /></div>
            <span><h3>Supplier Master</h3><p>{suppliers.length} visible suppliers</p></span>
            <button type="button" className="icon-button" onClick={load} disabled={loading}><RefreshCw className={loading ? 'purchasing-spin' : ''} size={18} /></button>
          </header>
          <label className="purchasing-search"><Search size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search code or supplier name" /></label>
          {loading && !suppliers.length ? <div className="purchasing-empty"><Loader2 className="purchasing-spin" /> Loading suppliers…</div> : null}
          {!loading && !suppliers.length ? <div className="purchasing-empty"><Building2 size={34} /><b>No suppliers yet</b><span>Create the first supplier from the form.</span></div> : null}
          <div className="supplier-list">
            {suppliers.map((supplier) => (
              <article key={supplier.id} className={supplier.active ? '' : 'disabled'}>
                <div className="supplier-avatar">{String(supplier.name || 'S').slice(0, 1).toUpperCase()}</div>
                <div className="supplier-main"><b>{supplier.name}</b><span>{supplier.supplierCode} · {supplier.purchaseOrderCount || 0} orders</span></div>
                <button type="button" className="icon-button" title="Edit" onClick={() => edit(supplier)}><Edit3 size={17} /></button>
                <button type="button" className="icon-button" title={supplier.active ? 'Disable' : 'Enable'} onClick={() => toggleActive(supplier)}>{supplier.active ? <ToggleRight size={22} /> : <ToggleLeft size={22} />}</button>
              </article>
            ))}
          </div>
          <footer><button type="button" onClick={onOpenOrders}>Open Purchase Orders</button></footer>
        </section>
      </div>
    </section>
  );
}
