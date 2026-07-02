import React, { useState } from 'react';
import {
  ArrowLeft,
  History,
  PlusCircle,
  ReceiptText,
  ShieldCheck,
} from 'lucide-react';
import { getSession } from '../phase2Api';
import NewSaleV10 from './NewSaleV10';
import SalesHistoryV10 from './SalesHistoryV10';
import './sales-v10.css';

export default function SalesWorkspaceV10({ initialView = 'sale', onExit }) {
  const [view, setView] = useState(initialView === 'history' ? 'history' : 'sale');
  const session = getSession();
  const userName = session?.user?.name || session?.user?.username || 'Mahar Shwe User';

  return (
    <div className="sv10-page">
      <header className="sv10-shell-header">
        <div className="sv10-brand-zone">
          <button type="button" className="sv10-back-button" onClick={onExit} title="Back to dashboard">
            <ArrowLeft size={18} />
          </button>
          <div className="sv10-brand-mark"><ReceiptText size={20} /></div>
          <div>
            <span>SALES</span>
            <h1>Sales Workspace</h1>
          </div>
        </div>

        <nav className="sv10-view-tabs">
          <button type="button" className={view === 'sale' ? 'active' : ''} onClick={() => setView('sale')}>
            <PlusCircle size={17} /> New Sale
          </button>
          <button type="button" className={view === 'history' ? 'active' : ''} onClick={() => setView('history')}>
            <History size={17} /> Sales History
          </button>
        </nav>

        <div className="sv10-session-zone">
          <ShieldCheck size={16} />
          <div><b>{userName}</b><small>PostgreSQL tenant session</small></div>
        </div>
      </header>

      <main className="sv10-workspace-body">
        {view === 'sale'
          ? <NewSaleV10 onOpenHistory={() => setView('history')} />
          : <SalesHistoryV10 />}
      </main>
    </div>
  );
}
