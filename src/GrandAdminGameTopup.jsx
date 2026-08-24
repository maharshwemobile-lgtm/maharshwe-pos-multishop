import React, { useEffect, useState } from 'react';
import { ChevronDown, Gamepad2, Loader2, RefreshCw, Search, Wallet } from 'lucide-react';
import { apiFetch } from './phase2Api';
import './grand-admin-game-topup.css';

const money = (value) => `${Number(value || 0).toLocaleString('en-US')} MMK`;

function VariationRow({ variation, onSave }) {
  const [shopCost, setShopCost] = useState(String(variation.shopCost));
  const [suggestedRetail, setSuggestedRetail] = useState(String(variation.suggestedRetail));
  const [busy, setBusy] = useState(false);
  const dirty = Number(shopCost) !== variation.shopCost || Number(suggestedRetail) !== variation.suggestedRetail;

  const save = async () => {
    setBusy(true);
    try {
      await onSave(variation.id, { shopCost: Number(shopCost), suggestedRetail: Number(suggestedRetail) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <tr className={variation.active ? '' : 'gt-admin-inactive-row'}>
      <td><b>{variation.name}</b><span>MooGold: {money(variation.moogoldPrice)}</span></td>
      <td><input type="number" min="0" value={shopCost} onChange={(event) => setShopCost(event.target.value)} /></td>
      <td><input type="number" min="0" value={suggestedRetail} onChange={(event) => setSuggestedRetail(event.target.value)} /></td>
      <td>{money(Math.max(0, Number(suggestedRetail || 0) - Number(shopCost || 0)))}</td>
      <td>
        <button type="button" disabled={!dirty || busy} onClick={save}>{busy ? <Loader2 className="grand-spin" size={14} /> : 'Save'}</button>
        <button type="button" onClick={() => onSave(variation.id, { active: !variation.active })}>{variation.active ? 'Hide' : 'Show'}</button>
      </td>
    </tr>
  );
}

const CATALOG_PAGE_SIZE = 5;

function CatalogPanel({ notify }) {
  const [catalog, setCatalog] = useState({ configured: false, products: [], page: 1, totalPages: 1, total: 0 });
  const [loading, setLoading] = useState(false);
  const [categoryId, setCategoryId] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [productId, setProductId] = useState('');
  const [productCategoryId, setProductCategoryId] = useState('');
  const [syncingProduct, setSyncingProduct] = useState(false);
  // The USD/MMK rate a sync converts a brand-new package's price with. Only
  // future syncs use it — an existing package's price is the admin's own
  // decision and a rate change never rewrites it.
  const [rate, setRate] = useState('');
  const [savedRate, setSavedRate] = useState(null);
  const [savingRate, setSavingRate] = useState(false);
  // 500+ games and thousands of packages is too heavy to hand over in one
  // response, so this is paged and searched by name rather than loaded whole
  // — "top" (highest completed sales) is already the server's sort order, so
  // page 1 with no search is the best-selling games without asking for them.
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  // Packages stay collapsed until a product is opened — 5 products can each
  // carry dozens of packages, and showing every table at once is exactly the
  // sprawl a 5-per-page catalog was meant to avoid.
  const [expandedId, setExpandedId] = useState(null);

  const load = async (targetPage = page, targetSearch = search) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(targetPage), pageSize: String(CATALOG_PAGE_SIZE) });
      if (targetSearch.trim()) params.set('search', targetSearch.trim());
      setCatalog(await apiFetch(`/api/grand-admin/game-topup/catalog?${params}`));
    } catch (error) {
      notify(error.message || 'Catalog load failed', 'error');
    } finally {
      setLoading(false);
    }
  };

  const loadRate = async () => {
    try {
      const result = await apiFetch('/api/grand-admin/game-topup/settings');
      setRate(String(result.usdToMmkRate));
      setSavedRate(result.usdToMmkRate);
    } catch (error) {
      notify(error.message || 'Rate load failed', 'error');
    }
  };

  useEffect(() => { load(1, search); loadRate(); }, []);

  // Debounced: a search box that refetches on every keystroke would hammer a
  // 500+ row table for nothing.
  useEffect(() => {
    const timer = window.setTimeout(() => { setPage(1); setExpandedId(null); load(1, search); }, 350);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const goToPage = (nextPage) => {
    const clamped = Math.max(1, Math.min(catalog.totalPages || 1, nextPage));
    setPage(clamped);
    setExpandedId(null);
    load(clamped, search);
  };

  const saveRate = async (event) => {
    event.preventDefault();
    const value = Number(rate);
    if (!(value > 0)) return notify('နှုန်း မှန်ကန်စွာ ထည့်ပါ', 'error');
    setSavingRate(true);
    try {
      const result = await apiFetch('/api/grand-admin/game-topup/settings', { method: 'PATCH', body: { usdToMmkRate: value } });
      setSavedRate(result.usdToMmkRate);
      notify(`နှုန်း ${result.usdToMmkRate.toLocaleString('en-US')} Ks/$ အဖြစ် သိမ်းပြီးပါပြီ — Sync အသစ်တွေမှာသာ သက်ရောက်ပါမယ်`, 'success');
    } catch (error) {
      notify(error.message || 'Rate update failed', 'error');
    } finally {
      setSavingRate(false);
    }
  };

  const syncCategory = async (event) => {
    event.preventDefault();
    if (!categoryId.trim()) return;
    setSyncing(true);
    try {
      const result = await apiFetch('/api/grand-admin/game-topup/sync-category', { method: 'POST', body: { categoryId: categoryId.trim() } });
      const summary = result.summary || {};
      notify(`Sync ပြီးပါပြီ — ပစ္စည်း ${summary.productsSeen || 0}၊ အသစ် ${summary.productsAdded || 0}၊ Variation အသစ် ${summary.variationsAdded || 0}`, 'success');
      await load();
    } catch (error) {
      notify(error.message || 'Category sync failed', 'error');
    } finally {
      setSyncing(false);
    }
  };

  const syncProduct = async (event) => {
    event.preventDefault();
    if (!productId.trim()) return;
    setSyncingProduct(true);
    try {
      await apiFetch('/api/grand-admin/game-topup/sync-product', { method: 'POST', body: { productId: productId.trim(), categoryId: productCategoryId.trim() || undefined } });
      notify('Product sync ပြီးပါပြီ', 'success');
      setProductId('');
      await load();
    } catch (error) {
      notify(error.message || 'Product sync failed', 'error');
    } finally {
      setSyncingProduct(false);
    }
  };

  const saveVariation = async (variationId, patch) => {
    try {
      await apiFetch(`/api/grand-admin/game-topup/variations/${variationId}`, { method: 'PATCH', body: patch });
      await load();
    } catch (error) {
      notify(error.message || 'Update failed', 'error');
    }
  };

  const toggleProduct = async (productId, active) => {
    try {
      await apiFetch(`/api/grand-admin/game-topup/products/${productId}`, { method: 'PATCH', body: { active } });
      await load();
    } catch (error) {
      notify(error.message || 'Update failed', 'error');
    }
  };

  return (
    <div className="grand-card">
      <div className="grand-section-title">
        <b>Game Top-up Catalog</b>
        <span>MooGold ကနေ ဆိုင်တွေ ရောင်းလို့ရမယ့် ပစ္စည်းစာရင်း ဆွဲယူပါ။ shop_cost/suggested_retail က admin ကိုယ်တိုင် သတ်မှတ်ရပါမယ် — resync လုပ်တိုင်း မပြောင်းပါ။</span>
      </div>

      {!catalog.configured ? (
        <div className="gt-admin-notice">MOOGOLD_PARTNER_ID / MOOGOLD_SECRET ကို server .env မှာ ထည့်ပါ — Sync မလုပ်ခင် လိုအပ်ပါတယ်။</div>
      ) : null}

      <form className="gt-admin-rate-row" onSubmit={saveRate}>
        <label><span>USD → MMK နှုန်း (Sync အသစ်များအတွက်)</span>
          <input type="number" min="1" step="1" value={rate} onChange={(event) => setRate(event.target.value)} placeholder="ဥပမာ - 4500" />
        </label>
        <button type="submit" disabled={savingRate || !rate || Number(rate) === savedRate}>
          {savingRate ? <Loader2 className="grand-spin" size={15} /> : null} နှုန်း သိမ်းမည်
        </button>
        {savedRate ? <span className="gt-admin-rate-current">လက်ရှိ — $1 = {savedRate.toLocaleString('en-US')} Ks</span> : null}
      </form>

      <div className="gt-admin-sync-row">
        <form onSubmit={syncCategory}>
          <label><span>Category ID (bulk sync)</span><input value={categoryId} onChange={(event) => setCategoryId(event.target.value)} placeholder="ဥပမာ - mobile-legends" /></label>
          <button type="submit" disabled={syncing || !categoryId.trim()}>{syncing ? <Loader2 className="grand-spin" size={15} /> : <RefreshCw size={15} />} Sync Category</button>
        </form>
        <form onSubmit={syncProduct}>
          <label><span>Product ID (single)</span><input value={productId} onChange={(event) => setProductId(event.target.value)} placeholder="MooGold product ID" /></label>
          <label><span>Category ID (first sync only)</span><input value={productCategoryId} onChange={(event) => setProductCategoryId(event.target.value)} placeholder="Optional after first sync" /></label>
          <button type="submit" disabled={syncingProduct || !productId.trim()}>{syncingProduct ? <Loader2 className="grand-spin" size={15} /> : <RefreshCw size={15} />} Sync Product</button>
        </form>
      </div>

      <div className="gt-admin-search-row">
        <label>
          <Search size={15} />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Game နာမည် ဒါမှမဟုတ် MooGold Product ID ရှာပါ…" />
        </label>
        <span className="gt-admin-total">{catalog.total ? `ပစ္စည်း ${catalog.total} ခု — ရောင်းအားများသည် အပေါ်ဆုံးမှာ` : null}</span>
      </div>

      {loading ? <div className="grand-empty"><Loader2 className="grand-spin" size={18} /></div> : null}
      {!loading && !catalog.products.length ? (
        <div className="grand-empty">{search.trim() ? 'ရှာဖွေမှု နှင့် ကိုက်ညီသော ပစ္စည်း မတွေ့ပါ' : 'ပစ္စည်း မရှိသေးပါ — Category ID နဲ့ Sync လုပ်ပါ'}</div>
      ) : null}

      {catalog.products.map((product) => {
        const open = expandedId === product.id;
        return (
          <div className={`gt-admin-product ${open ? 'expanded' : ''}`} key={product.id}>
            <button type="button" className="gt-admin-product-toggle" onClick={() => setExpandedId(open ? null : product.id)} aria-expanded={open}>
              {product.imageUrl ? <img src={product.imageUrl} alt={product.name} /> : <div className="gt-admin-icon"><Gamepad2 size={18} /></div>}
              <div>
                <b>{product.name}</b>
                <span>{product.moogoldProductId} · Category {product.moogoldCategoryId} · {product.requiresPlayerId ? 'Player ID' : ''}{product.requiresServer ? ' + Server' : ''} · ရောင်းပြီး {product.salesCount || 0} · Package {product.variations.length}</span>
              </div>
              <ChevronDown size={18} className="gt-admin-chevron" />
            </button>
            {open ? (
              <>
                <div className="gt-admin-product-actions">
                  <button type="button" onClick={() => toggleProduct(product.id, !product.active)}>{product.active ? 'Product ဖျောက်မယ်' : 'Product ပြမယ်'}</button>
                </div>
                <div className="grand-table-wrap">
                  <table className="grand-table">
                    <thead><tr><th>Variation</th><th>Wallet ကို ကုန်ကျစျေး (shop_cost)</th><th>Shop သုံးမယ့် အကြံပြု ရောင်းစျေး</th><th>အမြတ်</th><th /></tr></thead>
                    <tbody>
                      {product.variations.map((variation) => <VariationRow key={variation.id} variation={variation} onSave={saveVariation} />)}
                      {!product.variations.length ? <tr><td colSpan={5} className="grand-empty">Variation မရှိပါ</td></tr> : null}
                    </tbody>
                  </table>
                </div>
              </>
            ) : null}
          </div>
        );
      })}

      {catalog.totalPages > 1 ? (
        <div className="gt-admin-pager">
          <button type="button" onClick={() => goToPage(page - 1)} disabled={loading || page <= 1}>‹ နောက်ကျ</button>
          <span>စာမျက်နှာ {page} / {catalog.totalPages}</span>
          <button type="button" onClick={() => goToPage(page + 1)} disabled={loading || page >= catalog.totalPages}>ရှေ့ ›</button>
        </div>
      ) : null}
    </div>
  );
}

function WalletAdjustForm({ shopId, onDone, onCancel }) {
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event) => {
    event.preventDefault();
    if (!amount || !note.trim()) return setError('ပမာဏနဲ့ အကြောင်းပြချက် နှစ်ခုလုံး ထည့်ပါ');
    setBusy(true);
    setError('');
    try {
      await apiFetch(`/api/grand-admin/game-topup/wallets/${shopId}/adjust`, { method: 'POST', body: { amount: Number(amount), note: note.trim() } });
      onDone();
    } catch (requestError) {
      setError(requestError.message || 'Adjust failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="gt-admin-wallet-adjust" onSubmit={submit}>
      {error ? <div className="gt-admin-notice">{error}</div> : null}
      <input type="number" placeholder="ပမာဏ (ဖြည့်ရင် + ၊ နုတ်ရင် -)" value={amount} onChange={(event) => setAmount(event.target.value)} autoFocus />
      <input placeholder="အကြောင်းပြချက် (ဥပမာ - KBZ Pay ဖြင့် ငွေဖြည့်)" value={note} onChange={(event) => setNote(event.target.value)} />
      <button type="submit" disabled={busy}>{busy ? <Loader2 className="grand-spin" size={14} /> : 'Confirm'}</button>
      <button type="button" onClick={onCancel}>Cancel</button>
    </form>
  );
}

function WalletsPanel({ notify }) {
  const [wallets, setWallets] = useState([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [adjusting, setAdjusting] = useState('');
  const [moogoldBalance, setMoogoldBalance] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const [walletsData, balanceData] = await Promise.all([
        apiFetch(`/api/grand-admin/game-topup/wallets${query.trim() ? `?q=${encodeURIComponent(query.trim())}` : ''}`),
        apiFetch('/api/grand-admin/game-topup/moogold-balance'),
      ]);
      setWallets(walletsData.wallets || []);
      setMoogoldBalance(balanceData);
    } catch (error) {
      notify(error.message || 'Wallet list failed', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  return (
    <div className="grand-card">
      <div className="grand-section-title">
        <b>Shop Wallets</b>
        <span>ဆိုင်တွေ KBZ Pay နဲ့ ငွေလွှဲပြီးရင် ဒီမှာ Wallet ကို manual ဖြည့်ပေးပါ။</span>
      </div>

      <div className="gt-admin-moogold-balance">
        <Wallet size={20} />
        {moogoldBalance?.configured ? (
          <div><span>Platform ရဲ့ MooGold Balance</span><b>{moogoldBalance.currency} {Number(moogoldBalance.balance || 0).toLocaleString('en-US')}</b></div>
        ) : (
          <div><span>MooGold Balance</span><b>Not configured</b></div>
        )}
      </div>

      <div className="grand-toolbar">
        <label><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && load()} placeholder="ဆိုင်နာမည် / Slug ရှာရန်" /></label>
        <button type="button" onClick={load}>{loading ? <Loader2 className="grand-spin" size={15} /> : <RefreshCw size={15} />} Search</button>
      </div>

      <div className="grand-table-wrap">
        <table className="grand-table">
          <thead><tr><th>Shop</th><th>Wallet Balance</th><th>နောက်ဆုံးပြောင်း</th><th /></tr></thead>
          <tbody>
            {wallets.map((wallet) => (
              <React.Fragment key={wallet.shopId}>
                <tr>
                  <td><b>{wallet.shopName}</b><span>{wallet.slug}</span></td>
                  <td className={wallet.balance <= 0 ? 'gt-admin-zero' : ''}><b>{money(wallet.balance)}</b></td>
                  <td>{wallet.updatedAt ? new Date(wallet.updatedAt).toLocaleString() : '-'}</td>
                  <td><button type="button" onClick={() => setAdjusting(adjusting === wallet.shopId ? '' : wallet.shopId)}>{adjusting === wallet.shopId ? 'Close' : 'ငွေဖြည့်/နှုတ်'}</button></td>
                </tr>
                {adjusting === wallet.shopId ? (
                  <tr><td colSpan={4}>
                    <WalletAdjustForm shopId={wallet.shopId} onCancel={() => setAdjusting('')} onDone={() => { setAdjusting(''); load(); notify(`${wallet.shopName} wallet ပြင်ပြီးပါပြီ`, 'success'); }} />
                  </td></tr>
                ) : null}
              </React.Fragment>
            ))}
            {!wallets.length && !loading ? <tr><td colSpan={4} className="grand-empty">Shop မတွေ့ပါ</td></tr> : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PublicOrdersPanel({ notify }) {
  const [orders, setOrders] = useState([]);
  const [telegramConfigured, setTelegramConfigured] = useState(false);
  const [loading, setLoading] = useState(false);
  // 'pending' | 'refunded' | 'all' — refunded is its own view because it is
  // the one status that still needs a human action (send the KBZ Pay refund)
  // after the order is otherwise finished.
  const [view, setView] = useState('pending');
  const [acting, setActing] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const status = view === 'pending' ? 'PENDING_APPROVAL' : view === 'refunded' ? 'REFUNDED' : '';
      const data = await apiFetch(`/api/grand-admin/game-topup/public-orders${status ? `?status=${status}` : ''}`);
      setOrders(data.orders || []);
      setTelegramConfigured(Boolean(data.telegramConfigured));
    } catch (error) {
      notify(error.message || 'Order list failed', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [view]);

  const approve = async (order) => {
    if (!window.confirm(`${order.orderNumber} — ငွေရောက်ကြောင်း KBZ Pay မှာ စစ်ပြီးပြီလား? Approve လုပ်ရင် ချက်ချင်း ဖြည့်ပေးပါမယ်။`)) return;
    setActing(order.id);
    try {
      const result = await apiFetch(`/api/grand-admin/game-topup/public-orders/${order.id}/approve`, { method: 'POST' });
      notify(result.message || 'Approved', 'success');
      await load();
    } catch (error) {
      notify(error.message || 'Approve failed', 'error');
    } finally {
      setActing('');
    }
  };

  const reject = async (order) => {
    const reason = window.prompt('ငြင်းပယ်ရသည့် အကြောင်းပြချက်', 'ငွေလက်ခံရရှိမှု အတည်မပြုနိုင်ပါ');
    if (reason === null) return;
    setActing(order.id);
    try {
      const result = await apiFetch(`/api/grand-admin/game-topup/public-orders/${order.id}/reject`, { method: 'POST', body: { reason } });
      notify(result.message || 'Rejected', 'success');
      await load();
    } catch (error) {
      notify(error.message || 'Reject failed', 'error');
    } finally {
      setActing('');
    }
  };

  // REFUNDED means MooGold could not fulfil an order that already took the
  // customer's KBZ Pay money — that transfer back has to happen by hand, and
  // this only records that it did.
  const markRefundSent = async (order) => {
    if (!window.confirm(`${order.orderNumber} — ${order.customerPhone} ဆီကို ${money(order.retailPrice)} KBZ Pay နဲ့ ပြန်လွှဲပြီးပြီလား?`)) return;
    setActing(order.id);
    try {
      const result = await apiFetch(`/api/grand-admin/game-topup/public-orders/${order.id}/refund-sent`, { method: 'POST' });
      notify(result.message || 'Marked as refunded', 'success');
      await load();
    } catch (error) {
      notify(error.message || 'Update failed', 'error');
    } finally {
      setActing('');
    }
  };

  const registerWebhook = async () => {
    try {
      const result = await apiFetch('/api/grand-admin/game-topup/telegram/set-webhook', { method: 'POST' });
      notify(`Webhook registered: ${result.url}`, 'success');
    } catch (error) {
      notify(error.message || 'setWebhook failed', 'error');
    }
  };

  return (
    <div className="grand-card">
      <div className="grand-section-title">
        <b>Game Top-up — Public Orders</b>
        <span>ဖောက်သည်တွေ တိုက်ရိုက် တင်တဲ့ အော်ဒါများ။ KBZ Pay မှာ ငွေရောက်မရောက် စစ်ပြီးမှ Approve နှိပ်ပါ။</span>
      </div>

      {!telegramConfigured ? (
        <div className="gt-admin-notice">Telegram bot မထည့်ရသေးပါ (GAME_TOPUP_BOT_TOKEN / GAME_TOPUP_ADMIN_CHAT_IDS) — အော်ဒါတွေကို ဒီစာမျက်နှာကနေပဲ approve လုပ်ရပါမယ်။</div>
      ) : null}

      <div className="grand-toolbar">
        <div className="gt-admin-view-switch">
          <button type="button" className={view === 'pending' ? 'active' : ''} onClick={() => setView('pending')}>စောင့်ဆိုင်းဆဲ</button>
          <button type="button" className={view === 'refunded' ? 'active' : ''} onClick={() => setView('refunded')}>ပြန်ပေးရန် ကျန်</button>
          <button type="button" className={view === 'all' ? 'active' : ''} onClick={() => setView('all')}>အားလုံး</button>
        </div>
        <button type="button" onClick={load}>{loading ? <Loader2 className="grand-spin" size={15} /> : <RefreshCw size={15} />} Refresh</button>
        {telegramConfigured ? <button type="button" onClick={registerWebhook}>Telegram Webhook ချိတ်မည်</button> : null}
      </div>

      <div className="grand-table-wrap">
        <table className="grand-table">
          <thead><tr><th>Order</th><th>ပစ္စည်း</th><th>Player ID</th><th>ဖောက်သည်</th><th>ပမာဏ</th><th>Txn ၄ လုံး</th><th>Status</th><th /></tr></thead>
          <tbody>
            {orders.map((order) => (
              <tr key={order.id}>
                <td><b>{order.orderNumber}</b><span>{new Date(order.createdAt).toLocaleString()}</span></td>
                <td>{order.productName}<span>{order.variationName} × {order.quantity}</span></td>
                <td>{order.playerId || '-'}{order.serverId ? <span>Server {order.serverId}</span> : null}</td>
                <td>{order.customerName || '-'}<span>{order.customerPhone}</span></td>
                <td><b>{money(order.retailPrice)}</b></td>
                <td>
                  <code className="gt-admin-txn">{order.paymentTransactionId}</code>
                  {order.sameTxnCount > 1 ? <span className="gt-admin-dup">⚠️ {order.sameTxnCount} ကြိမ် — ပမာဏ/အချိန် တိုက်စစ်ပါ</span> : null}
                </td>
                <td>
                  <i className={order.status === 'COMPLETED' ? 'green' : order.status === 'PENDING_APPROVAL' ? 'blue' : 'red'}>{order.status}</i>
                  {order.rejectReason ? <span>{order.rejectReason}</span> : null}
                  {order.failureReason ? <span>{order.failureReason}</span> : null}
                  {order.status === 'REFUNDED' ? (
                    order.refundSentAt
                      ? <span className="gt-admin-refund-done">✅ ငွေ ပြန်ပေးပြီး — {new Date(order.refundSentAt).toLocaleString()}</span>
                      : <span className="gt-admin-refund-owed">⚠️ ဖောက်သည်ကို {money(order.retailPrice)} ပြန်ပေးရန် ကျန်</span>
                  ) : null}
                </td>
                <td>
                  {order.status === 'PENDING_APPROVAL' ? (
                    <>
                      <button type="button" disabled={acting === order.id} onClick={() => approve(order)}>
                        {acting === order.id ? <Loader2 className="grand-spin" size={14} /> : 'Approve'}
                      </button>
                      <button type="button" disabled={acting === order.id} onClick={() => reject(order)}>Reject</button>
                    </>
                  ) : null}
                  {order.status === 'REFUNDED' && !order.refundSentAt ? (
                    <button type="button" disabled={acting === order.id} onClick={() => markRefundSent(order)}>
                      {acting === order.id ? <Loader2 className="grand-spin" size={14} /> : 'ငွေပြန်ပေးပြီး'}
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
            {!orders.length && !loading ? (
              <tr><td colSpan={8} className="grand-empty">
                {view === 'pending' ? 'စောင့်ဆိုင်းနေတဲ့ အော်ဒါ မရှိပါ' : view === 'refunded' ? 'ပြန်ပေးရန် ကျန်နေတဲ့ Refund မရှိပါ' : 'အော်ဒါ မရှိသေးပါ'}
              </td></tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function GrandAdminGameTopup() {
  const [message, setMessage] = useState(null);
  const notify = (text, type = 'success') => setMessage({ text, type });

  useEffect(() => {
    if (!message) return undefined;
    const timer = window.setTimeout(() => setMessage(null), 5000);
    return () => window.clearTimeout(timer);
  }, [message]);

  return (
    <>
      {message ? <div className={`grand-toast ${message.type}`}>{message.text}</div> : null}
      <PublicOrdersPanel notify={notify} />
      <CatalogPanel notify={notify} />
      <WalletsPanel notify={notify} />
    </>
  );
}
