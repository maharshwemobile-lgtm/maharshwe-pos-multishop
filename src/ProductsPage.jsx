import React, { useEffect, useMemo, useState } from 'react';
import FirstLoginGuide from './FirstLoginGuide.jsx';
import {
  AlertTriangle,
  Boxes,
  ChevronDown,
  ChevronRight,
  Edit3,
  FolderPlus,
  Layers3,
  Loader2,
  LogIn,
  PackagePlus,
  Plus,
  Search,
  Tag,
  Trash2,
  X,
} from 'lucide-react';
import { apiFetch, clearSession, getSession, login } from './phase2Api';
import './products.css';

const money = (value) => `${Number(value || 0).toLocaleString('en-US')} MMK`;
const numberValue = (value) => Number(String(value ?? '').replaceAll(',', '')) || 0;
const dateInputValue = (value) => value ? String(value).slice(0, 10) : '';

const blankProduct = {
  categoryId: '',
  name: '',
  brand: '',
  model: '',
  requiresSerial: false,
  active: true,
};

const blankVariant = {
  variantName: '',
  sku: '',
  barcode: '',
  unit: '',
  ram: '',
  storage: '',
  color: '',
  expiryDate: '',
  costPrice: '',
  standardSellingPrice: '',
  wholesalePrice: '',
  minimumSellingPrice: '',
  initialQuantity: '0',
  minAlertQuantity: '0',
  active: true,
};

function Field({ label, children, hint }) {
  return (
    <label className="p2-field">
      <span>{label}</span>
      {children}
      {hint ? <small>{hint}</small> : null}
    </label>
  );
}

function Toggle({ checked, onChange, label }) {
  return (
    <label className="p2-toggle">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span aria-hidden="true" />
      <b>{label}</b>
    </label>
  );
}

function Modal({ title, subtitle, onClose, children, wide = false }) {
  return (
    <div className="p2-modal-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className={`p2-modal ${wide ? 'p2-modal-wide' : ''}`} role="dialog" aria-modal="true">
        <header>
          <div>
            <h3>{title}</h3>
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
          <button type="button" className="p2-icon-button" onClick={onClose} aria-label="Close"><X size={20} /></button>
        </header>
        {children}
      </section>
    </div>
  );
}

function LoginPanel({ onLoggedIn }) {
  const [form, setForm] = useState({ shopSlug: 'maharshwe-mobile', username: 'admin', password: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const session = await login(form);
      onLoggedIn(session);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="p2-login-card">
      <div className="p2-login-icon"><LogIn size={28} /></div>
      <h2>Products API Login</h2>
      <p>JWT session မရှိသေးပါ။ ဆိုင်အကောင့်ဖြင့် Login ဝင်ပြီး Products API ကို ချိတ်ပါ။</p>
      <form onSubmit={submit}>
        <Field label="Shop Slug">
          <input value={form.shopSlug} onChange={(event) => setForm({ ...form, shopSlug: event.target.value })} required />
        </Field>
        <Field label="Username">
          <input value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} required />
        </Field>
        <Field label="Password">
          <input type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} required autoFocus />
        </Field>
        {error ? <div className="p2-alert p2-alert-error">{error}</div> : null}
        <button className="primary p2-full-button" disabled={busy}>
          {busy ? <Loader2 className="p2-spin" size={18} /> : <LogIn size={18} />}
          Login
        </button>
      </form>
    </section>
  );
}

export default function ProductsPage({ onboardingGuide }) {
  const [session, setSession] = useState(() => getSession());
  const [categories, setCategories] = useState([]);
  const [products, setProducts] = useState([]);
  const [query, setQuery] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState(null);
  const [expanded, setExpanded] = useState(() => new Set());
  const [productEditor, setProductEditor] = useState(null);
  const [variantEditor, setVariantEditor] = useState(null);
  const [categoryEditor, setCategoryEditor] = useState(false);

  const user = session?.user;
  const canManage = !user || user.role === 'SUPER_ADMIN' || user.permissions?.inventory === true;
  const showCost = !user || user.role === 'SUPER_ADMIN' || user.permissions?.viewCost === true;

  const notify = (type, text) => {
    setMessage({ type, text });
    window.clearTimeout(notify.timer);
    notify.timer = window.setTimeout(() => setMessage(null), 3500);
  };

  const handleError = (error) => {
    if (error.status === 401) setSession(null);
    notify('error', error.message || 'Request failed');
  };

  const loadCategories = async () => {
    try {
      const data = await apiFetch('/api/categories');
      setCategories(data.categories || []);
    } catch (error) {
      handleError(error);
    }
  };

  const loadProducts = async () => {
    if (!session?.token) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: '20' });
      if (query.trim()) params.set('q', query.trim());
      if (categoryId) params.set('categoryId', categoryId);
      const data = await apiFetch(`/api/products?${params.toString()}`);
      setProducts(data.products || []);
      setTotal(data.total || 0);
      setTotalPages(Math.max(1, data.totalPages || 1));
    } catch (error) {
      handleError(error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!session?.token) return;
    loadCategories();
  }, [session?.token]);

  useEffect(() => {
    if (!session?.token) return;
    const timer = window.setTimeout(loadProducts, 250);
    return () => window.clearTimeout(timer);
  }, [session?.token, query, categoryId, page]);

  useEffect(() => setPage(1), [query, categoryId]);

  const summary = useMemo(() => {
    const variants = products.flatMap((product) => product.variants || []);
    const stock = variants.reduce((sum, variant) => sum + Number(variant.inventory?.quantity || 0), 0);
    const low = variants.filter((variant) => {
      const quantity = Number(variant.inventory?.quantity || 0);
      const minimum = Number(variant.inventory?.minAlertQuantity || 0);
      return minimum > 0 && quantity <= minimum;
    }).length;
    return { variants: variants.length, stock, low };
  }, [products]);

  const toggleExpanded = (id) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const openCreateProduct = () => setProductEditor({ mode: 'create', form: { ...blankProduct } });

  const openGuideAction = (action) => {
    if (action === 'add-product') {
      openCreateProduct();
      return;
    }
    if (action === 'add-variant') {
      const firstProduct = products.find((item) => item.active !== false) || products[0];
      if (!firstProduct) {
        notify('error', 'Product အရင် Save လုပ်ပါ။ ပြီးမှ Variant ထည့်ပါ။');
        openCreateProduct();
        return;
      }
      openVariant(firstProduct);
    }
  };
  const productFromCreateResponse = (response, fallback) => {
    const product = response?.product || response?.data?.product || response?.item || response;
    if (!product?.id) return null;
    return {
      ...product,
      name: product.name || fallback?.name || 'New Product',
      active: product.active !== false,
      variants: product.variants || [],
    };
  };

  const openEditProduct = (product) => setProductEditor({
    mode: 'edit',
    product,
    form: {
      categoryId: product.categoryId || '',
      name: product.name || '',
      brand: product.brand || '',
      model: product.model || '',
      requiresSerial: Boolean(product.requiresSerial),
      active: product.active !== false,
    },
  });

  const saveProduct = async (event) => {
    event.preventDefault();
    const editor = productEditor;
    const form = editor.form;
    if (!form.name.trim()) return notify('error', 'Product name ထည့်ပါ');

    const common = {
      categoryId: form.categoryId || null,
      name: form.name.trim(),
      brand: form.brand || null,
      model: form.model || null,
      requiresSerial: Boolean(form.requiresSerial),
      active: form.active !== false,
    };

    try {
      if (editor.mode === 'create') {
        const created = await apiFetch('/api/products', {
          method: 'POST',
          body: {
            ...common,
            variants: [],
          },
        });
        const createdProduct = productFromCreateResponse(created, common);
        setProductEditor(null);
        await Promise.all([loadProducts(), loadCategories()]);
        if (onboardingGuide?.show && createdProduct?.id) {
          notify('success', 'Product သိမ်းပြီးပါပြီ။ Variant / Stock ဆက်ထည့်ပါ။');
          openVariant(createdProduct);
          return;
        }
        notify('success', 'Product အသစ် သိမ်းပြီးပါပြီ။ Variant ကို Add Variant မှာသီးသန့်ထည့်ပါ');
        return;
      } else {
        await apiFetch(`/api/products/${editor.product.id}`, { method: 'PATCH', body: common });
        notify('success', 'Product ပြင်ဆင်ပြီးပါပြီ');
      }
      setProductEditor(null);
      await Promise.all([loadProducts(), loadCategories()]);
    } catch (error) {
      handleError(error);
    }
  };

  const deactivateProduct = async (product) => {
    if (!window.confirm(`${product.name} ကို Deactivate လုပ်မလား?`)) return;
    try {
      await apiFetch(`/api/products/${product.id}`, { method: 'DELETE' });
      notify('success', 'Product ကို Deactivate လုပ်ပြီးပါပြီ');
      loadProducts();
    } catch (error) {
      handleError(error);
    }
  };

  const openVariant = (product, variant = null) => setVariantEditor({
    mode: variant ? 'edit' : 'create',
    product,
    variant,
    form: variant ? {
      variantName: variant.variantName || '',
      sku: variant.sku || '',
      barcode: variant.barcode || '',
      unit: variant.unit || '',
      ram: variant.ram || '',
      storage: variant.storage || '',
      color: variant.color || '',
      expiryDate: dateInputValue(variant.expiryDate),
      costPrice: variant.costPrice ?? '',
      standardSellingPrice: variant.standardSellingPrice ?? '',
      wholesalePrice: variant.wholesalePrice ?? '',
      minimumSellingPrice: variant.minimumSellingPrice ?? '',
      initialQuantity: '0',
      minAlertQuantity: variant.inventory?.minAlertQuantity ?? '0',
      active: variant.active !== false,
    } : { ...blankVariant },
  });

  const saveVariant = async (event) => {
    event.preventDefault();
    const { mode, product, variant, form } = variantEditor;
    if (!form.variantName.trim()) return notify('error', 'Display name ထည့်ပါ');
    const body = {
      variantName: form.variantName.trim(),
      sku: form.sku || null,
      barcode: form.barcode || null,
      unit: form.unit || null,
      ram: form.ram || null,
      storage: form.storage || null,
      color: form.color || null,
      expiryDate: form.expiryDate || null,
      costPrice: numberValue(form.costPrice),
      standardSellingPrice: numberValue(form.standardSellingPrice),
      wholesalePrice: numberValue(form.wholesalePrice),
      minimumSellingPrice: numberValue(form.minimumSellingPrice),
      minAlertQuantity: Math.max(0, Math.trunc(numberValue(form.minAlertQuantity))),
      active: form.active !== false,
      ...(mode === 'create' ? { initialQuantity: Math.max(0, Math.trunc(numberValue(form.initialQuantity))) } : {}),
    };
    try {
      if (mode === 'create') {
        await apiFetch(`/api/products/${product.id}/variants`, { method: 'POST', body });
        notify('success', 'Variant အသစ် ထည့်ပြီးပါပြီ');
      } else {
        await apiFetch(`/api/variants/${variant.id}`, { method: 'PATCH', body });
        notify('success', 'Variant / specs ပြင်ဆင်ပြီးပါပြီ');
      }
      setVariantEditor(null);
      loadProducts();
    } catch (error) {
      handleError(error);
    }
  };

  const deactivateVariant = async (variant) => {
    if (!window.confirm(`${variant.variantName} ကို Deactivate လုပ်မလား? Sale history မပျက်အောင် အပြီးဖျက်မည်မဟုတ်ပါ။`)) return;
    try {
      await apiFetch(`/api/variants/${variant.id}`, { method: 'DELETE' });
      notify('success', 'Variant ကို Deactivate လုပ်ပြီးပါပြီ');
      loadProducts();
    } catch (error) {
      handleError(error);
    }
  };

  const logout = () => {
    clearSession();
    setSession(null);
  };

  const rawBusinessType = onboardingGuide?.businessType
    || session?.shop?.businessType
    || session?.user?.shop?.businessType
    || session?.businessType
    || session?.shopBusinessType
    || 'PHONE_SHOP';
  const isMiniMart = String(rawBusinessType).toUpperCase() === 'MINI_MART';
  const productCopy = isMiniMart ? {
    pageTitle: 'Mini Mart Products & Stock',
    pageIntro: 'Mini Mart ပစ္စည်း၊ Category၊ Barcode၊ Unit၊ Expiry၊ Price နဲ့ Stock ကို တစ်နေရာတည်းမှာ စီမံပါ။',
    searchPlaceholder: 'ပစ္စည်းနာမည်၊ SKU သို့ Barcode ရှာရန်...',
    productNameLabel: 'Item / Product Name *',
    productNameHint: 'ဥပမာ: Coca Cola 350ml, ဆန် ၂၄ပြည်, ဆီ ၁လီတာ',
    productNamePlaceholder: 'ဥပမာ: Coca Cola 350ml',
    categoryHint: 'ဥပမာ: Drinks, Food, Household, Medicine',
    variantLabel: 'Item Option / Package *',
    variantHint: 'Package/Size ကိုရေးပါ။ ဥပမာ: 350ml / 1kg / 12pcs box / Single',
    variantPlaceholder: 'ဥပမာ: 350ml',
    skuHint: 'ဆိုင်တွင်း product code ရှိရင်ထည့်ပါ။ မရှိရင် blank ထားလို့ရပါတယ်။',
    barcodeHint: 'Barcode scanner သုံးမယ်ဆို Barcode နံပါတ်ထည့်ပါ။',
    unitHint: 'ရေတွက်မယ့် unit ထည့်ပါ။ ဥပမာ: pcs / bottle / pack / box / kg',
    expiryHint: 'စားသောက်ကုန်/ဆေးဝါးလို သက်တမ်းကုန်ရက်ရှိတဲ့ပစ္စည်းဆို ထည့်ပါ။ မရှိရင် blank ထားပါ။',
    costHint: 'တစ်ခုဝယ်ဈေး / cost ထည့်ပါ။ Profit report အတွက်သုံးပါမယ်။',
    sellingHint: 'Customer ကိုရောင်းမယ့် ပုံမှန်ဈေး။',
    wholesaleHint: 'လက်ကားဈေးရှိမှထည့်ပါ။ မရှိရင် 0 ထားပါ။',
    minPriceHint: 'Discount ပေးလို့ရမယ့် အနိမ့်ဆုံးရောင်းဈေး။ မသုံးရင် Selling Price နဲ့တူထားပါ။',
    openingHint: 'လက်ရှိဆိုင်မှာရှိနေတဲ့ အရေအတွက်ကိုထည့်ပါ။',
    lowStockHint: 'ဒီအရေအတွက်အောက်ရောက်ရင် Low Stock warning ပြပါမယ်။',
  } : {
    pageTitle: 'Phone Shop Products & Variants',
    pageIntro: 'ဖုန်း၊ Accessories၊ Category၊ Brand/Model၊ Specs၊ Price နဲ့ Stock ကို တစ်နေရာတည်းမှာ စီမံပါ။',
    searchPlaceholder: 'ဖုန်း/ပစ္စည်းနာမည်၊ SKU၊ IMEI သို့ Barcode ရှာရန်...',
    productNameLabel: 'Product Name *',
    productNameHint: 'ဥပမာ: Redmi Note 15 Pro, iPhone 13, Type-C Charger',
    productNamePlaceholder: 'ဥပမာ: Redmi Note 15 Pro',
    categoryHint: 'ဥပမာ: Phones, Cases, Charger, Power Bank',
    brandHint: 'Brand ထည့်ပါ။ ဥပမာ: Redmi / Vivo / iPhone / Samsung',
    modelHint: 'Model ထည့်ပါ။ ဥပမာ: Note 15 Pro / Y28 / 13 Pro Max',
    variantLabel: 'Display Name / Specs *',
    variantHint: 'Customer မြင်မယ့် specs ကိုရေးပါ။ ဥပမာ: 8GB / 256GB / Black',
    variantPlaceholder: 'ဥပမာ: 8GB / 256GB / Black',
    skuHint: 'ဆိုင်တွင်း product code ရှိရင်ထည့်ပါ။ ဥပမာ: RN15P-8-256',
    barcodeHint: 'Accessories barcode ရှိရင်ထည့်ပါ။ Phone IMEI က sale ချိန်မှာထည့်လို့ရပါတယ်။',
    unitHint: 'အများအားဖြင့် pcs ထားပါ။ Accessories pack/box ဆို pack/box ထည့်နိုင်ပါတယ်။',
    expiryHint: 'Phone/Accessories အတွက် မလိုရင် blank ထားပါ။',
    ramHint: 'Phone RAM ထည့်ပါ။ ဥပမာ: 8GB',
    storageHint: 'Phone Storage ထည့်ပါ။ ဥပမာ: 128GB / 256GB',
    colorHint: 'အရောင်ထည့်ပါ။ ဥပမာ: Black / Blue / Gold',
    costHint: 'တစ်လုံး/တစ်ခု ဝယ်ဈေး။ Profit တွက်ဖို့လိုပါတယ်။',
    sellingHint: 'Customer ကိုရောင်းမယ့် ပုံမှန်ဈေး။',
    wholesaleHint: 'လက်ကား/Dealer price ရှိမှထည့်ပါ။ မရှိရင် 0 ထားပါ။',
    minPriceHint: 'အနိမ့်ဆုံးရောင်းနိုင်တဲ့ဈေး။ Discount approval အတွက်သုံးပါမယ်။',
    openingHint: 'လက်ရှိ stock အရေအတွက်ထည့်ပါ။ Phone serial များရင် qty ထည့်ပြီး sale ချိန် IMEI ထည့်ပါ။',
    lowStockHint: 'ဒီအရေအတွက်အောက်ရောက်ရင် Low Stock warning ပြပါမယ်။',
  };

  if (!session?.token) return <LoginPanel onLoggedIn={setSession} />;

  return (
    <div className="p2-products-page">
      {message ? <div className={`p2-toast p2-toast-${message.type}`}>{message.text}</div> : null}

      <section className="p2-page-heading">
        <div>
          <span className="p2-eyebrow">PRODUCTS</span>
          <h2>{productCopy.pageTitle}</h2>
          <p>{productCopy.pageIntro}</p>
        </div>
        <div className="p2-heading-actions">
          <button type="button" onClick={logout}>Logout API</button>
          {canManage ? <button type="button" onClick={() => setCategoryEditor(true)}><FolderPlus size={17} /> Categories</button> : null}
          {canManage ? <button type="button" className="primary" onClick={openCreateProduct}><Plus size={18} /> Add Product</button> : null}
        </div>
      </section>

      {onboardingGuide?.show ? <FirstLoginGuide currentPage="Products" businessType={onboardingGuide.businessType} onNavigate={onboardingGuide.navigate} onAction={openGuideAction} onDismiss={onboardingGuide.dismiss}/> : null}

      <section className="p2-summary-grid">
        <article><div className="p2-summary-icon p2-green"><Boxes /></div><span>Total Products</span><b>{total}</b></article>
        <article><div className="p2-summary-icon p2-blue"><Layers3 /></div><span>Variants on Page</span><b>{summary.variants}</b></article>
        <article><div className="p2-summary-icon p2-purple"><PackagePlus /></div><span>Units on Page</span><b>{summary.stock}</b></article>
        <article><div className="p2-summary-icon p2-orange"><AlertTriangle /></div><span>Low Stock on Page</span><b>{summary.low}</b></article>
      </section>

      <section className="card p2-products-card">
        <div className="p2-toolbar">
          <div className="p2-search-box"><Search size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={productCopy.searchPlaceholder} /></div>
          <select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
            <option value="">All Categories</option>
            {categories.filter((category) => category.active).map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
          </select>
        </div>

        <div className="p2-table-wrap">
          <table className="p2-product-table">
            <thead><tr><th /><th>Product</th><th>Category</th><th>Variants</th><th>Stock</th><th>Selling Price</th>{showCost ? <th>Cost</th> : null}<th>Status</th><th>Actions</th></tr></thead>
            <tbody>
              {loading ? <tr><td colSpan={showCost ? 9 : 8}><div className="p2-empty"><Loader2 className="p2-spin" /> Loading products...</div></td></tr> : null}
              {!loading && products.length === 0 ? <tr><td colSpan={showCost ? 9 : 8}><div className="p2-empty"><Boxes size={34} /><b>Product မတွေ့ပါ</b><span>Search/filter ပြောင်းပါ သို့ Product အသစ်ထည့်ပါ။</span></div></td></tr> : null}
              {!loading && products.map((product) => {
                const variants = product.variants || [];
                const quantity = variants.reduce((sum, variant) => sum + Number(variant.inventory?.quantity || 0), 0);
                const prices = variants.map((variant) => Number(variant.standardSellingPrice || 0)).filter((value) => value > 0);
                const costs = variants.map((variant) => Number(variant.costPrice || 0)).filter((value) => value > 0);
                const isOpen = expanded.has(product.id);
                return (
                  <React.Fragment key={product.id}>
                    <tr className={product.active ? '' : 'p2-row-inactive'}>
                      <td><button type="button" className="p2-expand" onClick={() => toggleExpanded(product.id)}>{isOpen ? <ChevronDown size={18} /> : <ChevronRight size={18} />}</button></td>
                      <td><div className="p2-product-name"><div><Tag size={18} /></div><span><b>{product.name}</b><small>{isMiniMart ? (product.category?.name || 'Mini Mart item') : ([product.brand, product.model, product.groupName].filter(Boolean).join(' · ') || 'No brand/model')}</small></span></div></td>
                      <td>{product.category?.name || 'Uncategorized'}</td>
                      <td>{variants.length}</td>
                      <td><b>{quantity}</b></td>
                      <td>{prices.length ? money(Math.min(...prices)) : '—'}</td>
                      {showCost ? <td>{costs.length ? money(Math.min(...costs)) : '—'}</td> : null}
                      <td><span className={`p2-status ${product.active ? 'p2-status-active' : 'p2-status-inactive'}`}>{product.active ? 'Active' : 'Inactive'}</span></td>
                      <td><div className="p2-actions">{canManage ? <button type="button" title="Add variant" onClick={() => openVariant(product)}><Plus size={16} /></button> : null}{canManage ? <button type="button" title="Edit product" onClick={() => openEditProduct(product)}><Edit3 size={16} /></button> : null}{canManage && product.active ? <button type="button" className="p2-danger" title="Deactivate product" onClick={() => deactivateProduct(product)}><Trash2 size={16} /></button> : null}</div></td>
                    </tr>
                    {isOpen ? <tr className="p2-variant-row"><td /><td colSpan={showCost ? 8 : 7}>
                      <div className="p2-variant-panel">
                        <div className="p2-variant-title"><div><Layers3 size={18} /><b>Variants</b></div>{canManage ? <button type="button" onClick={() => openVariant(product)}><Plus size={16} /> Add Variant</button> : null}</div>
                        {variants.length === 0 ? <div className="p2-empty-small">Variant မရှိသေးပါ</div> : <table><thead><tr><th>{isMiniMart ? 'Package / Option' : 'Variant'}</th><th>SKU / Barcode</th><th>{isMiniMart ? 'Unit' : 'RAM / Storage'}</th><th>{isMiniMart ? 'Expiry' : 'Color'}</th><th>{isMiniMart ? 'Barcode' : 'Unit / Expiry'}</th><th>Stock</th><th>Alert</th><th>Selling</th>{showCost ? <th>Cost / Min</th> : null}<th /></tr></thead><tbody>{variants.map((variant) => {
                          const stock = Number(variant.inventory?.quantity || 0);
                          const alert = Number(variant.inventory?.minAlertQuantity || 0);
                          const low = alert > 0 && stock <= alert;
                          return <tr key={variant.id} className={variant.active ? '' : 'p2-row-inactive'}><td><b>{variant.variantName}</b></td><td><span>{variant.sku || '—'}</span><small>{variant.barcode || ''}</small></td><td>{isMiniMart ? (variant.unit || '—') : ([variant.ram, variant.storage].filter(Boolean).join(' / ') || '—')}</td><td>{isMiniMart ? (variant.expiryDate ? dateInputValue(variant.expiryDate) : '—') : (variant.color || '—')}</td><td>{isMiniMart ? (variant.barcode || '—') : <><span>{variant.unit || '—'}</span><small>{variant.expiryDate ? dateInputValue(variant.expiryDate) : ''}</small></>}</td><td><span className={low ? 'p2-stock-low' : 'p2-stock-ok'}>{stock}</span></td><td>{alert}</td><td><span>{money(variant.standardSellingPrice)}</span>{Number(variant.wholesalePrice || 0) > 0 ? <small>Wholesale: {money(variant.wholesalePrice)}</small> : null}</td>{showCost ? <td><span>{money(variant.costPrice)}</span><small>Min: {money(variant.minimumSellingPrice)}</small></td> : null}<td><div className="p2-actions">{canManage ? <button type="button" title="Edit variant details" onClick={() => openVariant(product, variant)}><Edit3 size={15} /> Edit</button> : null}{canManage && variant.active ? <button type="button" className="p2-danger" title="Deactivate variant, keeps sale history safe" onClick={() => deactivateVariant(variant)}><Trash2 size={15} /> Deactivate</button> : null}</div></td></tr>;
                        })}</tbody></table>}
                      </div>
                    </td></tr> : null}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>

        <footer className="p2-pagination"><span>Page {page} / {totalPages} · Total {total}</span><div><button type="button" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Previous</button><button type="button" disabled={page >= totalPages} onClick={() => setPage((value) => value + 1)}>Next</button></div></footer>
      </section>

      {productEditor ? <Modal wide title={productEditor.mode === 'create' ? 'Add Product' : 'Edit Product'} subtitle="Product information ကို PostgreSQL tenant database ထဲ သိမ်းပါမယ်။" onClose={() => setProductEditor(null)}>
        <form onSubmit={saveProduct} className="p2-form">
          <div className="p2-form-grid">
            <Field label={productCopy.productNameLabel} hint={productCopy.productNameHint}><input value={productEditor.form.name} onChange={(event) => setProductEditor({ ...productEditor, form: { ...productEditor.form, name: event.target.value } })} placeholder={productCopy.productNamePlaceholder} required autoFocus /></Field>
            <Field label="Category" hint={productCopy.categoryHint}><div className="p2-inline-field-action"><select value={productEditor.form.categoryId} onChange={(event) => setProductEditor({ ...productEditor, form: { ...productEditor.form, categoryId: event.target.value } })}><option value="">Uncategorized</option>{categories.filter((category) => category.active).map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select>{canManage ? <button type="button" className="p2-icon-button" onClick={() => setCategoryEditor(true)} aria-label="Open category manager"><FolderPlus size={16} /></button> : null}</div></Field>
            {!isMiniMart ? <Field label="Brand" hint={productCopy.brandHint}><input value={productEditor.form.brand} onChange={(event) => setProductEditor({ ...productEditor, form: { ...productEditor.form, brand: event.target.value } })} placeholder="Redmi / Vivo / iPhone" /></Field> : null}
            {!isMiniMart ? <Field label="Model" hint={productCopy.modelHint}><input value={productEditor.form.model} onChange={(event) => setProductEditor({ ...productEditor, form: { ...productEditor.form, model: event.target.value } })} placeholder="Note 15 Pro / Y28" /></Field> : null}
          </div>
          <div className="p2-toggle-row">{!isMiniMart ? <Toggle checked={productEditor.form.requiresSerial} onChange={(checked) => setProductEditor({ ...productEditor, form: { ...productEditor.form, requiresSerial: checked } })} label="IMEI / Serial လိုအပ် (Phone stock အတွက်)" /> : null}<Toggle checked={productEditor.form.active} onChange={(checked) => setProductEditor({ ...productEditor, form: { ...productEditor.form, active: checked } })} label="Active" /></div>
          <div className="p2-modal-actions">{onboardingGuide?.show ? <div className="first-login-inline-guide"><b>Step 1</b> Product Name ထည့်ပြီး Save Product နှိပ်ပါ။ ပြီးရင် Add Variant ဆက်လုပ်ပါ။</div> : null}<button type="button" onClick={() => setProductEditor(null)}>Cancel</button><button className="primary">{productEditor.mode === 'create' ? 'Save Product' : 'Update Product'}</button></div>
        </form>
      </Modal> : null}

      {variantEditor ? <Modal wide title={variantEditor.mode === 'create' ? `Add Variant · ${variantEditor.product.name}` : `Edit Variant · ${variantEditor.product.name}`} onClose={() => setVariantEditor(null)}>
        <form onSubmit={saveVariant} className="p2-form">
          <div className="p2-form-grid p2-form-grid-3">
            <Field label={productCopy.variantLabel} hint={productCopy.variantHint}><input value={variantEditor.form.variantName} onChange={(event) => setVariantEditor({ ...variantEditor, form: { ...variantEditor.form, variantName: event.target.value } })} placeholder={productCopy.variantPlaceholder} required autoFocus /></Field>
            <Field label="SKU" hint={productCopy.skuHint}><input value={variantEditor.form.sku} onChange={(event) => setVariantEditor({ ...variantEditor, form: { ...variantEditor.form, sku: event.target.value } })} placeholder={isMiniMart ? 'ဥပမာ: COKE-350ML' : 'ဥပမာ: RN15P-8-256'} /></Field>
            <Field label="Barcode" hint={productCopy.barcodeHint}><input value={variantEditor.form.barcode} onChange={(event) => setVariantEditor({ ...variantEditor, form: { ...variantEditor.form, barcode: event.target.value } })} placeholder="Scan / type barcode" /></Field>
            <Field label="Unit" hint={productCopy.unitHint}><input value={variantEditor.form.unit} onChange={(event) => setVariantEditor({ ...variantEditor, form: { ...variantEditor.form, unit: event.target.value } })} placeholder={isMiniMart ? 'pcs / bottle / pack / kg' : 'pcs'} /></Field>
            <Field label="Expiry Date" hint={productCopy.expiryHint}><input type="date" value={variantEditor.form.expiryDate} onChange={(event) => setVariantEditor({ ...variantEditor, form: { ...variantEditor.form, expiryDate: event.target.value } })} /></Field>
            {!isMiniMart ? <Field label="RAM" hint={productCopy.ramHint}><input value={variantEditor.form.ram} onChange={(event) => setVariantEditor({ ...variantEditor, form: { ...variantEditor.form, ram: event.target.value } })} placeholder="8GB" /></Field> : null}
            {!isMiniMart ? <Field label="Storage" hint={productCopy.storageHint}><input value={variantEditor.form.storage} onChange={(event) => setVariantEditor({ ...variantEditor, form: { ...variantEditor.form, storage: event.target.value } })} placeholder="128GB / 256GB" /></Field> : null}
            {!isMiniMart ? <Field label="Color" hint={productCopy.colorHint}><input value={variantEditor.form.color} onChange={(event) => setVariantEditor({ ...variantEditor, form: { ...variantEditor.form, color: event.target.value } })} placeholder="Black / Blue / Gold" /></Field> : null}
            <Field label="Cost Price" hint={productCopy.costHint}><input type="number" min="0" value={variantEditor.form.costPrice} onChange={(event) => setVariantEditor({ ...variantEditor, form: { ...variantEditor.form, costPrice: event.target.value } })} placeholder="ဝယ်ဈေး" /></Field>
            <Field label="Selling Price" hint={productCopy.sellingHint}><input type="number" min="0" value={variantEditor.form.standardSellingPrice} onChange={(event) => setVariantEditor({ ...variantEditor, form: { ...variantEditor.form, standardSellingPrice: event.target.value } })} placeholder="ရောင်းဈေး" /></Field>
            <Field label="Wholesale Price" hint={productCopy.wholesaleHint}><input type="number" min="0" value={variantEditor.form.wholesalePrice} onChange={(event) => setVariantEditor({ ...variantEditor, form: { ...variantEditor.form, wholesalePrice: event.target.value } })} placeholder="0" /></Field>
            <Field label="Minimum Price" hint={productCopy.minPriceHint}><input type="number" min="0" value={variantEditor.form.minimumSellingPrice} onChange={(event) => setVariantEditor({ ...variantEditor, form: { ...variantEditor.form, minimumSellingPrice: event.target.value } })} placeholder="အနိမ့်ဆုံးဈေး" /></Field>
            {variantEditor.mode === 'create' ? <Field label="Opening Stock" hint={productCopy.openingHint}><input type="number" min="0" step="1" value={variantEditor.form.initialQuantity} onChange={(event) => setVariantEditor({ ...variantEditor, form: { ...variantEditor.form, initialQuantity: event.target.value } })} placeholder="0" /></Field> : null}
            <Field label="Low Stock Alert" hint={productCopy.lowStockHint}><input type="number" min="0" step="1" value={variantEditor.form.minAlertQuantity} onChange={(event) => setVariantEditor({ ...variantEditor, form: { ...variantEditor.form, minAlertQuantity: event.target.value } })} placeholder="0" /></Field>
          </div>
          <div className="p2-toggle-row"><Toggle checked={variantEditor.form.active} onChange={(checked) => setVariantEditor({ ...variantEditor, form: { ...variantEditor.form, active: checked } })} label="Active" /></div>
          <div className="p2-modal-actions">{onboardingGuide?.show ? <div className="first-login-inline-guide"><b>Step 2</b> Selling Price / Minimum Price / Opening Stock ထည့်ပြီး Save Variant နှိပ်ပါ။ ပြီးရင် Sale POS သွားရောင်းပါ။</div> : null}<button type="button" onClick={() => setVariantEditor(null)}>Cancel</button><button className="primary">{variantEditor.mode === 'create' ? 'Save Variant' : 'Update Variant'}</button></div>
        </form>
      </Modal> : null}

      {categoryEditor ? <CategoryManager categories={categories} onClose={() => setCategoryEditor(false)} onChanged={async () => { await loadCategories(); await loadProducts(); }} onError={handleError} notify={notify} /> : null}
    </div>
  );
}

function CategoryManager({ categories, onClose, onChanged, onError, notify }) {
  const [form, setForm] = useState({ id: '', name: '', kind: '' });
  const save = async (event) => {
    event.preventDefault();
    if (!form.name.trim()) return;
    try {
      if (form.id) await apiFetch(`/api/categories/${form.id}`, { method: 'PATCH', body: { name: form.name.trim(), kind: form.kind || null } });
      else await apiFetch('/api/categories', { method: 'POST', body: { name: form.name.trim(), kind: form.kind || null } });
      notify('success', form.id ? 'Category ပြင်ပြီးပါပြီ' : 'Category အသစ် ထည့်ပြီးပါပြီ');
      setForm({ id: '', name: '', kind: '' });
      await onChanged();
    } catch (error) {
      onError(error);
    }
  };
  const remove = async (category) => {
    if (!window.confirm(`${category.name} ကို Deactivate လုပ်မလား?`)) return;
    try {
      await apiFetch(`/api/categories/${category.id}`, { method: 'DELETE' });
      notify('success', 'Category ကို Deactivate လုပ်ပြီးပါပြီ');
      await onChanged();
    } catch (error) {
      onError(error);
    }
  };
  return <Modal title="Category Management" subtitle="Product Categories ကို Add၊ Edit၊ Deactivate လုပ်ပါ။" onClose={onClose}>
    <form className="p2-category-form" onSubmit={save}><input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Category name" required /><input value={form.kind} onChange={(event) => setForm({ ...form, kind: event.target.value })} placeholder="Kind (optional)" /><button className="primary">{form.id ? 'Update' : 'Add'}</button>{form.id ? <button type="button" onClick={() => setForm({ id: '', name: '', kind: '' })}>Cancel</button> : null}</form>
    <div className="p2-category-list">{categories.map((category) => <div key={category.id} className={category.active ? '' : 'p2-row-inactive'}><span><b>{category.name}</b><small>{category.kind || 'No kind'} · {category._count?.products || 0} products</small></span><div className="p2-actions"><button type="button" onClick={() => setForm({ id: category.id, name: category.name, kind: category.kind || '' })}><Edit3 size={15} /></button>{category.active ? <button type="button" className="p2-danger" onClick={() => remove(category)}><Trash2 size={15} /></button> : null}</div></div>)}</div>
  </Modal>;
}
