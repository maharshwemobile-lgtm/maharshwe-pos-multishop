import React, { useEffect, useRef, useState } from 'react';
import { changePassword, clearSession, googleLogin, login, registerTenant } from './phase2Api';
import { PROJECT_LOGO_URL } from './projectBrand';
import './login-register-gate.css';

const DEFAULT_GOOGLE_CLIENT_ID = '648689584934-kbfljosfdkui7phmiq9k9o3dfl9un0ql.apps.googleusercontent.com';
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || DEFAULT_GOOGLE_CLIENT_ID;

const BUSINESS_TYPES = [
  {
    value: 'PHONE_SHOP',
    title: '📱 Phone Shop',
    subtitle: 'ဖုန်းဆိုင် / Repair / IMEI / Money Service',
  },
  {
    value: 'MINI_MART',
    title: '🛒 Mini Mart',
    subtitle: 'Barcode / Expiry / Grocery POS',
  },
];

function BusinessTypePicker({ value, onChange }) {
  return (
    <div className="ms-business-type-field">
      <span>ဆိုင်အမျိုးအစား <b>*</b></span>
      <div className="ms-business-type-options">
        {BUSINESS_TYPES.map((item) => (
          <label key={item.value} className={`ms-business-type-card ${value === item.value ? 'active' : ''}`}>
            <input
              type="radio"
              name="businessType"
              value={item.value}
              checked={value === item.value}
              onChange={() => onChange(item.value)}
            />
            <strong>{item.title}</strong>
            <small>{item.subtitle}</small>
          </label>
        ))}
      </div>
    </div>
  );
}

export default function LoginRegisterGate({ onSession, forcePasswordChange = false }) {
  const [mode, setMode] = useState('login');
  const [loginForm, setLoginForm] = useState({ username: '', password: '', shopSlug: '' });
  const [registerForm, setRegisterForm] = useState({ shopName: '', businessType: 'PHONE_SHOP', username: '', password: '', phone: '' });
  const [googleBusinessType, setGoogleBusinessType] = useState('PHONE_SHOP');
  const [pendingGoogleCredential, setPendingGoogleCredential] = useState('');
  const [prefill, setPrefill] = useState(null);
  const [needSlug, setNeedSlug] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);
  const [pendingSession, setPendingSession] = useState(null);
  const [passwordChangeForm, setPasswordChangeForm] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });
  const googleButtonRef = useRef(null);

  useEffect(() => {
    if (!forcePasswordChange) return;
    setMode('changePassword');
    setSuccess('Temporary password ဖြင့်ဝင်ထားသောကြောင့် Password အသစ်ပြောင်းပါ။');
  }, [forcePasswordChange]);

  useEffect(() => {
    const raw = sessionStorage.getItem('pos_prefill_login');
    if (!raw) return;
    try {
      const data = JSON.parse(raw);
      setPrefill(data);
      setLoginForm((current) => ({
        ...current,
        username: data.username || current.username,
        shopSlug: data.shopSlug || current.shopSlug,
      }));
      setMode('login');
      sessionStorage.removeItem('pos_prefill_login');
    } catch {
      // Ignore invalid stored prefill.
    }
  }, []);

  const handleGoogleCredential = async (credential) => {
    setError('');
    setSuccess('');
    setLoading(true);
    try {
      const session = await googleLogin({
        credential,
        shopSlug: loginForm.shopSlug.trim() || undefined,
      });
      onSession?.(session);
    } catch (requestError) {
      if (requestError?.data?.requiresBusinessType) {
        setPendingGoogleCredential(credential);
        setGoogleBusinessType('PHONE_SHOP');
        setMode('googleBusinessType');
        setError('Google Register ဆက်လုပ်ရန် Phone ဆိုင် / Mini Mart ကို အရင်ရွေးပါ။');
        return;
      }
      const message = requestError?.message || 'Google Login မအောင်မြင်ပါ။';
      if (/(multiple|shop slug|shop code|tenant|ဆိုင်ကုဒ်)/i.test(message)) setNeedSlug(true);
      setError(/multiple/i.test(message)
        ? 'ဤ username/email သည် ဆိုင်တစ်ခုထက်မက အသုံးပြုထားသည်။ ဆိုင်ကုဒ် / Tenant ID ထည့်ပြီး ထပ်ကြိုးစားပါ။'
        : message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (mode !== 'login' || !GOOGLE_CLIENT_ID || !googleButtonRef.current) return undefined;
    let cancelled = false;

    const renderGoogleButton = () => {
      if (cancelled || !window.google?.accounts?.id || !googleButtonRef.current) return;
      googleButtonRef.current.innerHTML = '';
      window.google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: async (response) => handleGoogleCredential(response.credential),
      });
      window.google.accounts.id.renderButton(googleButtonRef.current, {
        type: 'standard',
        theme: 'outline',
        size: 'large',
        width: 320,
        text: 'signin_with',
        locale: 'my',
      });
    };

    if (window.google?.accounts?.id) {
      renderGoogleButton();
      return () => { cancelled = true; };
    }

    const existing = document.querySelector('script[data-mahar-google-login="true"]');
    if (existing) {
      existing.addEventListener('load', renderGoogleButton, { once: true });
      return () => { cancelled = true; };
    }

    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.dataset.maharGoogleLogin = 'true';
    script.onload = renderGoogleButton;
    script.onerror = () => {
      if (!cancelled) setError('Google Login script မဖွင့်နိုင်ပါ။ Username/Password ဖြင့်ဝင်ပါ။');
    };
    document.body.appendChild(script);
    return () => { cancelled = true; };
  }, [mode, loginForm.shopSlug, onSession]);

  const switchMode = (nextMode) => {
    setMode(nextMode);
    setError('');
    setSuccess('');
    setNeedSlug(false);
    if (nextMode !== 'googleBusinessType') setPendingGoogleCredential('');
  };

  const submitLogin = async (event) => {
    event.preventDefault();
    setError('');
    setSuccess('');
    if (!loginForm.username.trim() || !loginForm.password) {
      setError('Username နှင့် Password ထည့်ပါ။');
      return;
    }
    setLoading(true);
    try {
      const session = await login({
        username: loginForm.username.trim(),
        password: loginForm.password,
        shopSlug: loginForm.shopSlug.trim() || undefined,
      });
      if (session?.user?.passwordMustChange) {
        setPendingSession(session);
        setPasswordChangeForm({ currentPassword: loginForm.password, newPassword: '', confirmPassword: '' });
        setSuccess('Temporary password ဖြင့် Login ဝင်ပြီးပါပြီ။ Password အသစ်ပြောင်းပါ။');
        setMode('changePassword');
        return;
      }
      onSession?.(session);
    } catch (requestError) {
      const message = requestError?.message || 'Login မအောင်မြင်ပါ။';
      if (/(multiple|shop slug|shop code|tenant|ဆိုင်ကုဒ်)/i.test(message)) {
        setNeedSlug(true);
        setError('ဤ username/email သည် ဆိုင်တစ်ခုထက်မက အသုံးပြုထားသည်။ ဆိုင်ကုဒ် / Tenant ID ထည့်ပါ။');
      } else {
        setError(message);
      }
    } finally {
      setLoading(false);
    }
  };

  const submitRegister = async (event) => {
    event.preventDefault();
    setError('');
    setSuccess('');
    if (!registerForm.shopName.trim()) {
      setError('ဆိုင်အမည် ထည့်ပါ။');
      return;
    }
    if (!registerForm.username.trim() || registerForm.username.trim().length < 2) {
      setError('Username အနည်းဆုံး ၂ လုံး ရှိရမည်။');
      return;
    }
    if (!registerForm.password || registerForm.password.length < 6) {
      setError('Password အနည်းဆုံး ၆ လုံး ရှိရမည်။');
      return;
    }
    setLoading(true);
    try {
      const data = await registerTenant({
        shopName: registerForm.shopName.trim(),
        businessType: registerForm.businessType || 'PHONE_SHOP',
        username: registerForm.username.trim(),
        password: registerForm.password,
        phone: registerForm.phone.trim() || undefined,
      });
      const nextPrefill = {
        username: registerForm.username.trim(),
        shopSlug: data.tenant?.slug || '',
        tenantId: data.tenant?.code || data.tenant?.tenantId || data.tenant?.id || '',
        shopName: data.tenant?.name || registerForm.shopName.trim(),
      };
      sessionStorage.setItem('pos_prefill_login', JSON.stringify(nextPrefill));
      setPrefill(nextPrefill);
      setLoginForm({ username: nextPrefill.username, password: '', shopSlug: nextPrefill.shopSlug });
      setRegisterForm({ shopName: '', businessType: 'PHONE_SHOP', username: '', password: '', phone: '' });
      setSuccess(`${nextPrefill.shopName} အကောင့် ဖွင့်ပြီးပါပြီ။ Password ရိုက်ပြီး Login ဝင်ပါ။`);
      setMode('login');
    } catch (requestError) {
      const message = requestError?.status === 409
        ? 'ဤ Email/Username နဲ့ account ရှိပြီးသားပါ။ Login ဝင်ပါ။'
        : requestError?.message || 'အကောင့်ဖွင့်ခြင်း မအောင်မြင်ပါ။';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const submitGoogleBusinessType = async (event) => {
    event.preventDefault();
    setError('');
    setSuccess('');
    if (!pendingGoogleCredential) {
      setError('Google Login session မရှိတော့ပါ။ Google Login ကို ပြန်နှိပ်ပါ။');
      setMode('login');
      return;
    }
    setLoading(true);
    try {
      const session = await googleLogin({
        credential: pendingGoogleCredential,
        shopSlug: loginForm.shopSlug.trim() || undefined,
        businessType: googleBusinessType,
      });
      setPendingGoogleCredential('');
      onSession?.(session);
    } catch (requestError) {
      setError(requestError?.message || 'Google Register မအောင်မြင်ပါ။');
    } finally {
      setLoading(false);
    }
  };

  const submitPasswordChange = async (event) => {
    event.preventDefault();
    setError('');
    setSuccess('');
    if (!passwordChangeForm.currentPassword) {
      setError('Current temporary password ထည့်ပါ။');
      return;
    }
    if (!passwordChangeForm.newPassword || passwordChangeForm.newPassword.length < 8) {
      setError('Password အသစ် အနည်းဆုံး ၈ လုံး ရှိရမည်။');
      return;
    }
    if (passwordChangeForm.newPassword !== passwordChangeForm.confirmPassword) {
      setError('Password အသစ် နှစ်ခု မတူပါ။');
      return;
    }
    setLoading(true);
    try {
      const session = await changePassword({
        currentPassword: passwordChangeForm.currentPassword,
        newPassword: passwordChangeForm.newPassword,
      });
      setPendingSession(null);
      setPasswordChangeForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
      onSession?.(session);
    } catch (requestError) {
      setError(requestError?.message || 'Password ပြောင်းခြင်း မအောင်မြင်ပါ။');
    } finally {
      setLoading(false);
    }
  };

  const cancelPasswordChange = () => {
    clearSession();
    setPendingSession(null);
    setPasswordChangeForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
    setMode('login');
    setSuccess('');
    setError('');
  };

  if (mode === 'changePassword' || forcePasswordChange) {
    return (
      <main className="ms-login-page">
        <section className="ms-login-card">
          <div className="ms-login-brand">
            <img src={PROJECT_LOGO_URL} alt="Mahar Shwe POS" />
            <h1>Mahar Shwe POS</h1>
            <p>Password အသစ်ပြောင်းရန်</p>
          </div>
          {success ? <div className="ms-login-alert success">🔐 {success}</div> : null}
          {error ? <div className="ms-login-alert error">{error}</div> : null}
          <form className="ms-login-form" onSubmit={submitPasswordChange}>
            <label>
              <span>Current / Temporary Password</span>
              <input type="password" value={passwordChangeForm.currentPassword} onChange={(event) => setPasswordChangeForm({ ...passwordChangeForm, currentPassword: event.target.value })} autoComplete="current-password" />
            </label>
            <label>
              <span>New Password</span>
              <input type="password" value={passwordChangeForm.newPassword} onChange={(event) => setPasswordChangeForm({ ...passwordChangeForm, newPassword: event.target.value })} autoComplete="new-password" minLength={8} />
            </label>
            <label>
              <span>Confirm New Password</span>
              <input type="password" value={passwordChangeForm.confirmPassword} onChange={(event) => setPasswordChangeForm({ ...passwordChangeForm, confirmPassword: event.target.value })} autoComplete="new-password" minLength={8} />
            </label>
            <button type="submit" className="ms-login-submit" disabled={loading}>{loading ? 'ပြောင်းနေသည်…' : 'Password ပြောင်းပြီး Dashboard ဝင်မည်'}</button>
            <button type="button" className="ms-login-secondary" onClick={cancelPasswordChange}>Login ပြန်သွားမည်</button>
          </form>
          {pendingSession?.user?.username ? <div className="ms-login-help">Username: {pendingSession.user.username}</div> : null}
        </section>
      </main>
    );
  }

  if (mode === 'googleBusinessType') {
    return (
      <main className="ms-login-page">
        <section className="ms-login-card">
          <div className="ms-login-brand">
            <img src={PROJECT_LOGO_URL} alt="Mahar Shwe POS" />
            <h1>Mahar Shwe POS</h1>
            <p>Google Register ဆက်လုပ်ရန် ဆိုင်အမျိုးအစား ရွေးပါ</p>
          </div>
          {error ? <div className="ms-login-alert error">{error}</div> : null}
          <form className="ms-login-form" onSubmit={submitGoogleBusinessType}>
            <BusinessTypePicker value={googleBusinessType} onChange={(value) => { setGoogleBusinessType(value); setError(''); }} />
            <button type="submit" className="ms-login-primary" disabled={loading}>{loading ? 'Register လုပ်နေသည်...' : 'ရွေးပြီး Register ပြီး Dashboard ဝင်မည်'}</button>
            <button type="button" className="ms-login-secondary" disabled={loading} onClick={() => { setPendingGoogleCredential(''); switchMode('login'); }}>Google Login ပြန်လုပ်မည်</button>
          </form>
          <p className="ms-login-trial">✅ ဖွင့်ပြီးနောက် 7 ရက် Trial အခမဲ့ သုံးနိုင်သည်</p>
        </section>
      </main>
    );
  }

  return (
    <main className="ms-login-page">
      <section className="ms-login-card">
        <div className="ms-login-brand">
          <img src={PROJECT_LOGO_URL} alt="Mahar Shwe POS" />
          <h1>Mahar Shwe POS</h1>
          <p>{mode === 'login' ? 'အကောင့်ဝင်ရန်' : 'အကောင့်သစ် ဖွင့်ရန်'}</p>
        </div>
        <div className="ms-login-tabs" role="tablist" aria-label="Login and register">
          <button type="button" className={mode === 'login' ? 'active' : ''} onClick={() => switchMode('login')}>Login</button>
          <button type="button" className={mode === 'register' ? 'active' : ''} onClick={() => switchMode('register')}>Register</button>
        </div>
        {success ? <div className="ms-login-alert success">🎉 {success}</div> : null}
        {prefill && mode === 'login' ? <div className="ms-login-alert success"><b>{prefill.shopName}</b> အကောင့် ဖွင့်ပြီးပါပြီ။ Password ရိုက်ပြီး ဝင်ပါ။</div> : null}
        {error ? <div className="ms-login-alert error">{error}</div> : null}

        {mode === 'login' ? (
          <form className="ms-login-form" onSubmit={submitLogin}>
            <label>
              <span>Email / Username</span>
              <input value={loginForm.username} onChange={(event) => { setLoginForm({ ...loginForm, username: event.target.value }); setError(''); }} placeholder="email@example.com သို့မဟုတ် username" autoComplete="username" autoFocus={!prefill} readOnly={!!prefill} />
            </label>
            <label>
              <span>Password</span>
              <input type="password" value={loginForm.password} onChange={(event) => { setLoginForm({ ...loginForm, password: event.target.value }); setError(''); }} placeholder="••••••••" autoComplete="current-password" autoFocus={!!prefill} />
            </label>
            {(needSlug || loginForm.shopSlug) ? (
              <label>
                <span>ဆိုင်ကုဒ် / Tenant ID {needSlug ? <b>*</b> : null}</span>
                <input value={loginForm.shopSlug} onChange={(event) => { setLoginForm({ ...loginForm, shopSlug: event.target.value }); setError(''); }} placeholder="ဥပမာ MS123456" readOnly={!!prefill && !needSlug} />
                <small>မသိပါက ဆိုင် admin / owner ထံမေးပါ။ ပုံမှန် user တစ်ယောက်တည်းဆို ဒီအကွက် မလိုပါ။</small>
              </label>
            ) : null}
            <button type="submit" className="ms-login-primary" disabled={loading}>{loading ? 'ဝင်နေသည်...' : 'Login ဝင်မည်'}</button>
            {GOOGLE_CLIENT_ID ? <><div className="ms-login-divider"><span>သို့မဟုတ်</span></div><div className="ms-login-google" ref={googleButtonRef} /></> : null}
            <p className="ms-login-footer">အကောင့်မရှိသေးဘူးလား? <button type="button" onClick={() => switchMode('register')}>Register လုပ်ရန်</button></p>
          </form>
        ) : (
          <form className="ms-login-form" onSubmit={submitRegister}>
            <label>
              <span>ဆိုင်အမည် <b>*</b></span>
              <input name="shopName" value={registerForm.shopName} onChange={(event) => { setRegisterForm({ ...registerForm, shopName: event.target.value }); setError(''); }} placeholder="မဟာရွှေဆိုင်" autoFocus />
            </label>
            <BusinessTypePicker value={registerForm.businessType} onChange={(value) => { setRegisterForm({ ...registerForm, businessType: value }); setError(''); }} />
            <label>
              <span>Email / Username <b>*</b></span>
              <input name="username" value={registerForm.username} onChange={(event) => { setRegisterForm({ ...registerForm, username: event.target.value }); setError(''); }} placeholder="email@example.com သို့မဟုတ် username" autoComplete="username" />
              <small>Email သို့မဟုတ် username သုံးနိုင်သည်။ ရှိပြီးသား account ဆို Login ဝင်ပါ။</small>
            </label>
            <label>
              <span>Password <b>*</b></span>
              <input type="password" name="password" value={registerForm.password} onChange={(event) => { setRegisterForm({ ...registerForm, password: event.target.value }); setError(''); }} placeholder="အနည်းဆုံး ၆ လုံး" autoComplete="new-password" />
            </label>
            <label>
              <span>ဖုန်းနံပါတ် <em>(ရွေးချယ်နိုင်)</em></span>
              <input type="tel" name="phone" value={registerForm.phone} onChange={(event) => { setRegisterForm({ ...registerForm, phone: event.target.value }); setError(''); }} placeholder="09xxxxxxxxx" />
            </label>
            <button type="submit" className="ms-login-primary" disabled={loading}>{loading ? 'ဖွင့်နေသည်...' : 'အကောင့်ဖွင့်မည်'}</button>
            <p className="ms-login-trial">✅ ဖွင့်ပြီးနောက် 7 ရက် Trial အခမဲ့ သုံးနိုင်သည်</p>
            <p className="ms-login-footer">အကောင့်ရှိပြီးသားလား? <button type="button" onClick={() => switchMode('login')}>Login ဝင်ရန်</button></p>
          </form>
        )}
      </section>
    </main>
  );
}
