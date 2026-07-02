import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Barcode,
  Boxes,
  ChevronLeft,
  ChevronRight,
  History,
  Layers3,
  Loader2,
  MinusCircle,
  PackageMinus,
  PackagePlus,
  PlusCircle,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Wrench,
  X,
} from 'lucide-react';
import { apiFetch, clearSession } from './phase2Api';
import './stock-management.css';

const PAGE_SIZE = 20;

const ACTIONS = {
  STOCK_IN: {
    label: 'Stock In',
    description: 'ပစ္စည်းအသစ် ဝင်စာရင်းသွင်းမည်',
    icon: PackagePlus,
    tone: 'green',
    apiType: 'STOCK_IN',
    sign: 1,
    noteRequired: false,
  },
  STOCK_OUT: {
    label: 'Stock Out',
    description: 'လက်ဖြင့် ပစ္စည်းထုတ်စာရင်းသွင်းမည်',
    icon: PackageMinus,
    tone: 'red',
    apiType: 'ADJUSTMENT',
    sign: -1,
    noteRequired: true,
  },
  ADJUSTMENT: {
    label: 'Adjustment',
    description: 'လက်ကျန်ကို အတိုး/အလျော့ ပြင်ဆင်မည်',
    icon: SlidersHorizontal,
    tone: 'blue',
    apiType: 'ADJUSTMENT',
    sign: 1,
    noteRequired: true,
  },
  DAMAGE: {
    label: 'Damage',
    description: 'ပျက်စီးပစ္စည်းအဖြစ် လျှော့မည်',
    icon: AlertTriangle,
    tone: 'orange',
    apiType: 'DAMAGE',
    sign: -1,
    noteRequired: true,
  },
  REPAIR_USAGE: {
    label: 'Repair Usage',
    description: 'ပြင်ဆင်ရေးသုံးပစ္စည်းအဖြစ် လျှော့မည်',
    icon: Wrench,
    tone: 'purple',
    apiType: 'REPAIR_USAGE',
    sign: -1,
    noteRequired: true,
  },
};

const quantityOf = (variant) => Number(variant?.inventory?.quantity || 0);
const minimumOf = (variant) => Number(variant?.inventory?.minAlertQuantity || 0);
const isLowStock = (variant) => minimumOf(variant) > 0 && quantityOf(variant) <= minimumOf(variant);
const isOutOfStock = (variant) => quantityOf(variant) <= 0;
const money = (value) => `${Number(value || 0).toLocaleString('en-US')} MMK`;

function formatDate(value) {
  if (!value) return '-';
  try {
    return new Intl.DateTimeFormat('en-GB', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value));
  } catch {
    return String(value);
  }
}

function movementDisplay(movement) {
  const rawNote = String(movement?.note || '');
  if (movement?.referenceType === 'STOCK_OUT' || rawNote.startsWith('[STOCK_OUT]')) {
    return { label: 'Stock Out', tone: 'red', note: rawNote.replace(/^\[STOCK_OUT\]\s*/, '') };
  }
  if (movement?.type === 'STOCK_IN') return { label: 'Stock In', tone: 'green', note: rawNote };
  if (movement?.type === 'SALE_RETURN') return { label: 'Sale Return', tone: 'green', note: rawNote };
  if (movement?.type === 'SALE') return { label: 'Sale', tone: 'red', note: rawNote };
  if (movement?.type === 'DAMAGE') return { label: 'Damage', tone: 'orange', note: rawNote };
  if (movement?.type === 'REPAIR_USAGE') return { label: 'Repair Usage', tone: 'purple', note: rawNote };
  if (movement?.type === 'REVERSAL') return { label: 'Reversal', tone: 'blue', note: rawNote };
  return {
    label: 'Adjustment',
    tone: Number(movement?.quantityChange || 0) >= 0 ? 'blue' : 'red',
    note: rawNote.replace(/^\[ADJUSTMENT:(?:INCREASE|DECREASE)\]\s*/, ''),
  };
}

function variantTitle(variant) {
  return [variant?.product?.name, variant?.variantName].filter(Boolean).join(' — ') || 'Product Variant';
}

function MovementModal({ editor, onClose, onSaved }) {
  const action = ACTIONS[editor.action];
  const Icon = action.icon;
  const [quantity, setQuantity] = useState('1');
  const [direction, setDirection] = useState('increase');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const amount = Math.max(0, Number.parseInt(quantity || '0', 10) || 0);
  const adjustmentSign = editor.action === 'ADJUSTMENT' && direction === 'decrease' ? -1 : 1;
  const delta = editor.action === 'ADJUSTMENT' ? amount * adjustmentSign : amount * action.sign;
  const before = quantityOf(editor.variant);
  const after = before + delta;

  const submit = async (event) => {
    event.preventDefault();
    if (amount <= 0) {
      setError('Quantity must be greater than zero.');
      return;
    }
    if (action.noteRequired && !note.trim()) {
      setError('မှတ်ချက်ထည့်ပေးပါ။');
      return;
    }

    let finalNote = note.trim();
    if (editor.action === 'STOCK_OUT') finalNote = `[STOCK_OUT] ${finalNote}`;
    if (editor.action === 'ADJUSTMENT') {
      finalNote = `[ADJUSTMENT:${direction === 'increase' ? 'INCREASE' : 'DECREASE'}] ${finalNote}`;
    }
    if (!finalNote && editor.action === 'STOCK_IN') finalNote = 'Manual stock in';

    setBusy(true);
    setError('');
    try {
      await apiFetch('/api/stock/movements', {
        method: 'POST',
        body: {
          productVariantId: editor.variant.id,
          type: action.apiType,
          quantityChange: delta,
          note: finalNote,
        },
      });
      await onSaved(action.label);
    } catch (requestError) {
      setError(requestError.message || 'Stock update failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stock-modal-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !busy) onClose();
    }}>
      <section className="stock-modal" role="dialog" aria-modal="true">
        <header>
          <div className={`stock-modal-icon stock-tone-${action.tone}`}><Icon size={24} /></div>
          <div>
            <h3>{action.label}</h3>
            <p>{variantTitle(editor.variant)}</p>
          </div>
          <button type="button" className="stock-icon-button" onClick={onClose} disabled={busy}><X size={20} /></button>
        </header>

        <form onSubmit={submit} className="stock-movement-form">
          <div className="stock-balance-preview">
            <div><span>Before</span><b>{before}</b></div>
            <div className={delta >= 0 ? 'stock-delta-positive' : 'stock-delta-negative'}>
              <span>Change</span><b>{delta >= 0 ? '+' : ''}{delta}</b>
            </div>
            <div className={after < 0 ? 'stock-after-warning' : ''}><span>After</span><b>{after}</b></div>
          </div>

          {editor.action === 'ADJUSTMENT' ? (
            <div className="stock-direction-switch">
              <button type="button" className={direction === 'increase' ? 'active increase' : ''} onClick={() => setDirection('increase')}>
                <PlusCircle size={18} /> Increase
              </button>
              <button type="button" className={direction === 'decrease' ? 'active decrease' : ''} onClick={() => setDirection('decrease')}>
                <MinusCircle size={18} /> Decrease
              </button>
            </div>
          ) : null}

          <label className="stock-field">
            <span>Quantity</span>
            <input
              type="number"
              min="1"
              step="1"
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
              autoFocus
              required
            />
          </label>

          <label className="stock-field">
            <span>Note {action.noteRequired ? '*' : '(optional)'}</span>
            <textarea
              rows="3"
              maxLength="500"
              placeholder={editor.action === 'DAMAGE'
                ? 'ဥပမာ — မျက်နှာပြင်ကွဲ၊ ရေစို'
                : editor.action === 'REPAIR_USAGE'
                  ? 'ဥပမာ — Repair ID MS0551 အတွက်သုံး'
                  : 'အကြောင်းပြချက် / မှတ်ချက်'}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              required={action.noteRequired}
            />
          </label>

          {after < 0 ? (
            <div className="stock-form-warning">
              <AlertTriangle size={18} /> လက်ကျန်မလုံလောက်ပါ။ Negative stock ပိတ်ထားပါက Server က ငြင်းပါမယ်။
            </div>
          ) : null}
          {error ? <div className="stock-form-error">{error}</div> : null}

          <footer>
            <button type="button" onClick={onClose} disabled={busy}>Cancel</button>
            <button type="submit" className={`stock-submit stock-submit-${action.tone}`} disabled={busy}>
              {busy ? <Loader2 className="stock-spin" size={18} /> : <Icon size={18} />}
              Save {action.label}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}

function HistoryModal({ variant, onClose }) {
  const [movements, setMovements] = useState([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({
        productVariantId: variant.id,
        page: String(page),
        limit: '20',
      });
      const data = await apiFetch(`/api/stock/movements?${params.toString()}`);
      setMovements(data.movements || []);
      setTotal(Number(data.total || 0));
      setTotalPages(Math.max(1, Number(data.totalPages || 1)));
    } catch (requestError) {
      setError(requestError.message || 'Movement history failed');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [variant.id, page]);

  return (
    <div className="stock-modal-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="stock-modal stock-history-modal" role="dialog" aria-modal="true">
        <header>
          <div className="stock-modal-icon stock-tone-blue"><History size={24} /></div>
          <div>
            <h3>Movement History</h3>
            <p>{variantTitle(variant)} · {total} records</p>
          </div>
          <button type="button" className="stock-icon-button" onClick={onClose}><X size={20} /></button>
        </header>

        <div className="stock-history-body">
          {loading ? (
            <div className="stock-loading"><Loader2 className="stock-spin" /> Loading movement history…</div>
          ) : error ? (
            <div className="stock-form-error">{error}</div>
          ) : movements.length === 0 ? (
            <div className="stock-empty"><History size={34} /><b>No movement history yet</b></div>
          ) : (
            <div className="stock-history-table-wrap">
              <table className="stock-history-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Type</th>
                    <th>Change</th>
                    <th>Before → After</th>
                    <th>By</th>
                    <th>Note</th>
                  </tr>
                </thead>
                <tbody>
                  {movements.map((movement) => {
                    const display = movementDisplay(movement);
                    const change = Number(movement.quantityChange || 0);
                    return (
                      <tr key={movement.id}>
                        <td>{formatDate(movement.createdAt)}</td>
                        <td><span className={`stock-type-badge stock-type-${display.tone}`}>{display.label}</span></td>
                        <td className={change >= 0 ? 'stock-change-positive' : 'stock-change-negative'}>
                          {change >= 0 ? '+' : ''}{change}
                        </td>
                        <td><b>{movement.beforeQuantity}</b> → <b>{movement.afterQuantity}</b></td>
                        <td>{movement.user?.name || movement.user?.username || '-'}</td>
                        <td className="stock-note-cell">{display.note || '-'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <footer className="stock-history-footer">
          <span>Page {page} of {totalPages}</span>
          <div>
            <button type="button" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={page <= 1 || loading}>
              <ChevronLeft size={17} /> Previous
            </button>
            <button type="button" onClick={() => setPage((value) => Math.min(totalPages, value + 1))} disabled={page >= totalPages || loading}>
              Next <ChevronRight size={17} />
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}

export default function StockManagementPage() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [status, setStatus] = useState('all');
  const [page, setPage] = useState(1);
  const [movementEditor, setMovementEditor] = useState(null);
  const [historyVariant, setHistoryVariant] = useState(null);
  const [toast, setToast] = useState(null);

  const notify = (type, text) => {
    setToast({ type, text });
    window.clearTimeout(notify.timer);
    notify.timer = window.setTimeout(() => setToast(null), 3500);
  };

  const handleError = (error) => {
    if (error?.status === 401) {
      clearSession();
      window.location.reload();
      return;
    }
    notify('error', error?.message || 'Request failed');
  };

  const loadStock = async () => {
    setLoading(true);
    try {
      const allItems = [];
      let currentPage = 1;
      let totalPages = 1;

      do {
        const data = await apiFetch(`/api/stock?page=${currentPage}&limit=100`);
        allItems.push(...(data.items || []));
        totalPages = Math.max(1, Number(data.totalPages || 1));
        currentPage += 1;
      } while (currentPage <= totalPages && currentPage <= 100);

      setItems(allItems);
    } catch (error) {
      handleError(error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStock();
  }, []);

  useEffect(() => {
    setPage(1);
  }, [query, category, status]);

  const categories = useMemo(() => {
    return [...new Set(items.map((item) => item.category?.name).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  }, [items]);

  const summary = useMemo(() => ({
    variants: items.length,
    units: items.reduce((sum, item) => sum + quantityOf(item), 0),
    low: items.filter(isLowStock).length,
    out: items.filter(isOutOfStock).length,
  }), [items]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return items.filter((item) => {
      const haystack = [
        item.product?.name,
        item.product?.brand,
        item.product?.model,
        item.variantName,
        item.sku,
        item.barcode,
        item.category?.name,
      ].filter(Boolean).join(' ').toLowerCase();

      if (needle && !haystack.includes(needle)) return false;
      if (category && item.category?.name !== category) return false;
      if (status === 'low' && !isLowStock(item)) return false;
      if (status === 'out' && !isOutOfStock(item)) return false;
      if (status === 'available' && quantityOf(item) <= 0) return false;
      return true;
    });
  }, [items, query, category, status]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const visible = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const movementSaved = async (label) => {
    setMovementEditor(null);
    notify('success', `${label} saved successfully`);
    await loadStock();
  };

  return (
    <div className="stock-page">
      {toast ? <div className={`stock-toast stock-toast-${toast.type}`}>{toast.text}</div> : null}

      <div className="stock-page-heading">
        <div>
          <span className="stock-eyebrow">INVENTORY</span>
          <h2>Stock Management</h2>
          <p>Product Variant တစ်ခုချင်းစီအတွက် Stock In, Stock Out, Adjustment, Damage နဲ့ Repair Usage ကို စီမံပါ။</p>
        </div>
        <button type="button" className="stock-refresh-button" onClick={loadStock} disabled={loading}>
          <RefreshCw className={loading ? 'stock-spin' : ''} size={18} /> Refresh
        </button>
      </div>

      <section className="stock-summary-grid">
        <article><div className="stock-summary-icon stock-tone-blue"><Layers3 /></div><span>Total Variants</span><b>{summary.variants}</b></article>
        <article><div className="stock-summary-icon stock-tone-green"><Boxes /></div><span>Total Units</span><b>{summary.units.toLocaleString()}</b></article>
        <article><div className="stock-summary-icon stock-tone-orange"><AlertTriangle /></div><span>Low Stock</span><b>{summary.low}</b></article>
        <article><div className="stock-summary-icon stock-tone-red"><PackageMinus /></div><span>Out of Stock</span><b>{summary.out}</b></article>
      </section>

      <section className="stock-card">
        <div className="stock-toolbar">
          <div className="stock-search-box">
            <Search size={18} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search product, variant, SKU or barcode"
            />
          </div>
          <select value={category} onChange={(event) => setCategory(event.target.value)}>
            <option value="">All Categories</option>
            {categories.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="all">All Stock</option>
            <option value="available">Available</option>
            <option value="low">Low Stock</option>
            <option value="out">Out of Stock</option>
          </select>
        </div>

        {loading && items.length === 0 ? (
          <div className="stock-loading"><Loader2 className="stock-spin" /> Loading stock data…</div>
        ) : visible.length === 0 ? (
          <div className="stock-empty"><Boxes size={38} /><b>No stock records found</b><span>Products ထဲမှာ Variant အရင်ထည့်ပါ။</span></div>
        ) : (
          <div className="stock-table-wrap">
            <table className="stock-table">
              <thead>
                <tr>
                  <th>Product / Variant</th>
                  <th>SKU / Barcode</th>
                  <th>Category</th>
                  <th>Stock</th>
                  <th>Low Alert</th>
                  <th>Selling Price</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((variant) => {
                  const stock = quantityOf(variant);
                  const low = isLowStock(variant);
                  const out = isOutOfStock(variant);
                  return (
                    <tr key={variant.id} className={!variant.active ? 'stock-row-inactive' : ''}>
                      <td>
                        <div className="stock-product-cell">
                          <div><Boxes size={20} /></div>
                          <span>
                            <b>{variant.product?.name || 'Unnamed Product'}</b>
                            <small>{variant.variantName || 'Default'}{variant.color ? ` · ${variant.color}` : ''}</small>
                          </span>
                        </div>
                      </td>
                      <td>
                        <div className="stock-code-cell">
                          <span>{variant.sku || '-'}</span>
                          <small><Barcode size={13} /> {variant.barcode || '-'}</small>
                        </div>
                      </td>
                      <td>{variant.category?.name || '-'}</td>
                      <td>
                        <span className={`stock-quantity-badge ${out ? 'out' : low ? 'low' : 'ok'}`}>{stock}</span>
                      </td>
                      <td>{minimumOf(variant)}</td>
                      <td>{money(variant.standardSellingPrice)}</td>
                      <td>
                        <div className="stock-row-actions">
                          {Object.entries(ACTIONS).map(([key, action]) => {
                            const ActionIcon = action.icon;
                            return (
                              <button
                                key={key}
                                type="button"
                                className={`stock-action stock-action-${action.tone}`}
                                title={action.description}
                                onClick={() => setMovementEditor({ action: key, variant })}
                              >
                                <ActionIcon size={15} /> {action.label}
                              </button>
                            );
                          })}
                          <button type="button" className="stock-action stock-action-history" onClick={() => setHistoryVariant(variant)}>
                            <History size={15} /> History
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <footer className="stock-pagination">
          <span>Showing {visible.length} of {filtered.length} variants</span>
          <div>
            <button type="button" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={page <= 1}>
              <ChevronLeft size={17} /> Previous
            </button>
            <b>{page} / {totalPages}</b>
            <button type="button" onClick={() => setPage((value) => Math.min(totalPages, value + 1))} disabled={page >= totalPages}>
              Next <ChevronRight size={17} />
            </button>
          </div>
        </footer>
      </section>

      {movementEditor ? (
        <MovementModal
          key={`${movementEditor.variant.id}-${movementEditor.action}`}
          editor={movementEditor}
          onClose={() => setMovementEditor(null)}
          onSaved={movementSaved}
        />
      ) : null}
      {historyVariant ? <HistoryModal variant={historyVariant} onClose={() => setHistoryVariant(null)} /> : null}
    </div>
  );
}
