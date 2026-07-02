import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Archive,
  CheckCircle2,
  Clock3,
  DatabaseBackup,
  Fingerprint,
  HardDrive,
  Loader2,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import { apiFetch, clearSession } from './phase2Api';
import './backup-recovery.css';

function formatBytes(value) {
  const bytes = Number(value || 0);
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / (1024 ** index)).toFixed(index ? 2 : 0)} ${units[index]}`;
}

function formatDate(value) {
  if (!value) return '-';
  try {
    return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
  } catch {
    return String(value);
  }
}

function formatDays(value) {
  if (value === null || value === undefined) return '-';
  const days = Number(value);
  if (!Number.isFinite(days)) return '-';
  if (days === 0) return 'Today';
  if (days === 1) return '1 day';
  return `${days} days`;
}

function StatusBadge({ status }) {
  const healthy = status === 'HEALTHY';
  return (
    <span className={`backup-status-badge ${healthy ? 'healthy' : 'warning'}`}>
      {healthy ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
      {status || 'UNKNOWN'}
    </span>
  );
}

export default function BackupRecoveryPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState('');

  const handleError = (requestError) => {
    if (requestError?.status === 401) {
      clearSession();
      window.location.reload();
      return;
    }
    setError(requestError?.message || 'Backup status request failed');
  };

  const load = async (verify = false) => {
    verify ? setVerifying(true) : setLoading(true);
    setError('');
    try {
      const response = await apiFetch(`/api/backups/status${verify ? '?verify=1' : ''}`);
      setData(response);
    } catch (requestError) {
      setData(requestError?.data || null);
      handleError(requestError);
    } finally {
      setLoading(false);
      setVerifying(false);
    }
  };

  useEffect(() => { load(false); }, []);

  const cards = useMemo(() => [
    {
      icon: Clock3,
      label: 'Last Backup',
      value: formatDate(data?.backup?.createdAt),
      note: data?.backup ? `${data.backup.ageHours} hours ago` : 'No verified backup yet',
    },
    {
      icon: HardDrive,
      label: 'Archive Size',
      value: formatBytes(data?.backup?.sizeBytes),
      note: data?.backup?.fileName || '-',
    },
    {
      icon: Archive,
      label: 'Retention',
      value: `${data?.policy?.retentionDays || 14} days`,
      note: `${data?.policy?.archiveCount || 0} backup archives`,
    },
    {
      icon: ShieldCheck,
      label: 'Verification',
      value: data?.backup?.hashVerifiedNow
        ? (data?.backup?.hashMatches ? 'Hash matched' : 'Hash mismatch')
        : 'Structural check',
      note: data?.backup?.structuralVerification || 'Run Verify Now',
    },
  ], [data]);

  return (
    <section className="backup-recovery-page">
      <div className="backup-page-heading">
        <div>
          <span>DATA PROTECTION</span>
          <h2>Backup & Disaster Recovery</h2>
          <p>PostgreSQL backup freshness၊ SHA-256 integrity နဲ့ retention policy ကို ဒီနေရာက စောင့်ကြည့်နိုင်ပါတယ်။</p>
        </div>
        <div className="backup-heading-actions">
          <button type="button" onClick={() => load(false)} disabled={loading || verifying}>
            {loading ? <Loader2 className="backup-spin" size={18} /> : <RefreshCw size={18} />}
            Refresh
          </button>
          <button className="primary" type="button" onClick={() => load(true)} disabled={loading || verifying}>
            {verifying ? <Loader2 className="backup-spin" size={18} /> : <Fingerprint size={18} />}
            Verify SHA-256
          </button>
        </div>
      </div>

      <div className={`backup-health-banner ${data?.healthy ? 'healthy' : 'warning'}`}>
        <div className="backup-health-icon">
          {data?.healthy ? <DatabaseBackup size={28} /> : <AlertTriangle size={28} />}
        </div>
        <div>
          <b>{data?.healthy ? 'Backup system is healthy' : 'Backup system needs attention'}</b>
          <small>{error || data?.message || `Daily schedule: ${data?.policy?.schedule || '02:30'}`}</small>
        </div>
        <StatusBadge status={data?.status} />
      </div>

      <div className="backup-summary-grid">
        {cards.map(({ icon: Icon, label, value, note }) => (
          <article key={label}>
            <Icon size={22} />
            <span>{label}</span>
            <b>{value}</b>
            <small>{note}</small>
          </article>
        ))}
      </div>

      <div className="backup-content-grid">
        <section className="backup-card">
          <header>
            <DatabaseBackup size={20} />
            <div><h3>Latest Verified Archive</h3><p>Backup file details without exposing database credentials.</p></div>
          </header>
          <dl className="backup-details">
            <div><dt>Status</dt><dd><StatusBadge status={data?.status} /></dd></div>
            <div><dt>Created</dt><dd>{formatDate(data?.backup?.createdAt)}</dd></div>
            <div><dt>Age</dt><dd>{data?.backup ? `${data.backup.ageHours} hours` : '-'}</dd></div>
            <div><dt>Tenant Shop</dt><dd>{data?.tenant ? `${data.tenant.name} · ${data.tenant.tenantId}` : '-'}</dd></div>
            <div><dt>Tenant Users</dt><dd>{data?.tenant ? `${data.tenant.users?.active || 0} active / ${data.tenant.users?.total || 0} total` : '-'}</dd></div>
            <div><dt>Tenant Age</dt><dd>{formatDays(data?.tenant?.ageDays)}</dd></div>
            <div><dt>Tenant Backup Age</dt><dd>{data?.tenant ? `${data.tenant.backupAgeHours} hours since archive` : '-'}</dd></div>
            <div><dt>User Ages</dt><dd>{data?.tenant ? `Oldest ${formatDays(data.tenant.users?.oldestAgeDays)} · Newest ${formatDays(data.tenant.users?.newestAgeDays)}` : '-'}</dd></div>
            <div><dt>User Roles</dt><dd>{data?.tenant ? `${data.tenant.users?.shopAdmins || 0} shop admin · ${data.tenant.users?.cashiers || 0} cashier` : '-'}</dd></div>
            <div><dt>File</dt><dd><code>{data?.backup?.fileName || '-'}</code></dd></div>
            <div><dt>Size</dt><dd>{formatBytes(data?.backup?.sizeBytes)}</dd></div>
            <div><dt>SHA-256</dt><dd><code className="backup-hash">{data?.backup?.sha256 || '-'}</code></dd></div>
            <div><dt>Live verification</dt><dd>{data?.backup?.hashVerifiedNow ? (data.backup.hashMatches ? 'Passed' : 'Failed') : 'Not run in this session'}</dd></div>
          </dl>
        </section>

        <section className="backup-card">
          <header>
            <ShieldCheck size={20} />
            <div><h3>Recovery Policy</h3><p>Production recovery controls and expected schedule.</p></div>
          </header>
          <div className="backup-policy-list">
            <div><CheckCircle2 size={18} /><span><b>Daily custom-format archive</b><small>{data?.policy?.schedule || 'Daily at 02:30'}</small></span></div>
            <div><CheckCircle2 size={18} /><span><b>Structural verification</b><small>Every backup must pass pg_restore --list</small></span></div>
            <div><CheckCircle2 size={18} /><span><b>Integrity digest</b><small>SHA-256 stored beside every archive</small></span></div>
            <div><CheckCircle2 size={18} /><span><b>Automatic cleanup</b><small>Archives older than {data?.policy?.retentionDays || 14} days are removed</small></span></div>
            <div><CheckCircle2 size={18} /><span><b>Restore drill</b><small>Use a disposable PostgreSQL database, never production</small></span></div>
          </div>
        </section>
      </div>
    </section>
  );
}
