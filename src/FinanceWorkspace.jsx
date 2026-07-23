import React from 'react';
import PaymentsAccountsPage from './PaymentsAccountsPage.jsx';
import './finance-workspace.css';

export default function FinanceWorkspace({ onNavigate }) {
  return (
    <div className="finance-workspace">
      <PaymentsAccountsPage onNavigate={onNavigate} />
    </div>
  );
}
