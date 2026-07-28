import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Boxes,
  Camera,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CreditCard,
  History,
  Grid3X3,
  List,
  Loader2,
  Minus,
  Plus,
  Printer,
  Search,
  ShoppingCart,
  Trash2,
  UserRound,
  Wallet,
  X,
} from 'lucide-react';
import { apiFetch, clearSession, getSession } from '../phase2Api';
import '../stock-management.css';
import './sales-v10.css';
import './sale10-inline-scanner.css';
import './sale10-complete-hotfix.css';
import './sale10-product-images.css';
import FirstLoginGuide from '../FirstLoginGuide.jsx';
import './sales-v10-guided.css';
import { pickLanguageText } from '../settings/ProjectLanguageRuntime.jsx';
import {
  clearDraft,
  loadDraft,
  money,
  productName,
  reservedQuantity,
  reprintReceipt,
  saveDraft,
} from './salesV10Utils';
import { playPaymentSuccessSound, playPosAddSound } from './salesAudio';
import ProductCategoryIcon from '../ProductCategoryIcon.jsx';
import WebBarcodeScanner from '../pos/WebBarcodeScanner.jsx';

// Product list fills whatever space the screen gives it instead of a fixed 10.
// Bounds keep the request sane on very small and very large displays.
const MIN_PAGE_SIZE = 8;
const MAX_PAGE_SIZE = 60;
const FALLBACK_PAGE_SIZE = 12;
const GRID_CARD_FALLBACK_H = 210;
const LIST_ROW_FALLBACK_H = 54;
const PAGER_RESERVE_H = 78;
const EMPTY_CUSTOMER = { name: '', phone: '' };
const EMPTY_PAYMENT = { method: '', methodId: '', methodCode: '', methodName: '', reference: '', cashReceived: '' };
const CASH_PAYMENT_METHOD = { key: 'CASH', id: '', name: 'Cash', code: 'CASH', kind: 'CASH', accountName: 'Cash', legacyMethod: 'CASH', balance: 0 };
const CREDIT_PAYMENT_METHOD = { key: 'CREDIT', id: '', name: 'Credit', code: 'CREDIT', kind: 'CREDIT', accountName: '', legacyMethod: 'CREDIT', balance: 0 };
const FALLBACK_PAYMENT_METHODS = [CASH_PAYMENT_METHOD, CREDIT_PAYMENT_METHOD];
const t = pickLanguageText;

function ProductGridVisual({ item }) {
  const [imageFailed, setImageFailed] = useState(false);
  if (!item.imageUrl || imageFailed) return <div className="sale10-grid-category-icon"><ProductCategoryIcon item={item} size={44}/></div>;
  return <img src={item.imageUrl} alt="" loading="lazy" onError={() => setImageFailed(true)}/>;
}

function variantLabel(item) {
  return [item?.variantName, item?.color, item?.storage]
    .map((value) => String(value || '').trim())
    .filter((value) => value && value.toLowerCase() !== 'default')
    .join(' · ');
}

function normalizePaymentOption(row) {
  const legacyMethod = row?.legacyMethod || row?.method || row?.code || 'OTHER';
  const code = row?.code || legacyMethod;
  return {
    key: row?.id || code || legacyMethod,
    id: row?.id || '',
    name: row?.accountName || row?.name || code,
    code,
    kind: row?.kind || (legacyMethod === 'CASH' ? 'CASH' : legacyMethod === 'CREDIT' ? 'CREDIT' : 'WALLET'),
    accountId: row?.accountId || '',
    accountName: row?.accountName || row?.name || '',
    balance: Number(row?.balance || 0),
    legacyMethod,
  };
}

function ensureCashPaymentMethods(methods = []) {
  const list = (methods || []).filter(Boolean);
  const hasCash = list.some((method) => (
    method.legacyMethod === 'CASH'
    || method.kind === 'CASH'
    || String(method.code || '').toUpperCase() === 'CASH'
  ));
  return hasCash ? list : [normalizePaymentOption(CASH_PAYMENT_METHOD), ...list];
}

function paymentOptionKey(method) {
  return method?.id || method?.code || method?.legacyMethod || method?.key || '';
}

function paymentLabel(method, fallback = 'Cash') {
  if (!method) return fallback;
  if (method.legacyMethod === 'CREDIT') return 'Credit';
  return method.accountName || method.name || method.code || fallback;
}

function daysUntilExpiry(value) {
  if (!value) return null;
  const expiry = new Date(`${value}T00:00:00`);
  if (Number.isNaN(expiry.getTime())) return null;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.ceil((expiry - today) / 86400000);
}

function expiryWarning(item) {
  const days = daysUntilExpiry(item?.expiryDate);
  if (days === null) return '';
  if (days < 0) return `Expired ${Math.abs(days)} day(s) ago`;
  if (days === 0) return 'Expires today';
  if (days <= 30) return `Near expiry · ${days} day(s)`;
  return '';
}

function ReviewModal({ cart, customer, payment, paymentLegacyMethod, paymentMethodLabel, subtotal, discount, total, cashReceived, change, splitPayments = [], busy, error, onClose, onConfirm }) {
  return (
    <div className="stock-modal-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !busy) onClose();
    }}>
      <section className="stock-modal stock-history-modal sale10-review-modal" role="dialog" aria-modal="true">
        <header>
          <div className="stock-modal-icon stock-tone-green"><CheckCircle2 size={24} /></div>
          <div>
            <h3>Review Sale</h3>
            <p>Payment Confirm မလုပ်မီ Customer, Payment, Quantity နဲ့ Price ကို နောက်ဆုံးစစ်ပါ။</p>
          </div>
          <button type="button" className="stock-icon-button" onClick={onClose} disabled={busy}><X size={20} /></button>
        </header>

        <div className="sale10-review-body">
          <section className="sale10-review-summary-grid">
            <article><span>Customer</span><b>{customer.name || 'Walk-in Customer'}</b><small>{customer.phone || '-'}</small></article>
            <article><span>Payment</span><b>{paymentMethodLabel || payment.methodName || payment.method}</b><small>{splitPayments.length ? `${splitPayments.length} payment rows` : (payment.reference || 'No reference')}</small></article>
            <article><span>Items</span><b>{cart.reduce((sum, line) => sum + Number(line.quantity || 0), 0)}</b><small>{cart.length} product lines</small></article>
          </section>

          <div className="stock-history-table-wrap sale10-review-table-wrap">
            <table className="stock-history-table sale10-review-table">
              <thead><tr><th>Product / Variant</th><th>IMEI / Serial</th><th>Qty</th><th>Unit Price</th><th>Line Total</th></tr></thead>
              <tbody>
                {cart.map((line) => (
                  <tr key={line.key}>
                    <td><b>{productName(line)}</b></td>
                    <td>{line.imeiSerial || '-'}</td>
                    <td>{line.quantity}</td>
                    <td>{money(line.unitPrice)}</td>
                    <td><b>{money(Number(line.unitPrice || 0) * Number(line.quantity || 0))}</b></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <section className="sale10-review-totals">
            <div><span>Subtotal</span><b>{money(subtotal)}</b></div>
            <div><span>Discount</span><b>-{money(discount)}</b></div>
            <div className="grand"><span>Total</span><b>{money(total)}</b></div>
            {splitPayments.length ? <>
              <div><span>Paid / Covered</span><b>{money(cashReceived)}</b></div>
              <div><span>Change</span><b>{money(change)}</b></div>
            </> : paymentLegacyMethod === 'CASH' ? <>
              <div><span>Cash Received</span><b>{money(cashReceived)}</b></div>
              <div><span>Change</span><b>{money(change)}</b></div>
            </> : null}
          </section>

          {error ? <div className="stock-form-error">{error}</div> : null}
        </div>

        <footer>
          <button type="button" onClick={onClose} disabled={busy}>Back to Sale</button>
          <button type="button" className="stock-submit stock-submit-green" onClick={onConfirm} disabled={busy}>
            {busy ? <Loader2 className="stock-spin" size={18} /> : <CheckCircle2 size={18} />}
            Confirm Payment
          </button>
        </footer>
      </section>
    </div>
  );
}

function CompletedModal({ sale, onNewSale, onHistory }) {
  const print = () => {
    const popup = window.open('', '_blank', 'width=420,height=720');
    if (!popup) return;
    reprintReceipt(sale, popup);
  };
  return (
    <div className="stock-modal-backdrop">
      <section className="stock-modal sale10-complete-modal" role="dialog" aria-modal="true">
        <button type="button" className="sale10-complete-close" onClick={onNewSale} aria-label="Close"><X size={18} /></button>
        <div className="sale10-complete-icon"><CheckCircle2 size={40} /></div>
        <h3>Sale Completed</h3>
        <p>{sale.invoice}</p>
        <b>{money(sale.total)}</b>
        <small>{t(
          'You can reprint this receipt now or later from Sales History.',
          'ဤဘောက်ချာကို ယခုပင် ပြန်ပုံနှိပ်နိုင်သလို အရောင်းမှတ်တမ်းမှလည်း နောက်မှ ပြန်ပုံနှိပ်နိုင်ပါသည်။',
        )}</small>
        <footer className="sale10-complete-actions">
          <button type="button" className="sale10-complete-secondary" onClick={onHistory}>
            <History size={16} /> {t('History', 'မှတ်တမ်း')}
          </button>
          <button type="button" className="sale10-reprint-button allow-mobile-print" onClick={print}>
            <Printer size={16} /> {t('Reprint', 'ပြန်ပုံနှိပ်')}
          </button>
          <button type="button" className="stock-submit stock-submit-green sale10-new-sale-button" onClick={onNewSale}>
            <ShoppingCart size={16} /> {t('New Sale', 'အရောင်းအသစ်')}
          </button>
        </footer>
      </section>
    </div>
  );
}

export default function NewSaleV10({ onOpenHistory, onboardingGuide }) {
  const session = getSession();
  const isMiniMart = String(
    session?.shop?.businessType
    || session?.user?.shop?.businessType
    || session?.businessType
    || 'PHONE_SHOP',
  ).toUpperCase() === 'MINI_MART';
  const restored = useMemo(() => loadDraft(session), []);
  const canDiscount = session?.user?.role === 'SUPER_ADMIN'
    || session?.user?.role === 'SHOP_ADMIN'
    || session?.user?.permissions?.discount === true;

  const [catalog, setCatalog] = useState([]);
  const [categories, setCategories] = useState([]);
  const [paymentMethods, setPaymentMethods] = useState(FALLBACK_PAYMENT_METHODS);
  const [query, setQuery] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [productView, setProductView] = useState('grid');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(FALLBACK_PAGE_SIZE);
  const productListRef = useRef(null);
  const [totalItems, setTotalItems] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [cart, setCart] = useState(restored?.cart || []);
  const [customer, setCustomer] = useState(restored?.customer || EMPTY_CUSTOMER);
  const [payment, setPayment] = useState(restored?.payment || EMPTY_PAYMENT);
  const [splitPayments, setSplitPayments] = useState(restored?.splitPayments || []);
  const [splitModalOpen, setSplitModalOpen] = useState(false);
  const [discount, setDiscount] = useState(restored?.discount || '0');
  const [toast, setToast] = useState(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [checkoutBusy, setCheckoutBusy] = useState(false);
  const [checkoutError, setCheckoutError] = useState('');
  const [completedSale, setCompletedSale] = useState(null);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [lastAddedKey, setLastAddedKey] = useState(restored?.cart?.[restored.cart.length - 1]?.key || '');
  const searchRef = useRef(null);
  const cartRef = useRef(null);

  const animateProductToCart = (item, sourceElement) => {
    if (!sourceElement || !cartRef.current || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const source = sourceElement.getBoundingClientRect();
    const target = cartRef.current.getBoundingClientRect();
    const sourceX = source.left + source.width / 2;
    const sourceY = source.top + Math.min(source.height / 2, 55);
    const flyer = document.createElement('div');
    flyer.className = 'sale10-fly-to-cart';
    if (item.imageUrl) flyer.style.backgroundImage = `url("${String(item.imageUrl).replace(/"/g, '%22')}")`;
    else flyer.textContent = '+';
    flyer.style.left = `${sourceX - 18}px`;
    flyer.style.top = `${sourceY - 18}px`;
    document.body.appendChild(flyer);
    requestAnimationFrame(() => {
      flyer.style.transform = `translate(${target.left + target.width / 2 - sourceX}px, ${target.top + 22 - sourceY}px) scale(.35)`;
      flyer.style.opacity = '0.25';
    });
    flyer.addEventListener('transitionend', () => {
      flyer.remove();
      cartRef.current?.classList.remove('sale10-cart-pulse');
      void cartRef.current?.offsetWidth;
      cartRef.current?.classList.add('sale10-cart-pulse');
      window.setTimeout(() => cartRef.current?.classList.remove('sale10-cart-pulse'), 420);
    }, { once: true });
  };

  const notify = (type, text) => {
    setToast({ type, text });
    window.clearTimeout(notify.timer);
    notify.timer = window.setTimeout(() => setToast(null), 3500);
  };

  const handleError = (error) => {
    if (error?.status === 401) {
      clearSession();
      window.location.reload();
      return;
    }
    notify('error', error?.message || 'Request failed');
  };

  const reserved = useMemo(() => reservedQuantity(cart), [cart]);
  const availableCatalog = useMemo(() => catalog
    .map((item) => ({
      ...item,
      available: Math.max(0, Number(item.stockQuantity || 0) - Number(reserved.get(item.id) || 0)),
    }))
    .filter((item) => item.available > 0), [catalog, reserved]);

  const subtotal = useMemo(() => cart.reduce(
    (sum, line) => sum + Number(line.unitPrice || 0) * Number(line.quantity || 0),
    0,
  ), [cart]);
  const safeDiscount = Math.max(0, Math.min(subtotal, Number(discount || 0)));
  const total = subtotal - safeDiscount;
  const unitCount = cart.reduce((sum, line) => sum + Number(line.quantity || 0), 0);
  const selectedPaymentMethod = useMemo(() => {
    const selectedKey = payment.methodId || payment.methodCode || payment.method;
    return paymentMethods.find((method) => (
      paymentOptionKey(method) === selectedKey
      || method.code === selectedKey
    || (!payment.methodId && payment.method && method.legacyMethod === payment.method)
    )) || paymentMethods[0] || FALLBACK_PAYMENT_METHODS[0];
  }, [payment, paymentMethods]);
  const paymentMethodLabel = paymentLabel(selectedPaymentMethod, payment.methodName || payment.method);
  const paymentLegacyMethod = selectedPaymentMethod?.legacyMethod || payment.method || 'CASH';
  const cashReceived = paymentLegacyMethod === 'CASH' ? Number(payment.cashReceived || total) : total;
  const change = paymentLegacyMethod === 'CASH' ? Math.max(0, cashReceived - total) : 0;
  const splitPaymentOptions = useMemo(() => paymentMethods, [paymentMethods]);
  const splitPaymentTotal = useMemo(() => splitPayments.reduce((sum, row) => sum + Number(row.amount || 0), 0), [splitPayments]);
  const splitPaymentBalance = Math.max(0, total - splitPaymentTotal);
  const splitPaymentChange = Math.max(0, splitPaymentTotal - total);
  const splitPaymentActive = splitPayments.length > 0;
  const latestCartLine = cart.find((line) => line.key === lastAddedKey) || cart[cart.length - 1] || null;
  const latestLineTotal = latestCartLine ? Number(latestCartLine.unitPrice || 0) * Number(latestCartLine.quantity || 0) : 0;
  const loadCategories = async () => {
    try {
      const data = await apiFetch('/api/categories');
      setCategories((data.categories || []).filter((item) => item.active !== false));
    } catch (error) {
      handleError(error);
    }
  };

  const loadPaymentMethods = async () => {
    try {
      const data = await apiFetch('/api/pos/payment-methods');
      const methods = ensureCashPaymentMethods([
        ...(data.paymentMethods || []).map(normalizePaymentOption),
        normalizePaymentOption(data.credit || CREDIT_PAYMENT_METHOD),
      ].filter((method, index, list) => method.key && list.findIndex((item) => item.key === method.key) === index));
      const next = methods.length ? methods : FALLBACK_PAYMENT_METHODS;
      setPaymentMethods(next);
      setPayment((current) => {
        const currentKey = current.methodId || current.methodCode || current.method;
        const stillAvailable = next.some((method) => paymentOptionKey(method) === currentKey || method.code === currentKey || method.legacyMethod === current.method);
        const preferred = stillAvailable
          ? next.find((method) => paymentOptionKey(method) === currentKey || method.code === currentKey || method.legacyMethod === current.method)
          : next.find((method) => method.legacyMethod === 'CASH') || next[0];
        return {
          ...current,
          method: preferred.legacyMethod || 'OTHER',
          methodId: preferred.id || '',
          methodCode: preferred.code || preferred.legacyMethod || '',
          methodName: paymentLabel(preferred),
        };
      });
    } catch (error) {
      setPaymentMethods(FALLBACK_PAYMENT_METHODS);
      notify('error', error?.message || 'Payment methods load failed');
    }
  };

  const loadCatalog = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(pageSize) });
      if (query.trim()) params.set('q', query.trim());
      if (categoryId) params.set('categoryId', categoryId);
      const data = await apiFetch(`/api/pos/catalog?${params.toString()}`);
      setCatalog(data.items || []);
      setTotalItems(Number(data.total || 0));
      setTotalPages(Math.max(1, Number(data.totalPages || 1)));
    } catch (error) {
      setCatalog([]);
      handleError(error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadCategories(); loadPaymentMethods(); }, []);
  useEffect(() => {
    const timer = window.setTimeout(loadCatalog, 180);
    return () => window.clearTimeout(timer);
  }, [query, categoryId, page, pageSize]);
  useEffect(() => { setPage(1); }, [query, categoryId, pageSize]);

  // Measure the rendered list and ask for as many products as actually fit.
  // Rounding to whole rows avoids a ragged half-filled last row.
  useEffect(() => {
    const measure = () => {
      const host = productListRef.current;
      if (!host) return;
      const grid = host.querySelector('.sale10-product-grid');
      const target = grid || host;
      const rect = target.getBoundingClientRect();
      if (!rect.height && !rect.top) return;
      const styles = window.getComputedStyle(target);
      const columns = grid
        ? Math.max(1, styles.gridTemplateColumns.split(' ').filter(Boolean).length)
        : 1;
      const gap = parseFloat(styles.rowGap || styles.gap || '0') || 0;
      const sample = target.querySelector('.sale10-product-grid-card') || target.querySelector('tbody tr');
      const sampleHeight = sample ? sample.getBoundingClientRect().height : 0;
      const cardHeight = sampleHeight || (grid ? GRID_CARD_FALLBACK_H : LIST_ROW_FALLBACK_H);
      const rowHeight = cardHeight + gap;
      if (rowHeight <= 0) return;
      const available = window.innerHeight - rect.top - PAGER_RESERVE_H;
      // One extra row past the fold so the space below never looks empty.
      const rows = Math.max(2, Math.round(available / rowHeight) + 1);
      const next = Math.min(MAX_PAGE_SIZE, Math.max(MIN_PAGE_SIZE, columns * rows));
      setPageSize((current) => (current === next ? current : next));
    };

    const timer = window.setTimeout(measure, 60);
    window.addEventListener('resize', measure);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('resize', measure);
    };
  }, [productView, catalog.length]);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (!cart.length) clearDraft(session);
      else saveDraft(session, { cart, customer, payment, splitPayments, discount });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [cart, customer, payment, splitPayments, discount]);

  const addProduct = (item, sourceElement = null) => {
    if (Number(item.available ?? item.stockQuantity ?? 0) <= 0) {
      notify('error', t('Out of stock.', 'Stock မရှိတော့ပါ။'));
      return;
    }

    const nextKey = item.requiresSerial ? `${item.id}_${Date.now()}_${Math.random()}` : item.id;
    setLastAddedKey(nextKey);
    setCart((current) => {
      if (item.requiresSerial) {
        return [...current, {
          ...item,
          key: nextKey,
          quantity: 1,
          unitPrice: String(item.standardSellingPrice || 0),
          imeiSerial: '',
        }];
      }
      const found = current.find((line) => line.id === item.id);
      if (!found) {
        return [...current, {
          ...item,
          key: item.id,
          quantity: 1,
          unitPrice: String(item.standardSellingPrice || 0),
          imeiSerial: '',
        }];
      }
      return current.map((line) => line.key === found.key
        ? { ...line, quantity: Number(line.quantity || 0) + 1 }
        : line);
    });

    animateProductToCart(item, sourceElement);
    playPosAddSound();
  };

  const searchSubmit = async () => {
    const value = query.trim();
    if (!value) return;
    try {
      const data = await apiFetch(`/api/pos/catalog?q=${encodeURIComponent(value)}&page=1&limit=30`);
      const exact = (data.items || []).find((item) => item.barcode === value || item.sku === value);
      if (!exact) return;
      addProduct({
        ...exact,
        available: Math.max(0, Number(exact.stockQuantity || 0) - Number(reserved.get(exact.id) || 0)),
      });
      setQuery('');
      searchRef.current?.focus();
    } catch (error) {
      handleError(error);
    }
  };

  const addScannedProduct = async (rawCode) => {
    const code = String(rawCode || '').trim();
    if (!code) return { ok: false, message: 'Barcode မရှိပါ' };
    try {
      const data = await apiFetch(`/api/pos/catalog?q=${encodeURIComponent(code)}&page=1&limit=30`);
      const exact = (data.items || []).find((item) => (
        String(item.barcode || '').trim() === code || String(item.sku || '').trim() === code
      ));
      if (!exact) {
        notify('error', `Barcode ${code} နှင့် Product မတွေ့ပါ`);
        return { ok: false, message: 'Product မတွေ့ပါ' };
      }
      const available = Math.max(0, Number(exact.stockQuantity || 0) - Number(reserved.get(exact.id) || 0));
      if (available <= 0) {
        notify('error', `${productName(exact)} Stock မရှိတော့ပါ`);
        return { ok: false, message: 'Stock မရှိတော့ပါ' };
      }
      addProduct({ ...exact, available });
      setQuery('');
      return { ok: true, message: `${productName(exact)} · Cart ထဲထည့်ပြီးပါပြီ` };
    } catch (error) {
      handleError(error);
      return { ok: false, message: error?.message || 'Barcode ရှာမရပါ' };
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
      const source = catalog.find((item) => item.id === line.id);
      if (!source || Number(source.stockQuantity || 0) <= Number(reserved.get(line.id) || 0)) {
        notify('error', t('Not enough stock.', 'Stock မလုံလောက်ပါ။'));
        return;
      }
      patchLine(line.key, { quantity: Number(line.quantity || 0) + 1 });
      playPosAddSound();
      return;
    }
    if (Number(line.quantity || 0) <= 1) {
      removeLine(line);
      return;
    }
    patchLine(line.key, { quantity: Number(line.quantity || 0) - 1 });
  };

  const clearCart = () => {
    if (!cart.length) return;
    if (!window.confirm(t('Clear the current sale?', 'Current sale ကို ရှင်းမလား?'))) return;
    setLastAddedKey('');
    setCart([]);
    setCustomer(EMPTY_CUSTOMER);
    setPayment(EMPTY_PAYMENT);
    setSplitPayments([]);
    setSplitModalOpen(false);
    setDiscount('0');
    clearDraft(session);
  };

  const scrollToCart = () => {
    cartRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const selectPaymentMethod = (method) => {
    setPayment((current) => ({
      ...current,
      method: method.legacyMethod || 'OTHER',
      methodId: method.id || '',
      methodCode: method.code || method.legacyMethod || '',
      methodName: paymentLabel(method),
      cashReceived: method.legacyMethod === 'CASH' ? current.cashReceived : '',
    }));
  };

  const normalizeSplitMethod = (value) => {
    const upper = String(value || '').toUpperCase();
    return ['CASH', 'KPAY', 'WAVE_PAY', 'CREDIT'].includes(upper) ? upper : 'OTHER';
  };

  const addSplitPayment = () => {
    const method = splitPaymentOptions.find((item) => item.legacyMethod === 'CASH') || splitPaymentOptions[0];
    if (!method) return notify('error', t('No payment type is available yet.', 'Payment Type မရှိသေးပါ။'));
    setSplitPayments((current) => [...current, {
      id: `split_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      methodKey: paymentOptionKey(method),
      method: normalizeSplitMethod(method.legacyMethod || method.code),
      methodName: paymentLabel(method),
      amount: String(splitPaymentBalance || total || ''),
      reference: '',
    }]);
    setSplitModalOpen(true);
  };

  const patchSplitPayment = (rowId, patch) => {
    setSplitPayments((current) => current.map((row) => row.id === rowId ? { ...row, ...patch } : row));
  };

  const changeSplitPaymentMethod = (rowId, methodKey) => {
    const method = splitPaymentOptions.find((item) => paymentOptionKey(item) === methodKey);
    if (!method) return;
    patchSplitPayment(rowId, {
      methodKey,
      method: normalizeSplitMethod(method.legacyMethod || method.code),
      methodName: paymentLabel(method),
    });
  };

  const removeSplitPayment = (rowId) => {
    setSplitPayments((current) => current.filter((row) => row.id !== rowId));
  };

  const validate = () => {
    if (!cart.length) return 'Cart is empty.';
    const belowMinimum = cart.find((line) => Number(line.unitPrice || 0) < Number(line.minimumSellingPrice || 0));
    if (belowMinimum) return t(
      `${productName(belowMinimum)} selling price is below the minimum price.`,
      `${productName(belowMinimum)} ရောင်းဈေးသည် Minimum Price အောက်ရောက်နေသည်။`,
    );
    const missingSerial = cart.find((line) => line.requiresSerial && !String(line.imeiSerial || '').trim());
    if (missingSerial) return t(
      `Enter IMEI / Serial for ${productName(missingSerial)}.`,
      `${productName(missingSerial)} အတွက် IMEI / Serial ထည့်ပါ။`,
    );
    if (safeDiscount > 0 && !canDiscount) return t('You do not have discount permission.', 'Discount permission မရှိပါ။');
    if (splitPaymentActive) {
      if (splitPayments.some((row) => Number(row.amount || 0) <= 0)) return t('One or more split payment amounts are invalid.', 'Split Payment amount မမှန်ပါ။');
      if (splitPaymentTotal < total) return t('Split payment total is less than the sale total.', 'Split Payment စုစုပေါင်းသည် Sale Total ထက် နည်းနေသည်။');
      if (splitPayments.some((row) => row.method === 'CREDIT') && !customer.name.trim() && !customer.phone.trim()) return t('Enter a customer for the credit portion.', 'Credit ပါဝင်သော Split Payment အတွက် Customer ထည့်ပါ။');
    } else {
      if (paymentLegacyMethod === 'CREDIT' && !customer.name.trim() && !customer.phone.trim()) return t('Enter a customer for credit sale.', 'Credit sale အတွက် customer ထည့်ပါ။');
      if (paymentLegacyMethod === 'CASH' && cashReceived < total) return 'Cash received is less than total.';
    }
    return '';
  };

  const openReview = () => {
    const error = validate();
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
          paymentMethod: splitPaymentActive ? 'MIXED' : paymentLegacyMethod,
          paymentMethodId: selectedPaymentMethod?.id || null,
          paymentMethodCode: selectedPaymentMethod?.code || payment.methodCode || paymentLegacyMethod,
          paymentMethodName: splitPaymentActive ? 'Split Payment' : paymentMethodLabel,
          paymentReference: payment.reference || null,
          cashReceived: splitPaymentActive ? splitPaymentTotal : cashReceived,
          ...(splitPaymentActive ? {
            payments: splitPayments.map((row) => ({
              method: normalizeSplitMethod(row.method),
              amount: Number(row.amount || 0),
              reference: [row.methodName, row.reference].filter(Boolean).join(' · ') || null,
            })),
          } : {}),
          items: cart.map((line) => ({
            productVariantId: line.id,
            quantity: Number(line.quantity || 0),
            unitPrice: Number(line.unitPrice || 0),
            imeiSerial: line.imeiSerial || null,
          })),
        },
      });

      playPaymentSuccessSound();
      clearDraft(session);
      setReviewOpen(false);
      setCompletedSale(data.sale);
      setCart([]);
      setCustomer(EMPTY_CUSTOMER);
      setPayment(EMPTY_PAYMENT);
      setSplitPayments([]);
      setDiscount('0');
      await loadCatalog();
    } catch (error) {
      setCheckoutError(error?.message || 'Checkout failed');
    } finally {
      setCheckoutBusy(false);
    }
  };

  return (
    <div className="stock-page sale10-page">
      {toast ? <div className={`stock-toast stock-toast-${toast.type}`}>{toast.text}</div> : null}

      {onboardingGuide?.show ? <FirstLoginGuide currentPage="Sale POS" businessType={onboardingGuide.businessType} onNavigate={onboardingGuide.navigate} onDismiss={onboardingGuide.dismiss}/> : null}

      {cart.length && latestCartLine ? (
        <section
          className="sale10-cart-peek"
          aria-live="polite"
          role="button"
          tabIndex={0}
          title="Open current cart"
          onClick={scrollToCart}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              scrollToCart();
            }
          }}
        >
          <div className="sale10-cart-peek-item">
            <span>Selected</span>
            <b>{productName(latestCartLine)}</b>
          </div>
          <div>
            <span>Qty</span>
            <b>{latestCartLine.quantity}</b>
          </div>
          <div>
            <span>Line</span>
            <b>{money(latestLineTotal)}</b>
          </div>
          <div className="sale10-cart-peek-total">
            <span>Cart Total</span>
            <b>{money(total)}</b>
          </div>
        </section>
      ) : null}

      <div className="sale10-main-grid">
        <section className="stock-card sale10-products-card">
          <div className="sale10-card-label sale10-product-label"><b>Product List</b><span>Click / tap item to add</span></div>
          <div className="stock-toolbar sale10-product-toolbar">
            <div className="stock-search-box">
              <Search size={18} />
              <input ref={searchRef} value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && searchSubmit()} placeholder="Product, SKU or Barcode ရှာရန်" />
              <button type="button" className="sale10-inline-scan" onClick={() => setScannerOpen(true)} aria-label="Scan barcode" title="Scan barcode"><Camera size={18} /></button>
            </div>
            <select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
              <option value="">All Categories</option>
              {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
            </select>
            <div className="sale10-view-toggle" aria-label="Product view">
              <button type="button" className={productView === 'grid' ? 'active' : ''} onClick={() => setProductView('grid')}><Grid3X3 size={15}/> Grid</button>
              <button type="button" className={productView === 'list' ? 'active' : ''} onClick={() => setProductView('list')}><List size={15}/> List</button>
            </div>
          </div>

          <div ref={productListRef} className="sale10-product-list-host">
          {loading && catalog.length === 0 ? (
            <div className="stock-loading"><Loader2 className="stock-spin" /> Loading products…</div>
          ) : availableCatalog.length === 0 ? (
            <div className="stock-empty"><Boxes size={38} /><b>No available products found</b><span>Stock ရှိသော Product ကိုအရင်ထည့်ပါ။</span></div>
          ) : (
            productView === 'grid' ? (
              <div className="sale10-product-grid">
                {availableCatalog.map((item) => {
                  const pickedQuantity = Number(reserved.get(item.id) || 0);
                  return <button type="button" key={item.id} className={`sale10-product-grid-card ${pickedQuantity > 0 ? 'in-cart' : ''}`} onClick={(event) => addProduct(item, event.currentTarget)}>
                    <div className={`sale10-grid-photo ${item.imageUrl ? 'has-image' : 'has-icon'}`}><ProductGridVisual item={item}/>{pickedQuantity > 0 ? <span>Cart {pickedQuantity}</span> : null}</div>
                    <b>{item.productName || 'Unnamed Product'}</b>
                    {variantLabel(item) ? <small>{variantLabel(item)}</small> : null}
                    <strong>{money(item.standardSellingPrice)}</strong>
                    <div className="sale10-grid-card-foot"><em className={item.available <= Number(item.minAlertQuantity || 0) ? 'low' : ''}>Stock {item.available}</em><i>+ Add</i></div>
                  </button>;
                })}
              </div>
            ) : (
            <div className="stock-table-wrap">
              <table className="stock-table sale10-product-table sale10-quick-product-table">
                <thead><tr><th>Product / Variant</th><th>Stock</th><th>Selling Price</th><th>Add</th></tr></thead>
                <tbody>
                  {availableCatalog.map((item) => {
                    const pickedQuantity = Number(reserved.get(item.id) || 0);
                    const expiryText = isMiniMart ? expiryWarning(item) : '';
                    return (
                    <tr
                      key={item.id}
                      className={`sale10-clickable-product-row ${pickedQuantity > 0 ? 'in-cart' : ''}`}
                      tabIndex={0}
                      role="button"
                      onClick={(event) => addProduct(item, event.currentTarget)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          addProduct(item);
                        }
                      }}
                    >
                      <td>
                        <div className="stock-product-cell">
                          <span>
                            <b>{item.productName || 'Unnamed Product'}</b>
                            {variantLabel(item) ? <small>{variantLabel(item)}</small> : null}
                            {pickedQuantity > 0 ? <small className="sale10-in-cart-badge">In cart · {pickedQuantity}</small> : null}
                            {query.trim() ? <small className="sale10-search-code">SKU: {item.sku || '-'} · Barcode: {item.barcode || '-'}</small> : null}
                            {item.unit ? <small className="sale10-unit-badge">Unit: {item.unit}</small> : null}
                            {expiryText ? <small className="sale10-expiry-warning">{expiryText}{item.expiryDate ? ` - Exp: ${item.expiryDate}` : ''}</small> : null}
                          </span>
                        </div>
                      </td>
                      <td><span className={`stock-quantity-badge ${item.available <= Number(item.minAlertQuantity || 0) ? 'low' : 'ok'}`}>{item.available}</span></td>
                      <td>
                        <span className="sale10-product-price">{money(item.standardSellingPrice)}</span>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="stock-action stock-action-green sale10-row-add"
                          onClick={(event) => {
                            event.stopPropagation();
                            addProduct(item, event.currentTarget);
                          }}
                        >
                          <Plus size={15} /> Add
                        </button>
                      </td>
                    </tr>
                  );})}
                </tbody>
              </table>
            </div>
            )
          )}
          </div>

          <footer className="stock-pagination">
            <span>Showing {availableCatalog.length} of {totalItems} products</span>
            <div>
              <button type="button" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={page <= 1}><ChevronLeft size={17} /> Previous</button>
              <b>{page} / {totalPages}</b>
              <button type="button" onClick={() => setPage((value) => Math.min(totalPages, value + 1))} disabled={page >= totalPages}>Next <ChevronRight size={17} /></button>
            </div>
          </footer>
        </section>

        <section className="stock-card sale10-cart-card" ref={cartRef}>
          <div className="sale10-cart-heading">
            <div><ShoppingCart size={20} /><span><b>Current Cart</b><small>Receipt list · {cart.length} lines · {unitCount} units</small></span></div>
            <button type="button" className="stock-action stock-action-red" onClick={clearCart} disabled={!cart.length}><Trash2 size={15} /> Clear</button>
          </div>

          <div className="sale10-cart-table-wrap">
            {cart.length === 0 ? (
              <div className="stock-empty sale10-cart-empty"><ShoppingCart size={38} /><b>Cart is empty</b><span>Product row ကိုတစ်ချက်နှိပ်ပါ။</span></div>
            ) : (
              <div className="sale10-cart-slip-list">
                {cart.map((line, lineIndex) => {
                  const lineTotal = Number(line.unitPrice || 0) * Number(line.quantity || 0);
                  const expiryText = isMiniMart ? expiryWarning(line) : '';
                  return (
                    <article key={line.key} className="sale10-cart-slip-row">
                      <div className="sale10-cart-slip-main">
                        <div className="sale10-cart-item-title"><span>{lineIndex + 1}</span><b>{productName(line)}</b></div>
                        {line.requiresSerial ? <input className="sale10-serial-input" value={line.imeiSerial || ''} onChange={(event) => patchLine(line.key, { imeiSerial: event.target.value })} placeholder="IMEI / Serial" /> : null}
                        {expiryText ? <small className="sale10-expiry-warning">{expiryText}{line.expiryDate ? ` - Exp: ${line.expiryDate}` : ''}</small> : null}
                      </div>
                      <div className="sale10-cart-quantity-field"><div className="sale10-quantity-control"><button type="button" onClick={() => changeQuantity(line, -1)}><Minus size={14} /></button><b>{line.quantity}</b><button type="button" onClick={() => changeQuantity(line, 1)} disabled={line.requiresSerial}><Plus size={14} /></button></div></div>
                      <label className="sale10-cart-price-field">
                        <span>Price</span>
                        <input className="sale10-price-input" type="number" min="0" value={line.unitPrice} onChange={(event) => patchLine(line.key, { unitPrice: event.target.value })} aria-label={`${productName(line)} selling price`} />
                      </label>
                      <div className="sale10-cart-line-total"><span>Total</span><b>{money(lineTotal)}</b></div>
                      <button type="button" className="sale10-remove-button" onClick={() => removeLine(line)} aria-label={`Remove ${productName(line)}`}><X size={15} /></button>
                    </article>
                  );
                })}
              </div>
            )}
          </div>

          <div className="sale10-checkout-panel">
            <div className="sale10-customer-grid">
              <label className="stock-field"><span>Customer Name</span><input value={customer.name} onChange={(event) => setCustomer({ ...customer, name: event.target.value })} placeholder="Walk-in Customer" /></label>
              <label className="stock-field"><span>Phone</span><input value={customer.phone} onChange={(event) => setCustomer({ ...customer, phone: event.target.value })} placeholder="09xxxxxxxxx" /></label>
            </div>

            <label className="stock-field sale10-discount-field"><span>Overall Discount</span><input type="number" min="0" value={discount} disabled={!canDiscount} onChange={(event) => setDiscount(event.target.value)} /><small>{canDiscount ? 'Applied to the whole sale' : 'Discount permission required'}</small></label>

            <div className="sale10-total-lines">
              <div><span>Subtotal</span><b>{money(subtotal)}</b></div>
              <div><span>Discount</span><b>-{money(safeDiscount)}</b></div>
              <div className="grand"><span>Total</span><b>{money(total)}</b></div>
            </div>

            <div className="sale10-payment-block-title"><CreditCard size={17} /><b>Payment Type</b></div>
            <div className="sale10-payment-methods">
              {paymentMethods.map((method) => {
                const active = paymentOptionKey(selectedPaymentMethod) === paymentOptionKey(method);
                const MethodIcon = method.legacyMethod === 'CREDIT' ? CreditCard : Wallet;
                return (
                <button type="button" key={paymentOptionKey(method)} className={active ? 'active' : ''} onClick={() => selectPaymentMethod(method)}>
                  <MethodIcon size={14} />
                  <span>
                    <b>{paymentLabel(method)}</b>
                    {method.legacyMethod !== 'CREDIT' ? <small>{money(method.balance)}</small> : <small>Customer credit</small>}
                  </span>
                </button>
              );})}
            </div>

            <div className="sale10-split-actions">
              <button type="button" className="sale10-split-trigger" onClick={() => splitPaymentActive ? setSplitModalOpen(true) : addSplitPayment()}>
                <CreditCard size={16}/><span>{splitPaymentActive ? 'Split ပြင်မယ်' : '+ Split Payment'}</span>
              </button>
              {splitPaymentActive ? <button type="button" className="sale10-single-trigger" onClick={() => { setSplitPayments([]); setSplitModalOpen(false); }}><Wallet size={16}/> Single Payment</button> : null}
            </div>

            {splitPaymentActive ? (
              <div className="sale10-split-summary sale10-split-summary-compact">
                <span>Paid/Covered <b>{money(splitPaymentTotal)}</b></span>
                <span>Balance <b>{money(splitPaymentBalance)}</b></span>
                <span>Change <b>{money(splitPaymentChange)}</b></span>
              </div>
            ) : paymentLegacyMethod === 'CASH' ? (
              <div className="sale10-customer-grid">
                <label className="stock-field"><span>Cash Received</span><input type="number" min="0" value={payment.cashReceived} onChange={(event) => setPayment({ ...payment, cashReceived: event.target.value })} placeholder={String(total)} /></label>
                <div className="sale10-change-box"><span>Change</span><b>{money(change)}</b></div>
              </div>
            ) : paymentLegacyMethod === 'CREDIT' ? (
              <div className="sale10-credit-note"><UserRound size={17} /> Credit sale အတွက် Customer Name သို့ Phone လိုအပ်ပါသည်။</div>
            ) : (
              <label className="stock-field"><span>Transaction Reference</span><input value={payment.reference} onChange={(event) => setPayment({ ...payment, reference: event.target.value })} placeholder="Optional reference" /></label>
            )}

            <button type="button" className="sale10-review-button" onClick={openReview} disabled={!cart.length}><CheckCircle2 size={18} /> Review & Confirm Sale</button>
          </div>
        </section>
      </div>

      {splitPaymentActive && splitModalOpen ? (
        <div className="sale10-split-modal-backdrop" role="dialog" aria-modal="true">
          <div className="sale10-split-modal">
            <header>
              <div>
                <span>Split Payment</span>
                <h3>ငွေပေးချေမှု ခွဲထည့်ရန်</h3>
              </div>
              <button type="button" onClick={() => setSplitModalOpen(false)}><X size={18} /></button>
            </header>

            <div className="sale10-split-box">
              {splitPayments.map((row) => (
                <div className="sale10-split-row" key={row.id}>
                  <select value={row.methodKey} onChange={(event) => changeSplitPaymentMethod(row.id, event.target.value)}>
                    {splitPaymentOptions.map((method) => <option key={paymentOptionKey(method)} value={paymentOptionKey(method)}>{paymentLabel(method)}</option>)}
                  </select>
                  <input type="number" min="0" value={row.amount} onChange={(event) => patchSplitPayment(row.id, { amount: event.target.value })} placeholder="Amount" />
                  <input value={row.reference || ''} onChange={(event) => patchSplitPayment(row.id, { reference: event.target.value })} placeholder="Reference optional" />
                  <button type="button" onClick={() => removeSplitPayment(row.id)}><X size={14} /></button>
                </div>
              ))}

              <button type="button" className="sale10-add-split-row" onClick={addSplitPayment}>+ Payment Row ထပ်ထည့်မယ်</button>

              {splitPayments.some((row) => row.method === 'CREDIT') ? <div className="sale10-split-credit-note"><UserRound size={16}/> Credit ပမာဏကို Customer အကြွေးစာရင်းထဲ အလိုအလျောက်ထည့်ပါမယ်။ Customer Name သို့ Phone ထည့်ထားရန်လိုပါတယ်။</div> : null}

              <div className="sale10-split-summary">
                <span>Paid/Covered <b>{money(splitPaymentTotal)}</b></span>
                <span>Balance <b>{money(splitPaymentBalance)}</b></span>
                <span>Change <b>{money(splitPaymentChange)}</b></span>
              </div>
            </div>

            <footer>
              <button type="button" onClick={() => { setSplitPayments([]); setSplitModalOpen(false); }}>Clear Split</button>
              <button type="button" className="primary" onClick={() => setSplitModalOpen(false)}>Done</button>
            </footer>
          </div>
        </div>
      ) : null}

      {reviewOpen ? <ReviewModal cart={cart} customer={customer} payment={payment} paymentLegacyMethod={splitPaymentActive ? 'MIXED' : paymentLegacyMethod} paymentMethodLabel={splitPaymentActive ? 'Split Payment' : paymentMethodLabel} subtotal={subtotal} discount={safeDiscount} total={total} cashReceived={splitPaymentActive ? splitPaymentTotal : cashReceived} change={splitPaymentActive ? splitPaymentChange : change} splitPayments={splitPayments} busy={checkoutBusy} error={checkoutError} onClose={() => setReviewOpen(false)} onConfirm={completeSale} /> : null}
      {scannerOpen ? <WebBarcodeScanner onClose={() => setScannerOpen(false)} onDetected={addScannedProduct} /> : null}
      {completedSale ? <CompletedModal sale={completedSale} onNewSale={() => { setCompletedSale(null); searchRef.current?.focus(); }} onHistory={onOpenHistory} /> : null}
    </div>
  );
}
