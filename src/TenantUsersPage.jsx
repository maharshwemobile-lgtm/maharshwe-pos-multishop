import React, { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  KeyRound,
  Loader2,
  Search,
  ShieldCheck,
  ShieldX,
  UserPlus,
  UserRound,
  Users,
} from 'lucide-react';
import { apiFetch, clearSession } from './phase2Api';
import './tenant-users.css';

const blankForm = { username: '', password: '', name: '', role: 'CASHIER' };

function formatDate(value) {
  if (!value) return 'Never';
  try {
    return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
  } catch {
    return String(value);
  }
}

export default function TenantUsersPage() {
  const [data, setData] = useState({ users: [], tenant: null, total: 0 });
  const [integrity, setIntegrity] = useState(null);
  const [query, setQuery] = useState('');
  const [form, setForm] = useState(blankForm);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);

  const notify = (type, text) => {
    setMessage({ type, text });
    window.clearTimeout(notify.timer);
    notify.timer = window.setTimeout(() => setMessage(null), 3500);
  };

  const handleError = (error) => {
    if (error?.status === 401) {
      clearSession();
      window.location.reload();
      return;
    }
    notify('error', error?.message || 'User request failed');
  };

  const load = async () => {
    setLoading(true);
    try {
      const [usersResponse, integrityResponse] = await Promise.all([
        apiFetch('/api/users/live'),
        apiFetch('/api/tenant/integrity'),
      ]);
      setData(usersResponse);
      setIntegrity(integrityResponse);
    } catch (error) {
      handleError(error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const createUser = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      await apiFetch('/api/users/live', { method: 'POST', body: form });
      setForm(blankForm);
      notify('success', 'User saved inside this PostgreSQL tenant');
      await load();
    } catch (error) {
      handleError(error);
    } finally {
      setSaving(false);
    }
  };

  const setActive = async (user, active) => {
    try {
      await apiFetch(`/api/users/live/${user.id}`, { method: 'PATCH', body: { active } });
      notify('success', active ? 'User reactivated' : 'User deactivated; sale history link preserved');
      await load();
    } catch (error) {
      handleError(error);
    }
  };

  const filtered = useMemo(() => {
    const value = query.trim().toLowerCase();
    if (!value) return data.users || [];
    return (data.users || []).filter((user) => [user.username, user.name, user.role]
      .some((field) => String(field || '').toLowerCase().includes(value)));
  }, [data.users, query]);

  const summary = useMemo(() => ({
    total: (data.users || []).length,
    active: (data.users || []).filter((user) => user.active).length,
    admins: (data.users || []).filter((user) => user.role === 'SHOP_ADMIN' && user.active).length,
    cashiers: (data.users || []).filter((user) => user.role === 'CASHIER' && user.active).length,
  }), [data.users]);

  return (
    <section className="tenant-users-page">
      <div className="tenant-users-heading">
        <div>
          <span>TENANT SECURITY</span>
          <h2>Users & Tenant Isolation</h2>
          <p>Users၊ roles နဲ့ Sale History cashier links တွေကို လက်ရှိ PostgreSQL shop tenant အတွင်းမှာပဲ ထိန်းသိမ်းထားပါတယ်။</p>
        </div>
      </div>

      <div className={`tenant-integrity ${integrity?.tenantSafe ? 'safe' : 'unsafe'}`}>
        {integrity?.tenantSafe ? <ShieldCheck size={24} /> : <ShieldX size={24} />}
        <div>
          <b>{integrity?.tenantSafe ? 'Tenant Isolation Verified' : 'Tenant Integrity Needs Attention'}</b>
          <small>{data.tenant?.name || 'Current Shop'} · {integrity ? `${integrity.violations} cross-tenant violations` : 'Checking PostgreSQL relations...'}</small>
        </div>
        <code>{data.tenant?.slug || data.tenant?.id || '-'}</code>
      </div>

      <div className="tenant-user-stats">
        <article><Users /><span>Total Users</span><b>{summary.total}</b></article>
        <article><CheckCircle2 /><span>Active</span><b>{summary.active}</b></article>
        <article><ShieldCheck /><span>Shop Admins</span><b>{summary.admins}</b></article>
        <article><UserRound /><span>Cashiers</span><b>{summary.cashiers}</b></article>
      </div>

      <section className="tenant-users-card">
        <header><UserPlus size={20} /><div><h3>Create Tenant User</h3><p>User is automatically assigned to {data.tenant?.name || 'the current shop'}.</p></div></header>
        <form onSubmit={createUser}>
          <label>Name<input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required /></label>
          <label>Username<input value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} required /></label>
          <label>Password<input type="password" minLength="6" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} required /></label>
          <label>Role<select value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value })}><option value="CASHIER">Cashier</option><option value="SHOP_ADMIN">Shop Admin</option></select></label>
          <button type="submit" disabled={saving}>{saving ? <Loader2 className="tenant-spin" size={18} /> : <KeyRound size={18} />} Create User</button>
        </form>
      </section>

      <section className="tenant-users-card">
        <div className="tenant-users-toolbar">
          <div><Search size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name, username or role" /></div>
          <strong>{filtered.length} users</strong>
        </div>
        <div className="tenant-users-table-wrap">
          <table>
            <thead><tr><th>User</th><th>Role</th><th>Tenant</th><th>Last Login</th><th>Status</th><th>Action</th></tr></thead>
            <tbody>
              {filtered.map((user) => (
                <tr key={user.id}>
                  <td><div className="tenant-user-cell"><UserRound size={18} /><span><b>{user.name}</b><small>@{user.username} · {user.id.slice(0, 8)}</small></span></div></td>
                  <td><span className={`tenant-role ${user.role === 'SHOP_ADMIN' ? 'admin' : 'cashier'}`}>{user.role === 'SHOP_ADMIN' ? 'Shop Admin' : 'Cashier'}</span></td>
                  <td><b>{data.tenant?.name || '-'}</b><small>{user.shopId === data.tenant?.id ? 'Matched' : 'Mismatch'}</small></td>
                  <td>{formatDate(user.lastLoginAt)}</td>
                  <td><span className={`tenant-status ${user.active ? 'active' : 'inactive'}`}>{user.active ? 'Active' : 'Inactive'}</span></td>
                  <td><button type="button" className={user.active ? 'deactivate' : 'activate'} onClick={() => setActive(user, !user.active)}>{user.active ? 'Deactivate' : 'Reactivate'}</button></td>
                </tr>
              ))}
              {!filtered.length && !loading ? <tr><td colSpan="6" className="tenant-empty">No users found.</td></tr> : null}
            </tbody>
          </table>
          {loading ? <div className="tenant-loading"><Loader2 className="tenant-spin" /> Loading tenant users...</div> : null}
        </div>
      </section>

      {message ? <div className={`tenant-toast ${message.type}`}>{message.text}</div> : null}
    </section>
  );
}
