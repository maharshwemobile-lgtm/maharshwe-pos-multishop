import React, { useEffect, useState } from 'react';
import { CheckCircle2, ChevronLeft, Copy, Download, Gamepad2, Loader2, ShieldCheck } from 'lucide-react';
import { PROJECT_LOGO_URL } from './projectBrand';
import { downloadOrderSlip } from './gameTopupSlip';
import './game-topup-storefront.css';

const API_BASE_URL = String(import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '');
const money = (value) => `${Number(value || 0).toLocaleString('en-US')} MMK`;

async function publicFetch(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: options.method || 'GET',
    headers: { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}) },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) {
    const error = new Error(data.message || 'Request failed');
    error.status = response.status;
    throw error;
  }
  return data;
}

function CopyField({ label, value }) {
  const [copied, setCopied] = useState(false);
  if (!value) return null;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      const field = document.createElement('textarea');
      field.value = value;
      field.style.position = 'fixed';
      field.style.opacity = '0';
      document.body.appendChild(field);
      field.select();
      document.execCommand('copy');
      field.remove();
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className="gts-copy-field">
      <div><span>{label}</span><b>{value}</b></div>
      <button type="button" onClick={copy} aria-label={`${label} ကူးရန်`}>
        {copied ? <CheckCircle2 size={16} /> : <Copy size={16} />}
      </button>
    </div>
  );
}

export default function GameTopupStorefront() {
  const [products, setProducts] = useState([]);
  const [paymentInfo, setPaymentInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const [chosenGame, setChosenGame] = useState(null);
  const [selection, setSelection] = useState(null);
  const [step, setStep] = useState('games');
  const [form, setForm] = useState({ quantity: 1, playerId: '', server: '', customerName: '', customerPhone: '', paymentTransactionId: '' });
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const [placed, setPlaced] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const [catalog, payment] = await Promise.all([
          publicFetch('/api/public/game-topup/catalog'),
          publicFetch('/api/public/game-topup/payment-info'),
        ]);
        setProducts(catalog.products || []);
        setPaymentInfo(payment);
      } catch (error) {
        setLoadError(error.message || 'Load failed');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const total = selection ? Number(selection.variation.retailPrice || 0) * Math.max(1, Number(form.quantity || 1)) : 0;

  const goToPayment = (event) => {
    event.preventDefault();
    setFormError('');
    if (selection.product.requiresPlayerId && !form.playerId.trim()) return setFormError('Player ID ထည့်ပါ');
    if (selection.product.requiresServer && !form.server.trim()) return setFormError('Server ထည့်ပါ');
    if (!form.customerPhone.trim() || form.customerPhone.trim().length < 7) return setFormError('ဆက်သွယ်ရန် ဖုန်းနံပါတ် ထည့်ပါ');
    setStep('payment');
  };

  const submitOrder = async (event) => {
    event.preventDefault();
    setFormError('');
    if (!/^\d{4,}$/.test(form.paymentTransactionId.trim())) {
      return setFormError('Transaction ID နောက်ဆုံး ၄ လုံး (ဂဏန်း) ထည့်ပါ');
    }
    setBusy(true);
    try {
      const response = await publicFetch('/api/public/game-topup/orders', {
        method: 'POST',
        body: {
          variationId: selection.variation.id,
          quantity: Math.max(1, Number(form.quantity || 1)),
          playerId: form.playerId.trim() || undefined,
          server: form.server.trim() || undefined,
          customerName: form.customerName.trim() || undefined,
          customerPhone: form.customerPhone.trim(),
          paymentTransactionId: form.paymentTransactionId.trim(),
        },
      });
      setPlaced(response);
      setStep('done');
    } catch (error) {
      setFormError(error.message || 'Order failed');
    } finally {
      setBusy(false);
    }
  };

  const restart = () => {
    setChosenGame(null);
    setSelection(null);
    setPlaced(null);
    setStep('games');
    setForm({ quantity: 1, playerId: '', server: '', customerName: '', customerPhone: '', paymentTransactionId: '' });
  };

  const backToGames = () => { setChosenGame(null); setStep('games'); setFormError(''); };
  const backToPackages = () => { setSelection(null); setStep('packages'); setFormError(''); };

  return (
    <main className="gts-page">
      <header className="gts-header">
        <div className="gts-brand">
          <img src={PROJECT_LOGO_URL} alt="Mahar POS" />
          <div><b>Game Top-up</b><span>ချက်ချင်း ဖြည့်ပေးသည်</span></div>
        </div>
        <a className="gts-status-link" href="/topup-status">အော်ဒါ စစ်ရန်</a>
      </header>

      {loading ? <div className="gts-loading"><Loader2 className="gts-spin" size={22} /> ဖွင့်နေပါသည်…</div> : null}
      {loadError ? <div className="gts-alert error">{loadError}</div> : null}

      {!loading && !loadError && step === 'games' ? (
        <>
          {!products.length ? (
            <div className="gts-alert">ရောင်းချရန် ပစ္စည်း မရှိသေးပါ။ နောက်မှ ပြန်ကြည့်ပါ။</div>
          ) : null}
          <div className="gts-game-grid">
            {products.map((product) => (
              <button
                type="button"
                className="gts-game-tile"
                key={product.id}
                onClick={() => { setChosenGame(product); setStep('packages'); setFormError(''); }}
              >
                {product.imageUrl ? <img src={product.imageUrl} alt={product.name} /> : <div className="gts-product-icon"><Gamepad2 size={22} /></div>}
                <span>{product.name}</span>
              </button>
            ))}
          </div>
        </>
      ) : null}

      {!loading && !loadError && step === 'packages' && chosenGame ? (
        <section className="gts-product">
          <button type="button" className="gts-back" onClick={backToGames}><ChevronLeft size={16} /> ဂိမ်းများသို့ ပြန်သွားမည်</button>
          <header>
            {chosenGame.imageUrl ? <img src={chosenGame.imageUrl} alt={chosenGame.name} /> : <div className="gts-product-icon"><Gamepad2 size={20} /></div>}
            <b>{chosenGame.name}</b>
          </header>
          <div className="gts-package-grid">
            {chosenGame.variations.map((variation) => (
              <button
                type="button"
                key={variation.id}
                onClick={() => { setSelection({ product: chosenGame, variation }); setStep('details'); setFormError(''); }}
              >
                <span>{variation.name}</span>
                <b>{money(variation.retailPrice)}</b>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {step === 'details' && selection ? (
        <form className="gts-card" onSubmit={goToPayment}>
          <button type="button" className="gts-back" onClick={backToPackages}><ChevronLeft size={16} /> Package ပြန်ရွေးမည်</button>
          <h2>{selection.product.name}</h2>
          <p className="gts-chosen">{selection.variation.name} · {money(selection.variation.retailPrice)}</p>

          {formError ? <div className="gts-alert error">{formError}</div> : null}

          <label><span>အရေအတွက်</span>
            <input type="number" min="1" max="10" value={form.quantity} onChange={(event) => setForm({ ...form, quantity: event.target.value })} />
          </label>
          {selection.product.requiresPlayerId ? (
            <label><span>Player ID / User ID *</span>
              <input value={form.playerId} onChange={(event) => setForm({ ...form, playerId: event.target.value })} placeholder="ဂိမ်းထဲက ID" autoFocus />
            </label>
          ) : null}
          {selection.product.requiresServer ? (
            <label><span>Server / Zone ID *</span>
              <input value={form.server} onChange={(event) => setForm({ ...form, server: event.target.value })} placeholder="ဥပမာ - 2001" />
            </label>
          ) : null}
          <label><span>ဆက်သွယ်ရန် ဖုန်းနံပါတ် *</span>
            <input type="tel" value={form.customerPhone} onChange={(event) => setForm({ ...form, customerPhone: event.target.value })} placeholder="09xxxxxxxxx" />
          </label>
          <label><span>နာမည် (ဖြည့်စရာမလို)</span>
            <input value={form.customerName} onChange={(event) => setForm({ ...form, customerName: event.target.value })} />
          </label>

          <div className="gts-total"><span>စုစုပေါင်း</span><b>{money(total)}</b></div>
          <button type="submit" className="gts-primary">ငွေပေးချေရန် ဆက်သွားမည်</button>
        </form>
      ) : null}

      {step === 'payment' && selection ? (
        <form className="gts-card" onSubmit={submitOrder}>
          <button type="button" className="gts-back" onClick={() => { setStep('details'); setFormError(''); }}><ChevronLeft size={16} /> ပြန်သွားမည်</button>
          <h2>ငွေလွှဲပါ</h2>
          <div className="gts-total big"><span>လွှဲရမည့် ပမာဏ</span><b>{money(total)}</b></div>

          {paymentInfo?.configured ? (
            <div className="gts-payment-box">
              <CopyField label="KBZ Pay နံပါတ်" value={paymentInfo.payment.phone} />
              <CopyField label="အမည်" value={paymentInfo.payment.name} />
              {paymentInfo.payment.qrUrl ? <img className="gts-qr" src={paymentInfo.payment.qrUrl} alt="KBZ Pay QR" /> : null}
            </div>
          ) : (
            <div className="gts-alert error">ငွေလက်ခံမည့် အချက်အလက် မထည့်ရသေးပါ — ဆိုင်သို့ ဆက်သွယ်ပါ။</div>
          )}

          <ol className="gts-steps">
            <li>အထက်ပါ KBZ Pay နံပါတ်သို့ <b>{money(total)}</b> အတိအကျ လွှဲပါ</li>
            <li>လွှဲပြီးရင် KBZ Pay app ထဲက <b>Transaction ID နောက်ဆုံး ၄ လုံး</b> ကို ကြည့်ပါ</li>
            <li>အောက်မှာ ထည့်ပြီး အော်ဒါ တင်ပါ</li>
          </ol>

          {formError ? <div className="gts-alert error">{formError}</div> : null}

          <label><span>KBZ Pay Transaction ID — နောက်ဆုံး ၄ လုံး *</span>
            <input
              value={form.paymentTransactionId}
              onChange={(event) => setForm({ ...form, paymentTransactionId: event.target.value })}
              placeholder="ဥပမာ - 4821"
              inputMode="numeric"
              maxLength={20}
            />
          </label>

          <div className="gts-notice">
            <ShieldCheck size={17} />
            <span>ငွေလက်ခံရရှိကြောင်း စစ်ဆေးပြီးမှ ဖြည့်ပေးပါမယ်။ များသောအားဖြင့် မိနစ်အနည်းငယ်အတွင်း ပြီးပါတယ်။</span>
          </div>

          <button type="submit" className="gts-primary" disabled={busy || !paymentInfo?.configured}>
            {busy ? <Loader2 className="gts-spin" size={17} /> : null} အော်ဒါ တင်မည်
          </button>
        </form>
      ) : null}

      {step === 'done' && placed ? (
        <div className="gts-card gts-done">
          <CheckCircle2 size={44} />
          <h2>အော်ဒါ တင်ပြီးပါပြီ</h2>
          <p>အော်ဒါနံပါတ် <b>{placed.orderNumber}</b></p>
          <p className="gts-muted">ငွေစစ်ဆေးပြီးပါက ချက်ချင်း ဖြည့်ပေးပါမယ်။ ဖြတ်ပိုင်းကို Download ဆွဲထားပြီး အခြေအနေ စစ်နိုင်ပါတယ်။</p>
          <button
            type="button"
            className="gts-primary"
            onClick={() => downloadOrderSlip({
              orderNumber: placed.orderNumber,
              productName: selection?.product?.name,
              variationName: selection?.variation?.name,
              quantity: Math.max(1, Number(form.quantity || 1)),
              playerId: form.playerId.trim(),
              serverId: form.server.trim(),
              customerName: form.customerName.trim(),
              customerPhone: form.customerPhone.trim(),
              total,
              paymentTransactionId: form.paymentTransactionId.trim(),
              statusUrl: placed.statusUrl,
            })}
          >
            <Download size={17} /> ဖြတ်ပိုင်း Download ဆွဲမည်
          </button>
          <a className="gts-secondary as-link" href={placed.statusUrl}>အခြေအနေ ကြည့်မည်</a>
          <button type="button" className="gts-secondary" onClick={restart}>နောက်တစ်ခု ဝယ်မည်</button>
        </div>
      ) : null}
    </main>
  );
}
