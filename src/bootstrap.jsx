import React from 'react';
import { createRoot } from 'react-dom/client';
import AppFull from './AppFull.jsx';
import './styles.css';
import './pos/pos-minimal-overrides.css';

const element = React.createElement(AppFull);
createRoot(document.getElementById('root')).render(element);
