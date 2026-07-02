import React, { useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Eye,
  FileSpreadsheet,
  Loader2,
  Upload,
  X,
} from 'lucide-react';
import { apiFetch } from './phase2Api';
import './inventory-import-review.css';

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (quoted) {
      if (char === '"' && next === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(cell);
      cell = '';
    } else if (char === '\n') {
      row.push(cell.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += char;
    }
  }

  if (cell.length || row.length) {
    row.push(cell.replace(/\r$/, ''));
    rows.push(row);
  }

  const cleanRows = rows.filter((item) => item.some((value) => String(value).trim()));
  if (cleanRows.length < 2) return [];
  const headers = cleanRows[0].map((value) => String(value).replace(/^\uFEFF/, '').trim());
  return cleanRows.slice(1).map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ''])));
}

function ReviewModal({ onClose, onImported }) {
  const [fileName, setFileName] = useState('');
  const [rows, setRows] = useState([]);
  const [stockMode, setStockMode] = useState('set');
  const [overview, setOverview] = useState(null);
  const [confirmed, setConfirmed] = useState(false);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const [error, setError] = useState('');

  const resetReview = () => {
    setOverview(null);
    setConfirmed(false);
    setError('');
  };

  const chooseFile = async (file) => {
    resetReview();
    if (!file) return;
    try {
      const parsed = parseCsv(await file.text());
      if (!parsed.length) throw new Error('CSV data rows မတွေ့ပါ။');
      setFileName(file.name);
      setRows(parsed);
    } catch (parseError) {
      setRows([]);
      setFileName('');
      setError(parseError.message || 'CSV ဖတ်မရပါ။');
    }
  };

  const preview = async () => {
    if (!rows.length) return;
    setPreviewBusy(true);
    setError('');
    setConfirmed(false);
    try {
      const data = await apiFetch('/api/inventory/import/preview', {
        method: 'POST',
        body: { rows, stockMode },
      });
      setOverview(data.overview || null);
    } catch (requestError) {
      setError(requestError.message || 'Import overview failed');
    } finally {
      setPreviewBusy(false);
    }
  };

  const confirmImport = async () => {
    if (!confirmed || !overview?.canImport) return;
    setImportBusy(true);
    setError('');
    try {
      const data = await apiFetch('/api/inventory/import', {
        method: 'POST',
        body: { rows, stockMode, confirmed: true },
      });
      await onImported(data.summary || {});
    } catch (requestError) {
      setError(requestError.message || 'CSV import failed');
    } finally {
      setImportBusy(false);
    }
  };

  return (
    <div className="import-review-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !previewBusy && !importBusy) onClose();
    }}>
      <section className="import-review-modal">
        <header>
          <div className="import-review-icon"><FileSpreadsheet size={24} /></div>
          <span>
            <h3>Inventory Import</h3>
            <p>CSV ကို အရင် Overview စစ်ပြီး Confirm လုပ်မှသာ Import မည်။</p>
          </span>
          <button type="button" onClick={onClose} disabled={previewBusy || importBusy}><X size={20} /></button>
        </header>

        {!overview ? (
          <div className="import-review-body">
            <label className="import-file-picker">
              <FileSpreadsheet size={30} />
              <b>{fileName || 'Choose Inventory CSV'}</b>
              <span>{rows.length ? `${rows.length} data rows selected` : 'UTF-8 CSV file'}</span>
              <input type="file" accept=".csv,text/csv" onChange={(event) => chooseFile(event.target.files?.[0])} />
            </label>

            <label className="import-review-field">
              <span>Stock Import Mode</span>
              <select value={stockMode} onChange={(event) => {
                setStockMode(event.target.value);
                resetReview();
              }}>
                <option value="set">Set exact stock quantity</option>
                <option value="add">Add quantity to current stock</option>
              </select>
            </label>

            <div className="import-review-info">
              <b>Overview မှာ စစ်ပြမယ့်အရာများ</b>
              <span>New/Update Products, Variants, Stock Changes, Low Alert Changes, Skipped Rows နဲ့ Warning များ</span>
            </div>
            {error ? <div className="import-review-error">{error}</div> : null}

            <footer>
              <button type="button" onClick={onClose}>Cancel</button>
              <button type="button" className="primary" onClick={preview} disabled={!rows.length || previewBusy}>
                {previewBusy ? <Loader2 className="import-review-spin" size={18} /> : <Eye size={18} />}
                Generate Overview
              </button>
            </footer>
          </div>
        ) : (
          <div className="import-review-body">
            <div className="import-overview-banner">
              <CheckCircle2 size={24} />
              <div><b>Import Overview Ready</b><span>{fileName} · Mode: {overview.stockMode === 'add' ? 'Add to current stock' : 'Set exact stock'}</span></div>
            </div>

            <section className="import-overview-grid">
              <article><span>Total Rows</span><b>{overview.rows}</b></article>
              <article><span>Valid Rows</span><b>{overview.validRows}</b></article>
              <article><span>New Products</span><b>{overview.productsToCreate}</b></article>
              <article><span>Update Products</span><b>{overview.productsToUpdate}</b></article>
              <article><span>New Variants</span><b>{overview.variantsToCreate}</b></article>
              <article><span>Update Variants</span><b>{overview.variantsToUpdate}</b></article>
              <article><span>Stock Rows Changed</span><b>{overview.stockRowsChanged}</b></article>
              <article><span>Skipped Rows</span><b>{overview.skipped}</b></article>
            </section>

            <section className="import-stock-summary">
              <div><span>Total Stock Increase</span><b>+{overview.totalStockIncrease}</b></div>
              <div><span>Total Stock Decrease</span><b>-{overview.totalStockDecrease}</b></div>
              <div><span>Low Alert Changes</span><b>{overview.lowAlertRowsChanged}</b></div>
              <div><span>New Categories</span><b>{overview.categoriesToCreate}</b></div>
            </section>

            {overview.warningCount > 0 ? (
              <section className="import-warning-box">
                <div><AlertTriangle size={20} /><b>{overview.warningCount} Warnings</b></div>
                <ul>{overview.warnings.map((warning, index) => <li key={`${index}-${warning}`}>{warning}</li>)}</ul>
              </section>
            ) : null}

            <section className="import-sample-section">
              <h4>Sample Changes</h4>
              <div className="import-sample-table-wrap">
                <table>
                  <thead><tr><th>Row</th><th>Product / Variant</th><th>SKU / Barcode</th><th>Action</th><th>Stock</th></tr></thead>
                  <tbody>{overview.sample.map((item) => <tr key={`${item.rowNumber}-${item.productName}-${item.variantName}`}>
                    <td>{item.rowNumber}</td>
                    <td><b>{item.productName}</b><small>{item.variantName}</small></td>
                    <td><span>{item.sku || '-'}</span><small>{item.barcode || '-'}</small></td>
                    <td><em className={item.action === 'CREATE' ? 'create' : 'update'}>{item.action}</em></td>
                    <td><b>{item.currentQuantity}</b> → <b>{item.targetQuantity}</b> <small>({item.quantityChange >= 0 ? '+' : ''}{item.quantityChange})</small></td>
                  </tr>)}</tbody>
                </table>
              </div>
            </section>

            <label className="import-confirm-check">
              <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
              <span><b>I reviewed this overview and confirm the import.</b><small>Confirm လုပ်ပြီးနောက် Product, Variant, Price နဲ့ Stock တို့ PostgreSQL DB ထဲပြောင်းပါမယ်။</small></span>
            </label>

            {error ? <div className="import-review-error">{error}</div> : null}
            <footer>
              <button type="button" onClick={() => {
                setOverview(null);
                setConfirmed(false);
              }} disabled={importBusy}><ArrowLeft size={18} /> Back</button>
              <button type="button" className="confirm" onClick={confirmImport} disabled={!confirmed || !overview.canImport || importBusy}>
                {importBusy ? <Loader2 className="import-review-spin" size={18} /> : <Upload size={18} />}
                Confirm & Import
              </button>
            </footer>
          </div>
        )}
      </section>
    </div>
  );
}

export default function InventoryImportReview({ onImported }) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');

  const imported = async (summary) => {
    setOpen(false);
    setMessage(`Import complete — ${summary.variantsCreated || 0} variants created, ${summary.variantsUpdated || 0} updated, ${summary.stockAdjusted || 0} stock rows changed.`);
    await onImported?.();
  };

  return (
    <section className="import-review-panel">
      <div>
        <span>SAFE CSV IMPORT</span>
        <h3>Overview → Confirm → Import</h3>
        <p>CSV ကို DB ထဲမသိမ်းမီ New/Update/Stock Changes အားလုံးကို ကြိုတင်စစ်ဆေးပါ။</p>
      </div>
      <button type="button" onClick={() => setOpen(true)}><Upload size={18} /> Import CSV with Overview</button>
      {message ? <div className="import-review-message">{message}</div> : null}
      {open ? <ReviewModal onClose={() => setOpen(false)} onImported={imported} /> : null}
    </section>
  );
}
