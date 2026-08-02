import React from 'react';
import { createRoot } from 'react-dom/client';
import AppSecure from './AppSecure.jsx';
import AppErrorBoundary from './AppErrorBoundary.jsx';
import { installResponsiveViewportV21 } from './responsiveViewportV21.js';
import { installProductIconRuntimeV22 } from './productIconRuntimeV22.js';
import { installDateFieldRuntimeV25 } from './dateFieldRuntimeV25.js';
import './styles.css';
import './pos/pos-minimal-overrides.css';
import './pos/pos-payment-selector-direct-v23.css';
import './project-runtime-theme.css';
import './typography-v20.css';
import './mobile-auto-fit-v21.css';
import './ui-polish-v22.css';
import './product-category-icon.css';
import './ui-layout-hotfix-v24.css';
import './date-field-v25.css';
import './font-geist-v26.css';

const RUNTIME_VERSION = '20260723-stable-record-categories-date-picker';

async function clearLegacyRuntime() {
  try {
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      const appRegistrations = registrations.filter((registration) => {
        const scriptUrl = registration.active?.scriptURL
          || registration.waiting?.scriptURL
          || registration.installing?.scriptURL
          || '';
        return scriptUrl && !/firebase-messaging-sw\.js/i.test(scriptUrl);
      });
      await Promise.all(appRegistrations.map((registration) => registration.unregister()));
    }
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys
        .filter((key) => !/firebase|fcm|messaging/i.test(key))
        .map((key) => caches.delete(key)));
    }
    try {
      const previousVersion = window.localStorage.getItem('mahar-runtime-version');
      if (previousVersion !== RUNTIME_VERSION) {
        window.localStorage.setItem('mahar-runtime-version', RUNTIME_VERSION);
      }
    } catch {}
  } catch (error) {
    console.warn('Legacy runtime cleanup failed:', error);
  }
}

function renderApp() {
  const bootStatus = document.getElementById('app-boot-status');
  if (bootStatus) bootStatus.remove();
  createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <AppErrorBoundary>
        <AppSecure />
      </AppErrorBoundary>
    </React.StrictMode>
  );
  window.requestAnimationFrame(() => {
    installResponsiveViewportV21();
    installProductIconRuntimeV22();
    installDateFieldRuntimeV25();
  });
}

window.addEventListener('error', (event) => {
  console.error('Mahar POS window error:', event.error || event.message);
});

window.addEventListener('unhandledrejection', (event) => {
  console.error('Mahar POS unhandled promise rejection:', event.reason);
});

clearLegacyRuntime().finally(renderApp);
