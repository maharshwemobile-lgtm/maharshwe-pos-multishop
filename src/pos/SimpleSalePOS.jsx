import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  CreditCard,
  Minus,
  Monitor,
  Package,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  ShoppingCart,
  UserCircle2,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { apiFetch, clearSession, getSession } from '../phase2Api';
import { SmartReviewModal, SmartSuccessModal } from './SmartCheckoutModal';
import {
  buildReservedMap,
  clearSaleDraft,
  formatMoney,
  loadSaleDraft,
  playAddBeep,
  saveSaleDraft,
} from './posHelpers';
import './simple-sale-pos.css';
import './pos-payment-methods-v23.css';

const EMPTY_CUSTOMER = { name: '', phone: '' };
const EMPTY_PAYMENT = {
  method: 'CASH',
  methodId: null,
  code: 'CASH',
  name: 'Cash',
  kind: 'CASH',
  reference: '',
  cashReceived: '',
};
const PAYMENT_EVENT = 'mahar:payment-methods-changed';

const productTitle = (item) => [item?.productName, item?.variantName].filter(Boolean).join(' — ');

function paymentState(method, current = {}) {
  if (!method) return { ...EMPTY_PAYMENT, ...current };
  const credit = method.code === 'CREDIT' || method.kind === 'CREDIT';
  return {
    ...current,
    method: credit ? 'CREDIT' : (method.legacyMethod || 'OTHER'),
    methodId: credit ? null : (method.id || null),
    code: method.code || (credit ? 'CREDIT' : 'OTHER'),
    name: method.name || method.code || 'Payment',
    kind: method.kind || (credit ? 'CREDIT' : 'OTHER'),
    reference: current.reference || '',
    cashReceived: current.cashReceived || '',
  };
}

export default function SimpleSalePOS({ onExit }) {
  const session = getSession();
  const restoredDraft = useMemo(() => loadSaleDraft(session), []);

  const [catalog, setCatalog] = useState([]);
  const [categories, setCategories] = useState([]);
  const [paymentMethods, setPaymentMethods] = useState([]);
  const [paymentLoading, setPaymentLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [loading, setLoading] = useState(false);
  const [beepOn, setBeepOn] = useState(true);
  const [cart, setCart] = useState(restoredDraft?.cart || []);
  const [customer, setCustomer] = useState(restoredDraft?.customer || EMPTY_CUSTOMER);
  const [payment, setPayment] = useState({ ...EMPTY_PAYMENT, ...(restoredDraft?.payment || {}) });
  const [discount] = useState(restoredDraft?.discount || '0');
  const [message, setMessage] = useState(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [checkoutBusy, setCheckoutBusy] = useState(false);
  const [checkoutError, setCheckoutError] = useState('');
  const [completedSale, setCompletedSale] = useState(null);

  const searchRef = useRef(null);

  const notify = (type, text) => {
    setMessage({ type, text });
    window.clearTimeout(notify.timer);
    notify.timer = window.setTimeout(() => setMessage(null), 1800);
  };

  const handleError = (error) => {
    if (error?.status === 401) {
      clearSession();
      window.location.reload();
      return;
    }
    notify('error', error?.message || 'Request failed');
  };

  const reservedMap = useMemo(() => buildReservedMap(cart), [cart]);
  const visibleProducts = useMemo(() => catalog
    .map((item) => ({
      ...item,
      availableStock: Math.max(
        0,
        Number(item.stockQuantity || 0) - Number(reservedMap.get(item.id) || 0),
      ),
    }))
    .filter((item) => item.availableStock > 0), [catalog, reservedMap]);

  const cartQty = useMemo(
    () => cart.reduce((sum, line) => sum + Number(line.quantity || 0), 0),
    [cart],
  );
  const baseTotal = useMemo(
    () => cart.reduce(
      (sum, line) => sum + Number(line.standardSellingPrice || 0) * Number(line.quantity || 0),
      0,
    ),
    [cart],
  );
  const subtotal = useMemo(
    () => cart.reduce(
      (sum, line) => sum + Number(line.unitPrice || 0) * Number(line.quantity || 0),
      0,
    ),
    [cart],
  );
  const priceAdjustment = subtotal - baseTotal;
  const safeDiscount = Math.max(0, Math.min(subtotal, Number(discount || 0)));
  const total = subtotal - safeDiscount;
  const paymentIsCash = payment.kind === 'CASH' || payment.method === 'CASH';
  const paymentIsCredit = payment.kind === 'CREDIT' || payment.method === 'CREDIT' || payment.code === 'CREDIT';
  const cashReceived = paymentIsCash
    ? Number(payment.cashReceived || total)
    : total;
  const change = paymentIsCash
    ? Math.max(0, cashReceived - total)
    : 0;

  const loadCategories = async () => {
    try {
      const data = await apiFetch('/api/categories');
      setCategories((data.categories || []).filter((category) => category.active !== false));
    } catch (error) {
      handleError(error);
    }
  };

  const loadPaymentMethods = async () => {
    setPaymentLoading(true);
    try {
      const data = await apiFetch('/api/pos/payment-methods');
      const list = [
        ...(data.paymentMethods || []).filter((method) => method.active !== false),
        ...(data.credit ? [data.credit] : []),
      ];
      setPaymentMethods(list);
      setPayment((current) => {
        const matched = list.find((method) => (
          (current.methodId && method.id === current.methodId)
          || (current.code && method.code === current.code)
          || (!current.methodId && method.legacyMethod === current.method)
        ));
        const fallback = list.find((method) => method.kind === 'CASH' || method.legacyMethod === 'CASH') || list[0];
        return paymentState(matched || fallback, current);
      });
    } catch (error) {
      setPaymentMethods([]);
      handleError(error);
    } finally {
      setPaymentLoading(false);
    }
  };

  const loadCatalog = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: '1', limit: '120' });
      if (query.trim()) params.set('q', query.trim());
      if (categoryId) params.set('categoryId', categoryId);
      const data = await apiFetch(`/api/pos/catalog?${params.toString()}`);
      setCatalog(data.items || []);
    } catch (error) {
      handleError(error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCategories();
    loadPaymentMethods();
    const refreshPayments = () => loadPaymentMethods();
    window.addEventListener(PAYMENT_EVENT, refreshPayments);
    return () => window.removeEventListener(PAYMENT_EVENT, refreshPayments);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(loadCatalog, 160);
    return () => window.clearTimeout(timer);
  }, [query, categoryId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (!cart.length) {
        clearSaleDraft(session);
        return;
      }
      saveSaleDraft(session, { cart, customer, payment, discount });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [cart, customer, payment, discount]);

  const choosePayment = (method) => {
    setPayment((current) => paymentState(method, current));
  };

  const addProduct = (item) => {
    const available = Number(item.availableStock ?? item.stockQuantity ?? 0);
    if (available <= 0) {
      notify('error', 'ပစ္စည်းလက်ကျန် မရှိတော့ပါ။');
      return;
    }

    setCart((current) => {
      if (item.requiresSerial) {
        return [...current, {
          ...item,
          key: `${item.id}_${Date.now()}_${Math.random()}`,
          quantity: 1,
          unitPrice: String(item.standardSellingPrice || 0),
          imeiSerial: '',
        }];
      }

      const existing = current.find((line) => line.id === item.id);
      if (!existing) {
        return [...current, {
          ...item,
          key: item.id,
          quantity: 1,
          unitPrice: String(item.standardSellingPrice || 0),
          imeiSerial: '',
        }];
      }

      return current.map((line) => line.key === existing.key
        ? { ...line, quantity: Number(line.quantity || 0) + 1 }
        : line);
    });

    if (beepOn) playAddBeep();
    notify('success', `${productTitle(item)} → Cart ထည့်ပြီး`);
  };

  const submitSearch = async () => {
    const code = query.trim();
    if (!code) {
      searchRef.current?.focus();
      return;
    }

    try {
      const data = await apiFetch(`/api/pos/catalog?q=${encodeURIComponent(code)}&page=1&limit=30`);
      const exact = (data.items || []).find((item) => item.barcode === code || item.sku === code);
      if (!exact) return;
      const reserved = Number(reservedMap.get(exact.id) || 0);
      addProduct({
        ...exact,
        availableStock: Math.max(0, Number(exact.stockQuantity || 0) - reserved),
      });
      setQuery('');
      searchRef.current?.focus();
    } catch (error) {
      handleError(error);
    }
  };

  const patchLine = (key, patch) => {
    setCart((current) => current.map((line) => line.key === key ? { ...line, ...patch } : line));
  };

  const removeLine = (line) => {
    setCart((current) => current.filter((item) => item.key !== line.key));
  };

  const changeQuantity = (line, delta) => {
    if (line.requiresSerial) {
      if (delta < 0) removeLine(line);
      return;
    }

    if (delta > 0) {
      const currentReserved = Number(reservedMap.get(line.id) || 0);
      if (Number(line.stockQuantity || 0) - currentReserved <= 0) {
        notify('error', 'ထပ်ထည့်ရန် Stock မလုံလောက်ပါ။');
        return;
      }
      patchLine(line.key, { quantity: Number(line.quantity || 0) + 1 });
      if (beepOn) playAddBeep();
      return;
    }

    if (Number(line.quantity || 0) <= 1) {
      removeLine(line);
      return;
    }
    patchLine(line.key, { quantity: Number(line.quantity || 0) - 1 });
  };

  const changePrice = (line, rawValue) => {
    const numericValue = Math.max(0, Number(String(rawValue).replaceAll(',', '')) || 0);
    patchLine(line.key, { unitPrice: String(numericValue) });
  };

  const clearCart = () => {
    if (!cart.length) return;
    if (!window.confirm('Cart ထဲက ပစ္စည်းအားလုံးကို ရှင်းမလား?')) return;
    setCart([]);
    clearSaleDraft(session);
    notify('success', 'Cart ရှင်းပြီး Stock ပြန်လွှတ်ထားသည်။');
  };

  const validateSale = () => {
    if (!cart.length) return 'Cart ထဲတွင် ပစ္စည်းမရှိပါ။';
    if (!paymentMethods.length || !payment.code) return 'Project Settings မှ Payment Type တစ်ခုရွေးပါ။';
    const lowPrice = cart.find(
      (line) => Number(line.unitPrice || 0) < Number(line.minimumSellingPrice || 0),
    );
    if (lowPrice) return `${lowPrice.productName} ရောင်းဈေးသည် Minimum Price အောက်ရောက်နေသည်။`;
    const missingSerial = cart.find(
      (line) => line.requiresSerial && !String(line.imeiSerial || '').trim(),
    );
    if (missingSerial) return `${missingSerial.productName} အတွက် IMEI / Serial ထည့်ပါ။`;
    if (paymentIsCredit && !customer.name.trim() && !customer.phone.trim()) {
      return 'Credit sale အတွက် Customer Name သို့ Phone ထည့်ပါ။';
    }
    if (paymentIsCash && cashReceived < total) {
      return 'လက်ခံငွေသည် စုစုပေါင်းထက် နည်းနေသည်။';
    }
    return '';
  };

  const openReview = () => {
    const error = validateSale();
    if (error) {
      notify('error', error);
      return;
    }
    setCheckoutError('');
    setReviewOpen(true);
  };

  const completeSale = async () => {
    setCheckoutBusy(true);
    setCheckoutError('');
    try {
      const data = await apiFetch('/api/sales', {
        method: 'POST',
        body: {
          customerName: customer.name || null,
          customerPhone: customer.phone || null,
          discount: safeDiscount,
          paymentMethod: payment.method,
          paymentMethodId: payment.methodId || null,
          paymentMethodCode: payment.code || null,
          paymentMethodName: payment.name || null,
          paymentReference: payment.reference || null,
          cashReceived,
          items: cart.map((line) => ({
            productVariantId: line.id,
            quantity: Number(line.quantity || 0),
            unitPrice: Number(line.unitPrice || 0),
            imeiSerial: line.imeiSerial || null,
          })),
        },
      });

      clearSaleDraft(session);
      setReviewOpen(false);
      setCompletedSale(data.sale);
      setCart([]);
      setCustomer(EMPTY_CUSTOMER);
      const defaultMethod = paymentMethods.find((method) => method.kind === 'CASH' || method.legacyMethod === 'CASH') || paymentMethods[0];
      setPayment(paymentState(defaultMethod));
      await loadCatalog();
    } catch (error) {
      setCheckoutError(error.message || 'Sale checkout failed');
    } finally {
      setCheckoutBusy(false);
    }
  };

  const startNewSale = () => {
    setCompletedSale(null);
    searchRef.current?.focus();
  };

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'F2') {
        event.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault();
        openReview();
      }
      if (event.key === 'Escape' && reviewOpen && !checkoutBusy) {
        setReviewOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [cart, customer, payment, total, reviewOpen, checkoutBusy, paymentMethods]);

  const userName = session?.user?.name || session?.user?.username || 'Mahar Shwe';

  return (
    <div className="compact-pos-page">
      {message ? <div className={`compact-pos-toast ${message.type}`}>{message.text}</div> : null}

      <div className="compact-pos-shell">
        <section className="compact-pos-products">
          <header className="compact-pos-header">
            <button type="button" className="compact-pos-back" onClick={onExit} title="Dashboard">
              <ArrowLeft size={17} />
            </button>
            <div className="compact-pos-title"><Monitor size={18} /> POS Sale</div>
            <label className="compact-pos-search">
              <Search size={17} />
              <input
                ref={searchRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') submitSearch();
                }}
                placeholder="Product, SKU or Barcode ရှာပါ…"
              />
            </label>
            <div className="compact-pos-user"><UserCircle2 size={17} /> {userName}</div>
            <button
              type="button"
              className={`compact-pos-beep ${beepOn ? 'on' : ''}`}
              onClick={() => setBeepOn((value) => !value)}
            >
              {beepOn ? <Volume2 size={15} /> : <VolumeX size={15} />}
              Beep {beepOn ? 'ON' : 'OFF'}
            </button>
          </header>

          <div className="compact-pos-categories">
            <button
              type="button"
              className={!categoryId ? 'active' : ''}
              onClick={() => setCategoryId('')}
            >
              အားလုံး
            </button>
            {categories.map((category) => (
              <button
                type="button"
                key={category.id}
                className={categoryId === category.id ? 'active' : ''}
                onClick={() => setCategoryId(category.id)}
              >
                {category.name}
              </button>
            ))}
          </div>

          <div className="compact-pos-grid">
            {loading ? (
              <div className="compact-pos-empty">Loading available products…</div>
            ) : visibleProducts.length ? visibleProducts.map((item) => {
              const lowStock = item.availableStock <= Math.max(2, Number(item.minAlertQuantity || 0));
              return (
                <button
                  type="button"
                  className="compact-pos-product-card"
                  key={item.id}
                  onClick={() => addProduct(item)}
                >
                  <span className={`compact-pos-stock-badge ${lowStock ? 'low' : ''}`}>{item.availableStock}</span>
                  <Package className="compact-pos-product-icon" size={23} />
                  <span className="compact-pos-product-name">{productTitle(item)}</span>
                  <strong>{formatMoney(item.standardSellingPrice)}</strong>
                  <small>Stock: {item.availableStock}</small>
                </button>
              );
            }) : (
              <div className="compact-pos-empty">ရောင်းရန် Stock ရှိသော ပစ္စည်းမတွေ့ပါ။</div>
            )}
          </div>
        </section>

        <aside className="compact-pos-cart">
          <header className="compact-pos-cart-head">
            <div><ShoppingCart size={17} /> Cart <span>{cartQty}</span></div>
            <button type="button" onClick={clearCart} disabled={!cart.length}>
              <RotateCcw size={14} /> Clear & Restore
            </button>
          </header>

          <div className="compact-pos-cart-columns">
            <span>ပစ္စည်း</span><span>ဈေးနှုန်း</span><span>အရေ</span><span>ကျသင့်</span>
          </div>

          <div className="compact-pos-cart-items">
            {cart.length ? cart.map((line) => {
              const overridden = Number(line.unitPrice || 0) !== Number(line.standardSellingPrice || 0);
              return (
                <article className="compact-pos-cart-row" key={line.key}>
                  <div className="compact-pos-cart-name">
                    <b title={productTitle(line)}>{productTitle(line)}</b>
                    {line.requiresSerial ? (
                      <input
                        value={line.imeiSerial || ''}
                        onChange={(event) => patchLine(line.key, { imeiSerial: event.target.value })}
                        placeholder="IMEI / Serial"
                      />
                    ) : null}
                  </div>
                  <input
                    className={`compact-pos-price-input ${overridden ? 'overridden' : ''}`}
                    value={Number(line.unitPrice || 0).toLocaleString('en-US')}
                    onFocus={(event) => {
                      event.target.value = String(line.unitPrice || 0);
                      event.target.select();
                    }}
                    onChange={(event) => changePrice(line, event.target.value)}
                    onBlur={(event) => {
                      event.target.value = Number(line.unitPrice || 0).toLocaleString('en-US');
                    }}
                    inputMode="numeric"
                    title="Selling price override"
                  />
                  <div className="compact-pos-qty">
                    <button type="button" onClick={() => changeQuantity(line, -1)}><Minus size={13} /></button>
                    <b>{line.quantity}</b>
                    <button type="button" onClick={() => changeQuantity(line, 1)} disabled={line.requiresSerial}><Plus size={13} /></button>
                  </div>
                  <strong>{Number(line.unitPrice || 0) * Number(line.quantity || 0) > 999999
                    ? `${(Number(line.unitPrice || 0) * Number(line.quantity || 0) / 1000000).toFixed(1)}M`
                    : Number(line.unitPrice || 0) * Number(line.quantity || 0) > 9999
                      ? `${Math.round(Number(line.unitPrice || 0) * Number(line.quantity || 0) / 1000)}K`
                      : Number(line.unitPrice || 0) * Number(line.quantity || 0)}</strong>
                </article>
              );
            }) : (
              <div className="compact-pos-cart-empty">
                <ShoppingCart size={32} />
                <p>Cart ထဲ ပစ္စည်းမရှိသေး</p>
              </div>
            )}
          </div>

          <div className="compact-pos-summary">
            <div><span>ပစ္စည်းအရေ</span><b>{cartQty} ခု</b></div>
            <div><span>မူရင်းဈေး</span><b>{formatMoney(baseTotal)}</b></div>
            <div><span>ဈေးပြင် (Override)</span><b className={priceAdjustment < 0 ? 'negative' : priceAdjustment > 0 ? 'positive' : ''}>{priceAdjustment >= 0 ? '+' : ''}{formatMoney(priceAdjustment)}</b></div>
            <div className="compact-pos-grand-total"><span>စုစုပေါင်း</span><b>{formatMoney(total)}</b></div>

            <div className="compact-pos-payment-title">
              <span>Payment Type</span>
              <button type="button" onClick={loadPaymentMethods} disabled={paymentLoading} title="Refresh Project Settings wallets">
                <RefreshCw size={13} className={paymentLoading ? 'compact-pos-payment-spin' : ''} />
              </button>
            </div>
            {paymentLoading ? (
              <div className="compact-pos-payment-loading">Payment Types loading…</div>
            ) : paymentMethods.length ? (
              <div className="compact-pos-payment-methods compact-pos-payment-methods-dynamic">
                {paymentMethods.map((method) => (
                  <button
                    type="button"
                    key={method.id || method.code}
                    className={(payment.methodId && payment.methodId === method.id) || (!payment.methodId && payment.code === method.code) ? 'active' : ''}
                    onClick={() => choosePayment(method)}
                  >
                    <b>{method.name}</b>
                    <small>{method.kind === 'CREDIT' ? 'Customer Debt' : method.kind}</small>
                  </button>
                ))}
              </div>
            ) : (
              <button type="button" className="compact-pos-payment-retry" onClick={loadPaymentMethods}>
                <RefreshCw size={14} /> Project Settings Payment Types ပြန်ယူမည်
              </button>
            )}

            {paymentIsCash ? (
              <label className="compact-pos-field">
                <span>လက်ခံငွေ / အမ်းငွေ {formatMoney(change)}</span>
                <input
                  type="number"
                  min="0"
                  value={payment.cashReceived}
                  onChange={(event) => setPayment({ ...payment, cashReceived: event.target.value })}
                  placeholder={String(total)}
                />
              </label>
            ) : paymentIsCredit ? (
              <div className="compact-pos-credit-fields">
                <input
                  value={customer.name}
                  onChange={(event) => setCustomer({ ...customer, name: event.target.value })}
                  placeholder="Customer name"
                />
                <input
                  value={customer.phone}
                  onChange={(event) => setCustomer({ ...customer, phone: event.target.value })}
                  placeholder="Phone"
                />
              </div>
            ) : (
              <label className="compact-pos-field">
                <span>{payment.name || 'Wallet'} Transaction Reference</span>
                <input
                  value={payment.reference}
                  onChange={(event) => setPayment({ ...payment, reference: event.target.value })}
                  placeholder="Optional"
                />
              </label>
            )}

            <button type="button" className="compact-pos-pay" onClick={openReview} disabled={!cart.length || paymentLoading || !paymentMethods.length}>
              <CreditCard size={17} /> ငွေရှင်းမည်
            </button>
          </div>
        </aside>
      </div>

      {reviewOpen ? (
        <SmartReviewModal
          cart={cart}
          customer={customer}
          payment={payment}
          subtotal={subtotal}
          discount={safeDiscount}
          total={total}
          cashReceived={cashReceived}
          change={change}
          busy={checkoutBusy}
          error={checkoutError}
          onClose={() => setReviewOpen(false)}
          onConfirm={completeSale}
        />
      ) : null}

      {completedSale ? <SmartSuccessModal sale={completedSale} onNewSale={startNewSale} /> : null}
    </div>
  );
}
