import React, { useEffect, useRef, useState } from 'react';
import { KeyRound, Loader2, ShieldCheck, UserPlus } from 'lucide-react';
import { getSession, googleLogin, login, registerTenant, subscribeSession } from './phase2Api';
import './auth-gate.css';

const DEFAULT_GOOGLE_CLIENT_ID = '648689584934-kbfljosfdkui7phmiq9k9o3dfl9un0ql.apps.googleusercontent.com';
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || DEFAULT_GOOGLE_CLIENT_ID;
const DEFAULT_SHOP_SLUG = import.meta.env.VITE_SHOP_SLUG || '';
const LOGO_URL = 'https://raw.githubusercontent.com/maharshwemobile-lgtm/maharshwe.shop/main/mahar-pos-logo.png';

let googleScriptPromise;

function loadGoogleIdentityScript() {
  if (window.google?.accounts?.id) return Promise.resolve();
  if (googleScriptPromise) return googleScriptPromise;

  googleScriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-mahar-google-identity="true"]');
    if (existing) {
      if (window.google?.accounts?.id) {
        resolve();
        return;
      }
      existing.addEventListener('load', resolve, { once: true });
      existing.addEventListener('error', () => reject(new Error('Google login script could not be loaded')), { once: true });
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.dataset.maharGoogleIdentity = 'true';
    script.onload = resolve;
    script.onerror = () => reject(new Error('Google login script could not be loaded'));
    document.head.appendChild(script);
  });

  return googleScriptPromise;
}

export default function GoogleAuthGate({ children }) {
  const [session, setSession] = useState(() => getSession());
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({
    shopSlug: DEFAULT_SHOP_SLUG,
    username: 'admin',
    password: '',
  });
  const [registerForm, setRegisterForm] = useState({
    shopName: '',
    shopSlug: '',
    ownerName: '',
    username: 'admin',
    password: '',
    confirmPassword: '',
    phone: '',
    address: '',
  });
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [registerSuccess, setRegisterSuccess] = useState(null);
  const [busy, setBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [error, setError] = useState('');
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [showRegisterPassword, setShowRegisterPassword] = useState(false);
  const [showRegisterConfirm, setShowRegisterConfirm] = useState(false);
  const buttonRef = useRef(null);

  const handleGoogleCredential = async (credential) => {
    if (!credential) {
      setError('Google credential မရရှိပါ။ Google Console origin ကိုစစ်ပါ။');
      return;
    }
    setGoogleBusy(true);
    setError('');
    try {
      const nextSession = await googleLogin({
        credential,
        shopSlug: form.shopSlug.trim() || undefined,
      });
      setSession(nextSession);
    } catch (requestError) {
      setError(requestError.message || 'Google login failed');
    } finally {
      setGoogleBusy(false);
    }
  };

  useEffect(() => subscribeSession(setSession), []);

  useEffect(() => {
    if (session?.token) return undefined;
    let cancelled = false;

    const setupGoogleLogin = async () => {
      try {
        await loadGoogleIdentityScript();
        if (cancelled || !buttonRef.current) return;

        window.google.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          auto_select: false,
          cancel_on_tap_outside: true,
          callback: async (response) => {
            await handleGoogleCredential(response?.credential);
          },
        });

        buttonRef.current.innerHTML = '';
        window.google.accounts.id.renderButton(buttonRef.current, {
          type: 'standard',
          theme: 'outline',
          size: 'large',
          text: mode === 'register' ? 'signup_with' : 'continue_with',
          shape: 'rectangular',
          logo_alignment: 'left',
          width: Math.min(380, Math.max(280, buttonRef.current.clientWidth || 340)),
        });
      } catch {
        // Username/password login remains available when Google script is blocked.
      }
    };

    setupGoogleLogin();
    return () => {
      cancelled = true;
      window.google?.accounts?.id?.cancel?.();
    };
  }, [session?.token, form.shopSlug, mode]);

  const switchMode = (nextMode) => {
    setMode(nextMode);
    setError('');
  };

  const submitLogin = async (event) => {
    event.preventDefault();
    if (!form.shopSlug.trim() || !form.username.trim() || !form.password) {
      setError('Tenant ID / Shop Slug, Username နှင့် Password အားလုံးထည့်ပါ။');
      return;
    }

    setBusy(true);
    setError('');
    try {
      const nextSession = await login({
        shopSlug: form.shopSlug.trim(),
        username: form.username.trim(),
        password: form.password,
      });
      setSession(nextSession);
      setForm((current) => ({ ...current, password: '' }));
    } catch (requestError) {
      setError(requestError.message || 'Login failed');
    } finally {
      setBusy(false);
    }
  };

  const submitRegister = async (event) => {
    event.preventDefault();
    if (!registerForm.shopName.trim() || !registerForm.username.trim() || !registerForm.password) {
      setError('Shop name, admin username နှင့် password လိုအပ်ပါသည်။');
      return;
    }
    if (registerForm.password !== registerForm.confirmPassword) {
      setError('Password နှစ်ခု မတူပါ။ ပြန်စစ်ပေးပါ။');
      return;
    }
    if (!termsAccepted) {
      setError('7-day free trial စည်းကမ်းချက်ကို လက်ခံပေးပါ။');
      return;
    }

    setBusy(true);
    setError('');
    setRegisterSuccess(null);
    try {
      const result = await registerTenant({
        shopName: registerForm.shopName.trim(),
        shopSlug: registerForm.shopSlug.trim() || undefined,
        ownerName: registerForm.ownerName.trim() || undefined,
        username: registerForm.username.trim(),
        password: registerForm.password,
        phone: registerForm.phone.trim() || undefined,
        address: registerForm.address.trim() || undefined,
      });
      setRegisterSuccess(result);
      setMode('login');
      setForm({
        shopSlug: result.tenant?.tenantId || result.tenant?.slug || '',
        username: registerForm.username.trim(),
        password: '',
      });
      setRegisterForm((current) => ({ ...current, password: '', confirmPassword: '' }));
      setTermsAccepted(false);
    } catch (requestError) {
      setError(requestError.message || 'Registration failed');
    } finally {
      setBusy(false);
    }
  };

  if (session?.token) return children;

  return (
    <main className="auth-gate-page ms-auth-page">
      <div className="ms-auth-bg" aria-hidden="true">
        <span className="ms-auth-blob blob-one" />
        <span className="ms-auth-blob blob-two" />
        <span className="ms-auth-grid" />
      </div>

      <section className="ms-auth-shell">
        <aside className="ms-auth-brand-panel">
          <div className="ms-auth-brand-top">
            <a className="ms-auth-logo-link" href="https://maharshwe.shop/">
              <img src={LOGO_URL} alt="Mahar POS Logo" />
              <span>
                <b>Mahar Shwe Mobile POS</b>
                <small>app.maharshwe.shop</small>
              </span>
            </a>
            <div className="ms-auth-status"><i /> PostgreSQL Cloud POS Ready</div>
          </div>

          <div className="ms-auth-brand-copy">
            <p className="ms-auth-pill">7-Day Free Trial ပါဝင်သည်</p>
            <h1>
              Mobile Shop ကို
              <span> စနစ်တကျထိန်းချုပ်ပါ</span>
            </h1>
            <p>
              ဖုန်းအရောင်း၊ Accessories Stock၊ IMEI မှတ်တမ်း၊ Repair Job Card နှင့် ငွေစာရင်းများကို tenant တစ်ခုချင်း PostgreSQL data flow ဖြင့် ချိတ်ဆက်ထားသည်။
            </p>
          </div>

          <div className="ms-auth-feature-grid">
            <div><b>IMEI Stock</b><span>ဖုန်းတစ်လုံးချင်း tracking</span></div>
            <div><b>Repair Jobs</b><span>Job card + status flow</span></div>
            <div><b>Sale POS</b><span>Fast checkout + history</span></div>
            <div><b>Secure Access</b><span>Owner / Staff permissions</span></div>
          </div>

          <div className="ms-auth-link-row">
            <a href="https://maharshwe.shop/">Landing</a>
            <a href="https://admin.maharshwe.shop/">Admin Portal</a>
            <a href="https://api.maharshwe.shop/health">API Health</a>
          </div>
        </aside>

        <section className="ms-auth-panel">
          <header className="ms-auth-header">
            <a className="ms-auth-mobile-logo" href="https://maharshwe.shop/">
              <img src={LOGO_URL} alt="Mahar POS" />
              <span>Mahar Shwe POS</span>
            </a>
            <div className="ms-auth-tabs" role="tablist" aria-label="Login mode">
              <button type="button" className={mode === 'login' ? 'active' : ''} onClick={() => switchMode('login')}>
                Login
              </button>
              <button type="button" className={mode === 'register' ? 'active' : ''} onClick={() => switchMode('register')}>
                Register
              </button>
            </div>
          </header>

          <div className="ms-auth-scroll">
            <div className="ms-auth-form-wrap">
              <div className="ms-auth-title-block">
                <span><ShieldCheck size={16} /> {mode === 'login' ? 'Existing account' : 'New tenant registration'}</span>
                <h2>{mode === 'login' ? 'အကောင့်ဝင်ရန်' : 'အကောင့်သစ်ဖွင့်ရန်'}</h2>
                <p>
                  {mode === 'login'
                    ? 'Tenant ID / Shop Slug နှင့် username/password ဖြင့် Mahar POS Dashboard သို့ ဝင်ပါ။'
                    : 'ဆိုင်အကောင့်အသစ်ဖွင့်ပြီး 7-day free trial ကို စတင်နိုင်ပါသည်။'}
                </p>
              </div>

              {registerSuccess ? (
                <div className="auth-register-success ms-auth-success">
                  <b>Tenant created: {registerSuccess.tenant?.tenantId}</b>
                  <span>Shop Slug: {registerSuccess.tenant?.slug}</span>
                  <small>7-day free trial active until {new Date(registerSuccess.tenant?.subscription?.endsAt).toLocaleDateString()}။ Tenant ID ကို Login form ထဲ auto-fill လုပ်ထားပြီးပါပြီ။</small>
                </div>
              ) : null}

              {error ? <div className="auth-gate-error ms-auth-alert">{error}</div> : null}

              {mode === 'login' ? (
                <>
                  <div className="ms-auth-google-wrap">
                    <div className="auth-google-button ms-auth-google-render" ref={buttonRef} />
                    <p className="ms-auth-google-note">
                      Google သည် Gmail identity ကိုပဲစစ်ပါတယ်။ Data access ကို server-side မှာ သင့် email နဲ့ချိတ်ထားတဲ့ shop/tenant တစ်ခုတည်းအတွက်ပဲ ဖွင့်ပေးပါတယ်။
                    </p>
                    {googleBusy ? <div className="auth-gate-busy"><Loader2 className="auth-gate-spin" size={18} /> Google Account စစ်ဆေးနေသည်…</div> : null}
                  </div>

                  <div className="auth-gate-divider ms-auth-divider"><span>သို့မဟုတ်</span></div>

                  <form className="auth-gate-form ms-auth-form" onSubmit={submitLogin}>
                    <label>
                      <span>Tenant ID / Shop Slug</span>
                      <input
                        value={form.shopSlug}
                        onChange={(event) => setForm({ ...form, shopSlug: event.target.value })}
                        autoComplete="organization"
                        placeholder="MS-ABC123 or your-shop-slug"
                        required
                      />
                    </label>
                    <label>
                      <span>အီးမေးလ် / ဖုန်းနံပါတ် / Username</span>
                      <input
                        value={form.username}
                        onChange={(event) => setForm({ ...form, username: event.target.value })}
                        autoComplete="username"
                        placeholder="admin or admin@email.com"
                        required
                      />
                    </label>
                    <label>
                      <span>စကားဝှက်</span>
                      <div className="ms-auth-password">
                        <input
                          type={showLoginPassword ? 'text' : 'password'}
                          value={form.password}
                          onChange={(event) => setForm({ ...form, password: event.target.value })}
                          autoComplete="current-password"
                          placeholder="••••••••"
                          required
                        />
                        <button type="button" onClick={() => setShowLoginPassword((value) => !value)}>{showLoginPassword ? 'Hide' : 'Show'}</button>
                      </div>
                    </label>
                    <div className="ms-auth-form-row">
                      <label className="ms-auth-check"><input type="checkbox" /> Remember me</label>
                      <button type="button" className="ms-auth-link-button" onClick={() => setError('Password reset ကို Super Admin / Admin Portal မှ စီမံနိုင်ပါသည်။')}>
                        မေ့နေပါသလား?
                      </button>
                    </div>
                    <button type="submit" disabled={busy || googleBusy}>
                      {busy ? <Loader2 className="auth-gate-spin" size={19} /> : <KeyRound size={19} />}
                      {busy ? 'Signing in…' : 'Dashboard သို့ ဝင်မည်'}
                    </button>
                  </form>

                  <p className="ms-auth-switch-copy">
                    အကောင့် မရှိသေးဘူးလား?
                    <button type="button" onClick={() => switchMode('register')}>
                      အကောင့်သစ်ဖွင့်မည်
                    </button>
                  </p>
                </>
              ) : (
                <>
                  <div className="ms-auth-google-wrap ms-auth-register-google">
                    <div className="auth-google-button ms-auth-google-render" ref={buttonRef} />
                    <p className="ms-auth-google-note">
                      Gmail အသစ်ဖြင့်ဝင်ပါက tenant/shop အသစ်ကို 7-day trial ဖြင့် auto-create လုပ်ပေးပါမယ်။
                    </p>
                  </div>

                  <div className="auth-gate-divider ms-auth-divider"><span>သို့မဟုတ် manual register</span></div>

                  <form className="auth-gate-form auth-register-form ms-auth-form ms-auth-register-form" onSubmit={submitRegister}>
                    <label>
                      <span>Owner Name</span>
                      <input value={registerForm.ownerName} onChange={(event) => setRegisterForm({ ...registerForm, ownerName: event.target.value })} placeholder="Mg Mg" />
                    </label>
                    <label>
                      <span>ဖုန်းဆိုင်အမည်</span>
                      <input value={registerForm.shopName} onChange={(event) => setRegisterForm({ ...registerForm, shopName: event.target.value })} placeholder="Mahar Shwe Mobile" required />
                    </label>
                    <label>
                      <span>Admin Username / Email / Phone</span>
                      <input value={registerForm.username} onChange={(event) => setRegisterForm({ ...registerForm, username: event.target.value })} autoComplete="username" placeholder="admin@email.com / 09..." required />
                    </label>
                    <label>
                      <span>Preferred Shop Slug</span>
                      <input value={registerForm.shopSlug} onChange={(event) => setRegisterForm({ ...registerForm, shopSlug: event.target.value })} placeholder="optional, e.g. ac-mobile" />
                    </label>
                    <label>
                      <span>Phone / Township</span>
                      <input value={registerForm.phone} onChange={(event) => setRegisterForm({ ...registerForm, phone: event.target.value })} placeholder="09... / Yangon" />
                    </label>
                    <label>
                      <span>Address</span>
                      <input value={registerForm.address} onChange={(event) => setRegisterForm({ ...registerForm, address: event.target.value })} placeholder="optional" />
                    </label>
                    <label>
                      <span>စကားဝှက်</span>
                      <div className="ms-auth-password">
                        <input type={showRegisterPassword ? 'text' : 'password'} minLength={6} value={registerForm.password} onChange={(event) => setRegisterForm({ ...registerForm, password: event.target.value })} autoComplete="new-password" placeholder="အနည်းဆုံး ၆ လုံး" required />
                        <button type="button" onClick={() => setShowRegisterPassword((value) => !value)}>{showRegisterPassword ? 'Hide' : 'Show'}</button>
                      </div>
                    </label>
                    <label>
                      <span>စကားဝှက် ထပ်ထည့်ရန်</span>
                      <div className="ms-auth-password">
                        <input type={showRegisterConfirm ? 'text' : 'password'} minLength={6} value={registerForm.confirmPassword} onChange={(event) => setRegisterForm({ ...registerForm, confirmPassword: event.target.value })} autoComplete="new-password" placeholder="ပြန်ရိုက်ပါ" required />
                        <button type="button" onClick={() => setShowRegisterConfirm((value) => !value)}>{showRegisterConfirm ? 'Hide' : 'Show'}</button>
                      </div>
                    </label>
                    <div className="ms-auth-trial-note">
                      အကောင့်ဖွင့်ပြီးပါက Tenant ID ထုတ်ပေးပြီး 7-day free trial စတင်ပါမည်။ Renew လုပ်လျှင် data မပျက်ဘဲ ပြန်အသုံးပြုနိုင်ပါသည်။
                    </div>
                    <label className="ms-auth-terms">
                      <input type="checkbox" checked={termsAccepted} onChange={(event) => setTermsAccepted(event.target.checked)} />
                      <span>7-Day Free Trial စည်းကမ်းချက်များနှင့် Mahar POS အသုံးပြုမှု သဘောတူညီချက်များကို လက်ခံပါသည်။</span>
                    </label>
                    <button type="submit" disabled={busy}>
                      {busy ? <Loader2 className="auth-gate-spin" size={19} /> : <UserPlus size={19} />}
                      {busy ? 'Creating tenant…' : 'အကောင့်သစ်ဖွင့်ပြီး Trial စမည်'}
                    </button>
                  </form>

                  <p className="ms-auth-switch-copy">
                    အကောင့် ရှိပြီးသားလား?
                    <button type="button" onClick={() => switchMode('login')}>
                      Login ပြန်ဝင်မည်
                    </button>
                  </p>
                </>
              )}
            </div>
          </div>

          <footer className="ms-auth-footer">
            © 2026 Mahar Shwe Mobile POS. Powered by PostgreSQL Architecture.
          </footer>
        </section>
      </section>
    </main>
  );
}
