import React, { useEffect, useMemo, useState } from 'react';
import {
  Building2,
  CheckCircle2,
  KeyRound,
  Loader2,
  MapPin,
  RefreshCw,
  Save,
  ShieldCheck,
  UserCog,
  Users,
  X,
} from 'lucide-react';
import { apiFetch, clearSession, getSession } from './phase2Api';
import './shop-admin-branch-control.css';

const PERMISSION_KEYS = [
  ['sale', 'Sale POS'],
  ['history', 'Sales History'],
  ['inventory', 'Inventory / Stock'],
  ['productEdit', 'Product Edit'],
  ['purchaseApprove', 'Purchases'],
  ['accounting', 'Accounting'],
  ['reports', 'Reports'],
  ['settings', 'Settings'],
  ['discount', 'Discount'],
  ['viewCost', 'View Cost'],
];

const emptyBranch = { code: '', name: '', phone: '', address: '', managerName: '', active: true };

function dateText(value) {
  if (!value) return '-';
  try {
    return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
  } catch {
    return String(value);
  }
}

export default function ShopAdminBranchControl() {
  const session = getSession();
  const [branches, setBranches] = useState([]);
  const [users, setUsers] = useState([]);
  const [metrics, setMetrics] = useState({});
  const [auditLogs, setAuditLogs] = useState([]);
  const [branchDraft, setBranchDraft] = useState(emptyBranch);
  const [editingBranch, setEditingBranch] = useState(null);
  const [passwordReset, setPasswordReset] = useState({ user: null, password: '' });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);

  const canUse = Boolean(session?.user?.shopId) && (session?.user?.role === 'SHOP_ADMIN' || session?.user?.permissions?.settings === true);

  const branchMap = useMemo(() => new Map(branches.map((branch) => [branch.id, branch])), [branches]);

  const notify = (type, text) => {
    setMessage({ type, text });
    window.clearTimeout(notify.timer);
    notify.timer = window.setTimeout(() => setMessage(null), 3400);
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
      const data = await apiFetch('/api/shop-admin/branches/overview');
      setBranches(data.branches || []);
      setUsers(data.users || []);
      setMetrics(data.metrics || {});
      setAuditLogs(data.auditLogs || []);
    } catch (error) {
      handleError(error);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => { if (canUse) load(); }, [canUse]);

  const saveBranch = async () => {
    if (!branchDraft.name.trim()) {
      notify('error', 'Branch name ထည့်ပါ။');
      return;
    }
    setBusy(true);
    try {
      const path = editingBranch ? `/api/shop-admin/branches/${editingBranch.id}` : '/api/shop-admin/branches';
      const method = editingBranch ? 'PATCH' : 'POST';
      await apiFetch(path, { method, body: branchDraft });
      notify('success', editingBranch ? 'Branch updated' : 'Branch created');
      setBranchDraft(emptyBranch);
      setEditingBranch(null);
      await load();
    } catch (error) {
      handleError(error);
    } finally {
      setBusy(false);
    }
  };

  const editBranch = (branch) => {
    setEditingBranch(branch);
    setBranchDraft({
      code: branch.code || '',
      name: branch.name || '',
      phone: branch.phone || '',
      address: branch.address || '',
      managerName: branch.managerName || '',
      active: branch.active !== false,
    });
  };

  const updateBranch = async (branch, body) => {
    setBusy(true);
    try {
      await apiFetch(`/api/shop-admin/branches/${branch.id}`, { method: 'PATCH', body });
      notify('success', 'Branch updated');
      await load();
    } catch (error) {
      handleError(error);
    } finally {
      setBusy(false);
    }
  };

  const updateStaff = async (user, body) => {
    setBusy(true);
    try {
      const data = await apiFetch(`/api/shop-admin/staff/${user.id}`, { method: 'PATCH', body });
      setUsers((current) => current.map((item) => item.id === user.id ? data.user : item));
      notify('success', 'Staff updated');
    } catch (error) {
      handleError(error);
    } finally {
      setBusy(false);
    }
  };

  const togglePermission = (user, key, checked) => {
    updateStaff(user, { permissions: { ...(user.permissions || {}), [key]: checked } });
  };

  const resetPassword = async () => {
    if (!passwordReset.user || passwordReset.password.length < 8) return;
    setBusy(true);
    try {
      await apiFetch(`/api/shop-admin/staff/${passwordReset.user.id}/password`, {
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

  if (!canUse) {
    return (
      <section className="branch-denied">
        <ShieldCheck size={42} />
        <h2>Shop Admin Only</h2>
        <p>ဒီ page သည် မိမိဆိုင်အောက် Branch နှင့် Staff စီမံရန် Shop Admin အတွက်သာ ဖြစ်ပါတယ်။</p>
      </section>
    );
  }

  return (
    <div className="branch-page">
      {message ? <div className={`branch-toast ${message.type}`}>{message.text}</div> : null}

      <section className="branch-heading">
        <div>
          <span>SHOP ADMIN CONTROL</span>
          <h2>Branch & Staff Management</h2>
          <p>Admin သည် မိမိ shopId အောက်က Branch နှင့် Staff များကိုသာ စီမံနိုင်ပါတယ်။ Grand Admin / အခြားဆိုင် data မပါဝင်ပါ။</p>
        </div>
        <button type="button" onClick={load} disabled={busy}>
          {busy ? <Loader2 className="branch-spin" size={17} /> : <RefreshCw size={17} />}
          Refresh
        </button>
      </section>

      <section className="branch-metrics">
        <article><Building2 /><span>Branches</span><b>{branches.length}</b><small>{metrics.activeBranches || 0} active</small></article>
        <article><Users /><span>Staff</span><b>{metrics.staff || 0}</b><small>Shop users</small></article>
        <article><CheckCircle2 /><span>Products</span><b>{metrics.products || 0}</b><small>{metrics.variants || 0} variants</small></article>
        <article><MapPin /><span>Stock Units</span><b>{metrics.stockUnits || 0}</b><small>All branches</small></article>
      </section>

      <section className="branch-grid">
        <div className="branch-card">
          <div className="branch-section-title">
            <b>{editingBranch ? 'Edit Branch' : 'Create Branch'}</b>
            <span>Branch data is scoped under this shop only</span>
          </div>
          <div className="branch-form">
            <label><span>Code</span><input value={branchDraft.code} onChange={(event) => setBranchDraft({ ...branchDraft, code: event.target.value })} placeholder="BR-1" /></label>
            <label><span>Branch Name</span><input value={branchDraft.name} onChange={(event) => setBranchDraft({ ...branchDraft, name: event.target.value })} placeholder="Main Outlet" /></label>
            <label><span>Phone</span><input value={branchDraft.phone} onChange={(event) => setBranchDraft({ ...branchDraft, phone: event.target.value })} placeholder="09..." /></label>
            <label><span>Manager</span><input value={branchDraft.managerName} onChange={(event) => setBranchDraft({ ...branchDraft, managerName: event.target.value })} placeholder="Manager name" /></label>
            <label className="wide"><span>Address</span><input value={branchDraft.address} onChange={(event) => setBranchDraft({ ...branchDraft, address: event.target.value })} placeholder="Location / address" /></label>
            <label className="check"><input type="checkbox" checked={branchDraft.active} onChange={(event) => setBranchDraft({ ...branchDraft, active: event.target.checked })} /><span>Active Branch</span></label>
          </div>
          <footer>
            {editingBranch ? <button type="button" onClick={() => { setEditingBranch(null); setBranchDraft(emptyBranch); }}>Cancel</button> : null}
            <button type="button" className="primary" onClick={saveBranch} disabled={busy}><Save size={15} /> Save Branch</button>
          </footer>
        </div>

        <div className="branch-card">
          <div className="branch-section-title">
            <b>Branches</b>
            <span>Create, edit, suspend / safe active</span>
          </div>
          <div className="branch-list">
            {branches.map((branch) => (
              <article key={branch.id}>
                <div>
                  <b>{branch.name}</b>
                  <span>{branch.code || '-'} · {branch.managerName || 'No manager'}</span>
                  <small>{branch.address || '-'}</small>
                </div>
                <button type="button" onClick={() => editBranch(branch)}>Edit</button>
                <button type="button" className={branch.active ? 'danger' : 'success'} onClick={() => updateBranch(branch, { active: !branch.active })}>
                  {branch.active ? 'Suspend' : 'Safe Active'}
                </button>
              </article>
            ))}
            {!branches.length ? <div className="branch-empty">Branch မရှိသေးပါ။</div> : null}
          </div>
        </div>
      </section>

      <section className="branch-card">
        <div className="branch-section-title">
          <b>Staff Role & Permission</b>
          <span>Staff တစ်ယောက်ချင်း Branch assign, Suspend, Permission control လုပ်နိုင်ပါတယ်။</span>
        </div>
        <div className="branch-staff-list">
          {users.map((user) => (
            <article key={user.id}>
              <div className="staff-main">
                <b>{user.name}</b>
                <span>{user.username} · {user.role} · {user.active ? 'Active' : 'Suspended'}</span>
                <small>{user.lastLoginAt ? `Last login ${dateText(user.lastLoginAt)}` : 'No login yet'}</small>
              </div>

              <label>
                <span>Branch</span>
                <select value={user.branchId || ''} onChange={(event) => updateStaff(user, { branchId: event.target.value })}>
                  <option value="">All / Main Shop</option>
                  {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
                </select>
                <small>{user.branchId ? branchMap.get(user.branchId)?.code || '' : 'No branch limit'}</small>
              </label>

              <label>
                <span>Staff Title</span>
                <select value={user.staffTitle || ''} onChange={(event) => updateStaff(user, { staffTitle: event.target.value })}>
                  <option value="Admin">Admin</option>
                  <option value="Manager">Manager</option>
                  <option value="Cashier">Cashier</option>
                  <option value="Staff">Staff</option>
                </select>
              </label>

              <label>
                <span>Role</span>
                <select value={user.role} onChange={(event) => updateStaff(user, { role: event.target.value })}>
                  <option value="SHOP_ADMIN">SHOP_ADMIN</option>
                  <option value="CASHIER">CASHIER</option>
                </select>
              </label>

              <div className="staff-actions">
                <button type="button" className={user.active ? 'danger' : 'success'} onClick={() => updateStaff(user, { active: !user.active })}>{user.active ? 'Suspend' : 'Safe Active'}</button>
                <button type="button" onClick={() => setPasswordReset({ user, password: '' })}><KeyRound size={14} /> Reset</button>
              </div>

              <div className="staff-permissions">
                {PERMISSION_KEYS.map(([key, label]) => (
                  <label key={key}>
                    <input type="checkbox" checked={user.permissions?.[key] === true} onChange={(event) => togglePermission(user, key, event.target.checked)} />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
            </article>
          ))}
          {!users.length ? <div className="branch-empty">Staff မရှိသေးပါ။</div> : null}
        </div>
      </section>

      <section className="branch-card">
        <div className="branch-section-title">
          <b>Shop Activity Log</b>
          <span>Branch / Staff changes under this shop</span>
        </div>
        <div className="branch-audit-list">
          {auditLogs.map((row) => (
            <article key={row.id}>
              <b>{row.action}</b>
              <span>{row.user?.name || row.user?.username || '-'} · {row.entityType || '-'}</span>
              <small>{dateText(row.createdAt)}</small>
            </article>
          ))}
        </div>
      </section>

      {passwordReset.user ? (
        <div className="branch-modal-backdrop">
          <section className="branch-modal">
            <header>
              <div><b>Password Reset</b><span>{passwordReset.user.name} · {passwordReset.user.username}</span></div>
              <button type="button" onClick={() => setPasswordReset({ user: null, password: '' })}><X size={18} /></button>
            </header>
            <label>
              <span>Temporary Password</span>
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
