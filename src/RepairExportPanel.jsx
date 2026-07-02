import React, { useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { apiDownload, clearSession } from './phase2Api';

export default function RepairExportPanel({ notify }) {
  const [exporting, setExporting] = useState(false);
  const [exportFrom, setExportFrom] = useState('');
  const [exportTo, setExportTo] = useState('');
  const [exportStatus, setExportStatus] = useState('');

  const handleError = (error) => {
    if (error?.status === 401) {
      clearSession();
      window.location.reload();
      return;
    }
    notify?.('error', error?.message || 'Repair transaction export failed');
  };

  const exportCsv = async () => {
    setExporting(true);
    try {
      const params = new URLSearchParams();
      if (exportFrom) params.set('from', exportFrom);
      if (exportTo) params.set('to', exportTo);
      if (exportStatus) params.set('status', exportStatus);
      const fileName = await apiDownload(
        `/api/repair-platform/export.csv?${params.toString()}`,
        'repair-transactions.csv',
      );
      notify?.('success', `${fileName} exported`);
    } catch (error) {
      handleError(error);
    } finally {
      setExporting(false);
    }
  };

  return (
    <section className="repair-export-panel phase11-bottom-tool">
      <header>
        <Download size={20} />
        <div>
          <b>Export Repair Transactions</b>
          <small>Repair, payment, costs, profit, IMEI/Serial နဲ့ status တွေကို CSV ထုတ်ပါ။</small>
        </div>
      </header>
      <div className="repair-export-filters">
        <label>From<input type="date" value={exportFrom} onChange={(event) => setExportFrom(event.target.value)} /></label>
        <label>To<input type="date" value={exportTo} onChange={(event) => setExportTo(event.target.value)} /></label>
        <label>Status<select value={exportStatus} onChange={(event) => setExportStatus(event.target.value)}><option value="">All Statuses</option><option value="RECEIVED">Received</option><option value="CHECKING">Checking</option><option value="IN_PROGRESS">In Progress</option><option value="WAITING_PART">Waiting Part</option><option value="COMPLETED">Completed</option><option value="CANNOT_REPAIR">Cannot Repair</option><option value="DELIVERED">Delivered</option></select></label>
      </div>
      <button type="button" className="export-button" onClick={exportCsv} disabled={exporting}>
        {exporting ? <Loader2 className="repair-finance-spin" size={18} /> : <Download size={18} />} Export CSV
      </button>
    </section>
  );
}
