import React, { useEffect, useRef, useState } from 'react';

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"' && quoted && next === '"') {
      cell += '"';
      i += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === ',' && !quoted) {
      row.push(cell);
      cell = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && next === '\n') i += 1;
      row.push(cell);
      cell = '';
      if (row.some((value) => value !== '')) rows.push(row);
      row = [];
    } else {
      cell += char;
    }
  }

  row.push(cell);
  if (row.some((value) => value !== '')) rows.push(row);
  if (!rows.length) return [];

  const headers = rows[0].map((value) => value.replace(/^\uFEFF/, '').trim());
  return rows.slice(1).map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ''])));
}

function money(value) {
  return Number(value || 0).toLocaleString('en-US') + ' MMK';
}

export default function ProductManager() {
  const inputRef = useRef(null);
  const [products, setProducts] = useState([]);
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState('merge');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const loadProducts = async () => {
    try {
      const response = await fetch(`/api/products?q=${encodeURIComponent(query)}`);
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.message || 'Products load failed');
      setProducts(data.products || []);
    } catch (error) {
      setProducts([]);
      setMessage(`Load failed: ${error.message}`);
    }
  };

  useEffect(() => {
    const timer = window.setTimeout(loadProducts, 180);
    return () => window.clearTimeout(timer);
  }, [query]);

  const importCsv = async (file) => {
    if (!file) return;
    setBusy(true);
    setMessage('Reading CSV...');
    try {
      const text = await file.text();
      const rows = parseCsv(text);
      if (!rows.length) throw new Error('CSV rows not found');

      const required = ['brand', 'model', 'category', 'costPrice', 'sellingPrice', 'stockQty'];
      const missing = required.filter((key) => !Object.prototype.hasOwnProperty.call(rows[0], key));
      if (missing.length) throw new Error(`Missing columns: ${missing.join(', ')}`);

      const response = await fetch('/api/products/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, products: rows })
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.message || 'Import failed');
      setMessage(`Import completed: ${data.imported} imported, ${data.skipped} skipped, ${data.total} total`);
      await loadProducts();
    } catch (error) {
      setMessage(`Import failed: ${error.message}`);
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return <section className="card">
    <div className="cardHead">
      <h3>Products / Stock</h3>
      <strong>{products.length} shown</strong>
    </div>

    <div className="toolbar" style={{ alignItems: 'end' }}>
      <label style={{ flex: 1 }}>Search<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Product name, brand or category" /></label>
      <label>Import Mode<select value={mode} onChange={(event) => setMode(event.target.value)}><option value="merge">Merge / Update</option><option value="replace">Replace All</option></select></label>
      <label>Inventory CSV<input ref={inputRef} type="file" accept=".csv,text/csv" disabled={busy} onChange={(event) => importCsv(event.target.files?.[0])} /></label>
      <button type="button" onClick={loadProducts}>Refresh</button>
    </div>

    {message && <p style={{ fontWeight: 800, whiteSpace: 'pre-wrap' }}>{message}</p>}

    <div style={{ overflowX: 'auto' }}>
      <table>
        <thead><tr><th>#</th><th>Product</th><th>Category</th><th>Stock</th><th>Cost</th><th>Selling Price</th><th>Status</th></tr></thead>
        <tbody>
          {products.map((product, index) => <tr key={product.id}>
            <td>{index + 1}</td>
            <td><b>{product.brand} {product.model}</b></td>
            <td>{product.category}</td>
            <td>{Number(product.stockQty || 0).toLocaleString('en-US')}</td>
            <td>{money(product.costPrice)}</td>
            <td><b>{money(product.sellingPrice)}</b></td>
            <td><span className={Number(product.stockQty || 0) > 0 ? 'badge InStock' : 'badge OutofStock'}>{Number(product.stockQty || 0) > 0 ? 'In Stock' : 'Out of Stock'}</span></td>
          </tr>)}
          {!products.length && <tr><td colSpan="7">No products found. Choose the inventory CSV file above.</td></tr>}
        </tbody>
      </table>
    </div>
  </section>;
}
