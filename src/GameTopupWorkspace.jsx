import React, { useEffect, useState } from 'react';
import { Gamepad2, Loader2, RefreshCw, Wallet, X } from 'lucide-react';
import { apiFetch } from './phase2Api';
import './game-topup-workspace.css';

const money = (value) => `${Number(value || 0).toLocaleString('en-US')} ကျပ်`;

function formatDate(value) {
  if (!value) return '-';
  try {
    return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
  } catch {
    return String(value);
  }
}

function StorefrontPriceRow({ product, variation, onSaved }) {
  const [value, setValue] = useState(String(variation.storefrontRetail ?? variation.platformRetail));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const overridden = variation.storefrontRetail != null;
  // A 0/blank price would let customers order for free on this shop's own
  // storefront — same rule as the platform catalog's price editor.
  const validPrice = Number(value) > 0;

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      const result = await apiFetch(`/api/game-topup/storefront-prices/${variation.id}`, {
        method: 'PUT', body: { retailPrice: Number(value) },
      });
      onSaved(variation.id, result.storefrontRetail);
    } catch (err) {
      setError(err.message || 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    setBusy(true);
    try {
      await apiFetch(`/api/game-topup/storefront-prices/${variation.id}`, { method: 'PUT', body: {} });
      setValue(String(variation.platformRetail));
      onSaved(variation.id, null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <tr>
      <td>{product.name}<small>{variation.name}</small></td>
      <td>{money(variation.platformRetail)}</td>
      <td>
        <input type="number" min="1" value={value} onChange={(event) => setValue(event.target.value)} />
        {error ? <small className="gt-price-error">{error}</small> : null}
      </td>
      <td>
        <button type="button" disabled={busy || !validPrice || Number(value) === (variation.storefrontRetail ?? variation.platformRetail)} onClick={save}>Save</button>
        {overridden ? <button type="button" disabled={busy} onClick={reset}>ပလက်ဖောင်းစျေးသို့</button> : null}
      </td>
    </tr>
  );
}

function StorefrontPricingPanel() {
  const [open, setOpen] = useState(false);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const result = await apiFetch('/api/game-topup/storefront-prices');
      setProducts(result.products || []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (open && !products.length) load(); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const onSaved = (variationId, storefrontRetail) => {
    setProducts((current) => current.map((product) => ({
      ...product,
      variations: product.variations.map((variation) => variation.id === variationId ? { ...variation, storefrontRetail } : variation),
    })));
  };

  return (
    <section className="gt-pricing-panel">
      <button type="button" className="gt-pricing-toggle" onClick={() => setOpen((value) => !value)}>
        {open ? '▾' : '▸'} ကိုယ်ပိုင် Online Shop ဈေးနှုန်း (Storefront Pricing)
      </button>
      {open ? (
        <div className="gt-table-wrap">
          <p className="gt-pricing-hint">
            ဒီနေရာမှာ ဈေးနှုန်း ပြင်ထားရင် သင့်ဆိုင်ရဲ့ Online Shop (/shop/…) ကနေ ဝယ်တဲ့ဖောက်သည်တွေအတွက်ပဲ သက်ရောက်ပါမယ် —
            ပလက်ဖောင်းရဲ့ /digital/ page ဈေးနှုန်း မပြောင်းပါ။
          </p>
          {loading ? <div className="gt-empty">Loading…</div> : (
            <table>
              <thead><tr><th>Package</th><th>ပလက်ဖောင်းဈေး</th><th>ကိုယ့်ဆိုင်ဈေး</th><th /></tr></thead>
              <tbody>
                {products.flatMap((product) => product.variations.map((variation) => (
                  <StorefrontPriceRow key={variation.id} product={product} variation={variation} onSaved={onSaved} />
                )))}
                {!products.length ? <tr><td colSpan={4} className="gt-empty-cell">Package မရှိသေးပါ</td></tr> : null}
              </tbody>
            </table>
          )}
        </div>
      ) : null}
    </section>
  );
}

function PaymentAndPublicOrdersPanel({ notify }) {
  const [open, setOpen] = useState(false);
  const [payment, setPayment] = useState({ kbzPayName: '', kbzPayPhone: '', kbzPayQrUrl: '', usingOwnAccount: false });
  const [savingPayment, setSavingPayment] = useState(false);
  const [view, setView] = useState('PENDING_APPROVAL');
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [acting, setActing] = useState('');

  const loadPayment = async () => {
    const result = await apiFetch('/api/game-topup/payment-settings');
    setPayment({ kbzPayName: result.kbzPayName || '', kbzPayPhone: result.kbzPayPhone || '', kbzPayQrUrl: result.kbzPayQrUrl || '', usingOwnAccount: result.usingOwnAccount });
  };
  const loadOrders = async () => {
    setLoading(true);
    try {
      const result = await apiFetch(`/api/game-topup/public-orders?status=${encodeURIComponent(view)}`);
      setOrders(result.orders || []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (open) { loadPayment(); loadOrders(); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (open) loadOrders(); }, [view]); // eslint-disable-line react-hooks/exhaustive-deps

  const savePayment = async (event) => {
    event.preventDefault();
    setSavingPayment(true);
    try {
      await apiFetch('/api/game-topup/payment-settings', { method: 'PUT', body: payment });
      await loadPayment();
      notify?.('KBZ Pay အချက်အလက် သိမ်းပြီးပါပြီ', 'success');
    } catch (error) {
      notify?.(error.message || 'Save failed', 'error');
    } finally {
      setSavingPayment(false);
    }
  };

  const approve = async (order) => {
    if (!window.confirm(`${order.orderNumber} — KBZ Pay ငွေလက်ခံရရှိကြောင်း စစ်ဆေးပြီးပြီလား?`)) return;
    setActing(order.id);
    try {
      await apiFetch(`/api/game-topup/public-orders/${order.id}/approve`, { method: 'POST' });
      notify?.(`${order.orderNumber} အတည်ပြုပြီးပါပြီ`, 'success');
      await loadOrders();
    } catch (error) {
      notify?.(error.message || 'Approve failed', 'error');
    } finally {
      setActing('');
    }
  };
  const reject = async (order) => {
    const reason = window.prompt('ငြင်းပယ်ရသည့် အကြောင်းပြချက်', 'ငွေလက်ခံရရှိမှု အတည်မပြုနိုင်ပါ');
    if (reason === null) return;
    setActing(order.id);
    try {
      await apiFetch(`/api/game-topup/public-orders/${order.id}/reject`, { method: 'POST', body: { reason } });
      notify?.(`${order.orderNumber} ငြင်းပယ်ပြီးပါပြီ`, 'success');
      await loadOrders();
    } catch (error) {
      notify?.(error.message || 'Reject failed', 'error');
    } finally {
      setActing('');
    }
  };

  return (
    <section className="gt-pricing-panel">
      <button type="button" className="gt-pricing-toggle" onClick={() => setOpen((value) => !value)}>
        {open ? '▾' : '▸'} ကိုယ်ပိုင် KBZ Pay & Online Shop Order (Approve/Reject)
      </button>
      {open ? (
        <div className="gt-table-wrap">
          <p className="gt-pricing-hint">
            ဒီနေရာမှာ KBZ Pay အချက်အလက် ဖြည့်ထားရင် သင့်ဆိုင်ရဲ့ Online Shop ကနေ ဝယ်တဲ့ဖောက်သည်တွေက သင့် KBZ Pay ကိုပဲ တိုက်ရိုက်လွှဲပေးမှာဖြစ်ပြီး،
            ဒီအော်ဒါတွေကို platform (Grand Admin) အစား သင့်ကိုယ်တိုင် Approve/Reject လုပ်ရမှာပါ — ငွေကို သင့်ဆီ တိုက်ရိုက်ရောက်လို့ပါ။
            မဖြည့်ထားဘူးဆိုရင် ပလက်ဖောင်း KBZ Pay နဲ့ Grand Admin ကပဲ ဆက်စီမံပေးနေပါလိမ့်မယ်။
          </p>
          <form className="gt-payment-form" onSubmit={savePayment}>
            <label>KBZ Pay အမည်<input value={payment.kbzPayName} onChange={(e) => setPayment({ ...payment, kbzPayName: e.target.value })} placeholder="ဥပမာ - Khun Myint Aung" /></label>
            <label>KBZ Pay နံပါတ်<input value={payment.kbzPayPhone} onChange={(e) => setPayment({ ...payment, kbzPayPhone: e.target.value })} placeholder="09xxxxxxxxx" /></label>
            <label>QR ပုံ Link (ရွေးချယ်ရန်)<input value={payment.kbzPayQrUrl} onChange={(e) => setPayment({ ...payment, kbzPayQrUrl: e.target.value })} placeholder="https://…" /></label>
            <button type="submit" disabled={savingPayment}>{savingPayment ? <Loader2 className="grand-spin" size={14} /> : null} သိမ်းမည်</button>
            <span className={`gt-payment-status ${payment.usingOwnAccount ? 'on' : 'off'}`}>{payment.usingOwnAccount ? '✅ ကိုယ်ပိုင် KBZ Pay သုံးနေသည်' : '⛔ ပလက်ဖောင်း KBZ Pay ကို သုံးနေသည်'}</span>
          </form>

          <div className="gt-order-view-switch">
            {[['PENDING_APPROVAL', 'စောင့်ဆိုင်း'], ['COMPLETED', 'ပြီးပြီး'], ['REJECTED', 'ငြင်းပယ်']].map(([value, label]) => (
              <button key={value} type="button" className={view === value ? 'active' : ''} onClick={() => setView(value)}>{label}</button>
            ))}
          </div>
          {loading ? <div className="gt-empty">Loading…</div> : (
            <table>
              <thead><tr><th>Order</th><th>Item</th><th>Player ID</th><th>ဖောက်သည်</th><th>ပမာဏ</th><th>Txn</th><th /></tr></thead>
              <tbody>
                {orders.map((order) => (
                  <tr key={order.id}>
                    <td><b>{order.orderNumber}</b><span>{new Date(order.createdAt).toLocaleString()}</span></td>
                    <td>{order.productName} · {order.variationName}</td>
                    <td>{order.playerId || '-'}{order.serverId ? ` · ${order.serverId}` : ''}</td>
                    <td>{order.customerName || '-'}</td>
                    <td>{money(order.retailPrice)}</td>
                    <td>{order.paymentTransactionId}</td>
                    <td>
                      {order.status === 'PENDING_APPROVAL' ? (
                        <div className="gt-order-actions">
                          <button type="button" disabled={acting === order.id} onClick={() => approve(order)}>Approve</button>
                          <button type="button" disabled={acting === order.id} onClick={() => reject(order)}>Reject</button>
                        </div>
                      ) : order.status === 'REJECTED' ? <span className="gt-status rejected">{order.rejectReason}</span> : null}
                    </td>
                  </tr>
                ))}
                {!orders.length ? <tr><td colSpan={7} className="gt-empty-cell">Order မရှိပါ</td></tr> : null}
              </tbody>
            </table>
          )}
        </div>
      ) : null}
    </section>
  );
}

function StatusBadge({ status }) {
  const label = { COMPLETED: 'ပြီး', FAILED: 'မအောင်မြင်', PENDING: 'စောင့်ဆိုင်း', PROCESSING: 'လုပ်ဆောင်နေ' }[status] || status;
  return <span className={`gt-status ${String(status || '').toLowerCase()}`}>{label}</span>;
}

function SellPanel({ product, variation, accounts, canSeeCost, onClose, onSold }) {
  const [form, setForm] = useState({
    quantity: 1,
    playerId: '',
    server: '',
    customerName: '',
    customerPhone: '',
    retailPrice: String(variation.suggestedRetail || 0),
    paymentAccountId: accounts[0]?.id || '',
  });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  // Confirms whose account the top-up is going to before staff take payment —
  // a mistyped id is unrecoverable, so the name appears on its own as soon as
  // there is enough to check rather than needing a button press.
  const [check, setCheck] = useState({ state: 'idle', username: '', country: '', message: '' });

  const quantity = Math.max(1, Number(form.quantity || 1));
  const unitCost = Number(variation.shopCost || 0);
  const totalCost = unitCost * quantity;
  const totalRetail = Number(form.retailPrice || 0);
  const profit = totalRetail - totalCost;
  const needsCheck = Boolean(product.requiresPlayerId);

  useEffect(() => {
    setCheck({ state: 'idle', username: '', country: '', message: '' });
    if (!needsCheck) return undefined;
    const playerId = form.playerId.trim();
    const server = form.server.trim();
    if (!playerId) return undefined;
    if (product.requiresServer && !server) return undefined;

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setCheck({ state: 'checking', username: '', country: '', message: '' });
      try {
        const response = await apiFetch('/api/game-topup/validate', {
          method: 'POST',
          body: { variationId: variation.id, playerId, server: server || undefined },
        });
        if (cancelled) return;
        setCheck(response.valid
          ? { state: 'valid', username: response.username, country: response.country, message: '' }
          : { state: 'invalid', username: '', country: '', message: response.message || 'အကောင့် မတွေ့ပါ' });
      } catch (error) {
        if (!cancelled) setCheck({ state: 'invalid', username: '', country: '', message: error.message || 'စစ်ဆေးလို့ မရပါ' });
      }
    }, 600);
    return () => { cancelled = true; window.clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.playerId, form.server]);

  const submit = async (event) => {
    event.preventDefault();
    setMessage('');
    if (product.requiresPlayerId && !form.playerId.trim()) return setMessage('Player ID ထည့်ပါ');
    if (product.requiresServer && !form.server.trim()) return setMessage('Server ထည့်ပါ');
    if (needsCheck && check.state !== 'valid') return setMessage('အကောင့်ကို အရင်စစ်ပါ — Player ID မှန်ကန်ကြောင်း Name ပေါ်လာမှ ဆက်ရောင်းပါ');
    if (!form.paymentAccountId) return setMessage('ငွေလက်ခံမည့် Account ရွေးပါ');
    setBusy(true);
    try {
      const response = await apiFetch('/api/game-topup/orders', {
        method: 'POST',
        body: {
          variationId: variation.id,
          quantity,
          playerId: form.playerId.trim() || undefined,
          server: form.server.trim() || undefined,
          customerName: form.customerName.trim() || undefined,
          customerPhone: form.customerPhone.trim() || undefined,
          retailPrice: totalRetail,
          paymentAccountId: form.paymentAccountId,
        },
      });
      onSold(response);
    } catch (error) {
      setMessage(error.message || 'Order မအောင်မြင်ပါ');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="gt-sell-form" onSubmit={submit}>
      <header>
        <div>
          <span>{product.name}</span>
          <h4>{variation.name}</h4>
        </div>
        <button type="button" onClick={onClose} aria-label="ပိတ်ရန်"><X size={17} /></button>
      </header>

      {message ? <div className="gt-message">{message}</div> : null}

      <div className="gt-form-row">
        <label><span>အရေအတွက်</span><input type="number" min="1" max="50" value={form.quantity} onChange={(event) => setForm({ ...form, quantity: event.target.value })} /></label>
        <label><span>ဖောက်သည်ထံ ရောင်းစျေး (စုစုပေါင်း) *</span><input type="number" min="0" value={form.retailPrice} onChange={(event) => setForm({ ...form, retailPrice: event.target.value })} /></label>
      </div>

      {product.requiresPlayerId ? <label><span>Player ID *</span><input value={form.playerId} onChange={(event) => setForm({ ...form, playerId: event.target.value })} placeholder="ဥပမာ - 123456789" autoFocus /></label> : null}
      {product.requiresServer ? <label><span>Server *</span><input value={form.server} onChange={(event) => setForm({ ...form, server: event.target.value })} placeholder="ဥပမာ - 2001" /></label> : null}
      {needsCheck && check.state !== 'idle' ? (
        <div className={`gt-account-check ${check.state}`}>
          {check.state === 'checking' ? 'အကောင့် စစ်ဆေးနေပါသည်…' : null}
          {check.state === 'valid' ? <>✅ <b>{check.username || 'Account'}</b>{check.country ? ` · ${check.country}` : ''}<small>ဒီအကောင့်သို့ ဖြည့်ပါမည် — မှန်မမှန် သေချာစစ်ပါ</small></> : null}
          {check.state === 'invalid' ? check.message : null}
        </div>
      ) : null}

      <div className="gt-form-row">
        <label><span>ဖောက်သည်နာမည် (Optional)</span><input value={form.customerName} onChange={(event) => setForm({ ...form, customerName: event.target.value })} /></label>
        <label><span>ဖုန်းနံပါတ် (Optional)</span><input value={form.customerPhone} onChange={(event) => setForm({ ...form, customerPhone: event.target.value })} /></label>
      </div>

      <label><span>ငွေလက်ခံမည့် Account *</span>
        <select value={form.paymentAccountId} onChange={(event) => setForm({ ...form, paymentAccountId: event.target.value })}>
          <option value="">ရွေးပါ</option>
          {accounts.map((account) => <option key={account.id} value={account.id}>{account.name} · {money(account.balance)}</option>)}
        </select>
      </label>

      <div className="gt-sell-summary">
        {canSeeCost ? <div><span>Wallet ကနေ နုတ်မည့် ပမာဏ</span><b>{money(totalCost)}</b></div> : null}
        <div className={profit < 0 ? 'negative' : ''}><span>အမြတ်</span><b>{money(profit)}</b></div>
      </div>

      <button type="submit" className="gt-submit" disabled={busy || (needsCheck && check.state !== 'valid')}>
        {busy ? <Loader2 className="gt-spin" size={17} /> : <Gamepad2 size={17} />}
        {needsCheck && check.state !== 'valid' ? 'အကောင့် အရင်စစ်ပါ' : 'ရောင်းမည်'}
      </button>
    </form>
  );
}

export default function GameTopupWorkspace() {
  const [settings, setSettings] = useState({ configured: false, wallet: { balance: 0 }, products: [], accounts: [] });
  const [orders, setOrders] = useState({ orders: [], total: 0, totalPages: 1 });
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [selection, setSelection] = useState(null);

  const canSeeCost = (settings.products[0]?.variations[0]?.shopCost !== undefined);

  const loadSettings = async () => setSettings(await apiFetch('/api/game-topup/settings'));
  const loadOrders = async () => setOrders(await apiFetch(`/api/game-topup/orders?page=${page}&limit=15`));

  const refresh = async () => {
    setLoading(true);
    setMessage('');
    try {
      await Promise.all([loadSettings(), loadOrders()]);
    } catch (error) {
      setMessage(error.message || 'Load failed');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); }, []);
  useEffect(() => { loadOrders().catch((error) => setMessage(error.message)); }, [page]);

  const onSold = async (response) => {
    setSelection(null);
    setMessage(`${response.order?.orderNumber || ''} ရောင်းပြီးပါပြီ — အမြတ် ${money(response.order?.profit)}`);
    await Promise.all([loadSettings(), loadOrders()]);
  };

  return (
    <section className="gt-workspace">
      <header className="gt-heading">
        <div>
          <span>GAME TOP-UP</span>
          <h2>ကစားစနစ် ငွေဖြည့်ရောင်းချမှု</h2>
          <p>Mobile Legends စတဲ့ game diamond/credit ကို ဖောက်သည်ဆီ ရောင်းချပါ။ Wallet ထဲက ပမာဏနုတ်ပြီး Platform ကနေ တိုက်ရိုက် ဖြည့်ပေးပါမယ်။</p>
        </div>
        <button type="button" onClick={refresh} disabled={loading}>
          {loading ? <Loader2 className="gt-spin" size={17} /> : <RefreshCw size={17} />}
          Refresh
        </button>
      </header>

      <div className="gt-wallet-card">
        <Wallet size={26} />
        <div>
          <span>Wallet Balance</span>
          <b>{money(settings.wallet?.balance)}</b>
        </div>
      </div>

      {!settings.configured ? (
        <div className="gt-message">Game Top-up ကို Platform Admin မှ ဖွင့်ပေးရန် လိုအပ်ပါသေးတယ် — MooGold API key ထည့်ပြီးမှ ပစ္စည်းများ ပေါ်လာပါမယ်။</div>
      ) : null}
      {message ? <div className="gt-message">{message}</div> : null}

      {canSeeCost ? <StorefrontPricingPanel /> : null}
      {canSeeCost ? <PaymentAndPublicOrdersPanel notify={(text) => setMessage(text)} /> : null}

      <div className="gt-layout">
        <div className="gt-catalog">
          {!settings.products.length ? (
            <div className="gt-empty">ရောင်းလို့ရမယ့် Game ပစ္စည်း မရှိသေးပါ။</div>
          ) : settings.products.map((product) => (
            <article className="gt-product-card" key={product.id}>
              <div className="gt-product-head">
                {product.imageUrl ? <img src={product.imageUrl} alt={product.name} /> : <div className="gt-product-icon"><Gamepad2 size={22} /></div>}
                <b>{product.name}</b>
              </div>
              <div className="gt-variation-grid">
                {product.variations.map((variation) => (
                  <button
                    type="button"
                    key={variation.id}
                    className={selection?.variation.id === variation.id ? 'active' : ''}
                    onClick={() => setSelection({ product, variation })}
                  >
                    <span>{variation.name}</span>
                    <b>{money(variation.suggestedRetail)}</b>
                  </button>
                ))}
              </div>
            </article>
          ))}
        </div>

        <div className="gt-sell-panel">
          {!selection ? (
            <div className="gt-empty">ရောင်းလိုတဲ့ Package ကို ဘယ်ဘက်မှာ ရွေးပါ</div>
          ) : (
            <SellPanel
              product={selection.product}
              variation={selection.variation}
              accounts={settings.accounts}
              canSeeCost={canSeeCost}
              onClose={() => setSelection(null)}
              onSold={onSold}
            />
          )}
        </div>
      </div>

      <section className="gt-orders">
        <header><h3>မှတ်တမ်း</h3></header>
        <div className="gt-table-wrap">
          <table>
            <thead><tr><th>Order</th><th>ပစ္စည်း</th><th>Player ID</th><th>ရောင်းစျေး</th><th>အမြတ်</th><th>Status</th><th>အချိန်</th></tr></thead>
            <tbody>
              {(orders.orders || []).map((order) => (
                <tr key={order.id}>
                  <td><b>{order.orderNumber}</b></td>
                  <td>{order.productName}<small>{order.variationName} × {order.quantity}</small></td>
                  <td>{order.playerId || '-'}{order.serverId ? <small>Server {order.serverId}</small> : null}</td>
                  <td>{money(order.retailPrice)}</td>
                  <td className={order.profit < 0 ? 'gt-negative' : ''}>{money(order.profit)}</td>
                  <td><StatusBadge status={order.status} />{order.failureReason ? <small className="gt-fail-reason">{order.failureReason}</small> : null}</td>
                  <td>{formatDate(order.createdAt)}</td>
                </tr>
              ))}
              {!orders.orders?.length ? <tr><td colSpan={7} className="gt-empty-cell">မှတ်တမ်း မရှိသေးပါ</td></tr> : null}
            </tbody>
          </table>
        </div>
        <div className="gt-pagination">
          <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)}>‹</button>
          <span>{orders.total || 0} records · Page {page} / {orders.totalPages || 1}</span>
          <button type="button" disabled={page >= (orders.totalPages || 1)} onClick={() => setPage(page + 1)}>›</button>
        </div>
      </section>
    </section>
  );
}
