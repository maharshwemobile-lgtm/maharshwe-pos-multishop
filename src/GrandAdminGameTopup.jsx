import React, { useEffect, useState } from 'react';
import { Gamepad2, Loader2, RefreshCw, Search, Wallet } from 'lucide-react';
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

function CatalogPanel({ notify }) {
  const [catalog, setCatalog] = useState({ configured: false, products: [] });
  const [loading, setLoading] = useState(false);
  const [categoryId, setCategoryId] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [productId, setProductId] = useState('');
  const [productCategoryId, setProductCategoryId] = useState('');
  const [syncingProduct, setSyncingProduct] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      setCatalog(await apiFetch('/api/grand-admin/game-topup/catalog'));
    } catch (error) {
      notify(error.message || 'Catalog load failed', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

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

      {loading ? <div className="grand-empty"><Loader2 className="grand-spin" size={18} /></div> : null}
      {!loading && !catalog.products.length ? <div className="grand-empty">ပစ္စည်း မရှိသေးပါ — Category ID နဲ့ Sync လုပ်ပါ</div> : null}

      {catalog.products.map((product) => (
        <div className="gt-admin-product" key={product.id}>
          <header>
            <div>
              {product.imageUrl ? <img src={product.imageUrl} alt={product.name} /> : <div className="gt-admin-icon"><Gamepad2 size={18} /></div>}
              <div>
                <b>{product.name}</b>
                <span>{product.moogoldProductId} · Category {product.moogoldCategoryId} · {product.requiresPlayerId ? 'Player ID' : ''}{product.requiresServer ? ' + Server' : ''}</span>
              </div>
            </div>
            <button type="button" onClick={() => toggleProduct(product.id, !product.active)}>{product.active ? 'Product ဖျောက်မယ်' : 'Product ပြမယ်'}</button>
          </header>
          <div className="grand-table-wrap">
            <table className="grand-table">
              <thead><tr><th>Variation</th><th>Wallet ကို ကုန်ကျစျေး (shop_cost)</th><th>Shop သုံးမယ့် အကြံပြု ရောင်းစျေး</th><th>အမြတ်</th><th /></tr></thead>
              <tbody>
                {product.variations.map((variation) => <VariationRow key={variation.id} variation={variation} onSave={saveVariation} />)}
                {!product.variations.length ? <tr><td colSpan={5} className="grand-empty">Variation မရှိပါ</td></tr> : null}
              </tbody>
            </table>
          </div>
        </div>
      ))}
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
  const [onlyPending, setOnlyPending] = useState(true);
  const [acting, setActing] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const data = await apiFetch(`/api/grand-admin/game-topup/public-orders${onlyPending ? '?status=PENDING_APPROVAL' : ''}`);
      setOrders(data.orders || []);
      setTelegramConfigured(Boolean(data.telegramConfigured));
    } catch (error) {
      notify(error.message || 'Order list failed', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [onlyPending]);

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
        <label className="gt-admin-checkbox">
          <input type="checkbox" checked={onlyPending} onChange={(event) => setOnlyPending(event.target.checked)} />
          <span>စောင့်ဆိုင်းဆဲသာ ပြမည်</span>
        </label>
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
                </td>
              </tr>
            ))}
            {!orders.length && !loading ? <tr><td colSpan={8} className="grand-empty">{onlyPending ? 'စောင့်ဆိုင်းနေတဲ့ အော်ဒါ မရှိပါ' : 'အော်ဒါ မရှိသေးပါ'}</td></tr> : null}
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
