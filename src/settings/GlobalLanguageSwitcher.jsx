import React, { useEffect, useState } from 'react';
import { Languages } from 'lucide-react';
import { applyProjectLanguage } from './ProjectLanguageRuntime.jsx';

const LANGUAGE_KEY = 'mahar-pos-language-v2';
const LEGACY_LANGUAGE_KEY = 'mahar-pos-language';

function readLanguage() {
  if (typeof window === 'undefined') return 'my';
  return window.localStorage.getItem(LANGUAGE_KEY)
    || window.localStorage.getItem(LEGACY_LANGUAGE_KEY)
    || document.documentElement.dataset.language
    || 'my';
}

export default function GlobalLanguageSwitcher() {
  const [language, setLanguage] = useState(() => readLanguage());

  useEffect(() => {
    const sync = (event) => setLanguage(event.detail === 'en' ? 'en' : 'my');
    window.addEventListener('mahar-project-language', sync);
    return () => window.removeEventListener('mahar-project-language', sync);
  }, []);

  const choose = (nextLanguage) => {
    window.localStorage.setItem(LANGUAGE_KEY, nextLanguage);
    window.localStorage.setItem(LEGACY_LANGUAGE_KEY, nextLanguage);
    setLanguage(nextLanguage);
    applyProjectLanguage(nextLanguage);
  };

  return (
    <div className="global-language-switcher" role="group" aria-label="Language" data-i18n-ignore="true">
      <Languages size={16} aria-hidden="true"/>
      <button type="button" className={language === 'my' ? 'active' : ''} onClick={() => choose('my')} aria-pressed={language === 'my'}>မြန်မာ</button>
      <button type="button" className={language === 'en' ? 'active' : ''} onClick={() => choose('en')} aria-pressed={language === 'en'}>English</button>
    </div>
  );
}
