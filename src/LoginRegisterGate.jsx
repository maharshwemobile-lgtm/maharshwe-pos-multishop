import React, { useEffect, useRef, useState } from 'react';
import { changePassword, clearSession, googleLogin, login, registerTenant } from './phase2Api';
import { PROJECT_LOGO_URL } from './projectBrand';
import LoginFooterActions from './LoginFooterActions.jsx';
import './login-register-gate.css';

const DEFAULT_GOOGLE_CLIENT_ID = '648689584934-kbfljosfdkui7phmiq9k9o3dfl9un0ql.apps.googleusercontent.com';
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || DEFAULT_GOOGLE_CLIENT_ID;
let googleIdentityInitialized = false;
let googleCredentialHandler = null;

// Mahar POS is a phone shop system only. Retail / Mini Mart runs as its own
// product on Wallet Note, so shops that need barcodes and expiry dates are sent
// there instead of being registered here with half the features hidden.
const RETAIL_SIGNUP_URL = 'https://walletnote.online/register?type=MINI_MART';

function EyeIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M1.8 12S5.4 5.4 12 5.4 22.2 12 22.2 12 18.6 18.6 12 18.6 1.8 12 1.8 12Z" />
      <circle cx="12" cy="12" r="3.1" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9.9 5.6A9.5 9.5 0 0 1 12 5.4c6.6 0 10.2 6.6 10.2 6.6a17.8 17.8 0 0 1-3 4" />
      <path d="M6.4 6.5A17.4 17.4 0 0 0 1.8 12S5.4 18.6 12 18.6a9.7 9.7 0 0 0 4.1-.9" />
      <path d="M9.9 9.9a3.1 3.1 0 0 0 4.3 4.3" />
      <path d="m3 3 18 18" />
    </svg>
  );
}

function RetailShopNotice() {
  return (
    <div className="ms-retail-notice">
      <strong>🛒 Mini Mart / Retail Shop လား?</strong>
      <small>Mahar POS က ဖုန်းဆိုင်သီးသန့်ပါ။ Barcode, ကုန်ဆုံးရက်နဲ့ retail POS အတွက် Wallet Note Mini Mart ကို သုံးပါ။</small>
      <a href={RETAIL_SIGNUP_URL} target="_blank" rel="noreferrer noopener">Wallet Note Mini Mart မှာ အကောင့်ဖွင့်မည် →</a>
    </div>
  );
}

function LifetimeFreePlan() {
  return (
    <div className="ms-lifetime-plan" aria-label="Lifetime Free plan">
      <div className="ms-lifetime-plan-icon" aria-hidden="true">∞</div>
      <div className="ms-lifetime-plan-copy">
        <strong>Lifetime Free</strong>
        <span>Core POS features are free without a time limit.</span>
      </div>
      <small>Free Plan</small>
    </div>
  );
}

export default function LoginRegisterGate({ onSession, forcePasswordChange = false }) {
  const [mode, setMode] = useState('login');
  const [loginForm, setLoginForm] = useState({ username: '', password: '', shopSlug: '' });
  const [registerForm, setRegisterForm] = useState({ shopName: '', username: '', password: '', confirmPassword: '', phone: '' });
  // One toggle for both password boxes: they have to match, so seeing one
  // without the other is no help.
  const [showRegisterPassword, setShowRegisterPassword] = useState(false);
  const [justRegistered, setJustRegistered] = useState(false);
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
        businessType: mode === 'register' ? 'PHONE_SHOP' : undefined,
      });
      onSession?.(session);
    } catch (requestError) {
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
    if (!['login', 'register'].includes(mode) || !GOOGLE_CLIENT_ID || !googleButtonRef.current) return undefined;
    let cancelled = false;

    const renderGoogleButton = () => {
      if (cancelled || !window.google?.accounts?.id || !googleButtonRef.current) return;
      googleButtonRef.current.innerHTML = '';
      googleCredentialHandler = handleGoogleCredential;
      if (!googleIdentityInitialized) {
        window.google.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          callback: async (response) => googleCredentialHandler?.(response.credential),
        });
        googleIdentityInitialized = true;
      }
      window.google.accounts.id.renderButton(googleButtonRef.current, {
        type: 'standard',
        theme: 'outline',
        size: 'large',
        width: 320,
        text: mode === 'register' ? 'signup_with' : 'signin_with',
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
    setJustRegistered(false);
    setError('');
    setSuccess('');
    setNeedSlug(false);
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

  const passwordsMatch = registerForm.password === registerForm.confirmPassword;
  const registerBasicsComplete = Boolean(
    registerForm.shopName.trim()
    && registerForm.username.trim().length >= 2
    && registerForm.password.length >= 6
    && registerForm.confirmPassword.length >= 6
    && passwordsMatch,
  );

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
    if (registerForm.password !== registerForm.confirmPassword) {
      setError('Password နှစ်ခု မတူပါ။ ပြန်စစ်ပါ။');
      return;
    }
    setLoading(true);
    try {
      const data = await registerTenant({
        shopName: registerForm.shopName.trim(),
        businessType: 'PHONE_SHOP',
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
      // Carry the password they just chose into the login form so signing in is
      // one tap. It stays in memory only — sessionStorage keeps the shop details
      // and never the password.
      setLoginForm({ username: nextPrefill.username, password: registerForm.password, shopSlug: nextPrefill.shopSlug });
      setRegisterForm({ shopName: '', username: '', password: '', confirmPassword: '', phone: '' });
      setShowRegisterPassword(false);
      setSuccess(`${nextPrefill.shopName} အကောင့် ဖွင့်ပြီးပါပြီ။ Sign In နှိပ်ပြီး ဝင်လိုက်ပါ။`);
      setMode('login');
      setJustRegistered(true);
    } catch (requestError) {
      const message = requestError?.status === 409
        ? 'ဤ Email/Username နဲ့ account ရှိပြီးသားပါ။ Login ဝင်ပါ။'
        : requestError?.message || 'အကောင့်ဖွင့်ခြင်း မအောင်မြင်ပါ။';
      setError(message);
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
            <img src={PROJECT_LOGO_URL} alt="Mahar POS" />
            <h1>Mahar POS</h1>
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

  return (
    <main className="ms-login-page">
      <section className="ms-login-card">
        <div className="ms-login-brand">
          <img src={PROJECT_LOGO_URL} alt="Mahar POS" />
          <h1>Mahar POS</h1>
          <p>{mode === 'login' ? 'Sign in to your account' : 'Create a new account'}</p>
        </div>
        <LifetimeFreePlan />
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
              <input id="login-username" name="username" type="text" value={loginForm.username} onChange={(event) => { setLoginForm({ ...loginForm, username: event.target.value }); setError(''); }} placeholder="Email address or username" autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} autoFocus={!prefill} />
            </label>
            <label>
              <span>Password</span>
              <input id="login-password" name="password" type="password" value={loginForm.password} onChange={(event) => { setLoginForm({ ...loginForm, password: event.target.value }); setError(''); }} placeholder="••••••••" autoComplete="current-password" autoFocus={!!prefill && !justRegistered} />
            </label>
            {(needSlug || loginForm.shopSlug) ? (
              <label>
              <span>Shop Code / Tenant ID {needSlug ? <b>*</b> : null}</span>
                <input id="login-shop-slug" name="shopSlug" value={loginForm.shopSlug} onChange={(event) => { setLoginForm({ ...loginForm, shopSlug: event.target.value }); setError(''); }} placeholder="ဥပမာ MS123456" autoComplete="organization" autoCapitalize="characters" />
                <small>Ask your shop admin or owner if you do not know it. A single-shop user can leave this blank.</small>
              </label>
            ) : null}
            <button type="submit" className="ms-login-primary" disabled={loading} autoFocus={justRegistered}>{loading ? 'Signing in...' : 'Sign In'}</button>
            {GOOGLE_CLIENT_ID ? <><div className="ms-login-divider"><span>Or continue with</span></div><div className="ms-login-google" ref={googleButtonRef} /></> : null}
            <p className="ms-login-footer">No account yet? <button type="button" onClick={() => switchMode('register')}>Create Account</button></p>
          </form>
        ) : (
          <form className="ms-login-form" onSubmit={submitRegister}>
            <label>
              <span>Shop Name <b>*</b></span>
              <input name="shopName" value={registerForm.shopName} onChange={(event) => { setRegisterForm({ ...registerForm, shopName: event.target.value }); setError(''); }} placeholder="My Shop" autoFocus />
            </label>
            <label>
              <span>Email / Username <b>*</b></span>
              <input id="register-username" name="username" type="text" autoCapitalize="none" autoCorrect="off" spellCheck={false} value={registerForm.username} onChange={(event) => { setRegisterForm({ ...registerForm, username: event.target.value }); setError(''); }} placeholder="Email address or username" autoComplete="username" />
              <small>Use an email address or username. Sign in if the account already exists.</small>
            </label>
            <label>
              <span>Password <b>*</b></span>
              <div className="ms-password-field">
                <input id="register-password" type={showRegisterPassword ? 'text' : 'password'} name="password" value={registerForm.password} onChange={(event) => { setRegisterForm({ ...registerForm, password: event.target.value }); setError(''); }} placeholder="အနည်းဆုံး ၆ လုံး" autoComplete="new-password" />
                <button type="button" className="ms-password-toggle" onClick={() => setShowRegisterPassword((value) => !value)} aria-pressed={showRegisterPassword} aria-label={showRegisterPassword ? 'Password ဖျောက်မည်' : 'Password ပြမည်'} title={showRegisterPassword ? 'ဖျောက်မည်' : 'ပြမည်'}>
                  {showRegisterPassword ? <EyeOffIcon /> : <EyeIcon />}
                </button>
              </div>
            </label>
            <label>
              <span>Password ထပ်ရိုက်ပါ <b>*</b></span>
              <div className="ms-password-field">
                <input id="register-password-confirm" type={showRegisterPassword ? 'text' : 'password'} name="confirmPassword" value={registerForm.confirmPassword} onChange={(event) => { setRegisterForm({ ...registerForm, confirmPassword: event.target.value }); setError(''); }} placeholder="အပေါ်က Password အတိုင်း" autoComplete="new-password" />
                <button type="button" className="ms-password-toggle" onClick={() => setShowRegisterPassword((value) => !value)} aria-pressed={showRegisterPassword} aria-label={showRegisterPassword ? 'Password ဖျောက်မည်' : 'Password ပြမည်'} title={showRegisterPassword ? 'ဖျောက်မည်' : 'ပြမည်'}>
                  {showRegisterPassword ? <EyeOffIcon /> : <EyeIcon />}
                </button>
              </div>
              {registerForm.confirmPassword && !passwordsMatch
                ? <small className="ms-password-mismatch">Password နှစ်ခု မတူသေးပါ။</small>
                : null}
            </label>
            <label>
              <span>Phone Number <em>(Optional)</em></span>
              <input type="tel" name="phone" value={registerForm.phone} onChange={(event) => { setRegisterForm({ ...registerForm, phone: event.target.value }); setError(''); }} placeholder="09xxxxxxxxx" />
            </label>
            <RetailShopNotice />
            <button type="submit" className="ms-login-primary" disabled={loading || !registerBasicsComplete}>{loading ? 'Creating account...' : 'Create Account'}</button>
            <p className="ms-login-footer">Already have an account? <button type="button" onClick={() => switchMode('login')}>Sign In</button></p>
            {GOOGLE_CLIENT_ID ? (
              <>
                <div className="ms-login-divider"><span>Or continue with</span></div>
                <div className="ms-login-google-register">
                  <b>Quick registration with Google</b>
                  <div className="ms-login-google" ref={googleButtonRef} />
                </div>
              </>
            ) : null}
          </form>
        )}
        <LoginFooterActions onForgotPassword={() => setError('Password reset လိုအပ်ပါက Telegram Support မှ Admin ကိုဆက်သွယ်ပါ။')} />
      </section>
    </main>
  );
}
