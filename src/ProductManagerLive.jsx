import React, { useEffect, useState } from 'react';

const money = (v) => Number(v || 0).toLocaleString('en-US') + ' MMK';
const empty = { brand:'', model:'', category:'Accessories', costPrice:0, sellingPrice:0, stockQty:0 };

function csvRows(text) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const heads = lines[0].split(',').map((x) => x.trim());
  return lines.slice(1).map((line) => {
    const values = line.split(',');
    return Object.fromEntries(heads.map((head, index) => [head, values[index] || '']));
  });
}

export default function ProductManagerLive() {
  const [rows, setRows] = useState([]);
  const [form, setForm] = useState(empty);
  const [editId, setEditId] = useState('');
  const [query, setQuery] = useState('');
  const [message, setMessage] = useState('');

  const load = async () => {
    const data = await fetch(`/api/products?q=${encodeURIComponent(query)}`).then((r) => r.json());
    setRows(data.products || []);
  };
  useEffect(() => { load(); }, [query]);

  const save = async (event) => {
    event.preventDefault();
    const response = await fetch(editId ? `/api/products/${editId}` : '/api/products', { method: editId ? 'PUT' : 'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(form) });
    const data = await response.json();
    setMessage(data.ok ? 'Saved' : data.message || 'Failed');
    if (data.ok) { setForm(empty); setEditId(''); load(); }
  };

  const remove = async (product) => {
    if (!window.confirm('Remove this product?')) return;
    const data = await fetch(`/api/products/${product.id}`, { method:'DELETE' }).then((r) => r.json());
    setMessage(data.ok ? 'Removed' : data.message || 'Failed');
    if (data.ok) load();
  };

  const importCsv = async (file) => {
    if (!file) return;
    const products = csvRows(await file.text());
    const response = await fetch('/api/products/import', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ mode:'merge', products }) });
    const data = await response.json();
    setMessage(data.ok ? `Imported ${data.imported}` : data.message || 'Import failed');
    if (data.ok) load();
  };

  return <>
    <section className="card"><div className="cardHead"><h3>{editId ? 'Edit Product' : 'Add Product'}</h3><span>{message}</span></div><form className="toolbar" onSubmit={save} style={{flexWrap:'wrap'}}>
      {['brand','model','category','costPrice','sellingPrice','stockQty'].map((key) => <input key={key} type={key.includes('Price') || key==='stockQty' ? 'number':'text'} placeholder={key} value={form[key]} onChange={(e)=>setForm({...form,[key]:e.target.value})} />)}
      <button className="primary">{editId ? 'Update' : 'Add'}</button>{editId && <button type="button" onClick={()=>{setEditId('');setForm(empty)}}>Cancel</button>}
    </form></section>
    <section className="card" style={{marginTop:18}}><div className="toolbar"><input placeholder="Search" value={query} onChange={(e)=>setQuery(e.target.value)} /><input type="file" accept=".csv" onChange={(e)=>importCsv(e.target.files?.[0])} /><button onClick={load}>Refresh</button></div><table><thead><tr><th>Product</th><th>Category</th><th>Stock</th><th>Cost</th><th>Price</th><th>Action</th></tr></thead><tbody>
      {rows.map((p)=><tr key={p.id}><td>{p.brand} {p.model}</td><td>{p.category}</td><td>{p.stockQty}</td><td>{money(p.costPrice)}</td><td>{money(p.sellingPrice)}</td><td><button onClick={()=>{setEditId(p.id);setForm(p)}}>Edit</button> <button onClick={()=>remove(p)}>Remove</button></td></tr>)}
    </tbody></table></section>
  </>;
}
