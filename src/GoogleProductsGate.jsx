import React, { useEffect, useRef, useState } from 'react';
import { Loader2, ShieldCheck } from 'lucide-react';
import ProductsPage from './ProductsPage.jsx';
import { getSession, googleLogin } from './phase2Api';
import './products.css';

const DEFAULT_GOOGLE_CLIENT_ID = '648689584934-kbfljosfdkui7phmiq9k9o3dfl9un0ql.apps.googleusercontent.com';
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || DEFAULT_GOOGLE_CLIENT_ID;

let googleScriptPromise;

function loadGoogleIdentityScript() {
  if (window.google?.accounts?.id) return Promise.resolve();
  if (googleScriptPromise) return googleScriptPromise;

  googleScriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-mahar-google-identity="true"]');
    if (existing) {
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

export default function GoogleProductsGate() {
  const [session, setSession] = useState(() => getSession());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const buttonRef = useRef(null);

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
            if (!response?.credential) {
              setError('Google credential မရရှိပါ။');
              return;
            }

            setBusy(true);
            setError('');
            try {
              const nextSession = await googleLogin({
                credential: response.credential,
              });
              setSession(nextSession);
            } catch (requestError) {
              setError(requestError.message || 'Google login failed');
            } finally {
              setBusy(false);
            }
          },
        });

        buttonRef.current.innerHTML = '';
        window.google.accounts.id.renderButton(buttonRef.current, {
          type: 'standard',
          theme: 'outline',
          size: 'large',
          text: 'continue_with',
          shape: 'rectangular',
          logo_alignment: 'left',
          width: Math.min(360, Math.max(280, buttonRef.current.clientWidth || 340)),
        });
      } catch (scriptError) {
        if (!cancelled) setError(scriptError.message || 'Google login could not be started');
      }
    };

    setupGoogleLogin();
    return () => {
      cancelled = true;
      window.google?.accounts?.id?.cancel?.();
    };
  }, [session?.token]);

  if (session?.token) return <ProductsPage />;

  return (
    <section className="p2-login-card">
      <div className="p2-login-icon"><ShieldCheck size={28} /></div>
      <h2>Sign in with Google</h2>
      <p>
        သင့် Gmail identity ကို Google မှာစစ်ပြီး၊ server-side မှာ သင့် email နဲ့ချိတ်ထားတဲ့ shop data တစ်ခုတည်းကိုပဲ ဖွင့်ပေးပါမယ်။
      </p>
      <div style={{ display: 'flex', justifyContent: 'center', minHeight: 44 }} ref={buttonRef} />
      {busy ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 14 }}>
          <Loader2 className="p2-spin" size={18} />
          <b>Google Account စစ်ဆေးနေသည်…</b>
        </div>
      ) : null}
      {error ? <div className="p2-alert p2-alert-error" style={{ marginTop: 14 }}>{error}</div> : null}
      <small style={{ display: 'block', marginTop: 16, color: '#64748b', textAlign: 'center' }}>
        New Gmail owner accounts receive their own 7-day trial tenant when self-signup is enabled.
      </small>
    </section>
  );
}
