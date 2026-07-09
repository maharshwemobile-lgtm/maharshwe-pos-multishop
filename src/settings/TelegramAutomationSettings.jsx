import React, { useEffect, useRef, useState } from 'react';
import { BellRing, CheckCircle2, Loader2, Save, Send, ShieldCheck, UserRound } from 'lucide-react';
import { apiFetch } from '../phase2Api';

const EMPTY = {
  enabled: false,
  saleNotifications: false,
  dailyReportEnabled: false,
  dailyReportTime: '21:00',
};

export default function TelegramAutomationSettings() {
  const [form, setForm] = useState(EMPTY);
  const [meta, setMeta] = useState({});
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const widgetRef = useRef(null);

  const update = (patch) => setForm((current) => ({ ...current, ...patch }));

  const load = async () => {
    setBusy('load');
    try {
      const response = await apiFetch('/api/project-settings/api/telegram');
      const telegram = response.telegram || {};
      setMeta(telegram);
      setForm({
        enabled: Boolean(telegram.enabled),
        saleNotifications: Boolean(telegram.saleNotifications),
        dailyReportEnabled: Boolean(telegram.dailyReportEnabled),
        dailyReportTime: telegram.dailyReportTime || '21:00',
      });
      setMessage(telegram.loginWidgetReady ? 'Telegram ချိတ်ရန် အသင့်ဖြစ်ပါပြီ။' : 'Telegram bot setup ကို admin/server ဖက်မှာ အရင်ချိတ်ထားရန်လိုပါတယ်။');
    } catch (error) {
      setMessage(error.message || 'Telegram settings load failed');
    } finally {
      setBusy('');
    }
  };

  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (!meta.loginWidgetReady || !meta.botUsername || !widgetRef.current) return undefined;
    widgetRef.current.innerHTML = '';
    const callbackName = `__maharTelegramConnect_${Date.now()}`;
    window[callbackName] = async (user) => {
      setBusy('telegram-login');
      try {
        const response = await apiFetch('/api/project-settings/api/telegram/connect-login', { method: 'POST', body: user });
        setMeta(response.telegram || {});
        setForm((current) => ({ ...current, enabled: true }));
        setMessage('ဒီ POS user ကို Telegram နဲ့ချိတ်ပြီးပါပြီ။');
      } catch (error) {
        setMessage(error.message || 'Telegram connect failed');
      } finally {
        setBusy('');
      }
    };

    const script = document.createElement('script');
    script.async = true;
    script.src = 'https://telegram.org/js/telegram-widget.js?22';
    script.setAttribute('data-telegram-login', meta.botUsername);
    script.setAttribute('data-size', 'medium');
    script.setAttribute('data-userpic', 'false');
    script.setAttribute('data-request-access', 'write');
    script.setAttribute('data-onauth', `${callbackName}(user)`);
    widgetRef.current.appendChild(script);

    return () => {
      delete window[callbackName];
      if (widgetRef.current) widgetRef.current.innerHTML = '';
    };
  }, [meta.loginWidgetReady, meta.botUsername]);

  const save = async () => {
    setBusy('save');
    try {
      const response = await apiFetch('/api/project-settings/api/telegram', {
        method: 'PUT',
        body: {
          enabled: form.enabled,
          saleNotifications: form.saleNotifications,
          dailyReportEnabled: form.dailyReportEnabled,
          dailyReportTime: form.dailyReportTime,
        },
      });
      setMeta(response.telegram || {});
      setMessage('Telegram settings သိမ်းပြီးပါပြီ။');
    } catch (error) {
      setMessage(error.message || 'Telegram settings save failed');
    } finally {
      setBusy('');
    }
  };

  const test = async () => {
    setBusy('test');
    try {
      const response = await apiFetch('/api/project-settings/api/telegram/test', { method: 'POST', body: {} });
      setMeta(response.telegram || {});
      setMessage(response.message || 'Test message ပို့ပြီးပါပြီ။');
    } catch (error) {
      setMessage(error.message || 'Telegram test failed');
    } finally {
      setBusy('');
    }
  };

  const sendDailyReport = async () => {
    setBusy('report');
    try {
      const response = await apiFetch('/api/project-settings/api/telegram/send-daily-report', { method: 'POST', body: {} });
      setMeta((current) => ({ ...current, lastReportDate: response.date, lastReportSentAt: new Date().toISOString() }));
      setMessage(response.message || 'Daily report ပို့ပြီးပါပြီ။');
    } catch (error) {
      setMessage(error.message || 'Daily report failed');
    } finally {
      setBusy('');
    }
  };

  const userConnected = Boolean(meta.currentUserTelegram);

  return (
    <section className="ps-panel telegram-simple-settings">
      <header className="ps-panel-head">
        <div>
          <BellRing size={21} />
          <span>
            <h3>Telegram Notification</h3>
            <p>Telegram ချိတ်ပြီး Sale notification နဲ့ Daily report ကို ပို့မယ်။</p>
          </span>
        </div>
        <button className="ps-icon-button" type="button" onClick={load} disabled={busy === 'load'} title="Reload">
          {busy === 'load' ? <Loader2 className="ps-spin" size={18} /> : <CheckCircle2 size={18} />}
        </button>
      </header>

      {message ? <div className="gs-message"><ShieldCheck size={16} /> {message}</div> : null}

      <div className="project-google-status">
        <div>
          <ShieldCheck size={20} />
          <span><small>System</small><b>{meta.loginWidgetReady ? 'Ready' : 'Need Admin Setup'}</b></span>
        </div>
        <div>
          <UserRound size={20} />
          <span><small>Telegram User</small><b>{userConnected ? 'Connected' : 'Not Connected'}</b></span>
        </div>
        <div>
          <BellRing size={20} />
          <span><small>Auto Send</small><b>{form.enabled ? 'ON' : 'OFF'}</b></span>
        </div>
      </div>

      <div className="ps-form">
        <div className="project-google-guide">
          <div><b>1</b><span><strong>Telegram Login</strong><small>ဒီ POS user ကို Telegram account နဲ့ချိတ်ပါ။</small></span></div>
          <div><b>2</b><span><strong>Sale ပို့မယ်</strong><small>Sale voucher ထွက်တိုင်း Telegram ကို auto ပို့ပါမယ်။</small></span></div>
          <div><b>3</b><span><strong>Daily Report</strong><small>နေ့ကုန်စာရင်းကို သတ်မှတ်ချိန်မှာ auto ပို့ပါမယ်။</small></span></div>
        </div>

        <div className="gs-code-card">
          <div><b>Login as Telegram</b></div>
          {userConnected ? (
            <p>ချိတ်ပြီးသား: Telegram ID {meta.currentUserTelegram.telegramId}{meta.currentUserTelegram.name ? ` · ${meta.currentUserTelegram.name}` : ''}</p>
          ) : (
            <p>အောက်က Telegram login button ကိုနှိပ်ပါ။ Chat ID ကို system က auto မှတ်ပါမယ်။</p>
          )}
          <div ref={widgetRef} />
          {!meta.loginWidgetReady ? <small>Bot setup ကို admin/server ဖက်မှာ ချိတ်ပြီးမှ Telegram login button ပေါ်ပါမယ်။</small> : null}
        </div>

        <div className="ps-grid-2">
          <label className="ps-switch-row">
            <span><b>Telegram ကိုဖွင့်မယ်</b><small>OFF ဖြစ်ရင် notification မပို့ပါ။</small></span>
            <input type="checkbox" checked={form.enabled} onChange={(event) => update({ enabled: event.target.checked })} />
          </label>

          <label className="ps-switch-row">
            <span><b>Sale တစ်ခါထွက်တိုင်း ပို့မယ်</b><small>Voucher confirm ပြီးတာနဲ့ ပို့ပါမယ်။</small></span>
            <input type="checkbox" checked={form.saleNotifications} onChange={(event) => update({ saleNotifications: event.target.checked })} />
          </label>

          <label className="ps-switch-row">
            <span><b>Daily Report ပို့မယ်</b><small>နေ့တိုင်း သတ်မှတ်ချိန်မှာ ပို့ပါမယ်။</small></span>
            <input type="checkbox" checked={form.dailyReportEnabled} onChange={(event) => update({ dailyReportEnabled: event.target.checked })} />
          </label>

          <label className="ps-field">
            <span>Daily Report Time</span>
            <input type="time" value={form.dailyReportTime} onChange={(event) => update({ dailyReportTime: event.target.value })} />
          </label>
        </div>
      </div>

      <div className="ps-actions">
        <button className="ps-primary" type="button" onClick={save} disabled={busy === 'save'}>
          {busy === 'save' ? <Loader2 className="ps-spin" size={18} /> : <Save size={18} />} Save
        </button>
        <button type="button" onClick={test} disabled={busy === 'test' || !meta.loginWidgetReady}>
          {busy === 'test' ? <Loader2 className="ps-spin" size={18} /> : <Send size={18} />} Test ပို့မယ်
        </button>
        <button type="button" onClick={sendDailyReport} disabled={busy === 'report' || !meta.loginWidgetReady}>
          {busy === 'report' ? <Loader2 className="ps-spin" size={18} /> : <BellRing size={18} />} Daily Report စမ်းပို့မယ်
        </button>
      </div>
    </section>
  );
}
