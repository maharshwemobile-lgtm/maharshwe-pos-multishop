import React from 'react';
import AppFull from './AppFull.jsx';
import CustomerRepairPortal from './CustomerRepairPortal.jsx';
import GameTopupStorefront from './GameTopupStorefront.jsx';
import GameTopupOrderStatus from './GameTopupOrderStatus.jsx';

export default function AppSecure() {
  const pathname = window.location.pathname.replace(/\/+$/, '') || '/';
  if (pathname === '/repair' || pathname === '/repair-status') {
    return <CustomerRepairPortal />;
  }
  if (pathname === '/topup') {
    return <GameTopupStorefront />;
  }
  if (pathname === '/topup-status') {
    return <GameTopupOrderStatus />;
  }

  return <AppFull />;
}
