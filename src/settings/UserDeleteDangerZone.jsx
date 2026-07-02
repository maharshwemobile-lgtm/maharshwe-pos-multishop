import React, { useMemo, useState } from 'react';
import { AlertTriangle, Loader2, Trash2 } from 'lucide-react';
import { apiFetch, getSession } from '../phase2Api';
import './user-password-reset-v22.css';

export default function UserDeleteDangerZone({ user, notify, onDeleted }) {
  const role = getSession()?.user?.role || '';
  const canDelete = role === 'SUPER_ADMIN' || role === 'SHOP_ADMIN';
  const [confirmation, setConfirmation] = useState('');
  const [deleting, setDeleting] = useState(false);

  const matched = useMemo(() => {
    const value = confirmation.trim().replace(/^@/, '').toLowerCase();
    return value && value === String(user?.username || '').toLowerCase();
  }, [confirmation, user?.username]);

  if (!user || !canDelete) return null;

  const remove = async () => {
    if (!matched || deleting) return;
    const approved = window.confirm(`Permanently delete ${user.name} (@${user.username})? This cannot be undone.`);
    if (!approved) return;

    setDeleting(true);
    try {
      await apiFetch(`/api/users/live/${user.id}/permanent`, {
        method: 'DELETE',
        body: { confirmation },
      });
      notify('success', `User @${user.username} permanently deleted`);
      await onDeleted?.();
    } catch (error) {
      notify('error', error.message || 'User delete failed');
    } finally {
      setDeleting(false);
    }
  };

  return <section className="ps-user-danger-zone">
    <header><div><AlertTriangle size={20}/><span><b>Danger Zone</b><small>User account ကို database မှ အပြီးဖျက်ရန်</small></span></div><em>PERMANENT</em></header>
    <p>Sale History ချိတ်ထားသော User ကို အပြီးဖျက်၍မရပါ။ အဲဒီ User ကို <b>User Active</b> ပိတ်ပြီး Deactivate လုပ်ပါ။ Record မရှိသော User ကိုသာ အပြီးဖျက်နိုင်ပါသည်။</p>
    <label><span>Confirm Username</span><input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} placeholder={`Type ${user.username}`}/></label>
    <button type="button" onClick={remove} disabled={!matched || deleting}>{deleting ? <Loader2 className="ps-spin" size={17}/> : <Trash2 size={17}/>} Delete User Permanently</button>
  </section>;
}
