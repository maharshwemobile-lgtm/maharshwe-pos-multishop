import React, { useEffect, useMemo, useState } from 'react';
import {
  Barcode,
  ChevronLeft,
  ChevronRight,
  History,
  Loader2,
  PackagePlus,
  Plus,
  RefreshCw,
  Search,
  ShoppingBag,
  Trash2,
  Truck,
} from 'lucide-react';
import { apiFetch, clearSession } from './phase2Api';
import './purchase-stock.css';

const today = () => new Date().toISOString().slice(0, 10);
const money = (value) => `${Number(value || 0).toLocaleString('en-US')} MMK`;
const variantLabel = (item) => `${item.product?.name || 'Product'} — ${item.variantName}${item.sku ? ` · ${item.sku}` : ''}`;

const blankHeader = {
  supplierName: '',
  invoiceNumber: '',
  purchaseDate: today(),
  status: 'PAID',
  note: '',
};

function newLine(variants = []) {
  const first = variants[0];
  return {
    key: `${Date.now()}_${Math.random()}`,
    productVariantId: first?.id || '',
    quantity: '1',
    unitCost: first?.costPrice ?? '0',
  };
}

export default function PurchaseStockPage() {
  const [variants, setVariants] = useState([]);
  const [header, setHeader] = useState(blankHeader);
  const [lines, setLines] = useState([]);
  const [history, setHistory] = useState([]);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyPages, setHistoryPages] = useState(1);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);
  const [barcode, setBarcode] = useState('');
  const [productSearch, setProductSearch] = useState('');

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
    setLines((current) => current.length ? current : [newLine(all)]);
  };

  const loadHistory = async () => {
    const data = await apiFetch(`/api/inventory/purchases?page=${historyPage}&limit=10`);
    setHistory(data.purchases || []);
    setHistoryTotal(Number(data.total || 0));
    setHistoryPages(Math.max(1, Number(data.totalPages || 1)));
  };

  const load = async () => {
    setLoading(true);
    try {
      await Promise.all([loadVariants(), loadHistory()]);
    } catch (error) {
      handleError(error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [historyPage]);

  const filteredVariants = useMemo(() => {
    const needle = productSearch.trim().toLowerCase();
    if (!needle) return variants;
    return variants.filter((item) => [item.product?.name, item.variantName, item.sku, item.barcode].filter(Boolean).join(' ').toLowerCase().includes(needle));
  }, [variants, productSearch]);

  const totalAmount = useMemo(() => lines.reduce((sum, line) => {
    const quantity = Math.max(0, Number.parseInt(line.quantity || '0', 10) || 0);
    const cost = Math.max(0, Number(line.unitCost || 0));
    return sum + quantity * cost;
  }, 0), [lines]);

  const updateLine = (key, patch) => {
    setLines((current) => current.map((line) => {
      if (line.key !== key) return line;
      const next = { ...line, ...patch };
      if (patch.productVariantId) {
        const variant = variants.find((item) => item.id === patch.productVariantId);
        next.unitCost = variant?.costPrice ?? next.unitCost;
      }
      return next;
    }));
  };

  const addByBarcode = () => {
    const normalized = barcode.trim();
    if (!normalized) return;
    const variant = variants.find((item) => item.barcode === normalized || item.sku === normalized);
    if (!variant) {
      notify('error', 'Barcode / SKU နှင့်ကိုက်ညီသော Variant မတွေ့ပါ။');
      return;
    }
    setLines((current) => {
      const existing = current.find((line) => line.productVariantId === variant.id);
      if (existing) {
        return current.map((line) => line.key === existing.key
          ? { ...line, quantity: String((Number.parseInt(line.quantity || '0', 10) || 0) + 1) }
          : line);
      }
      return [...current, {
        key: `${Date.now()}_${Math.random()}`,
        productVariantId: variant.id,
        quantity: '1',
        unitCost: variant.costPrice ?? '0',
      }];
    });
    setBarcode('');
    notify('success', `${variantLabel(variant)} added.`);
  };

  const submit = async (event) => {
    event.preventDefault();
    const items = lines
      .map((line) => ({
        productVariantId: line.productVariantId,
        quantity: Number.parseInt(line.quantity || '0', 10) || 0,
        unitCost: Number(line.unitCost || 0),
      }))
      .filter((item) => item.productVariantId && item.quantity > 0);

    if (!header.supplierName.trim()) {
      notify('error', 'Supplier name ထည့်ပါ။');
      return;
    }
    if (!items.length) {
      notify('error', 'အနည်းဆုံး Purchase item တစ်ခုထည့်ပါ။');
      return;
    }

    setSaving(true);
    try {
      const data = await apiFetch('/api/inventory/purchases', {
        method: 'POST',
        body: { ...header, items },
      });
      notify('success', `Purchase saved. Stock +${items.reduce((sum, item) => sum + item.quantity, 0)} units`);
      setHeader({ ...blankHeader, purchaseDate: today() });
      setLines([newLine(variants)]);
      setHistoryPage(1);
      await Promise.all([loadVariants(), loadHistory()]);
      return data;
    } catch (error) {
      handleError(error);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="purchase-page">
      {message ? <div className={`purchase-toast purchase-toast-${message.type}`}>{message.text}</div> : null}

      <div className="purchase-page-heading">
        <div><span>PURCHASE RECEIVING</span><h2>Purchase → Stock Auto Add</h2><p>Supplier ထံမှ ဝယ်ယူထားသော Product Variants ကိုစာရင်းသွင်းပြီး Stock နဲ့ Cost Price ကို အလိုအလျောက် Update လုပ်ပါ။</p></div>
        <button type="button" onClick={load} disabled={loading}><RefreshCw className={loading ? 'purchase-spin' : ''} size={18} /> Refresh</button>
      </div>

      <section className="purchase-layout">
        <form className="purchase-form-card" onSubmit={submit}>
          <header><div><Truck size={22} /></div><span><h3>New Purchase</h3><p>Receiving note and purchased variants</p></span></header>

          <div className="purchase-header-grid">
            <label><span>Supplier *</span><input value={header.supplierName} onChange={(event) => setHeader({ ...header, supplierName: event.target.value })} required /></label>
            <label><span>Invoice Number</span><input value={header.invoiceNumber} onChange={(event) => setHeader({ ...header, invoiceNumber: event.target.value })} /></label>
            <label><span>Purchase Date *</span><input type="date" value={header.purchaseDate} onChange={(event) => setHeader({ ...header, purchaseDate: event.target.value })} required /></label>
            <label><span>Payment Status</span><select value={header.status} onChange={(event) => setHeader({ ...header, status: event.target.value })}><option value="PAID">Paid</option><option value="PARTIAL">Partial</option><option value="CREDIT">Credit</option></select></label>
          </div>

          <div className="purchase-quick-add">
            <div><Barcode size={18} /><input value={barcode} onChange={(event) => setBarcode(event.target.value)} onKeyDown={(event) => {
              if (event.key === 'Enter') { event.preventDefault(); addByBarcode(); }
            }} placeholder="Scan barcode or enter SKU" /></div>
            <button type="button" onClick={addByBarcode}><PackagePlus size={18} /> Add Item</button>
          </div>

          <div className="purchase-lines-heading"><div><ShoppingBag size={18} /><b>Purchase Items</b></div><button type="button" onClick={() => setLines((current) => [...current, newLine(variants)])}><Plus size={17} /> Add Row</button></div>
          <label className="purchase-search"><Search size={16} /><input value={productSearch} onChange={(event) => setProductSearch(event.target.value)} placeholder="Filter product dropdown by name, SKU or barcode" /></label>

          <div className="purchase-lines-table-wrap">
            <table className="purchase-lines-table">
              <thead><tr><th>Product Variant</th><th>Current</th><th>Qty</th><th>Unit Cost</th><th>Total</th><th /></tr></thead>
              <tbody>
                {lines.map((line) => {
                  const selected = variants.find((item) => item.id === line.productVariantId);
                  const quantity = Number.parseInt(line.quantity || '0', 10) || 0;
                  const cost = Number(line.unitCost || 0);
                  return <tr key={line.key}>
                    <td><select value={line.productVariantId} onChange={(event) => updateLine(line.key, { productVariantId: event.target.value })} required><option value="">Select variant</option>{filteredVariants.map((variant) => <option key={variant.id} value={variant.id}>{variantLabel(variant)}</option>)}</select></td>
                    <td><span className="purchase-stock-pill">{Number(selected?.inventory?.quantity || 0)}</span></td>
                    <td><input type="number" min="1" step="1" value={line.quantity} onChange={(event) => updateLine(line.key, { quantity: event.target.value })} required /></td>
                    <td><input type="number" min="0" step="1" value={line.unitCost} onChange={(event) => updateLine(line.key, { unitCost: event.target.value })} required /></td>
                    <td><b>{money(quantity * cost)}</b></td>
                    <td><button type="button" className="purchase-delete" onClick={() => setLines((current) => current.filter((item) => item.key !== line.key))} disabled={lines.length <= 1}><Trash2 size={17} /></button></td>
                  </tr>;
                })}
              </tbody>
            </table>
          </div>

          <label className="purchase-note"><span>Note</span><textarea rows="3" value={header.note} onChange={(event) => setHeader({ ...header, note: event.target.value })} /></label>
          <footer><div><span>Purchase Total</span><b>{money(totalAmount)}</b></div><button type="submit" disabled={saving}>{saving ? <Loader2 className="purchase-spin" size={19} /> : <PackagePlus size={19} />} Save & Add Stock</button></footer>
        </form>

        <section className="purchase-history-card">
          <header><div><History size={22} /></div><span><h3>Purchase History</h3><p>{historyTotal} receiving records</p></span></header>
          {loading && !history.length ? <div className="purchase-loading"><Loader2 className="purchase-spin" /> Loading…</div> : history.length ? <div className="purchase-history-list">{history.map((purchase) => <article key={purchase.id}><div className="purchase-history-title"><span><b>{purchase.supplierName || 'Supplier'}</b><small>{purchase.purchaseDate || '-'} · {purchase.invoiceNumber || 'No invoice'}</small></span><strong>{money(purchase.totalAmount)}</strong></div><div className="purchase-history-meta"><span>{purchase.itemCount || purchase.items?.length || 0} variants</span><span>{purchase.status || 'PAID'}</span><span>{purchase.user?.name || purchase.user?.username || '-'}</span></div>{purchase.items?.slice(0, 4).map((item) => <p key={item.productVariantId}>{item.productName} — {item.variantName}: +{item.quantity}</p>)}</article>)}</div> : <div className="purchase-empty"><History size={35} /><b>No purchase history yet</b></div>}
          <footer><button type="button" onClick={() => setHistoryPage((value) => Math.max(1, value - 1))} disabled={historyPage <= 1}><ChevronLeft size={17} /></button><span>{historyPage} / {historyPages}</span><button type="button" onClick={() => setHistoryPage((value) => Math.min(historyPages, value + 1))} disabled={historyPage >= historyPages}><ChevronRight size={17} /></button></footer>
        </section>
      </section>
    </div>
  );
}
