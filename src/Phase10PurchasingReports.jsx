import React, { useEffect, useState } from 'react';
import { BarChart3, Download, Loader2, RefreshCw } from 'lucide-react';
import { apiDownload, apiFetch } from './phase2Api';
import { money } from './phase10PurchasingUtils';

export default function Phase10PurchasingReports({ notify, onError }) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [summary, setSummary] = useState({});
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      const data = await apiFetch(`/api/purchasing/reports/summary?${params}`);
      setSummary(data.summary || {});
    } catch (error) { onError(error); } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const exportCsv = async () => {
    setExporting(true);
    try {
      const params = new URLSearchParams();
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      const file = await apiDownload(`/api/purchasing/reports/export.csv?${params}`, 'mahar-pos-purchasing.csv');
      notify('success', `${file} downloaded.`);
    } catch (error) { onError(error); } finally { setExporting(false); }
  };

  return <section className="purchasing-card p10-wide-card">
    <header><div><BarChart3 size={20}/></div><span><h3>Purchasing Reports</h3><p>Goods received, payments, returns and outstanding payables</p></span><button type="button" className="icon-button" onClick={load}><RefreshCw className={loading ? 'purchasing-spin' : ''} size={18}/></button></header>
    <div className="p10-form-body">
      <div className="p10-report-filters"><label className="p10-field"><span>From</span><input type="date" value={from} onChange={(e) => setFrom(e.target.value)}/></label><label className="p10-field"><span>To</span><input type="date" value={to} onChange={(e) => setTo(e.target.value)}/></label><button type="button" onClick={load} disabled={loading}>{loading ? <Loader2 className="purchasing-spin" size={18}/> : <RefreshCw size={18}/>} Apply</button><button type="button" className="export" onClick={exportCsv} disabled={exporting}>{exporting ? <Loader2 className="purchasing-spin" size={18}/> : <Download size={18}/>} Export CSV</button></div>
      <div className="p10-report-grid">
        <article><span>Net Purchases</span><b>{money(summary.netPurchases)}</b><small>{summary.receiptCount || 0} receipts</small></article>
        <article><span>Supplier Payments</span><b>{money(summary.paidAmount)}</b><small>{summary.paymentCount || 0} payments</small></article>
        <article><span>Purchase Returns</span><b>{money(summary.returnedAmount)}</b><small>{summary.returnCount || 0} returns</small></article>
        <article><span>Outstanding</span><b>{money(summary.outstanding)}</b><small>Supplier payable</small></article>
        <article><span>Approved Orders</span><b>{summary.approvedOrders || 0}</b><small>Waiting receiving</small></article>
        <article><span>Partial Orders</span><b>{summary.partiallyReceivedOrders || 0}</b><small>Receiving in progress</small></article>
        <article><span>Received Orders</span><b>{summary.receivedOrders || 0}</b><small>Fully received</small></article>
        <article><span>Active Suppliers</span><b>{summary.activeSuppliers || 0}</b><small>Supplier master</small></article>
      </div>
    </div>
  </section>;
}
