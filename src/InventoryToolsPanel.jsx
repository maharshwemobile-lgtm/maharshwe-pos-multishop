import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Barcode,
  Bell,
  BellRing,
  Camera,
  Download,
  FileSpreadsheet,
  Loader2,
  Search,
  Upload,
  X,
} from 'lucide-react';
import { apiFetch } from './phase2Api';
import './inventory-tools.css';

const CSV_HEADERS = [
  'productName',
  'brand',
  'model',
  'category',
  'productType',
  'variantName',
  'sku',
  'barcode',
  'ram',
  'storage',
  'color',
  'costPrice',
  'standardSellingPrice',
  'minimumSellingPrice',
  'stockQuantity',
  'minAlertQuantity',
];

function csvEscape(value) {
  const text = String(value ?? '');
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

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

function downloadText(filename, content, type = 'text/csv;charset=utf-8') {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function ScannerModal({ onClose }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const detectorRef = useRef(null);
  const rafRef = useRef(null);
  const [code, setCode] = useState('');
  const [cameraOn, setCameraOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [matches, setMatches] = useState([]);

  const stopCamera = () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks?.().forEach((track) => track.stop());
    streamRef.current = null;
    setCameraOn(false);
  };

  useEffect(() => () => stopCamera(), []);

  const lookup = async (value) => {
    const normalized = String(value || '').trim();
    if (!normalized) return;
    setBusy(true);
    setError('');
    try {
      const params = new URLSearchParams({ q: normalized, page: '1', limit: '20' });
      const data = await apiFetch(`/api/stock?${params.toString()}`);
      setMatches(data.items || []);
      setCode(normalized);
    } catch (requestError) {
      setError(requestError.message || 'Barcode lookup failed');
    } finally {
      setBusy(false);
    }
  };

  const scanLoop = async () => {
    if (!videoRef.current || !detectorRef.current || !streamRef.current) return;
    try {
      const barcodes = await detectorRef.current.detect(videoRef.current);
      const detected = barcodes?.[0]?.rawValue;
      if (detected) {
        stopCamera();
        await lookup(detected);
        return;
      }
    } catch {
      // Keep scanning while the camera warms up.
    }
    rafRef.current = requestAnimationFrame(scanLoop);
  };

  const startCamera = async () => {
    setError('');
    if (!('BarcodeDetector' in window)) {
      setError('ဒီ Browser မှာ Camera BarcodeDetector မရှိပါ။ Barcode ကို လက်ဖြင့်ရိုက်ပါ သို့မဟုတ် USB scanner သုံးပါ။');
      return;
    }
    try {
      const formats = await window.BarcodeDetector.getSupportedFormats?.();
      detectorRef.current = new window.BarcodeDetector({
        formats: formats?.length ? formats : ['ean_13', 'ean_8', 'code_128', 'qr_code'],
      });
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraOn(true);
      rafRef.current = requestAnimationFrame(scanLoop);
    } catch (cameraError) {
      setError(cameraError.message || 'Camera ဖွင့်မရပါ။');
      stopCamera();
    }
  };

  return (
    <div className="inventory-modal-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="inventory-modal inventory-scanner-modal">
        <header>
          <div><Barcode size={24} /></div>
          <span><h3>Barcode Scanner</h3><p>Camera, USB scanner သို့မဟုတ် manual barcode lookup</p></span>
          <button type="button" onClick={onClose}><X size={20} /></button>
        </header>

        <div className="inventory-modal-body">
          <div className="scanner-input-row">
            <div><Search size={18} /><input value={code} onChange={(event) => setCode(event.target.value)} onKeyDown={(event) => {
              if (event.key === 'Enter') lookup(code);
            }} placeholder="Scan or enter barcode / SKU" autoFocus /></div>
            <button type="button" onClick={() => lookup(code)} disabled={busy}>{busy ? <Loader2 className="inventory-spin" /> : <Search size={18} />} Search</button>
            <button type="button" onClick={cameraOn ? stopCamera : startCamera}><Camera size={18} /> {cameraOn ? 'Stop Camera' : 'Use Camera'}</button>
          </div>

          <div className={`scanner-video-wrap ${cameraOn ? 'active' : ''}`}>
            <video ref={videoRef} muted playsInline />
            {!cameraOn ? <div><Camera size={34} /><span>Camera preview</span></div> : <div className="scanner-target" />}
          </div>

          {error ? <div className="inventory-error">{error}</div> : null}
          <div className="scanner-results">
            {matches.length ? matches.map((item) => (
              <article key={item.id}>
                <div><b>{item.product?.name || 'Product'} — {item.variantName}</b><small>SKU: {item.sku || '-'} · Barcode: {item.barcode || '-'}</small></div>
                <span className={Number(item.inventory?.quantity || 0) <= 0 ? 'out' : 'ok'}>{Number(item.inventory?.quantity || 0)} in stock</span>
              </article>
            )) : code && !busy ? <div className="inventory-empty-small">No matching product found.</div> : null}
          </div>
        </div>
      </section>
    </div>
  );
}

function ImportModal({ onClose, onImported }) {
  const [fileName, setFileName] = useState('');
  const [rows, setRows] = useState([]);
  const [stockMode, setStockMode] = useState('set');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const chooseFile = async (file) => {
    setError('');
    if (!file) return;
    try {
      const parsed = parseCsv(await file.text());
      if (!parsed.length) throw new Error('CSV data rows မတွေ့ပါ။');
      setFileName(file.name);
      setRows(parsed);
    } catch (parseError) {
      setError(parseError.message || 'CSV ဖတ်မရပါ။');
      setRows([]);
    }
  };

  const submit = async () => {
    if (!rows.length) return;
    setBusy(true);
    setError('');
    try {
      const data = await apiFetch('/api/inventory/import', { method: 'POST', body: { rows, stockMode } });
      await onImported(data.summary || {});
    } catch (requestError) {
      setError(requestError.message || 'CSV import failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="inventory-modal-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !busy) onClose();
    }}>
      <section className="inventory-modal">
        <header>
          <div><Upload size={24} /></div>
          <span><h3>Import Inventory CSV</h3><p>Products, variants, prices, stock နဲ့ low alert ကို merge လုပ်ပါ။</p></span>
          <button type="button" onClick={onClose} disabled={busy}><X size={20} /></button>
        </header>
        <div className="inventory-modal-body">
          <label className="inventory-file-picker">
            <FileSpreadsheet size={28} />
            <b>{fileName || 'Choose CSV file'}</b>
            <span>{rows.length ? `${rows.length} data rows ready` : 'UTF-8 CSV format'}</span>
            <input type="file" accept=".csv,text/csv" onChange={(event) => chooseFile(event.target.files?.[0])} />
          </label>
          <label className="inventory-field"><span>Stock Import Mode</span><select value={stockMode} onChange={(event) => setStockMode(event.target.value)}><option value="set">Set exact stock quantity</option><option value="add">Add quantity to current stock</option></select></label>
          <div className="inventory-import-hint">Required column: <b>productName</b>. Recommended: variantName, SKU or barcode, prices, stockQuantity, minAlertQuantity.</div>
          {error ? <div className="inventory-error">{error}</div> : null}
          <footer><button type="button" onClick={onClose} disabled={busy}>Cancel</button><button type="button" className="primary" onClick={submit} disabled={busy || !rows.length}>{busy ? <Loader2 className="inventory-spin" /> : <Upload size={18} />} Import {rows.length || ''} Rows</button></footer>
        </div>
      </section>
    </div>
  );
}

export default function InventoryToolsPanel({ onInventoryChanged }) {
  const [lowItems, setLowItems] = useState([]);
  const [loadingLow, setLoadingLow] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [message, setMessage] = useState('');
  const lastNotifiedRef = useRef('');

  const loadLowStock = async ({ notify = false } = {}) => {
    setLoadingLow(true);
    try {
      const data = await apiFetch('/api/stock/low');
      const items = data.items || [];
      setLowItems(items);
      const signature = items.map((item) => `${item.id}:${item.inventory?.quantity}`).join('|');
      if (notify && items.length && Notification.permission === 'granted' && signature !== lastNotifiedRef.current) {
        lastNotifiedRef.current = signature;
        new Notification(`Mahar POS — Low stock ${items.length} items`, {
          body: items.slice(0, 4).map((item) => `${item.product?.name || item.variantName}: ${item.inventory?.quantity || 0}`).join('\n'),
          icon: '/maharshwe-logo.png',
        });
      }
    } catch (error) {
      setMessage(error.message || 'Low stock check failed');
    } finally {
      setLoadingLow(false);
    }
  };

  useEffect(() => {
    loadLowStock({ notify: true });
    const timer = window.setInterval(() => loadLowStock({ notify: true }), 5 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, []);

  const enableNotifications = async () => {
    if (!('Notification' in window)) {
      setMessage('ဒီ Browser မှာ notification မထောက်ပံ့ပါ။');
      return;
    }
    const permission = await Notification.requestPermission();
    setMessage(permission === 'granted' ? 'Low stock browser notification enabled.' : 'Notification permission မရပါ။');
    if (permission === 'granted') loadLowStock({ notify: true });
  };

  const exportCsv = async () => {
    setMessage('');
    try {
      const data = await apiFetch('/api/inventory/export');
      const lines = [CSV_HEADERS.join(','), ...(data.rows || []).map((row) => CSV_HEADERS.map((header) => csvEscape(row[header])).join(','))];
      downloadText(`mahar-pos-inventory-${new Date().toISOString().slice(0, 10)}.csv`, `\uFEFF${lines.join('\r\n')}`);
      setMessage(`Exported ${data.total || 0} variants.`);
    } catch (error) {
      setMessage(error.message || 'CSV export failed');
    }
  };

  const importFinished = async (summary) => {
    setImportOpen(false);
    setMessage(`Imported: ${summary.variantsCreated || 0} created, ${summary.variantsUpdated || 0} updated, ${summary.stockAdjusted || 0} stock adjusted.`);
    await loadLowStock({ notify: true });
    await onInventoryChanged?.();
  };

  return (
    <section className="inventory-tools-panel">
      <div className="inventory-tools-heading">
        <div><span>INVENTORY TOOLS</span><h3>Low Stock, Barcode & CSV</h3></div>
        <div className="inventory-tool-actions">
          <button type="button" onClick={enableNotifications}><BellRing size={17} /> Enable Notification</button>
          <button type="button" onClick={() => setScannerOpen(true)}><Barcode size={17} /> Scan Barcode</button>
          <button type="button" onClick={() => setImportOpen(true)}><Upload size={17} /> Import CSV</button>
          <button type="button" onClick={exportCsv}><Download size={17} /> Export CSV</button>
        </div>
      </div>

      <div className={`low-stock-strip ${lowItems.length ? 'has-alert' : ''}`}>
        <div className="low-stock-icon">{loadingLow ? <Loader2 className="inventory-spin" /> : lowItems.length ? <AlertTriangle /> : <Bell />}</div>
        <div><b>{lowItems.length ? `${lowItems.length} Low Stock Items` : 'Stock levels are healthy'}</b><span>{lowItems.length ? lowItems.slice(0, 5).map((item) => `${item.product?.name || item.variantName} (${item.inventory?.quantity || 0})`).join(' · ') : 'Low-stock threshold အောက်ရောက်ရင် ဒီနေရာနဲ့ Browser notification မှာပြပါမယ်။'}</span></div>
        <button type="button" onClick={() => loadLowStock({ notify: false })}>Refresh</button>
      </div>
      {message ? <div className="inventory-tools-message">{message}</div> : null}

      {scannerOpen ? <ScannerModal onClose={() => setScannerOpen(false)} /> : null}
      {importOpen ? <ImportModal onClose={() => setImportOpen(false)} onImported={importFinished} /> : null}
    </section>
  );
}
