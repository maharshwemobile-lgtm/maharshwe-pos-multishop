import React, { useEffect, useMemo, useState } from 'react';
import {
  BadgeDollarSign,
  CalendarDays,
  Download,
  Link2,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Store,
  WalletCards,
  X,
} from 'lucide-react';
import { apiDownload, apiFetch } from './phase2Api';
import PartnerSettlementTables from './PartnerSettlementTables.jsx';
import PartnerSettlementDetail from './PartnerSettlementDetail.jsx';
import './partner-settlement.css';

const money = (value) => `${Number(value || 0).toLocaleString('en-US')} ကျပ်`;

function weekDates() {
  const now = new Date();
  const start = new Date(now);
  start.setDate(now.getDate() + (now.getDay() === 0 ? -6 : 1 - now.getDay()));
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  const format = (date) => new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  return { periodStart: format(start), periodEnd: format(end) };
}

const blankPartnerForm = {
  partnerShopSlug: '',
  partnerCode: '',
  displayName: '',
  settlementWeekday: 1,
  defaultPartnerProfitPercent: 0,
  defaultProviderFee: 0,
  customerPaysPartner: true,
};

export default function PartnerSettlementWorkspace() {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [tab, setTab] = useState('settlements');
  const [query, setQuery] = useState('');
  const [dashboard, setDashboard] = useState({});
  const [partners, setPartners] = useState([]);
  const [ledger, setLedger] = useState([]);
  const [settlements, setSettlements] = useState([]);
  const [detail, setDetail] = useState(null);
  const [showGenerate, setShowGenerate] = useState(false);
  const [showPartnerForm, setShowPartnerForm] = useState(false);
  const [partnerForm, setPartnerForm] = useState(blankPartnerForm);
  const [period, setPeriod] = useState({ partnerLinkId: '', ...weekDates(), notes: '' });

  const providerLinks = useMemo(() => partners.filter((partner) => partner.accessMode === 'PROVIDER'), [partners]);
  const filtered = (rows) => {
    const text = query.trim().toLowerCase();
    return text ? rows.filter((row) => Object.values(row).some((value) => String(value || '').toLowerCase().includes(text))) : rows;
  };

  async function openDetail(id, spin = true) {
    if (spin) setBusy(`detail:${id}`);
    try {
      setDetail(await apiFetch(`/api/partner-settlements/settlements/${id}`));
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      if (spin) setBusy('');
    }
  }

  async function loadAll(keepDetail = true) {
    setLoading(true);
    setError('');
    try {
      const [dashboardResponse, partnerResponse, ledgerResponse, settlementResponse] = await Promise.all([
        apiFetch('/api/partner-settlements/dashboard'),
        apiFetch('/api/partner-settlements/partners'),
        apiFetch('/api/partner-settlements/ledger'),
        apiFetch('/api/partner-settlements/settlements'),
      ]);
      const nextPartners = partnerResponse.partners || [];
      setDashboard(dashboardResponse.dashboard || {});
      setPartners(nextPartners);
      setLedger(ledgerResponse.ledger || []);
      setSettlements(settlementResponse.settlements || []);
      const firstProvider = nextPartners.find((partner) => partner.accessMode === 'PROVIDER');
      setPeriod((current) => ({ ...current, partnerLinkId: current.partnerLinkId || firstProvider?.id || '' }));
      if (keepDetail && detail?.settlement?.id) await openDetail(detail.settlement.id, false);
    } catch (requestError) {
      setError(requestError.message || 'Partner settlement data မရရှိပါ။');
    } finally {
      setLoading(false);
    }
  }

  async function run(key, action) {
    setBusy(key);
    setError('');
    try {
      await action();
    } catch (requestError) {
      setError(requestError.message || 'လုပ်ဆောင်ချက် မအောင်မြင်ပါ။');
    } finally {
      setBusy('');
    }
  }

  useEffect(() => { loadAll(false); }, []);

  async function createPartner(event) {
    event.preventDefault();
    await run('partner:create', async () => {
      await apiFetch('/api/partner-settlements/partners', {
        method: 'POST',
        body: {
          ...partnerForm,
          partnerShopSlug: partnerForm.partnerShopSlug.trim(),
          partnerCode: partnerForm.partnerCode.trim().toUpperCase(),
          displayName: partnerForm.displayName.trim(),
          settlementWeekday: Number(partnerForm.settlementWeekday),
          defaultPartnerProfitPercent: Number(partnerForm.defaultPartnerProfitPercent || 0),
          defaultProviderFee: Number(partnerForm.defaultProviderFee || 0),
          customerPaysPartner: Boolean(partnerForm.customerPaysPartner),
        },
      });
      setPartnerForm(blankPartnerForm);
      setShowPartnerForm(false);
      setTab('partners');
      await loadAll(false);
    });
  }

  async function autoSync() {
    await run('sync', async () => {
      const response = await apiFetch('/api/partner-settlements/ledger/auto-sync', {
        method: 'POST',
        body: { partnerLinkId: period.partnerLinkId || null },
      });
      await loadAll(false);
      window.alert(response.created ? `${response.created} ledger အသစ်ဖန်တီးပြီးပါပြီ။` : 'Sync လုပ်ရန် completed repair အသစ်မရှိပါ။');
    });
  }

  async function generate(event) {
    event.preventDefault();
    await run('generate', async () => {
      const response = await apiFetch('/api/partner-settlements/settlements/generate', { method: 'POST', body: period });
      setShowGenerate(false);
      await loadAll(false);
      await openDetail(response.settlement.id);
    });
  }

  async function markPaid(item) {
    await run(`paid:${item.id}`, async () => {
      await apiFetch(`/api/partner-settlements/ledger/${item.id}/customer-paid`, {
        method: 'PATCH',
        body: { customerPaid: !item.customerPaid },
      });
      await loadAll(false);
    });
  }

  async function refreshDetail(id) {
    await loadAll(false);
    await openDetail(id, false);
  }

  const stats = [
    ['ပေးရန်ကျန်ငွေ', money(dashboard.outstandingAmount), 'Open settlements', WalletCards, 'red'],
    ['Settlement မဝင်ရသေး', money(dashboard.unbatchedDue), `${dashboard.unbatchedJobs || 0} jobs`, Link2, 'orange'],
    ['ဖွင့်ထားသော Settlement', dashboard.openSettlements || 0, 'Draft / Confirmed / Partial', CalendarDays, 'blue'],
    ['Partner စုစုပေါင်းအမြတ်', money(dashboard.totalPartnerProfit), `Paid ${money(dashboard.totalPaid)}`, BadgeDollarSign, 'green'],
  ];

  return (
    <section className="psw-page">
      {error ? <div className="psw-error"><span>{error}</span><button type="button" onClick={() => setError('')}><X size={17} /></button></div> : null}

      <header className="psw-hero">
        <div>
          <span className="psw-eyebrow">PARTNER SHOP</span>
          <h2>Weekly Settlement Center</h2>
        </div>
        <div className="psw-actions">
          <button className="psw-button ghost" type="button" onClick={() => loadAll()}>
            <RefreshCw size={18} className={loading ? 'psw-spin' : ''} />Refresh
          </button>
          <button className="psw-button ghost" type="button" onClick={() => apiDownload('/api/partner-settlements/export.csv', 'partner-settlements.csv')}>
            <Download size={18} />CSV
          </button>
          <button className="psw-button primary" type="button" onClick={() => setShowPartnerForm(true)}>
            <Store size={18} />Add Partner Shop
          </button>
          {providerLinks.length ? (
            <>
              <button className="psw-button ghost" type="button" onClick={autoSync} disabled={busy === 'sync'}>
                {busy === 'sync' ? <Loader2 className="psw-spin" size={18} /> : <Link2 size={18} />}Sync Completed
              </button>
              <button className="psw-button primary" type="button" onClick={() => setShowGenerate(true)}>
                <Plus size={18} />New Settlement
              </button>
            </>
          ) : null}
        </div>
      </header>

      <div className="psw-stats">
        {stats.map(([label, value, note, Icon, tone]) => (
          <article className="psw-stat" key={label}>
            <div className={`psw-stat-icon ${tone}`}><Icon size={22} /></div>
            <div><span>{label}</span><strong>{value}</strong><small>{note}</small></div>
          </article>
        ))}
      </div>

      <div className="psw-toolbar">
        <div className="psw-tabs">
          <button className={tab === 'settlements' ? 'active' : ''} type="button" onClick={() => setTab('settlements')}>Weekly Settlements <b>{settlements.length}</b></button>
          <button className={tab === 'ledger' ? 'active' : ''} type="button" onClick={() => setTab('ledger')}>Repair Ledger <b>{ledger.length}</b></button>
          <button className={tab === 'partners' ? 'active' : ''} type="button" onClick={() => setTab('partners')}>Partner Shops <b>{partners.length}</b></button>
        </div>
        <label className="psw-search"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search..." /></label>
      </div>

      {loading ? (
        <div className="psw-loading"><Loader2 className="psw-spin" />Loading partner settlements…</div>
      ) : (
        <PartnerSettlementTables
          tab={tab}
          settlements={filtered(settlements)}
          ledger={filtered(ledger)}
          partners={filtered(partners)}
          busy={busy}
          onOpen={openDetail}
          onMarkPaid={markPaid}
        />
      )}

      {showPartnerForm ? (
        <div className="psw-modal-backdrop">
          <form className="psw-modal" onSubmit={createPartner}>
            <header>
              <div><span className="psw-eyebrow">ADD PARTNER SHOP</span><h3>Tenant Shop ချိတ်မယ်</h3></div>
              <button type="button" onClick={() => setShowPartnerForm(false)}><X /></button>
            </header>
            <label>
              <span>Tenant ID / Shop Slug</span>
              <input value={partnerForm.partnerShopSlug} onChange={(event) => setPartnerForm({ ...partnerForm, partnerShopSlug: event.target.value })} placeholder="talent-shop / test-2" required />
            </label>
            <div className="psw-form-grid">
              <label>
                <span>Partner Code</span>
                <input value={partnerForm.partnerCode} onChange={(event) => setPartnerForm({ ...partnerForm, partnerCode: event.target.value.toUpperCase() })} placeholder="TL / TEST2" required />
              </label>
              <label>
                <span>Display Name</span>
                <input value={partnerForm.displayName} onChange={(event) => setPartnerForm({ ...partnerForm, displayName: event.target.value })} placeholder="Talent Mobile" required />
              </label>
            </div>
            <div className="psw-form-grid">
              <label>
                <span>Weekly Settlement Day</span>
                <select value={partnerForm.settlementWeekday} onChange={(event) => setPartnerForm({ ...partnerForm, settlementWeekday: event.target.value })}>
                  <option value="1">Monday</option>
                  <option value="2">Tuesday</option>
                  <option value="3">Wednesday</option>
                  <option value="4">Thursday</option>
                  <option value="5">Friday</option>
                  <option value="6">Saturday</option>
                  <option value="0">Sunday</option>
                </select>
              </label>
              <label>
                <span>Partner Profit %</span>
                <input type="number" min="0" max="100" value={partnerForm.defaultPartnerProfitPercent} onChange={(event) => setPartnerForm({ ...partnerForm, defaultPartnerProfitPercent: event.target.value })} />
              </label>
            </div>
            <label>
              <span>Provider Due / Fixed Fee</span>
              <input type="number" min="0" value={partnerForm.defaultProviderFee} onChange={(event) => setPartnerForm({ ...partnerForm, defaultProviderFee: event.target.value })} placeholder="0 ဆို report/API amount ကိုယူမယ်" />
            </label>
            <label className="psw-check-row">
              <input type="checkbox" checked={partnerForm.customerPaysPartner} onChange={(event) => setPartnerForm({ ...partnerForm, customerPaysPartner: event.target.checked })} />
              <span>Customer က partner shop ဘက်မှာငွေရှင်းမယ်</span>
            </label>
            <div className="psw-modal-actions">
              <button type="button" className="psw-button ghost" onClick={() => setShowPartnerForm(false)}>Cancel</button>
              <button className="psw-button primary" disabled={busy === 'partner:create'}>
                {busy === 'partner:create' ? <Loader2 className="psw-spin" size={18} /> : <Store size={18} />}Add Partner Shop
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {showGenerate ? (
        <div className="psw-modal-backdrop">
          <form className="psw-modal" onSubmit={generate}>
            <header>
              <div><span className="psw-eyebrow">NEW WEEKLY SETTLEMENT</span><h3>Generate Settlement</h3></div>
              <button type="button" onClick={() => setShowGenerate(false)}><X /></button>
            </header>
            <label>
              <span>Partner Shop</span>
              <select value={period.partnerLinkId} onChange={(event) => setPeriod({ ...period, partnerLinkId: event.target.value })} required>
                <option value="">Select partner</option>
                {providerLinks.map((partner) => <option value={partner.id} key={partner.id}>{partner.displayName} ({partner.partnerCode})</option>)}
              </select>
            </label>
            <div className="psw-form-grid">
              <label><span>Period Start</span><input type="date" value={period.periodStart} onChange={(event) => setPeriod({ ...period, periodStart: event.target.value })} required /></label>
              <label><span>Period End</span><input type="date" value={period.periodEnd} onChange={(event) => setPeriod({ ...period, periodEnd: event.target.value })} required /></label>
            </div>
            <label><span>Note</span><textarea rows="3" value={period.notes} onChange={(event) => setPeriod({ ...period, notes: event.target.value })} /></label>
            <div className="psw-modal-actions">
              <button type="button" className="psw-button ghost" onClick={() => setShowGenerate(false)}>Cancel</button>
              <button className="psw-button primary" disabled={busy === 'generate'}>{busy === 'generate' ? <Loader2 className="psw-spin" size={18} /> : <Plus size={18} />}Generate</button>
            </div>
          </form>
        </div>
      ) : null}

      <PartnerSettlementDetail data={detail} onClose={() => setDetail(null)} onRefresh={refreshDetail} onError={setError} />
    </section>
  );
}
