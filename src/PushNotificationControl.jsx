import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Bell, BellOff, BellRing, Loader2 } from 'lucide-react';
import { apiFetch } from './phase2Api';
import {
  getPushSupportStatus,
  requestAndRegisterPushToken,
  subscribeForegroundMessages,
} from './firebasePushClient';
import './push-notifications.css';

function statusLabel(clientStatus, serverStatus) {
  if (!clientStatus?.supported) {
    if (clientStatus?.reason === 'secure_context_required') return 'HTTPS required';
    return 'Not supported';
  }
  if (clientStatus.permission === 'denied') return 'Denied';
  if (clientStatus.permission === 'granted' && serverStatus?.activeTokens > 0) return 'Enabled';
  if (clientStatus.permission === 'granted') return 'Allowed';
  return 'Enable';
}

function statusClass(clientStatus, serverStatus) {
  if (!clientStatus?.supported || clientStatus.permission === 'denied') return 'off';
  if (clientStatus.permission === 'granted' && serverStatus?.activeTokens > 0) return 'on';
  return 'idle';
}

function formatTime(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return '';
  return date.toLocaleString();
}

export default function PushNotificationControl() {
  const rootRef = useRef(null);
  const [clientStatus, setClientStatus] = useState(null);
  const [serverStatus, setServerStatus] = useState(null);
  const [notifications, setNotifications] = useState([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [toast, setToast] = useState(null);

  const badgeCount = serverStatus?.unreadCount || 0;
  const label = statusLabel(clientStatus, serverStatus);
  const tone = statusClass(clientStatus, serverStatus);

  const Icon = useMemo(() => {
    if (busy) return Loader2;
    if (!clientStatus?.supported || clientStatus.permission === 'denied') return BellOff;
    if (clientStatus.permission === 'granted' && serverStatus?.activeTokens > 0) return BellRing;
    return Bell;
  }, [busy, clientStatus, serverStatus]);

  const refresh = async () => {
    const status = await getPushSupportStatus();
    setClientStatus(status);
    try {
      const [push, list] = await Promise.all([
        apiFetch('/api/push/status'),
        apiFetch('/api/notifications?limit=6'),
      ]);
      setServerStatus(push);
      setNotifications(list.notifications || []);
    } catch (error) {
      setNotice(error.message || 'Notification status unavailable');
    }
  };

  useEffect(() => {
    refresh().catch((error) => setNotice(error.message || 'Notification status unavailable'));
  }, []);

  useEffect(() => subscribeForegroundMessages((message) => {
    setToast(message);
    refresh().catch(() => {});
    window.setTimeout(() => setToast(null), 6500);
  }), []);

  useEffect(() => {
    if (!open) return undefined;
    const closeIfOutside = (event) => {
      const root = rootRef.current;
      if (!root || root.contains(event.target)) return;
      setOpen(false);
    };
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', closeIfOutside, true);
    document.addEventListener('focusin', closeIfOutside, true);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeIfOutside, true);
      document.removeEventListener('focusin', closeIfOutside, true);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  const enable = async () => {
    setBusy(true);
    setNotice('');
    try {
      const result = await requestAndRegisterPushToken();
      if (result.ok) setNotice('Push notifications enabled for this shop/device.');
      else if (result.permission === 'denied') setNotice('Browser permission is denied. Enable it in browser site settings.');
      else setNotice(result.reason || 'Push notifications are not available on this browser.');
      await refresh();
    } catch (error) {
      const message = error?.message || '';
      setNotice(/ServiceWorker|firebase-messaging-sw/i.test(message)
        ? 'Notification worker was updated. Please refresh once, then enable announcement alert again.'
        : message || 'Push notification enable failed');
    } finally {
      setBusy(false);
    }
  };

  return <div className="push-notification-control" ref={rootRef}>
    <button
      type="button"
      className={`icon notice push-notification-trigger ${tone}`}
      onClick={() => setOpen((value) => !value)}
      title={`Push notification: ${label}`}
    >
      <Icon size={22} className={busy ? 'push-spin' : ''}/>
      {badgeCount > 0 ? <em>{Math.min(99, badgeCount)}</em> : null}
    </button>

    {open ? <section className="push-notification-menu">
      <header>
        <span>
          <b>Admin Announcements</b>
          <small>Admin announcement only</small>
        </span>
      </header>

      <div className="push-actions">
        <button type="button" onClick={enable} disabled={busy || clientStatus?.permission === 'denied'}>
          <BellRing size={15}/> {clientStatus?.permission === 'granted' ? 'Announcement alert enabled' : 'Enable announcement alert'}
        </button>
      </div>

      {notice ? <p className="push-notice">{notice}</p> : null}

      <div className="push-list">
        {notifications.length ? notifications.map((item) => <article key={item.id} className={item.isRead ? '' : 'unread'}>
          <b>{item.title}</b>
          <span>{item.body}</span>
          <time>{formatTime(item.createdAt)}</time>
        </article>) : <p>No admin announcement yet.</p>}
      </div>
    </section> : null}

    {toast ? <aside className="push-toast">
      <b>{toast.title}</b>
      <span>{toast.body}</span>
    </aside> : null}
  </div>;
}
