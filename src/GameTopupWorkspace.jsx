import React, { useEffect, useState } from 'react';
import { Gamepad2, Loader2, RefreshCw, Wallet, X } from 'lucide-react';
import { apiFetch } from './phase2Api';
import './game-topup-workspace.css';

const money = (value) => `${Number(value || 0).toLocaleString('en-US')} MMK`;

function formatDate(value) {
  if (!value) return '-';
  try {
    return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
  } catch {
    return String(value);
  }
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

  const quantity = Math.max(1, Number(form.quantity || 1));
  const unitCost = Number(variation.shopCost || 0);
  const totalCost = unitCost * quantity;
  const totalRetail = Number(form.retailPrice || 0);
  const profit = totalRetail - totalCost;

  const submit = async (event) => {
    event.preventDefault();
    setMessage('');
    if (product.requiresPlayerId && !form.playerId.trim()) return setMessage('Player ID ထည့်ပါ');
    if (product.requiresServer && !form.server.trim()) return setMessage('Server ထည့်ပါ');
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

      <button type="submit" className="gt-submit" disabled={busy}>
        {busy ? <Loader2 className="gt-spin" size={17} /> : <Gamepad2 size={17} />}
        ရောင်းမည်
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
