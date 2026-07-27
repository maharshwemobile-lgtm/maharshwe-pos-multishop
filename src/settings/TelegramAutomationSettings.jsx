import React, { useEffect, useRef, useState } from 'react';
import { BellRing, CheckCircle2, Link2, Link2Off, Loader2, Save, Send, ShieldCheck, UserRound } from 'lucide-react';
import { apiFetch } from '../phase2Api';

const EMPTY = {
  enabled: false,
  saleNotifications: false,
  auditLogNotifications: false,
  dailyReportEnabled: false,
  dailyReportTime: '21:00',
};

export default function TelegramAutomationSettings() {
  const [form, setForm] = useState(EMPTY);
  const [meta, setMeta] = useState({});
  const [botTokenInput, setBotTokenInput] = useState('');
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
        auditLogNotifications: Boolean(telegram.auditLogNotifications),
        dailyReportEnabled: Boolean(telegram.dailyReportEnabled),
        dailyReportTime: telegram.dailyReportTime || '21:00',
      });
    } catch (error) {
      setMessage(error.message || 'Telegram settings load failed');
    } finally {
      setBusy('');
    }
  };

  useEffect(() => { load(); }, []);

  // Telegram Login Widget (alternative linking method)
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
        setMessage('Telegram account နဲ့ ချိတ်ပြီးပါပြီ။ Notifications ပို့ပါမည်။');
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

  const saveBotToken = async () => {
    if (!botTokenInput.trim()) return;
    setBusy('token');
    try {
      const response = await apiFetch('/api/project-settings/api/telegram', {
        method: 'PUT',
        body: { botToken: botTokenInput.trim(), enabled: true },
      });
      setMeta(response.telegram || {});
      setBotTokenInput('');
      setForm((current) => ({ ...current, enabled: true }));
      const tg = response.telegram || {};
      setMessage(tg.webhookRegistered
        ? `Bot "@${tg.botUsername}" ready! အောက်က link ကို နှိပ်ပြီး /start ပို့ပါ။`
        : 'Bot Token သိမ်းပြီးပါပြီ။');
    } catch (error) {
      setMessage(error.message || 'Bot token save failed');
    } finally {
      setBusy('');
    }
  };

  const save = async () => {
    setBusy('save');
    try {
      const response = await apiFetch('/api/project-settings/api/telegram', {
        method: 'PUT',
        body: {
          enabled: form.enabled,
          saleNotifications: form.saleNotifications,
          auditLogNotifications: form.auditLogNotifications,
          dailyReportEnabled: form.dailyReportEnabled,
          dailyReportTime: form.dailyReportTime,
        },
      });
      setMeta(response.telegram || {});
      setMessage('Telegram settings သိမ်းပြီးပါပြီ။');
    } catch (error) {
      setMessage(error.message || 'Save failed');
    } finally {
      setBusy('');
    }
  };

  const unlink = async () => {
    if (!window.confirm('Telegram ချိတ်ဆက်မှုကို ဖြုတ်မည်လား?')) return;
    setBusy('unlink');
    try {
      const response = await apiFetch('/api/project-settings/api/telegram/unlink', { method: 'POST', body: {} });
      setMeta(response.telegram || {});
      setMessage('Telegram unlinked. Bot ကို /start ပို့ပြီး ပြန်ချိတ်နိုင်ပါသည်။');
    } catch (error) {
      setMessage(error.message || 'Unlink failed');
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

  const isLinked = Boolean(meta.linkedTelegramId);
  const canSend = isLinked || Boolean(meta.chatId);

  return (
    <section className="ps-panel telegram-simple-settings">
      <header className="ps-panel-head">
        <div>
          <BellRing size={21} />
          <span>
            <h3>Telegram Notification</h3>
            <p>Bot ချိတ်ပြီး /start ပို့ရုံနဲ့ — Chat ID ထည့်စရာမလို။</p>
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
          <span><small>Bot</small><b>{meta.hasBotToken ? (meta.botUsername ? `@${meta.botUsername}` : 'Set') : 'Not Set'}</b></span>
        </div>
        <div>
          <UserRound size={20} />
          <span><small>Linked</small><b>{isLinked ? (meta.linkedTelegramName || meta.linkedTelegramId) : 'Not Linked'}</b></span>
        </div>
        <div>
          <BellRing size={20} />
          <span><small>Notifications</small><b>{form.enabled ? 'ON' : 'OFF'}</b></span>
        </div>
      </div>

      <div className="ps-form">
        <div className="project-google-guide">
          <div><b>1</b><span><strong>Bot Token ထည့်မယ်</strong><small>@BotFather မှာ bot ဖန်တီးပြီး token paste ပါ။</small></span></div>
          <div><b>2</b><span><strong>/start ပို့မယ်</strong><small>Bot link ကိုနှိပ်ပြီး /start ပို့ပါ — Chat ID auto မှတ်ပါမည်။</small></span></div>
          <div><b>3</b><span><strong>Notification ဖွင့်မယ်</strong><small>Sale, Audit Log, Daily Report — ရွေးချယ်ပါ။</small></span></div>
        </div>

        {/* Step 1: Bot Token */}
        <div className="gs-code-card">
          <div><b>Step 1 — Bot Token</b></div>
          {meta.hasBotToken ? (
            <p style={{ color: '#16a34a', marginBottom: 6 }}>
              ✅ {meta.botUsername ? `@${meta.botUsername}` : 'Bot'} Token သိမ်းပြီး (···{meta.botTokenLast4})
              {meta.webhookRegistered ? ' · Webhook active' : ''}
            </p>
          ) : (
            <p style={{ marginBottom: 6 }}>@BotFather မှာ bot တစ်ခုဖန်တီးပြီး token ကို paste ပါ။</p>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              className="ps-input"
              type="password"
              placeholder={meta.hasBotToken ? 'New token to replace…' : 'Paste bot token from @BotFather'}
              value={botTokenInput}
              onChange={(e) => setBotTokenInput(e.target.value)}
              style={{ flex: 1 }}
            />
            <button className="ps-primary" type="button" onClick={saveBotToken} disabled={!botTokenInput.trim() || busy === 'token'}>
              {busy === 'token' ? <Loader2 className="ps-spin" size={16} /> : <Save size={16} />}
            </button>
          </div>
        </div>

        {/* Step 2: Link Telegram */}
        {meta.hasBotToken && (
          <div className="gs-code-card">
            <div><b>Step 2 — Telegram ချိတ်မယ်</b></div>
            {isLinked ? (
              <div>
                <p style={{ color: '#16a34a', marginBottom: 8 }}>
                  ✅ <b>{meta.linkedTelegramName || meta.linkedTelegramId}</b> ချိတ်ပြီး — Notifications ပို့ပါမည်။
                </p>
                <button type="button" onClick={unlink} disabled={busy === 'unlink'} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 13 }}>
                  {busy === 'unlink' ? <Loader2 className="ps-spin" size={14} /> : <Link2Off size={14} />} Unlink
                </button>
              </div>
            ) : (
              <div>
                <p style={{ marginBottom: 8 }}>Bot ကို Telegram မှာ ဖွင့်ပြီး <b>/start</b> ပို့ပါ — Chat ID ကို system က auto မှတ်ပါမည်။</p>
                {meta.botDeepLink && (
                  <a
                    href={meta.botDeepLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 14px', background: '#2563eb', color: '#fff', borderRadius: 6, textDecoration: 'none', fontWeight: 600, fontSize: 14, marginBottom: 10 }}
                  >
                    <Link2 size={15} /> @{meta.botUsername} ကို ဖွင့်မယ်
                  </a>
                )}
                <div ref={widgetRef} style={{ marginTop: 8 }} />
                {!meta.webhookRegistered && <small style={{ opacity: 0.65 }}>သို့မဟုတ် Login Widget ဖြင့် ချိတ်နိုင်သည်။</small>}
              </div>
            )}
          </div>
        )}

        {/* Step 3: Notification toggles */}
        <div className="ps-grid-2">
          <label className="ps-switch-row">
            <span><b>Telegram ကိုဖွင့်မယ်</b><small>OFF ဖြစ်ရင် notification မပို့ပါ။</small></span>
            <input type="checkbox" checked={form.enabled} onChange={(e) => update({ enabled: e.target.checked })} />
          </label>

          <label className="ps-switch-row">
            <span><b>Sale Notification</b><small>Sale voucher confirm ပြီးတာနဲ့ ပို့ပါမယ်။</small></span>
            <input type="checkbox" checked={form.saleNotifications} onChange={(e) => update({ saleNotifications: e.target.checked })} />
          </label>

          <label className="ps-switch-row">
            <span><b>Audit Log Notification</b><small>Staff လုပ်ဆောင်မှုများကို real-time ပို့ပါမည်။</small></span>
            <input type="checkbox" checked={form.auditLogNotifications} onChange={(e) => update({ auditLogNotifications: e.target.checked })} />
          </label>

          <label className="ps-switch-row">
            <span><b>Daily Report ပို့မယ်</b><small>နေ့တိုင်း သတ်မှတ်ချိန်မှာ ပို့ပါမယ်။</small></span>
            <input type="checkbox" checked={form.dailyReportEnabled} onChange={(e) => update({ dailyReportEnabled: e.target.checked })} />
          </label>

          <label className="ps-field">
            <span>Daily Report Time</span>
            <input type="time" value={form.dailyReportTime} onChange={(e) => update({ dailyReportTime: e.target.value })} />
          </label>
        </div>
      </div>

      <div className="ps-actions">
        <button className="ps-primary" type="button" onClick={save} disabled={busy === 'save'}>
          {busy === 'save' ? <Loader2 className="ps-spin" size={18} /> : <Save size={18} />} Save
        </button>
        <button type="button" onClick={test} disabled={busy === 'test' || !canSend}>
          {busy === 'test' ? <Loader2 className="ps-spin" size={18} /> : <Send size={18} />} Test ပို့မယ်
        </button>
        <button type="button" onClick={sendDailyReport} disabled={busy === 'report' || !canSend}>
          {busy === 'report' ? <Loader2 className="ps-spin" size={18} /> : <BellRing size={18} />} Daily Report စမ်းပို့မယ်
        </button>
      </div>
    </section>
  );
}
