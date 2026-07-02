import React from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import './pos/pos-minimal-overrides.css';
import './typography-v20.css';
import './mobile-auto-fit-v21.css';
import './ui-polish-v22.css';
import './ui-layout-hotfix-v24.css';
import AppFull from './AppFull.jsx';
import AppErrorBoundary from './AppErrorBoundary.jsx';
import { installResponsiveViewportV21 } from './responsiveViewportV21.js';
import { installProductIconRuntimeV22 } from './productIconRuntimeV22.js';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <AppFull />
    </AppErrorBoundary>
  </React.StrictMode>
);

installResponsiveViewportV21();
installProductIconRuntimeV22();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    const swUrl = new URL('sw-v4.js?v=22-category-product-icons-20260618b', window.location.href);
    navigator.serviceWorker.register(swUrl, { updateViaCache: 'none' }).then((registration) => {
      registration.update().catch(() => {});
    }).catch((error) => {
      console.warn('Service worker registration failed:', error);
    });
  });
}
