import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Copy,
  Eye,
  FileClock,
  Fingerprint,
  KeyRound,
  Link2,
  Loader2,
  RefreshCw,
  Search,
  ShieldCheck,
  ShieldX,
  UserRound,
  X,
} from 'lucide-react';
import { apiFetch, clearSession } from './phase2Api';
import './audit-trail.css';

const shortHash = (value) => value ? `${value.slice(0, 10)}…${value.slice(-8)}` : '-';

function formatDate(value) {
  if (!value) return '-';
  try {
    return new Intl.DateTimeFormat('en-GB', {
      dateStyle: 'medium',
      timeStyle: 'medium',
    }).format(new Date(value));
  } catch {
    return String(value);
  }
}

function pretty(value) {
  if (value === null || value === undefined) return '-';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function EventDetailModal({ event, onClose }) {
  const copy = async (value) => {
    try {
      await navigator.clipboard.writeText(String(value || ''));
    } catch {
      // Clipboard can be blocked by the browser; detail remains visible.
    }
  };

  return (
    <div className="audit-modal-backdrop" onMouseDown={(mouseEvent) => {
      if (mouseEvent.target === mouseEvent.currentTarget) onClose();
    }}>
      <section className="audit-modal" role="dialog" aria-modal="true">
        <header>
          <div className={`audit-modal-icon ${event.crypto ? 'audit-tone-green' : 'audit-tone-orange'}`}>
            {event.crypto ? <Fingerprint size={25} /> : <FileClock size={25} />}
          </div>
          <div>
            <h3>{event.action}</h3>
            <p>{event.summary} · {formatDate(event.createdAt)}</p>
          </div>
          <button type="button" className="audit-icon-button" onClick={onClose}><X size={20} /></button>
        </header>

        <div className="audit-detail-body">
          <div className="audit-detail-grid">
            <article><span>Actor</span><b>{event.actor?.name || event.actor?.username || 'Unknown'}</b><small>{event.actor?.role || '-'} · {event.actor?.username || '-'}</small></article>
            <article><span>Outcome</span><b className={event.outcome === 'SUCCESS' ? 'audit-text-success' : event.outcome === 'FAILED' ? 'audit-text-danger' : ''}>{event.outcome}</b><small>Status {event.metadata?.statusCode || '-'}</small></article>
            <article><span>Target</span><b>{event.entityType || '-'}</b><small>{event.entityId || '-'}</small></article>
            <article><span>Request</span><b>{event.request?.method || '-'}</b><small>{event.request?.path || '-'}</small></article>
            <article><span>IP Address</span><b>{event.ipAddress || '-'}</b><small>{event.metadata?.durationMs ? `${event.metadata.durationMs} ms` : '-'}</small></article>
            <article><span>Request ID</span><b className="audit-mono">{shortHash(event.requestId)}</b><button type="button" onClick={() => copy(event.requestId)}><Copy size={14} /> Copy</button></article>
          </div>

          <div className="audit-section-title">Recorded Change</div>
          <pre className="audit-json-block">{pretty(event.changes)}</pre>

          <div className="audit-section-title">Request Context</div>
          <pre className="audit-json-block">{pretty(event.request)}</pre>

          <div className="audit-section-title">Cryptographic Chain</div>
          {event.crypto ? (
            <div className="audit-crypto-block">
              <div><span>Algorithm</span><b>{event.crypto.algorithm}</b></div>
              <div><span>Signed At</span><b>{formatDate(event.crypto.signedAt)}</b></div>
              <div><span>Previous Hash</span><code>{event.crypto.previousHash}</code><button type="button" onClick={() => copy(event.crypto.previousHash)}><Copy size={14} /></button></div>
              <div><span>Payload Hash</span><code>{event.crypto.payloadHash}</code><button type="button" onClick={() => copy(event.crypto.payloadHash)}><Copy size={14} /></button></div>
              <div><span>Event Hash</span><code>{event.crypto.eventHash}</code><button type="button" onClick={() => copy(event.crypto.eventHash)}><Copy size={14} /></button></div>
            </div>
          ) : (
            <div className="audit-legacy-note"><AlertTriangle size={20} /> This is a legacy audit event created before cryptographic chaining was enabled.</div>
          )}

          <div className="audit-section-title">Device</div>
          <div className="audit-user-agent">{event.userAgent || '-'}</div>
        </div>
      </section>
    </div>
  );
}

export default function AuditTrailPage() {
  const [data, setData] = useState({ events: [], summary: {}, total: 0, totalPages: 1, actions: [], actors: [] });
  const [query, setQuery] = useState('');
  const [action, setAction] = useState('');
  const [outcome, setOutcome] = useState('');
  const [actorId, setActorId] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [integrity, setIntegrity] = useState(null);
  const [selected, setSelected] = useState(null);
  const [message, setMessage] = useState(null);

  const notify = (type, text) => {
    setMessage({ type, text });
    window.clearTimeout(notify.timer);
    notify.timer = window.setTimeout(() => setMessage(null), 4000);
  };

  const handleError = (error) => {
    if (error?.status === 401) {
      clearSession();
      window.location.reload();
      return;
    }
    notify('error', error?.message || 'Audit request failed');
  };

  const load = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: '25' });
      if (query.trim()) params.set('q', query.trim());
      if (action) params.set('action', action);
      if (outcome) params.set('outcome', outcome);
      if (actorId) params.set('actorId', actorId);
      if (fromDate) params.set('from', fromDate);
      if (toDate) params.set('to', toDate);
      const response = await apiFetch(`/api/audit/events?${params.toString()}`);
      setData(response);
    } catch (error) {
      handleError(error);
    } finally {
      setLoading(false);
    }
  };

  const verify = async (showToast = true) => {
    setVerifying(true);
    try {
      const response = await apiFetch('/api/audit/integrity');
      setIntegrity(response);
      if (showToast) notify(response.valid ? 'success' : 'error', response.valid ? `Audit chain verified: ${response.verified} events` : 'Audit chain verification failed');
    } catch (error) {
      handleError(error);
    } finally {
      setVerifying(false);
    }
  };

  useEffect(() => {
    const timer = window.setTimeout(load, 220);
    return () => window.clearTimeout(timer);
  }, [query, action, outcome, actorId, fromDate, toDate, page]);

  useEffect(() => setPage(1), [query, action, outcome, actorId, fromDate, toDate]);
  useEffect(() => { verify(false); }, []);

  const summary = data.summary || {};
  const cards = useMemo(() => [
    { label: 'Total Events', value: Number(summary.totalEvents || 0).toLocaleString(), icon: FileClock, tone: 'blue' },
    { label: 'Crypto Chained', value: Number(summary.chained || 0).toLocaleString(), icon: Link2, tone: 'green' },
    { label: 'Successful', value: Number(summary.successful || 0).toLocaleString(), icon: CheckCircle2, tone: 'green' },
    { label: 'Failed', value: Number(summary.failed || 0).toLocaleString(), icon: AlertTriangle, tone: 'red' },
  ], [summary]);

  return (
    <section className="audit-page">
      <div className="audit-page-heading">
        <div>
          <span className="audit-eyebrow">SECURITY</span>
          <h2>Cryptographic Audit Trail</h2>
          <p>ဘယ်သူ၊ ဘယ်အချိန်၊ ဘယ်နေရာကနေ၊ ဘာလုပ်ခဲ့သလဲကို tamper-evident hash chain နဲ့ တိတိကျကျမှတ်တမ်းတင်ထားပါတယ်။</p>
        </div>
        <div className="audit-heading-actions">
          <button type="button" className="audit-refresh-button" onClick={load} disabled={loading}><RefreshCw size={18} /> Refresh</button>
          <button type="button" className={`audit-verify-button ${integrity && !integrity.valid ? 'danger' : ''}`} onClick={() => verify(true)} disabled={verifying}>
            {verifying ? <Loader2 className="audit-spin" size={18} /> : integrity?.valid === false ? <ShieldX size={18} /> : <ShieldCheck size={18} />}
            Verify Chain
          </button>
        </div>
      </div>

      <div className={`audit-integrity-banner ${integrity?.valid === false ? 'invalid' : integrity?.valid ? 'valid' : 'pending'}`}>
        <div>{integrity?.valid === false ? <ShieldX size={25} /> : <ShieldCheck size={25} />}</div>
        <span>
          <b>{integrity?.valid === false ? 'Integrity Check Failed' : integrity?.valid ? 'Audit Chain Verified' : 'Checking Audit Chain'}</b>
          <small>{integrity ? `${integrity.verified}/${integrity.totalChained} chained events verified · ${integrity.algorithm} · checked ${formatDate(integrity.checkedAt)}` : 'Verifying cryptographic hashes…'}</small>
        </span>
        {integrity?.firstInvalid ? <code>{shortHash(integrity.firstInvalid.id)}</code> : <code>{shortHash(integrity?.lastVerifiedHash)}</code>}
      </div>

      <div className="audit-summary-grid">
        {cards.map((card) => <article key={card.label}><div className={`audit-summary-icon audit-tone-${card.tone}`}><card.icon size={23} /></div><span>{card.label}</span><b>{card.value}</b></article>)}
      </div>

      <section className="audit-card">
        <div className="audit-toolbar">
          <div className="audit-search-box"><Search size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search actor, action, target, request ID or IP" /></div>
          <input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} aria-label="From date" />
          <input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} aria-label="To date" />
          <select value={actorId} onChange={(event) => setActorId(event.target.value)}><option value="">All Actors</option>{(data.actors || []).map((actor) => <option key={actor.id} value={actor.id}>{actor.name || actor.username} · {actor.role || '-'}</option>)}</select>
          <select value={action} onChange={(event) => setAction(event.target.value)}><option value="">All Actions</option>{(data.actions || []).map((item) => <option key={item} value={item}>{item}</option>)}</select>
          <select value={outcome} onChange={(event) => setOutcome(event.target.value)}><option value="">All Outcomes</option><option value="SUCCESS">Success</option><option value="FAILED">Failed</option><option value="LEGACY">Legacy</option></select>
        </div>

        <div className="audit-table-wrap">
          <table className="audit-table">
            <thead><tr><th>Time</th><th>Actor</th><th>Action</th><th>Target</th><th>Result</th><th>Request ID</th><th>Chain</th><th>Detail</th></tr></thead>
            <tbody>
              {(data.events || []).map((event) => (
                <tr key={event.id}>
                  <td><div className="audit-time-cell"><Clock3 size={15} /><span>{formatDate(event.createdAt)}</span></div></td>
                  <td><div className="audit-actor-cell"><div><UserRound size={17} /></div><span><b>{event.actor?.name || event.actor?.username || 'Unknown'}</b><small>{event.actor?.role || '-'} · {event.ipAddress || '-'}</small></span></div></td>
                  <td><b className="audit-action-name">{event.action}</b><small className="audit-row-summary">{event.summary}</small></td>
                  <td><b>{event.entityType || '-'}</b><small className="audit-mono">{shortHash(event.entityId)}</small></td>
                  <td><span className={`audit-outcome ${String(event.outcome).toLowerCase()}`}>{event.outcome}</span></td>
                  <td className="audit-mono">{shortHash(event.requestId)}</td>
                  <td>{event.crypto ? <span className="audit-chain-badge verified"><Fingerprint size={14} /> Signed</span> : <span className="audit-chain-badge legacy"><FileClock size={14} /> Legacy</span>}</td>
                  <td><button type="button" className="audit-view-button" onClick={() => setSelected(event)}><Eye size={15} /> View</button></td>
                </tr>
              ))}
              {!data.events?.length && !loading ? <tr><td colSpan="8"><div className="audit-empty"><FileClock size={30} /><span>No audit events found.</span></div></td></tr> : null}
            </tbody>
          </table>
          {loading ? <div className="audit-loading"><Loader2 className="audit-spin" /> Loading audit events…</div> : null}
        </div>

        <div className="audit-pagination">
          <span>Showing {data.events?.length || 0} of {data.total || 0} events</span>
          <div><button type="button" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}><ChevronLeft size={17} /> Previous</button><b>Page {page} / {Math.max(1, data.totalPages || 1)}</b><button type="button" disabled={page >= Math.max(1, data.totalPages || 1)} onClick={() => setPage((value) => value + 1)}>Next <ChevronRight size={17} /></button></div>
        </div>
      </section>

      {message ? <div className={`audit-toast audit-toast-${message.type}`}>{message.text}</div> : null}
      {selected ? <EventDetailModal event={selected} onClose={() => setSelected(null)} /> : null}
    </section>
  );
}
