import React, { useState } from 'react';
import { Check, Copy, Eye, EyeOff, KeyRound, Loader2, LockKeyhole, ShieldAlert, Sparkles } from 'lucide-react';
import { apiFetch, getSession } from '../phase2Api';
import './user-password-reset-v22.css';

const EMPTY = { password: '', confirmPassword: '', reason: '', show: false };

function randomIndex(max) {
  if (window.crypto?.getRandomValues) {
    const value = new Uint32Array(1);
    window.crypto.getRandomValues(value);
    return value[0] % max;
  }
  return Math.floor(Math.random() * max);
}

function generateTemporaryPassword(length = 12) {
  const groups = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnopqrstuvwxyz', '23456789', '@#$%'];
  const all = groups.join('');
  const chars = groups.map((group) => group[randomIndex(group.length)]);
  while (chars.length < length) chars.push(all[randomIndex(all.length)]);
  for (let index = chars.length - 1; index > 0; index -= 1) {
    const swapIndex = randomIndex(index + 1);
    [chars[index], chars[swapIndex]] = [chars[swapIndex], chars[index]];
  }
  return chars.join('');
}

async function copyText(value) {
  if (!value) return false;
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    const input = document.createElement('textarea');
    input.value = value;
    input.style.position = 'fixed';
    input.style.opacity = '0';
    document.body.appendChild(input);
    input.select();
    const copied = document.execCommand('copy');
    input.remove();
    return copied;
  }
}

export default function AdminPasswordResetPanel({ user, notify, onReset }) {
  const role = getSession()?.user?.role || '';
  const canReset = role === 'SUPER_ADMIN' || role === 'SHOP_ADMIN';
  const [form, setForm] = useState(EMPTY);
  const [resetting, setResetting] = useState(false);
  const [copying, setCopying] = useState(false);
  const [lastReset, setLastReset] = useState(null);

  if (!user) return null;

  const generate = () => {
    const password = generateTemporaryPassword();
    setForm({ ...form, password, confirmPassword: password, show: true });
    setLastReset(null);
  };

  const copy = async (value = form.password) => {
    if (!value) return;
    setCopying(true);
    const copied = await copyText(value);
    notify(copied ? 'success' : 'error', copied ? 'Temporary password copied' : 'Password copy failed');
    setCopying(false);
  };

  const submit = async (event) => {
    event.preventDefault();
    if (!canReset) return;
    if (form.password.length < 6) return notify('error', 'Password must contain at least 6 characters');
    if (form.password !== form.confirmPassword) return notify('error', 'New password and confirm password do not match');
    if (!window.confirm(`Reset password for ${user.name} (@${user.username})?`)) return;

    setResetting(true);
    try {
      await apiFetch(`/api/users/live/${user.id}/reset-password`, {
        method: 'POST',
        body: { password: form.password, reason: form.reason || undefined },
      });
      setLastReset({ username: user.username, password: form.password });
      setForm(EMPTY);
      notify('success', `Password reset completed for @${user.username}`);
      await onReset?.();
    } catch (error) {
      notify('error', error.message || 'Password reset failed');
    } finally {
      setResetting(false);
    }
  };

  if (!canReset) {
    return <div className="ps-password-denied"><LockKeyhole size={19}/><span><b>Password Reset is Admin only</b><small>Shop Admin သို့မဟုတ် Super Admin account ဖြင့်သာ reset လုပ်နိုင်ပါသည်။</small></span></div>;
  }

  return <>
    <form className="ps-password-reset-card" onSubmit={submit}>
      <header><div><LockKeyhole size={21}/><span><b>Admin Password Reset</b><small>{user.name} · @{user.username}</small></span></div><em>ADMIN ONLY</em></header>
      <p>User မေ့သွားသော Password ကို Admin က Temporary Password အသစ်သတ်မှတ်ပေးနိုင်ပါသည်။ Password ကို Audit Log ထဲမသိမ်းပါ။</p>
      <div className="ps-password-grid">
        <label><span>New Password</span><div className="ps-password-input"><input type={form.show ? 'text' : 'password'} minLength="6" value={form.password} onChange={(event) => setForm({...form,password:event.target.value})} autoComplete="new-password" placeholder="At least 6 characters"/><button type="button" onClick={() => setForm({...form,show:!form.show})}>{form.show ? <EyeOff size={17}/> : <Eye size={17}/>}</button></div></label>
        <label><span>Confirm Password</span><input type={form.show ? 'text' : 'password'} minLength="6" value={form.confirmPassword} onChange={(event) => setForm({...form,confirmPassword:event.target.value})} autoComplete="new-password" placeholder="Enter the same password"/></label>
        <label className="ps-password-reason"><span>Reason / Note (Optional)</span><input value={form.reason} maxLength="300" onChange={(event) => setForm({...form,reason:event.target.value})} placeholder="Forgot password / staff request"/></label>
      </div>
      <div className="ps-password-actions">
        <button type="button" onClick={generate}><Sparkles size={17}/> Generate Temporary</button>
        <button type="button" onClick={() => copy()} disabled={!form.password || copying}><Copy size={17}/> {copying ? 'Copying...' : 'Copy'}</button>
        <button className="danger" type="submit" disabled={resetting || !form.password || !form.confirmPassword}>{resetting ? <Loader2 className="ps-spin" size={17}/> : <KeyRound size={17}/>} Reset Password</button>
      </div>
      <div className="ps-password-warning"><ShieldAlert size={18}/><span>Reset ပြီးနောက် User ကို Temporary Password ပေးပြီး Login ပြန်ဝင်ခိုင်းပါ။</span></div>
    </form>

    {lastReset ? <div className="ps-password-success"><Check size={20}/><span><b>@{lastReset.username} password reset completed</b><small>Temporary Password ကို User ထံပေးပါ။</small><code>{lastReset.password}</code></span><button type="button" onClick={() => copy(lastReset.password)}><Copy size={17}/> Copy Password</button></div> : null}
  </>;
}
