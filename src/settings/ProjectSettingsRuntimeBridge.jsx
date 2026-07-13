import React, { useEffect } from 'react';
import ProjectSettingsCenter from './ProjectSettingsCenter.jsx';
import { applyProjectLanguage } from './ProjectLanguageRuntime.jsx';
import './project-operations-v23.css';
import './postgresql-settings-hub-v23.css';

const THEME_KEY = 'mahar-pos-theme';

export function applyProjectTheme(value) {
  if (typeof document === 'undefined') return;
  const theme = ['light', 'dark', 'system'].includes(value) ? value : 'light';
  const dark = theme === 'dark'
    || (theme === 'system' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
  document.body.classList.toggle('dark', dark);
  document.documentElement.dataset.theme = theme;
  try {
    window.localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Storage can be unavailable in browser privacy mode.
  }
  window.dispatchEvent(new CustomEvent('mahar-project-theme', { detail: { theme, dark } }));
}

export default function ProjectSettingsRuntimeBridge() {
  useEffect(() => {
    const storedTheme = window.localStorage.getItem(THEME_KEY);
    if (storedTheme) applyProjectTheme(storedTheme);

    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    const refreshSystemTheme = () => {
      if (document.documentElement.dataset.theme === 'system') applyProjectTheme('system');
    };
    media?.addEventListener?.('change', refreshSystemTheme);
    return () => media?.removeEventListener?.('change', refreshSystemTheme);
  }, []);

  const onChange = (event) => {
    const target = event.target;
    if (!(target instanceof HTMLSelectElement)) return;
    if (['light', 'dark', 'system'].includes(target.value)) applyProjectTheme(target.value);
    if (['my', 'en'].includes(target.value)) applyProjectLanguage(target.value);
  };

  return <div className="project-settings-v23-centralized" onChangeCapture={onChange}>
    <ProjectSettingsCenter/>
  </div>;
}
