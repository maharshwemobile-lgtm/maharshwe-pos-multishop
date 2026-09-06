import React from 'react';
import { createRoot } from 'react-dom/client';
// First, so every stylesheet after it can refer to the tokens.
import './design-system.css';
import './styles.css';
import './pos/pos-minimal-overrides.css';
import './typography-v20.css';
import './mobile-auto-fit-v21.css';
import './ui-polish-v22.css';
import './ui-layout-hotfix-v24.css';
import './date-field-v25.css';
import AppFull from './AppFull.jsx';
import AppErrorBoundary from './AppErrorBoundary.jsx';
import { installResponsiveViewportV21 } from './responsiveViewportV21.js';
import { installProductIconRuntimeV22 } from './productIconRuntimeV22.js';
import { installDateFieldRuntimeV25 } from './dateFieldRuntimeV25.js';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <AppFull />
    </AppErrorBoundary>
  </React.StrictMode>
);

installResponsiveViewportV21();
installProductIconRuntimeV22();
installDateFieldRuntimeV25();
