import React, { useEffect, useState } from 'react';
import './login-footer-actions.css';

const LANGUAGE_KEY = 'mahar-pos-language-v2';
const LEGACY_LANGUAGE_KEY = 'mahar-pos-language';
const SUPPORT_URL = 'https://t.me/+2gc9ml7iMgk1ZThl';

function readLanguage() {
  if (typeof window === 'undefined') return 'my';
  try {
    return localStorage.getItem(LANGUAGE_KEY) || localStorage.getItem(LEGACY_LANGUAGE_KEY) || 'my';
  } catch {
    return 'my';
  }
}

function applyLanguage(language) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(LANGUAGE_KEY, language);
    localStorage.setItem(LEGACY_LANGUAGE_KEY, language);
  } catch {
    // Ignore private-mode storage errors.
  }
  document.documentElement.lang = language === 'en' ? 'en' : 'my';
  window.dispatchEvent(new CustomEvent('mahar-language-changed', { detail: { language } }));
  window.dispatchEvent(new CustomEvent('mahar-project-settings-updated', { detail: { preferences: { language } } }));
}

export default function LoginFooterActions({ onForgotPassword }) {
  const [language, setLanguage] = useState(() => readLanguage());

  useEffect(() => {
    applyLanguage(language);
  }, [language]);

  const forgotPassword = () => {
    onForgotPassword?.();
    window.open(SUPPORT_URL, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="login-footer-actions" aria-label="Login help and language">
      <button type="button" className="login-footer-link" onClick={forgotPassword}>
        Forgot password?
      </button>
      <div className="login-language-switch" role="group" aria-label="Language change">
        <span>Language</span>
        <button
          type="button"
          className={language === 'my' ? 'active' : ''}
          onClick={() => setLanguage('my')}
          aria-pressed={language === 'my'}
        >
          MM
        </button>
        <button
          type="button"
          className={language === 'en' ? 'active' : ''}
          onClick={() => setLanguage('en')}
          aria-pressed={language === 'en'}
        >
          EN
        </button>
      </div>
    </div>
  );
}
