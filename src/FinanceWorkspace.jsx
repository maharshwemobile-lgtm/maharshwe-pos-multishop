import React, { useEffect, useState } from 'react';
import {
  Banknote,
  CircleDollarSign,
  Loader2,
  TrendingDown,
  TrendingUp,
  Wrench,
} from 'lucide-react';
import PaymentsAccountsPage from './PaymentsAccountsPage.jsx';
import { apiFetch, clearSession } from './phase2Api';
import './finance-workspace.css';

const money = (value) => `${Number(value || 0).toLocaleString('en-US')} MMK`;

function dateLabel(value) {
  if (!value) return '-';
  return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short' }).format(new Date(value));
}

export default function FinanceWorkspace({ onNavigate }) {
  const [weekly, setWeekly] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await apiFetch('/api/repair-platform/finance/weekly');
      setWeekly(response.weekly || null);
    } catch (requestError) {
      if (requestError?.status === 401) {
        clearSession();
        window.location.reload();
        return;
      }
      setError(requestError?.message || 'Weekly finance failed');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const positive = Number(weekly?.changePercent || 0) >= 0;

  return (
    <div className="finance-workspace">
      <section className="finance-weekly-panel">
        <header>
          <div><span>WEEKLY PROFIT</span><h2>Finance Performance</h2><p>{dateLabel(weekly?.weekStart)} – {dateLabel(weekly?.weekEnd)} · Myanmar time</p></div>
        </header>
        {error ? <div className="finance-error">{error}</div> : null}
        <div className="finance-weekly-grid">
          <article className="total"><TrendingUp size={24} /><span>This Week Total Profit</span><b>{money(weekly?.totalProfit)}</b><small className={positive ? 'positive' : 'negative'}>{positive ? '▲' : '▼'} {Math.abs(Number(weekly?.changePercent || 0)).toFixed(1)}% vs previous week</small></article>
          <article><Wrench size={24} /><span>Repair Profit</span><b>{money(weekly?.repairProfit)}</b><small>{Number(weekly?.completedRepairs || 0)} completed repairs</small></article>
          <article><Banknote size={24} /><span>Sales Profit</span><b>{money(weekly?.salesProfit)}</b><small>Product sales profit</small></article>
          <article><CircleDollarSign size={24} /><span>Money Service Profit</span><b>{money(weekly?.moneyProfit)}</b><small>Configured wallets and service fees</small></article>
          <article className="cost"><TrendingDown size={24} /><span>Repair Cost</span><b>{money(weekly?.repairCost)}</b><small>Parts + technician + other</small></article>
          <article><TrendingUp size={24} /><span>Repair Revenue</span><b>{money(weekly?.repairRevenue)}</b><small>This week recognized revenue</small></article>
        </div>
      </section>
      <PaymentsAccountsPage onNavigate={onNavigate} />
    </div>
  );
}
