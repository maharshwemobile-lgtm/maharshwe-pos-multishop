import React, { useEffect, useRef, useState } from 'react';
import { BellRing, CheckCircle2, Copy, Loader2, Save, Send, ShieldCheck } from 'lucide-react';
import { apiFetch } from '../phase2Api';

const EMPTY = {
  enabled: false,
  botToken: '',
  botUsername: '',
  chatId: '',
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
        botToken: '',
        botUsername: telegram.botUsername || '',
        chatId: telegram.chatId || '',
        saleNotifications: Boolean(telegram.saleNotifications),
        dailyReportEnabled: Boolean(telegram.dailyReportEnabled),
        dailyReportTime: telegram.dailyReportTime || '21:00',
      });
      setMessage(telegram.hasBotToken ? `Telegram Bot saved · ****${telegram.botTokenLast4 || ''}` : 'Telegram Bot Token မသတ်မှတ်ရသေးပါ။');
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
        setForm((current) => ({ ...current, enabled: true, chatId: response.telegram?.chatId || current.chatId }));
        setMessage(response.message || 'Telegram connected');
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
      const body = {
        enabled: form.enabled,
        botUsername: form.botUsername,
        chatId: form.chatId,
        saleNotifications: form.saleNotifications,
        dailyReportEnabled: form.dailyReportEnabled,
        dailyReportTime: form.dailyReportTime,
        ...(form.botToken.trim() ? { botToken: form.botToken.trim() } : {}),
      };
      const response = await apiFetch('/api/project-settings/api/telegram', { method: 'PUT', body });
      setMeta(response.telegram || {});
      setForm((current) => ({ ...current, botToken: '' }));
      setMessage(response.message || 'Telegram settings saved');
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
      setMessage(response.message || 'Telegram test sent');
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
      setMessage(response.message || 'Daily report sent');
    } catch (error) {
      setMessage(error.message || 'Daily report failed');
    } finally {
      setBusy('');
    }
  };

  const copy = async (value) => {
    try {
      await navigator.clipboard.writeText(value);
      setMessage('Copied');
    } catch {
      setMessage(value);
    }
  };

  const botLink = form.botUsername ? `https://t.me/${form.botUsername.replace(/^@/, '')}` : '';

  return (
    <section className="ps-panel">
      <header className="ps-panel-head">
        <div>
          <BellRing size={21} />
          <span>
            <h3>Login as Telegram / Auto Sale Report</h3>
            <p>Telegram နဲ့ connect လုပ်တာနဲ့ ဒီ POS user ကို Telegram ID / Chat ID နဲ့မှတ်ထားမယ်။ Sale တစ်ခါပြီးတိုင်း Telegram ပို့ပြီး Daily Report auto ပို့နိုင်ပါတယ်။</p>
          </span>
        </div>
        <button className="ps-icon-button" type="button" onClick={load} disabled={busy === 'load'}>
          {busy === 'load' ? <Loader2 className="ps-spin" size={18} /> : <CheckCircle2 size={18} />}
        </button>
      </header>

      {message ? <div className="gs-message"><ShieldCheck size={16} /> {message}</div> : null}
      {meta.currentUserTelegram ? (
        <div className="gs-message">
          <ShieldCheck size={16} />
          Connected POS User · Telegram ID {meta.currentUserTelegram.telegramId}
          {meta.currentUserTelegram.name ? ` · ${meta.currentUserTelegram.name}` : ''}
        </div>
      ) : (
        <div className="gs-message">
          <ShieldCheck size={16} />
          Not connected yet. Press Login as Telegram to save this POS user with Telegram Chat ID.
        </div>
      )}

      <div className="ps-form ps-grid-2">
        <label className="ps-switch-row">
          <span><b>Enable Telegram</b><small>ON ထားမှ Sale notification / Daily report ပို့ပါမယ်။</small></span>
          <input type="checkbox" checked={form.enabled} onChange={(event) => update({ enabled: event.target.checked })} />
        </label>

        <label className="ps-field">
          <span>Telegram Bot Token</span>
          <input type="password" value={form.botToken} onChange={(event) => update({ botToken: event.target.value })} placeholder={meta.hasBotToken ? `Saved · ****${meta.botTokenLast4 || ''}` : '123456789:ABC...'} />
          <small>BotFather ကရတဲ့ token. Browser ထဲကို token ပြန်မပြပါ။</small>
        </label>

        <label className="ps-field">
          <span>Bot Username</span>
          <input value={form.botUsername} onChange={(event) => update({ botUsername: event.target.value.replace(/^@/, '') })} placeholder="your_bot_username" />
          <small>Telegram Login widget သုံးချင်ရင် bot username လိုပါတယ်။</small>
        </label>

        <label className="ps-field">
          <span>Chat ID / Group ID</span>
          <input value={form.chatId} onChange={(event) => update({ chatId: event.target.value })} placeholder="Telegram user/group chat id" />
          <small>Manual ထည့်လို့ရသလို Telegram Login widget နဲ့ connect လုပ်ရင် auto ဖြည့်ပေးပါမယ်။</small>
        </label>

        <label className="ps-switch-row">
          <span><b>Sale Auto Send</b><small>Sale POS မှာ voucher တစ်ခါထွက်တိုင်း Telegram ကို auto ပို့မယ်။</small></span>
          <input type="checkbox" checked={form.saleNotifications} onChange={(event) => update({ saleNotifications: event.target.checked })} />
        </label>

        <label className="ps-switch-row">
          <span><b>Daily Auto Report</b><small>နေ့တိုင်း သတ်မှတ်ချိန်ရောက်ရင် Daily Report ပို့မယ်။</small></span>
          <input type="checkbox" checked={form.dailyReportEnabled} onChange={(event) => update({ dailyReportEnabled: event.target.checked })} />
        </label>

        <label className="ps-field">
          <span>Daily Report Time</span>
          <input type="time" value={form.dailyReportTime} onChange={(event) => update({ dailyReportTime: event.target.value })} />
          <small>Myanmar time အတိုင်းပို့ပါမယ်။ ဥပမာ 21:00 = ည ၉ နာရီ။</small>
        </label>

        <div className="ps-field">
          <span>Login as Telegram</span>
          <div ref={widgetRef} />
          {!meta.loginWidgetReady ? <small>Bot Token + Bot Username Save လုပ်ပြီးမှ Telegram Login button ပေါ်ပါမယ်။</small> : <small>Login နှိပ်တာနဲ့ ဒီ POS user ကို Telegram Chat ID နဲ့ auto မှတ်ထားပါမယ်။</small>}
          {botLink ? <button type="button" onClick={() => window.open(botLink, '_blank', 'noopener,noreferrer')}>Open Bot</button> : null}
        </div>
      </div>

      <div className="ps-actions">
        <button className="ps-primary" type="button" onClick={save} disabled={busy === 'save'}>
          {busy === 'save' ? <Loader2 className="ps-spin" size={18}/> : <Save size={18}/>} Save Telegram
        </button>
        <button type="button" onClick={test} disabled={busy === 'test'}>
          {busy === 'test' ? <Loader2 className="ps-spin" size={18}/> : <Send size={18}/>} Send Test
        </button>
        <button type="button" onClick={sendDailyReport} disabled={busy === 'report'}>
          {busy === 'report' ? <Loader2 className="ps-spin" size={18}/> : <BellRing size={18}/>} Send Daily Report Now
        </button>
      </div>

      <div className="gs-code-card">
        <div><b>Setup Note</b><button type="button" onClick={() => copy('1) BotFather မှ bot token ယူပါ\\n2) Bot username ထည့်ပါ\\n3) Save Telegram နှိပ်ပါ\\n4) Login / Connect as Telegram နှိပ်ပါ သို့မဟုတ် Chat ID ထည့်ပါ\\n5) Sale Auto Send / Daily Auto Report ON ထားပါ')}><Copy size={15}/> Copy</button></div>
        <pre>{`1) BotFather မှ bot token ယူပါ
2) Bot username ထည့်ပါ
3) Save Telegram နှိပ်ပါ
4) Login / Connect as Telegram နှိပ်ပါ သို့မဟုတ် Chat ID ထည့်ပါ
5) Sale Auto Send / Daily Auto Report ON ထားပါ`}</pre>
      </div>
    </section>
  );
}
