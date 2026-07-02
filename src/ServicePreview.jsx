import React, { useEffect, useState } from 'react';
import { Search, Wrench } from 'lucide-react';
import { apiFetch } from './phase2Api';

const money = (value) => Number(value || 0).toLocaleString('en-US') + ' MMK';
const today = new Date().toISOString().slice(0, 10);

export default function ServicePreview() {
  const [date, setDate] = useState('');
  const [month, setMonth] = useState('');
  const [query, setQuery] = useState('');
  const [data, setData] = useState({ summary: { total: 0, pending: 0, done: 0, picked: 0 }, repairs: [] });
  const [form, setForm] = useState({ repairId: '', date: today, customer: '', device: '', issue: '', status: 'Pending', pickup: 'Not Collected', cost: 0 });
  const [message, setMessage] = useState('');

  const load = async () => {
    const params = new URLSearchParams();
    if (date) params.set('date', date);
    if (month) params.set('month', month);
    if (query) params.set('q', query);
    try {
      const json = await apiFetch(`/api/service-jobs?${params.toString()}`);
      setData(json);
      setMessage('');
    } catch (error) {
      setMessage(error.message || 'Load failed');
    }
  };

  useEffect(() => { const timer = setTimeout(load, 180); return () => clearTimeout(timer); }, [date, month, query]);

  const save = async (event) => {
    event.preventDefault();
    try {
      const json = await apiFetch('/api/service-jobs', { method: 'POST', body: form });
      setMessage(json.ok ? 'Service job saved' : json.message || 'Save failed');
      if (json.ok) {
        setForm({ repairId: '', date: today, customer: '', device: '', issue: '', status: 'Pending', pickup: 'Not Collected', cost: 0 });
        load();
      }
    } catch (error) {
      setMessage(error.message || 'Save failed');
    }
  };

  const update = async (row, patch) => {
    try {
      const json = await apiFetch(`/api/service-jobs/${encodeURIComponent(row.id || row.repairId)}`, { method: 'PUT', body: patch });
      setMessage(json.ok ? 'Updated' : json.message || 'Update failed');
      if (json.ok) load();
    } catch (error) {
      setMessage(error.message || 'Update failed');
    }
  };

  const remove = async (row) => {
    if (!window.confirm('Delete this service job?')) return;
    try {
      const json = await apiFetch(`/api/service-jobs/${encodeURIComponent(row.id || row.repairId)}`, { method: 'DELETE' });
      setMessage(json.ok ? 'Deleted' : json.message || 'Delete failed');
      if (json.ok) load();
    } catch (error) {
      setMessage(error.message || 'Delete failed');
    }
  };

  const cards = [
    { title: 'Total Service Jobs', value: data.summary.total, tone: 'blue' },
    { title: 'Pending', value: data.summary.pending, tone: 'orange' },
    { title: 'Completed', value: data.summary.done, tone: 'green' },
    { title: 'Collected', value: data.summary.picked, tone: 'red' },
  ];
  const rows = data.repairs || [];

  return <>
    <section className="stats">{cards.map((card) => <div className="stat" key={card.title}><div className={`statIcon ${card.tone}`}><Wrench /></div><div><p>{card.title}</p><h2>{card.value}</h2><small>Live database</small></div></div>)}</section>
    <section className="card">
      <div className="cardHead"><h3>New Service Job</h3><span>{message}</span></div>
      <form className="toolbar" onSubmit={save} style={{ alignItems: 'end', flexWrap: 'wrap' }}>
        <label>ID<input value={form.repairId} onChange={(event) => setForm({ ...form, repairId: event.target.value })} placeholder="Auto if empty" /></label>
        <label>Date<input type="date" value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} /></label>
        <label>Customer<input value={form.customer} onChange={(event) => setForm({ ...form, customer: event.target.value })} required /></label>
        <label>Device<input value={form.device} onChange={(event) => setForm({ ...form, device: event.target.value })} required /></label>
        <label>Problem<input value={form.issue} onChange={(event) => setForm({ ...form, issue: event.target.value })} /></label>
        <label>Cost<input type="number" value={form.cost} onChange={(event) => setForm({ ...form, cost: event.target.value })} /></label>
        <button className="primary" type="submit">Save</button>
      </form>
    </section>
    <section className="card" style={{ marginTop: 18 }}>
      <div className="cardHead"><h3>Service Jobs</h3><span>Search by date, month or ID</span></div>
      <div className="toolbar" style={{ alignItems: 'end' }}><label>Date<input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label><label>Month<input type="month" value={month} onChange={(event) => setMonth(event.target.value)} /></label><label>Search<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ID / Customer / Device" /></label><button onClick={() => { setDate(''); setMonth(''); setQuery(''); }}><Search size={16}/> Clear</button></div>
      <div style={{ overflowX: 'auto' }}><table><thead><tr><th>ID</th><th>Date</th><th>Customer</th><th>Device / Problem</th><th>Status</th><th>Pickup</th><th>Cost</th><th>Action</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id || row.repairId}><td><b>{row.repairId}</b></td><td>{row.date}</td><td>{row.customer}</td><td>{row.device} / {row.issue}</td><td><span className={row.status === 'Completed' ? 'badge Done' : 'badge Pending'}>{row.status}</span></td><td>{row.pickup}</td><td><b>{money(row.cost)}</b></td><td><button onClick={() => update(row, { status: row.status === 'Completed' ? 'Pending' : 'Completed' })}>{row.status === 'Completed' ? 'Reopen' : 'Complete'}</button> <button onClick={() => update(row, { pickup: row.pickup === 'Collected' ? 'Not Collected' : 'Collected' })}>{row.pickup === 'Collected' ? 'Undo Pickup' : 'Collected'}</button> <button onClick={() => remove(row)}>Delete</button></td></tr>)}{!rows.length && <tr><td colSpan="8">No service jobs found.</td></tr>}</tbody></table></div>
    </section>
  </>;
}
