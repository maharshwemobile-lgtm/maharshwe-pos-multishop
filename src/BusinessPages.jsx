import React, { useEffect, useState } from 'react';
import TenantUsersPage from './TenantUsersPage.jsx';
import { apiFetch } from './phase2Api';

const money = (value) => Number(value || 0).toLocaleString('en-US') + ' MMK';

function useRows(route) {
  const [rows, setRows] = useState([]);
  const [message, setMessage] = useState('');
  const load = async () => {
    try {
      const data = await apiFetch(`/api/${route}`);
      if (!data.ok) throw new Error(data.message || 'Load failed');
      setRows(data.rows || []);
      setMessage('');
    } catch (error) {
      setMessage(error.message || 'Load failed');
    }
  };
  useEffect(() => { load(); }, [route]);
  return { rows, message, setMessage, load };
}

function EntityPage({ title, route, fields, columns }) {
  const { rows, message, setMessage, load } = useRows(route);
  const initial = Object.fromEntries(fields.map((field) => [field.name, field.defaultValue || '']));
  const [form, setForm] = useState(initial);
  const [busy, setBusy] = useState(false);

  const save = async (event) => {
    event.preventDefault();
    setBusy(true);
    try {
      const data = await apiFetch(`/api/${route}`, { method: 'POST', body: form });
      if (!data.ok) throw new Error(data.message || 'Save failed');
      setForm(initial);
      setMessage('Saved successfully');
      await load();
    } catch (error) {
      setMessage(error.message || 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id) => {
    if (!window.confirm('Delete this record?')) return;
    try {
      const data = await apiFetch(`/api/${route}/${id}`, { method: 'DELETE' });
      setMessage(data.ok ? 'Deleted' : data.message || 'Delete failed');
      if (data.ok) load();
    } catch (error) {
      setMessage(error.message || 'Delete failed');
    }
  };

  return <section className="card">
    <div className="cardHead"><h3>{title}</h3><strong>{rows.length} records</strong></div>
    <form className="toolbar" onSubmit={save} style={{ alignItems: 'end', flexWrap: 'wrap' }}>
      {fields.map((field) => <label key={field.name}>{field.label}<input type={field.type || 'text'} value={form[field.name]} onChange={(event) => setForm({ ...form, [field.name]: event.target.value })} required={field.required} /></label>)}
      <button className="primary" type="submit" disabled={busy}>{busy ? 'Saving...' : 'Save'}</button>
    </form>
    {message && <p style={{ fontWeight: 800 }}>{message}</p>}
    <div style={{ overflowX: 'auto' }}><table><thead><tr>{columns.map((column) => <th key={column.key}>{column.label}</th>)}<th>Action</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}>{columns.map((column) => <td key={column.key}>{column.money ? money(row[column.key]) : row[column.key]}</td>)}<td><button type="button" onClick={() => remove(row.id)}>Delete</button></td></tr>)}{!rows.length && <tr><td colSpan={columns.length + 1}>No records yet.</td></tr>}</tbody></table></div>
  </section>;
}

export function CustomersPage() {
  return <EntityPage title="Customers" route="customers" fields={[{ name: 'name', label: 'Name', required: true }, { name: 'phone', label: 'Phone' }, { name: 'address', label: 'Address' }, { name: 'balance', label: 'Receivable', type: 'number' }]} columns={[{ key: 'name', label: 'Name' }, { key: 'phone', label: 'Phone' }, { key: 'address', label: 'Address' }, { key: 'balance', label: 'Receivable', money: true }]} />;
}

export function SuppliersPage() {
  return <EntityPage title="Suppliers" route="suppliers" fields={[{ name: 'name', label: 'Name', required: true }, { name: 'phone', label: 'Phone' }, { name: 'address', label: 'Address' }, { name: 'balance', label: 'Payable', type: 'number' }]} columns={[{ key: 'name', label: 'Name' }, { key: 'phone', label: 'Phone' }, { key: 'address', label: 'Address' }, { key: 'balance', label: 'Payable', money: true }]} />;
}

export function PurchasesPage() {
  const today = new Date().toISOString().slice(0, 10);
  return <EntityPage title="Purchases" route="purchases" fields={[{ name: 'purchase_date', label: 'Date', type: 'date', required: true, defaultValue: today }, { name: 'supplier', label: 'Supplier' }, { name: 'amount', label: 'Amount', type: 'number' }, { name: 'status', label: 'Status', defaultValue: 'Paid' }, { name: 'note', label: 'Note' }]} columns={[{ key: 'purchase_date', label: 'Date' }, { key: 'supplier', label: 'Supplier' }, { key: 'amount', label: 'Amount', money: true }, { key: 'status', label: 'Status' }, { key: 'note', label: 'Note' }]} />;
}

export function AccountingPage() {
  const today = new Date().toISOString().slice(0, 10);
  return <EntityPage title="Accounting" route="accounting" fields={[{ name: 'entry_date', label: 'Date', type: 'date', required: true, defaultValue: today }, { name: 'entry_type', label: 'Type', required: true, defaultValue: 'Expense' }, { name: 'category', label: 'Category' }, { name: 'amount', label: 'Amount', type: 'number' }, { name: 'account', label: 'Account' }, { name: 'note', label: 'Note' }]} columns={[{ key: 'entry_date', label: 'Date' }, { key: 'entry_type', label: 'Type' }, { key: 'category', label: 'Category' }, { key: 'amount', label: 'Amount', money: true }, { key: 'account', label: 'Account' }, { key: 'note', label: 'Note' }]} />;
}

export function ReportsPage() {
  const [report, setReport] = useState({});
  const [message, setMessage] = useState('');
  const load = async () => {
    try {
      const data = await apiFetch('/api/reports/summary');
      if (!data.ok) throw new Error(data.message || 'Report failed');
      setReport(data.report || {});
      setMessage('');
    } catch (error) { setMessage(error.message || 'Report failed'); }
  };
  useEffect(() => { load(); }, []);
  const cards = [
    ['Total Sales', report.totalSales], ['Other Income', report.otherIncome], ['Expenses', report.expense], ['Net Profit', report.netProfit],
    ['Purchases', report.totalPurchases], ['Receivable', report.receivable], ['Payable', report.payable], ['Orders', report.orders],
  ];
  return <><section className="card"><div className="cardHead"><h3>Business Reports</h3><button onClick={load}>Refresh</button></div>{message && <p>{message}</p>}</section><section className="stats">{cards.map(([title, value]) => <div className="stat" key={title}><div><p>{title}</p><h2>{title === 'Orders' ? Number(value || 0).toLocaleString() : money(value)}</h2><small>Live database</small></div></div>)}</section></>;
}

export function UsersPage() {
  return <TenantUsersPage/>;
}

export function SettingsPage() {
  const [form, setForm] = useState({ shopName: 'Mahar Shwe POS', phone: '', address: '', subtitle: 'Mobile Software & Hardware Expert' });
  const [message, setMessage] = useState('');
  useEffect(() => {
    apiFetch('/api/settings/live')
      .then((data) => setForm((current) => ({ ...current, ...(data.settings || {}) })))
      .catch((error) => setMessage(error.message || 'Settings load failed'));
  }, []);
  const save = async (event) => {
    event.preventDefault();
    try {
      const data = await apiFetch('/api/settings/live', { method: 'POST', body: form });
      setMessage(data.ok ? 'Settings saved' : data.message || 'Save failed');
    } catch (error) {
      setMessage(error.message || 'Save failed');
    }
  };
  return <section className="card"><div className="cardHead"><h3>Settings</h3></div><form onSubmit={save}><div className="grid2"><label>Shop Name<input value={form.shopName} onChange={(event) => setForm({ ...form, shopName: event.target.value })} /></label><label>Subtitle<input value={form.subtitle} onChange={(event) => setForm({ ...form, subtitle: event.target.value })} /></label><label>Phone<input value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} /></label><label>Address<input value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })} /></label></div><button className="primary" type="submit">Save Settings</button></form>{message && <p style={{ fontWeight: 800 }}>{message}</p>}</section>;
}
