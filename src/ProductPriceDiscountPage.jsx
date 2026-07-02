import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Edit3,
  Layers3,
  Loader2,
  PackageSearch,
  RefreshCw,
  Save,
  Search,
  Tags,
  X,
} from 'lucide-react';
import { apiFetch, clearSession, getSession } from './phase2Api';
import './price-discount-page.css';

const LIMIT = 200;

function money(value) {
  const amount = Number(value || 0);
  return `${amount.toLocaleString('en-US')} Ks`;
}

function numberValue(value) {
  const cleaned = String(value ?? '').replaceAll(',', '').trim();
  if (!cleaned) return 0;
  const amount = Number(cleaned);
  return Number.isFinite(amount) ? Math.max(0, amount) : 0;
}

function percentValue(value) {
  const amount = numberValue(value);
  return Math.max(0, Math.min(100, amount));
}

function marginPercent(selling, cost) {
  const sale = Number(selling || 0);
  const buy = Number(cost || 0);
  if (sale <= 0 || buy <= 0) return '-';
  return `${(((sale - buy) / sale) * 100).toFixed(1)}%`;
}

function variantTitle(row) {
  return [row.productName, row.variantName].filter(Boolean).join(' / ') || 'Unnamed Product';
}

function applyPercentDiscount(base, percent) {
  const amount = Number(base || 0);
  const pct = percentValue(percent);
  return Math.max(0, Math.round(amount * (100 - pct) / 100));
}

function uniqueValues(rows, key) {
  return [...new Set(rows.map((row) => String(row[key] || '').trim()).filter(Boolean))].sort();
}

export default function ProductPriceDiscountPage() {
  const session = getSession();
  const user = session?.user || {};
  const canManage = user.role === 'SUPER_ADMIN' || user.role === 'SHOP_ADMIN' || user.permissions?.inventory === true || user.permissions?.productEdit === true;
  const showCost = user.role === 'SUPER_ADMIN' || user.permissions?.viewCost === true;

  const [query, setQuery] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [groupType, setGroupType] = useState('all');
  const [groupValue, setGroupValue] = useState('');
  const [page, setPage] = useState(1);
  const [categories, setCategories] = useState([]);
  const [products, setProducts] = useState([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState({});
  const [savingId, setSavingId] = useState(null);
  const [selectedIds, setSelectedIds] = useState([]);
  const [bulkDraft, setBulkDraft] = useState({
    mode: 'sellingFixed',
    value: '',
  });
  const [bulkBusy, setBulkBusy] = useState(false);

  const notify = (type, text) => {
    setMessage({ type, text });
    window.clearTimeout(notify.timer);
    notify.timer = window.setTimeout(() => setMessage(null), 3200);
  };

  const handleError = (error) => {
    if (error?.status === 401) {
      clearSession();
      window.location.reload();
      return;
    }
    notify('error', error?.message || 'Request failed');
  };

  const loadCategories = async () => {
    try {
      const data = await apiFetch('/api/categories');
      setCategories((data.categories || []).filter((item) => item.active !== false));
    } catch (error) {
      handleError(error);
    }
  };

  const loadProducts = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(LIMIT) });
      if (query.trim()) params.set('q', query.trim());
      if (categoryId) params.set('categoryId', categoryId);
      const data = await apiFetch(`/api/products?${params.toString()}`);
      setProducts(data.products || []);
      setTotal(data.total || 0);
      setTotalPages(Math.max(1, data.totalPages || 1));
    } catch (error) {
      handleError(error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadCategories(); }, []);

  useEffect(() => {
    const timer = window.setTimeout(loadProducts, 180);
    return () => window.clearTimeout(timer);
  }, [query, categoryId, page]);

  useEffect(() => {
    setPage(1);
    setSelectedIds([]);
  }, [query, categoryId, groupType, groupValue]);

  useEffect(() => {
    setGroupValue('');
  }, [groupType, categoryId]);

  const rows = useMemo(() => products.flatMap((product) => (
    (product.variants || []).map((variant) => ({
      ...variant,
      productName: product.name,
      productBrand: product.brand || '',
      productModel: product.model || '',
      productId: product.id,
      categoryId: product.categoryId || product.category?.id || variant.categoryId || variant.category?.id || '',
      categoryName: product.category?.name || variant.category?.name || 'Uncategorized',
      productActive: product.active !== false,
    }))
  )), [products]);

  const groupOptions = useMemo(() => {
    if (groupType === 'category') return uniqueValues(rows, 'categoryName');
    if (groupType === 'brand') return uniqueValues(rows, 'productBrand');
    if (groupType === 'model') return uniqueValues(rows, 'productModel');
    return [];
  }, [rows, groupType]);

  const filteredRows = useMemo(() => rows.filter((row) => {
    if (categoryId && String(row.categoryId) !== String(categoryId)) return false;
    if (groupType === 'category' && groupValue && row.categoryName !== groupValue) return false;
    if (groupType === 'brand' && groupValue && row.productBrand !== groupValue) return false;
    if (groupType === 'model' && groupValue && row.productModel !== groupValue) return false;
    return true;
  }), [rows, categoryId, groupType, groupValue]);

  const selectedRows = useMemo(() => filteredRows.filter((row) => selectedIds.includes(row.id)), [filteredRows, selectedIds]);

  const summary = useMemo(() => {
    const stock = filteredRows.reduce((sum, row) => sum + Number(row.inventory?.quantity || 0), 0);
    const priced = filteredRows.filter((row) => Number(row.standardSellingPrice || 0) > 0).length;
    const low = filteredRows.filter((row) => {
      const quantity = Number(row.inventory?.quantity || 0);
      const alert = Number(row.inventory?.minAlertQuantity || 0);
      return alert > 0 && quantity <= alert;
    }).length;
    return { variants: filteredRows.length, stock, priced, low, selected: selectedRows.length };
  }, [filteredRows, selectedRows]);

  const editingRow = useMemo(() => rows.find((row) => row.id === editingId) || null, [rows, editingId]);

  const startEdit = (row) => {
    setEditingId(row.id);
    setDraft({
      costPrice: row.costPrice ?? '',
      standardSellingPrice: row.standardSellingPrice ?? '',
      wholesalePrice: row.wholesalePrice ?? '',
      minimumSellingPrice: row.minimumSellingPrice ?? '',
      minAlertQuantity: row.inventory?.minAlertQuantity ?? 0,
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setDraft({});
  };

  const savePrice = async (row) => {
    if (!canManage) {
      notify('error', 'Price ပြင်ရန် Inventory/Product permission လိုအပ်ပါတယ်။');
      return;
    }

    const selling = numberValue(draft.standardSellingPrice);
    const minimum = numberValue(draft.minimumSellingPrice);
    if (showCost && selling > 0 && minimum > selling) {
      notify('error', 'Minimum Price သည် Selling Price ထက် မများရပါ။');
      return;
    }

    const body = {
      standardSellingPrice: selling,
      wholesalePrice: numberValue(draft.wholesalePrice),
      minAlertQuantity: Math.max(0, Math.trunc(numberValue(draft.minAlertQuantity))),
    };

    if (showCost) {
      body.costPrice = numberValue(draft.costPrice);
      body.minimumSellingPrice = minimum;
    }

    setSavingId(row.id);
    try {
      await apiFetch(`/api/variants/${row.id}`, { method: 'PATCH', body });
      notify('success', `${variantTitle(row)} ဈေးနှုန်း သိမ်းပြီးပါပြီ`);
      setEditingId(null);
      setDraft({});
      await loadProducts();
    } catch (error) {
      handleError(error);
    } finally {
      setSavingId(null);
    }
  };

  const toggleSelected = (rowId) => {
    setSelectedIds((current) => current.includes(rowId)
      ? current.filter((id) => id !== rowId)
      : [...current, rowId]);
  };

  const selectVisible = () => {
    setSelectedIds(filteredRows.map((row) => row.id));
  };

  const clearSelected = () => {
    setSelectedIds([]);
  };

  const buildBulkBody = (row) => {
    const value = numberValue(bulkDraft.value);
    const body = {};

    if (bulkDraft.mode === 'sellingFixed') {
      body.standardSellingPrice = value;
    } else if (bulkDraft.mode === 'wholesaleFixed') {
      body.wholesalePrice = value;
    } else if (bulkDraft.mode === 'minimumFixed') {
      body.minimumSellingPrice = value;
    } else if (bulkDraft.mode === 'sellingDiscountPercent') {
      body.standardSellingPrice = applyPercentDiscount(row.standardSellingPrice, value);
    } else if (bulkDraft.mode === 'minimumDiscountPercent') {
      body.minimumSellingPrice = applyPercentDiscount(row.standardSellingPrice, value);
    }

    return body;
  };

  const applyBulk = async () => {
    if (!canManage) {
      notify('error', 'Batch price ပြင်ရန် permission လိုအပ်ပါတယ်။');
      return;
    }
    if (!selectedRows.length) {
      notify('error', 'အနည်းဆုံး item တစ်ခုရွေးပါ။');
      return;
    }
    if (!bulkDraft.value && bulkDraft.value !== 0) {
      notify('error', 'Value ထည့်ပါ။');
      return;
    }
    if ((bulkDraft.mode === 'minimumFixed' || bulkDraft.mode === 'minimumDiscountPercent') && !showCost) {
      notify('error', 'Minimum Price ပြင်ရန် viewCost permission လိုအပ်ပါတယ်။');
      return;
    }

    const actionLabel = {
      sellingFixed: 'Selling Price fixed amount',
      wholesaleFixed: 'Wholesale Price fixed amount',
      minimumFixed: 'Minimum Price fixed amount',
      sellingDiscountPercent: 'Selling Price % discount',
      minimumDiscountPercent: 'Minimum Price % discount limit',
    }[bulkDraft.mode] || 'Batch Price';

    if (!window.confirm(`${selectedRows.length} items ကို ${actionLabel} apply လုပ်မလား?`)) return;

    setBulkBusy(true);
    try {
      for (const row of selectedRows) {
        await apiFetch(`/api/variants/${row.id}`, {
          method: 'PATCH',
          body: buildBulkBody(row),
        });
      }
      notify('success', `${selectedRows.length} items batch price update ပြီးပါပြီ`);
      setSelectedIds([]);
      await loadProducts();
    } catch (error) {
      handleError(error);
    } finally {
      setBulkBusy(false);
    }
  };

  return (
    <div className="price-page">
      {message ? <div className={`price-toast ${message.type}`}>{message.text}</div> : null}

      <section className="price-heading">
        <div>
          <span>PRICE & DISCOUNT CONTROL</span>
          <h2>ဈေးနှုန်းနှင့် လျော့ဈေးများ</h2>
          <p>Category / Group အလိုက်ရွေးပြီး Selling Price, Wholesale Price, Minimum Price နှင့် Discount % ကို Batch Apply လုပ်နိုင်ပါတယ်။</p>
        </div>
        <button type="button" onClick={loadProducts} disabled={loading}>
          <RefreshCw className={loading ? 'price-spin' : ''} size={17} /> Refresh
        </button>
      </section>

      <section className="price-summary-grid">
        <article><PackageSearch size={22} /><span>Variants</span><b>{summary.variants}</b></article>
        <article><CheckCircle2 size={22} /><span>Priced Items</span><b>{summary.priced}</b></article>
        <article><PackageSearch size={22} /><span>Stock Units</span><b>{summary.stock}</b></article>
        <article><Tags size={22} /><span>Selected</span><b>{summary.selected}</b></article>
      </section>

      <section className="price-card">
        <div className="price-toolbar">
          <label>
            <Search size={17} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Product, variant, SKU, Barcode ရှာရန်" />
          </label>
          <div>
            <button type="button" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>Previous</button>
            <b>{page} / {totalPages}</b>
            <button type="button" disabled={page >= totalPages} onClick={() => setPage((value) => Math.min(totalPages, value + 1))}>Next</button>
          </div>
        </div>

        <div className="price-filter-panel">
          <label>
            <span>Category</span>
            <select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
              <option value="">All Categories</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>{category.name}</option>
              ))}
            </select>
          </label>

          <label>
            <span>Group Type</span>
            <select value={groupType} onChange={(event) => setGroupType(event.target.value)}>
              <option value="all">All</option>
              <option value="category">Category Group</option>
              <option value="brand">Brand Group</option>
              <option value="model">Model Group</option>
            </select>
          </label>

          <label>
            <span>Group</span>
            <select value={groupValue} onChange={(event) => setGroupValue(event.target.value)} disabled={groupType === 'all'}>
              <option value="">All Groups</option>
              {groupOptions.map((value) => (
                <option key={value} value={value}>{value}</option>
              ))}
            </select>
          </label>

          <div className="price-select-actions">
            <button type="button" onClick={selectVisible} disabled={!filteredRows.length}>Visible အားလုံးရွေး</button>
            <button type="button" onClick={clearSelected} disabled={!selectedIds.length}>Clear</button>
          </div>
        </div>

        <div className="price-bulk-panel">
          <div>
            <Layers3 size={18} />
            <b>Batch Price / Discount</b>
            <span>{selectedRows.length} items selected</span>
          </div>

          <label>
            <span>Apply Mode</span>
            <select value={bulkDraft.mode} onChange={(event) => setBulkDraft({ ...bulkDraft, mode: event.target.value })}>
              <option value="sellingFixed">Selling Price ကို Fixed Amount သတ်မှတ်</option>
              <option value="wholesaleFixed">Wholesale Price ကို Fixed Amount သတ်မှတ်</option>
              {showCost ? <option value="minimumFixed">Minimum Price / လျော့ဈေး Limit Fixed Amount</option> : null}
              <option value="sellingDiscountPercent">Selling Price ကို % လျော့</option>
              {showCost ? <option value="minimumDiscountPercent">Minimum Price ကို Selling Price မှ % လျော့ပြီးသတ်မှတ်</option> : null}
            </select>
          </label>

          <label>
            <span>{bulkDraft.mode.includes('Percent') ? 'Discount %' : 'Amount'}</span>
            <input type="number" min="0" max={bulkDraft.mode.includes('Percent') ? '100' : undefined} value={bulkDraft.value} onChange={(event) => setBulkDraft({ ...bulkDraft, value: event.target.value })} placeholder={bulkDraft.mode.includes('Percent') ? 'ဥပမာ 10' : 'ဥပမာ 150000'} />
          </label>

          <button type="button" className="price-bulk-apply" onClick={applyBulk} disabled={bulkBusy || !selectedRows.length}>
            {bulkBusy ? <Loader2 className="price-spin" size={15} /> : <Save size={15} />} Apply
          </button>
        </div>

        <div className="price-table-wrap">
          <table className="price-table">
            <thead>
              <tr>
                <th>Select</th>
                <th>Product / Variant</th>
                <th>Category / Group</th>
                <th>Stock</th>
                {showCost ? <th>အမှာဈေး / Cost</th> : null}
                <th>ရောင်းဈေး / Selling</th>
                <th>လက်ကားဈေး</th>
                {showCost ? <th>လျော့ဈေး Limit</th> : null}
                {showCost ? <th>Profit</th> : null}
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={showCost ? 10 : 7}><div className="price-empty"><Loader2 className="price-spin" /> Loading prices...</div></td></tr>
              ) : null}

              {!loading && filteredRows.length === 0 ? (
                <tr><td colSpan={showCost ? 10 : 7}><div className="price-empty"><PackageSearch size={36} /><b>Product မတွေ့ပါ</b><span>Search / Category / Group ပြောင်းကြည့်ပါ။</span></div></td></tr>
              ) : null}

              {!loading && filteredRows.map((row) => {
                const stock = Number(row.inventory?.quantity || 0);
                const low = Number(row.inventory?.minAlertQuantity || 0) > 0 && stock <= Number(row.inventory?.minAlertQuantity || 0);
                const selling = Number(row.standardSellingPrice || 0);
                const cost = Number(row.costPrice || 0);
                const checked = selectedIds.includes(row.id);
                return (
                  <tr key={row.id} className={row.active === false || row.productActive === false ? 'inactive' : ''}>
                    <td><input type="checkbox" checked={checked} onChange={() => toggleSelected(row.id)} /></td>
                    <td>
                      <div className="price-product-cell">
                        <b>{row.productName}</b>
                        <span>{row.variantName || 'Default'}{row.sku ? ` · SKU: ${row.sku}` : ''}{row.barcode ? ` · Barcode: ${row.barcode}` : ''}</span>
                      </div>
                    </td>
                    <td>
                      <span>{row.categoryName}</span>
                      <small>{[row.productBrand, row.productModel].filter(Boolean).join(' / ') || '-'}</small>
                    </td>
                    <td><b className={low ? 'price-low' : ''}>Stock {stock}</b></td>
                    {showCost ? <td>{money(row.costPrice)}</td> : null}
                    <td><b>{money(row.standardSellingPrice)}</b></td>
                    <td>{money(row.wholesalePrice)}</td>
                    {showCost ? <td>{money(row.minimumSellingPrice)}</td> : null}
                    {showCost ? <td><b className={selling - cost >= 0 ? 'price-profit' : 'price-loss'}>{money(selling - cost)}</b><small>{marginPercent(selling, cost)}</small></td> : null}
                    <td>
                      <button type="button" className="price-edit" onClick={() => startEdit(row)} disabled={!canManage}><Edit3 size={14} /> ဈေးညှိမယ်</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <footer className="price-footer">
          <span>Total {total} products · Showing {filteredRows.length} variants · Selected {selectedRows.length}</span>
          {!showCost ? <b>Cost / Minimum Price ကြည့်ရန် viewCost permission လိုအပ်ပါတယ်။</b> : null}
        </footer>
      </section>

      {editingRow ? (
        <div className="price-modal-backdrop" role="dialog" aria-modal="true">
          <div className="price-modal">
            <header>
              <div>
                <span>PRICE EDIT</span>
                <h3>{variantTitle(editingRow)}</h3>
                <p>{editingRow.categoryName} · Stock {Number(editingRow.inventory?.quantity || 0)}</p>
              </div>
              <button type="button" onClick={cancelEdit}><X size={18} /></button>
            </header>

            <div className="price-modal-grid">
              {showCost ? (
                <label>
                  <span>အမှာဈေး / Cost</span>
                  <input type="number" min="0" value={draft.costPrice} onChange={(event) => setDraft({ ...draft, costPrice: event.target.value })} />
                </label>
              ) : null}
              <label>
                <span>ရောင်းဈေး / Selling</span>
                <input type="number" min="0" value={draft.standardSellingPrice} onChange={(event) => setDraft({ ...draft, standardSellingPrice: event.target.value })} />
              </label>
              <label>
                <span>လက်ကားဈေး / Wholesale</span>
                <input type="number" min="0" value={draft.wholesalePrice} onChange={(event) => setDraft({ ...draft, wholesalePrice: event.target.value })} />
              </label>
              {showCost ? (
                <label>
                  <span>လျော့ဈေး Limit / Minimum</span>
                  <input type="number" min="0" value={draft.minimumSellingPrice} onChange={(event) => setDraft({ ...draft, minimumSellingPrice: event.target.value })} />
                </label>
              ) : null}
              <label>
                <span>Low Stock Alert</span>
                <input type="number" min="0" value={draft.minAlertQuantity} onChange={(event) => setDraft({ ...draft, minAlertQuantity: event.target.value })} />
              </label>
            </div>

            <footer>
              <button type="button" onClick={cancelEdit}>Cancel</button>
              <button type="button" className="save" onClick={() => savePrice(editingRow)} disabled={savingId === editingRow.id}>
                {savingId === editingRow.id ? <Loader2 className="price-spin" size={15} /> : <Save size={15} />} Save Price
              </button>
            </footer>
          </div>
        </div>
      ) : null}
    </div>
  );
}
