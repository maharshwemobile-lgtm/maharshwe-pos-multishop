import React from 'react';
import AppFull from './AppFull.jsx';
import CustomerRepairPortal from './CustomerRepairPortal.jsx';

export default function AppSecure() {
  const pathname = window.location.pathname.replace(/\/+$/, '') || '/';
  if (pathname === '/repair' || pathname === '/repair-status') {
    return <CustomerRepairPortal />;
  }

  return <AppFull />;
}
