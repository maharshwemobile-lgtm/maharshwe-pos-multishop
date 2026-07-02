import React, { useMemo, useState } from 'react';
import { ClipboardList, Loader2, Plus, Trash2 } from 'lucide-react';
import { apiFetch } from './phase2Api';

const today = () => new Date().toISOString().slice(0, 10);
const money = (value) => `${Number(value || 0).toLocaleString('en-US')} MMK`;

function newLine(variants = []) {
  const first = variants[0];
  return {
    key: `${Date.now()}_${Math.random()}`,
    productVariantId: first?.id || '',
    quantity: '1',
    unitCost: String(first?.costPrice ?? 0),
    note: '',
  };
}

function variantLabel(item) {
  return `${item.product?.name || 'Product'} — ${item.variantName || 'Default'}${item.sku ? ` · ${item.sku}` : ''}`;
}

export default function Phase10PurchaseOrderForm({ suppliers, variants, onCreated, onError }) {
  const [header, setHeader] = useState({ supplierId: '', orderDate: today(), expectedDate: '', notes: '' });
  const [lines, setLines] = useState([newLine(variants)]);
  const [saving, setSaving] = useState(false);

  const total = useMemo(() => lines.reduce((sum, line) => {
    const quantity = Math.max(0, Number.parseInt(line.quantity || '0', 10) || 0);
    const unitCost = Math.max(0, Number(line.unitCost || 0));
    return sum + quantity * unitCost;
  }, 0), [lines]);

  const updateLine = (key, patch) => {
    setLines((current) => current.map((line) => {
      if (line.key !== key) return line;
      const next = { ...line, ...patch };
      if (patch.productVariantId) {
        const variant = variants.find((item) => item.id === patch.productVariantId);
        next.unitCost = String(variant?.costPrice ?? next.unitCost ?? 0);
      }
      return next;
    }));
  };

  const reset = () => {
    setHeader({ supplierId: suppliers[0]?.id || '', orderDate: today(), expectedDate: '', notes: '' });
    setLines([newLine(variants)]);
  };

  const submit = async (event) => {
    event.preventDefault();
    const supplierId = header.supplierId || suppliers[0]?.id || '';
    const items = lines.map((line) => ({
      productVariantId: line.productVariantId,
      quantity: Number.parseInt(line.quantity || '0', 10) || 0,
      unitCost: Number(line.unitCost || 0),
      note: line.note.trim() || null,
    })).filter((item) => item.productVariantId && item.quantity > 0);

    if (!supplierId) return onError(new Error('Supplier ရွေးပါ။'));
    if (!items.length) return onError(new Error('အနည်းဆုံး Item တစ်ခုထည့်ပါ။'));

    setSaving(true);
    try {
      const data = await apiFetch('/api/purchasing/orders', {
        method: 'POST',
        body: {
          supplierId,
          orderDate: header.orderDate,
          expectedDate: header.expectedDate || null,
          notes: header.notes.trim() || null,
          items,
        },
      });
      reset();
      onCreated(data.order);
    } catch (error) {
      onError(error);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="purchasing-card purchasing-order-form" onSubmit={submit}>
      <header><div><Plus size={20} /></div><span><h3>New Purchase Order</h3><p>Create a draft before receiving goods.</p></span></header>
      <div className="purchasing-form-grid">
        <label><span>Supplier *</span><select value={header.supplierId || suppliers[0]?.id || ''} onChange={(event) => setHeader({ ...header, supplierId: event.target.value })} required><option value="">Select supplier</option>{suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.supplierCode} — {supplier.name}</option>)}</select></label>
        <label><span>Order Date *</span><input type="date" value={header.orderDate} onChange={(event) => setHeader({ ...header, orderDate: event.target.value })} required /></label>
        <label><span>Expected Date</span><input type="date" min={header.orderDate} value={header.expectedDate} onChange={(event) => setHeader({ ...header, expectedDate: event.target.value })} /></label>
      </div>

      <div className="po-lines-heading"><b>Order Items</b><button type="button" onClick={() => setLines((current) => [...current, newLine(variants)])}><Plus size={16} /> Add Row</button></div>
      <div className="po-lines-wrap">
        <table className="po-lines-table">
          <thead><tr><th>Product Variant</th><th>Qty</th><th>Unit Cost</th><th>Total</th><th /></tr></thead>
          <tbody>{lines.map((line) => {
            const quantity = Number.parseInt(line.quantity || '0', 10) || 0;
            const unitCost = Number(line.unitCost || 0);
            return <tr key={line.key}>
              <td><select value={line.productVariantId} onChange={(event) => updateLine(line.key, { productVariantId: event.target.value })} required><option value="">Select product</option>{variants.map((variant) => <option key={variant.id} value={variant.id}>{variantLabel(variant)}</option>)}</select></td>
              <td><input type="number" min="1" step="1" value={line.quantity} onChange={(event) => updateLine(line.key, { quantity: event.target.value })} required /></td>
              <td><input type="number" min="0" step="1" value={line.unitCost} onChange={(event) => updateLine(line.key, { unitCost: event.target.value })} required /></td>
              <td><b>{money(quantity * unitCost)}</b></td>
              <td><button type="button" className="danger-icon" onClick={() => setLines((current) => current.filter((item) => item.key !== line.key))} disabled={lines.length <= 1}><Trash2 size={16} /></button></td>
            </tr>;
          })}</tbody>
        </table>
      </div>
      <label><span>Notes</span><textarea rows="3" value={header.notes} onChange={(event) => setHeader({ ...header, notes: event.target.value })} /></label>
      <footer><div><span>PO Total</span><strong>{money(total)}</strong></div><button type="submit" disabled={saving || !suppliers.length}>{saving ? <Loader2 className="purchasing-spin" size={18} /> : <ClipboardList size={18} />} Save Draft PO</button></footer>
    </form>
  );
}
