import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Building2,
  CheckCircle2,
  Database,
  KeyRound,
  Loader2,
  LockKeyhole,
  RefreshCw,
  Search,
  ShieldCheck,
  Users,
  XCircle,
} from 'lucide-react';
import { apiFetch, clearSession, getSession } from './phase2Api';
import './grand-admin-portal.css';

const FEATURE_KEYS = [
  ['sale', 'Sale POS'],
  ['history', 'Sales History'],
  ['inventory', 'Inventory / Stock'],
  ['productEdit', 'Product Edit'],
  ['purchaseApprove', 'Purchases'],
  ['accounting', 'Accounting'],
  ['reports', 'Reports'],
  ['settings', 'Settings'],
  ['viewCost', 'View Cost'],
];

function money(value) {
  return `${Number(value || 0).toLocaleString('en-US')} Ks`;
}

function dateText(value) {
  if (!value) return '-';
  try {
    return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
  } catch {
    return String(value);
  }
}

function statusTone(status) {
  const key = String(status || '').toLowerCase();
  if (key.includes('active')) return 'green';
  if (key.includes('trial')) return 'blue';
  if (key.includes('suspend') || key.includes('overdue')) return 'red';
  return 'gray';
}

function HealthPill({ label, item }) {
  return (
    <article className={item?.ok ? 'ok' : 'warn'}>
      {item?.ok ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
      <span>{label}</span>
      <b>{item?.status || item?.provider || (item?.ok ? 'ok' : 'not ready')}</b>
    </article>
  );
}

export default function GrandAdminPortal() {
  const session = getSession();
  const [query, setQuery] = useState('');
  const [overview, setOverview] = useState(null);
  const [shops, setShops] = useState([]);
  const [selectedShop, setSelectedShop] = useState(null);
  const [shopUsers, setShopUsers] = useState([]);
  const [auditRows, setAuditRows] = useState([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const [passwordReset, setPasswordReset] = useState({ user: null, password: '' });

  const isGrandAdmin = session?.user?.role === 'SUPER_ADMIN' && !session?.user?.shopId;

  const notify = (type, text) => {
    setMessage({ type, text });
    window.clearTimeout(notify.timer);
    notify.timer = window.setTimeout(() => setMessage(null), 3600);
  };

  const handleError = (error) => {
    if (error?.status === 401) {
      clearSession();
      window.location.reload();
      return;
    }
    notify('error', error?.message || 'Request failed');
  };

  const load = async () => {
    setBusy(true);
    try {
      const search = query.trim();
      const [overviewData, shopsData, auditData] = await Promise.all([
        apiFetch('/api/grand-admin/overview'),
        apiFetch(`/api/grand-admin/shops${search ? `?q=${encodeURIComponent(search)}` : ''}`),
        apiFetch('/api/grand-admin/audit-logs?limit=80'),
      ]);
      setOverview(overviewData);
      setShops(shopsData.shops || []);
      setAuditRows(auditData.rows || []);
      if (selectedShop) {
        const next = (shopsData.shops || []).find((shop) => shop.id === selectedShop.id) || null;
        setSelectedShop(next);
      }
    } catch (error) {
      handleError(error);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => { load(); }, []);

  const filteredShops = useMemo(() => shops, [shops]);

  const openShop = async (shop) => {
    setSelectedShop(shop);
    setShopUsers([]);
    try {
      const data = await apiFetch(`/api/grand-admin/shops/${shop.id}/users`);
      setShopUsers(data.users || []);
    } catch (error) {
      handleError(error);
    }
  };

  const updateShop = async (shop, body) => {
    setBusy(true);
    try {
      const data = await apiFetch(`/api/grand-admin/shops/${shop.id}`, { method: 'PATCH', body });
      const nextShop = data.shop;
      setShops((current) => current.map((item) => item.id === nextShop.id ? nextShop : item));
      setSelectedShop((current) => current?.id === nextShop.id ? nextShop : current);
      notify('success', 'Shop control updated');
      await load();
    } catch (error) {
      handleError(error);
    } finally {
      setBusy(false);
    }
  };

  const updateUser = async (user, body) => {
    setBusy(true);
    try {
      const data = await apiFetch(`/api/grand-admin/users/${user.id}`, { method: 'PATCH', body });
      setShopUsers((current) => current.map((item) => item.id === user.id ? data.user : item));
      notify('success', 'User updated');
    } catch (error) {
      handleError(error);
    } finally {
      setBusy(false);
    }
  };

  const resetPassword = async () => {
    if (!passwordReset.user || !passwordReset.password) return;
    setBusy(true);
    try {
      await apiFetch(`/api/grand-admin/users/${passwordReset.user.id}/password`, {
        method: 'PATCH',
        body: { password: passwordReset.password, mustChange: true },
      });
      notify('success', 'Password reset completed');
      setPasswordReset({ user: null, password: '' });
    } catch (error) {
      handleError(error);
    } finally {
      setBusy(false);
    }
  };

  if (!isGrandAdmin) {
    return (
      <section className="grand-admin-denied">
        <LockKeyhole size={42} />
        <h2>Grand Super Admin Only</h2>
        <p>ဒီ Portal သည် Platform ပိုင်ရှင်အတွက်သာ ဖြစ်ပါတယ်။ Tenant shop user မဝင်နိုင်ပါ။</p>
      </section>
    );
  }

  return (
    <div className="grand-admin-page">
      {message ? <div className={`grand-toast ${message.type}`}>{message.text}</div> : null}

      <section className="grand-heading">
        <div>
          <span>PLATFORM CENTRALIZED CONTROL</span>
          <h2>Grand Super Admin Portal</h2>
          <p>ဆိုင်အားလုံး၊ Tenant ID၊ Subscription၊ Feature Permission၊ User Suspend နှင့် System Health ကို တစ်နေရာထဲက စီမံနိုင်ပါတယ်။</p>
        </div>
        <button type="button" onClick={load} disabled={busy}>
          {busy ? <Loader2 className="grand-spin" size={17} /> : <RefreshCw size={17} />}
          Refresh
        </button>
      </section>

      <section className="grand-metrics">
        <article><Building2 /><span>Total Shops</span><b>{overview?.metrics?.shopCount || 0}</b></article>
        <article><CheckCircle2 /><span>Active Shops</span><b>{overview?.metrics?.activeShopCount || 0}</b></article>
        <article><XCircle /><span>Suspended Shops</span><b>{overview?.metrics?.suspendedShopCount || 0}</b></article>
        <article><Users /><span>All Users</span><b>{overview?.metrics?.userCount || 0}</b></article>
        <article><Database /><span>Products</span><b>{overview?.metrics?.productCount || 0}</b></article>
      </section>

      <section className="grand-health">
        <div><Activity size={19} /><b>API Health Dashboard</b><span>Third-party status included</span></div>
        <HealthPill label="API" item={overview?.health?.api} />
        <HealthPill label="Database" item={overview?.health?.database} />
        <HealthPill label="SMS Gateway" item={overview?.health?.thirdParty?.smsGateway} />
        <HealthPill label="Payment Gateway" item={overview?.health?.thirdParty?.paymentGateway} />
        <HealthPill label="Mail Server" item={overview?.health?.thirdParty?.mailServer} />
      </section>

      <section className="grand-card">
        <div className="grand-toolbar">
          <label><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && load()} placeholder="Shop name / Tenant ID / phone ရှာရန်" /></label>
          <button type="button" onClick={load}>Search</button>
        </div>

        <div className="grand-table-wrap">
          <table className="grand-table">
            <thead>
              <tr>
                <th>Shop / Tenant</th>
                <th>Business</th>
                <th>Subscription</th>
                <th>Metrics</th>
                <th>Portal</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredShops.map((shop) => (
                <tr key={shop.id}>
                  <td><b>{shop.name}</b><span>{shop.tenantId} · {shop.slug}</span></td>
                  <td>{shop.businessType}</td>
                  <td><i className={statusTone(shop.subscription?.status)}>{shop.subscription?.status || '-'}</i><span>{shop.subscription?.endsAt ? `Ends ${dateText(shop.subscription.endsAt)}` : '-'}</span></td>
                  <td><span>{shop.metrics.users} users · {shop.metrics.products} products</span><span>{shop.metrics.sales} sales</span></td>
                  <td><i className={shop.adminPortalEnabled ? 'green' : 'red'}>{shop.adminPortalEnabled ? 'Enabled' : 'Disabled'}</i></td>
                  <td><i className={shop.active ? 'green' : 'red'}>{shop.active ? 'Active' : 'Suspended'}</i></td>
                  <td>
                    <button type="button" onClick={() => openShop(shop)}>Control</button>
                  </td>
                </tr>
              ))}
              {!filteredShops.length ? <tr><td colSpan="7" className="grand-empty">No shops found</td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>

      {selectedShop ? (
        <section className="grand-control-grid">
          <div className="grand-card">
            <div className="grand-section-title">
              <b>{selectedShop.name}</b>
              <span>{selectedShop.tenantId} · {selectedShop.businessType}</span>
            </div>

            <div className="grand-switch-list">
              <button type="button" onClick={() => updateShop(selectedShop, { active: !selectedShop.active })}>
                {selectedShop.active ? 'Shop Suspend' : 'Shop Safe Active'}
              </button>
              <button type="button" onClick={() => updateShop(selectedShop, { adminPortalEnabled: !selectedShop.adminPortalEnabled })}>
                {selectedShop.adminPortalEnabled ? 'Admin Portal ပိတ်မယ်' : 'Admin Portal ဖွင့်မယ်'}
              </button>
              <button type="button" onClick={() => updateShop(selectedShop, { subscription: { status: 'ACTIVE', extendDays: 30, notes: 'Renewed by Grand Super Admin' } })}>
                Plan 30 days Renew
              </button>
              <button type="button" onClick={() => updateShop(selectedShop, { subscription: { status: 'SUSPENDED', notes: 'Suspended by Grand Super Admin' } })}>
                Subscription Suspend
              </button>
            </div>

            <div className="grand-feature-grid">
              {FEATURE_KEYS.map(([key, label]) => {
                const current = selectedShop.featurePermissions || {};
                const enabled = current[key] !== false;
                return (
                  <label key={key}>
                    <input
                      type="checkbox"
                      checked={enabled}
                      onChange={(event) => updateShop(selectedShop, {
                        featurePermissions: { ...current, [key]: event.target.checked },
                      })}
                    />
                    <span>{label}</span>
                  </label>
                );
              })}
            </div>
          </div>

          <div className="grand-card">
            <div className="grand-section-title">
              <b>Shop Users</b>
              <span>Grand Admin can suspend, safe active, reset password</span>
            </div>
            <div className="grand-user-list">
              {shopUsers.map((user) => (
                <article key={user.id}>
                  <div>
                    <b>{user.name}</b>
                    <span>{user.username} · {user.role} · {user.authProvider || 'password'}</span>
                    <small>{user.lastLoginAt ? `Last login ${dateText(user.lastLoginAt)}` : 'No login yet'}</small>
                  </div>
                  <button type="button" onClick={() => updateUser(user, { active: !user.active })}>{user.active ? 'Suspend' : 'Safe Active'}</button>
                  <button type="button" onClick={() => setPasswordReset({ user, password: '' })}><KeyRound size={14} /> Reset</button>
                </article>
              ))}
              {!shopUsers.length ? <div className="grand-empty">No users</div> : null}
            </div>
          </div>
        </section>
      ) : null}

      <section className="grand-card">
        <div className="grand-section-title">
          <b>Global Audit Log</b>
          <span>System-wide user activity</span>
        </div>
        <div className="grand-audit-list">
          {auditRows.map((row) => (
            <article key={row.id}>
              <b>{row.action}</b>
              <span>{row.shop?.name || 'Platform'} · {row.user?.name || row.user?.username || '-'}</span>
              <small>{dateText(row.createdAt)}</small>
            </article>
          ))}
        </div>
      </section>

      {passwordReset.user ? (
        <div className="grand-modal-backdrop">
          <section className="grand-modal">
            <header>
              <div><b>Password Reset</b><span>{passwordReset.user.name} · {passwordReset.user.username}</span></div>
              <button type="button" onClick={() => setPasswordReset({ user: null, password: '' })}>×</button>
            </header>
            <label>
              <span>New Temporary Password</span>
              <input value={passwordReset.password} onChange={(event) => setPasswordReset({ ...passwordReset, password: event.target.value })} placeholder="At least 8 characters" />
            </label>
            <footer>
              <button type="button" onClick={() => setPasswordReset({ user: null, password: '' })}>Cancel</button>
              <button type="button" className="primary" onClick={resetPassword} disabled={passwordReset.password.length < 8}>Reset Password</button>
            </footer>
          </section>
        </div>
      ) : null}
    </div>
  );
}
