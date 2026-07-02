import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Clock3, Link2, PackageCheck, RefreshCw, Wrench } from 'lucide-react';
import { apiFetch } from './phase2Api';
import './repair-summary-placement.css';

export default function RepairSummaryBelowFinance({ refreshToken = 0 }) {
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    apiFetch('/api/repair-platform/jobs?page=1&limit=1')
      .then((response) => {
        if (active) setSummary(response.summary || null);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [refreshToken]);

  const cards = useMemo(() => [
    { label: 'Total Repairs', value: summary?.total || 0, icon: Wrench, tone: 'blue' },
    { label: 'In Workflow', value: summary?.pending || 0, icon: Clock3, tone: 'orange' },
    { label: 'Completed', value: summary?.completed || 0, icon: CheckCircle2, tone: 'green' },
    { label: 'Delivered', value: summary?.delivered || 0, icon: PackageCheck, tone: 'purple' },
    { label: 'API Connected', value: summary?.imported || 0, icon: Link2, tone: 'teal' },
  ], [summary]);

  return (
    <div className="repair-summary-grid repair-summary-below-finance" aria-busy={loading}>
      {cards.map(({ label, value, icon: Icon, tone }) => (
        <article key={label}>
          <div className={`tone-${tone}`}>{loading ? <RefreshCw className="repair-spin" size={20} /> : <Icon size={22} />}</div>
          <span>{label}</span>
          <b>{Number(value).toLocaleString()}</b>
        </article>
      ))}
    </div>
  );
}
