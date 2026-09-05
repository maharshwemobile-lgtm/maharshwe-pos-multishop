import React, { useEffect, useMemo, useState } from 'react';
import FirstLoginGuide from './FirstLoginGuide.jsx';
import InventoryImportReview from './InventoryImportReview.jsx';
import {
  AlertTriangle,
  Boxes,
  Camera,
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
import { apiFetch, getSession, login } from './phase2Api';
import { pickLanguageText } from './settings/ProjectLanguageRuntime.jsx';
import './products.css';
import WebBarcodeScanner from './pos/WebBarcodeScanner.jsx';

const PHONE_DEFAULT_CATEGORIES = [
  { name: 'Phone', kind: 'PHONE' },
  { name: 'Accessories', kind: 'ACCESSORIES' },
  { name: 'Electronics', kind: 'ELECTRONICS' },
  { name: 'Spare Parts', kind: 'REPAIR_PART' },
];

const inferPhoneBrandModel = (value) => {
  const name = String(value || '').replace(/\s+/g, ' ').trim();
  if (!name) return { brand: '', model: '' };
  const rules = [
    [/^redmi\s+/i, 'Redmi'], [/^xiaomi\s+/i, 'Xiaomi'], [/^samsung\s+/i, 'Samsung'],
    [/^vivo\s+/i, 'Vivo'], [/^oppo\s+/i, 'OPPO'], [/^realme\s+/i, 'realme'],
    [/^tecno\s+/i, 'TECNO'], [/^infinix\s+/i, 'Infinix'], [/^honor\s+/i, 'HONOR'],
    [/^huawei\s+/i, 'HUAWEI'], [/^nokia\s+/i, 'Nokia'], [/^oneplus\s+/i, 'OnePlus'],
    [/^nubia\s+/i, 'nubia'], [/^google\s+pixel\s+/i, 'Google'],
  ];
  if (/^iphone\b/i.test(name)) return { brand: 'Apple', model: name };
  for (const [pattern, brand] of rules) {
    if (pattern.test(name)) return { brand, model: name.replace(pattern, '').trim() };
  }
  return { brand: '', model: '' };
};

const money = (value) => `${Number(value || 0).toLocaleString('en-US')} MMK`;
const numberValue = (value) => Number(String(value ?? '').replaceAll(',', '')) || 0;
const dateInputValue = (value) => value ? String(value).slice(0, 10) : '';
const t = pickLanguageText;
const categoryAllowsVariants = (category) => !['ACCESSORIES', 'REPAIR_PART'].includes(String(category?.kind || '').toUpperCase());

const blankProduct = {
  categoryId: '',
  name: '',
  brand: '',
  model: '',
  requiresSerial: false,
  barcode: '',
  costPrice: '',
  standardSellingPrice: '',
  initialQuantity: '0',
  minAlertQuantity: '0',
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
          <input id="products-shop-slug" name="shopSlug" autoComplete="organization" value={form.shopSlug} onChange={(event) => setForm({ ...form, shopSlug: event.target.value })} required />
        </Field>
        <Field label="Username">
          <input id="products-username" name="username" type="text" autoComplete="username" autoCapitalize="none" spellCheck={false} value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} required />
        </Field>
        <Field label="Password">
          <input id="products-password" name="password" type="password" autoComplete="current-password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} required autoFocus />
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
  const [barcodeScannerOpen, setBarcodeScannerOpen] = useState(false);

  const user = session?.user;
  const canManage = !user || user.role === 'SUPER_ADMIN' || user.permissions?.inventory === true;
  const showCost = !user || user.role === 'SUPER_ADMIN' || user.permissions?.viewCost === true;
  const allowsVariants = (category) => categoryAllowsVariants(category);

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
      let rows = data.categories || [];
      // a shop with no category at all cannot save a product, so start it off
      // with the phone shop defaults
      if (rows.length === 0 && canManage) {
        for (const category of PHONE_DEFAULT_CATEGORIES) {
          try { await apiFetch('/api/categories', { method: 'POST', body: category }); } catch (error) {
            if (error?.status !== 409) throw error;
          }
        }
        const seeded = await apiFetch('/api/categories');
        rows = seeded.categories || [];
      }
      setCategories(rows);
    } catch (error) {
      handleError(error);
    }
  };

  // Create a category straight from the product form so adding a product never
  // dead-ends on a missing category.
  const addCategoryInline = async () => {
    const name = window.prompt(t('New category name', 'Category အသစ် နာမည်'));
    if (!name || !name.trim()) return;
    try {
      const created = await apiFetch('/api/categories', { method: 'POST', body: { name: name.trim(), kind: null } });
      await loadCategories();
      const id = created?.category?.id;
      if (id) setProductEditor((current) => current ? { ...current, form: { ...current.form, categoryId: id } } : current);
      notify('success', t('Category added.', 'Category ထည့်ပြီးပါပြီ'));
    } catch (error) {
      handleError(error);
    }
  };

  const loadProducts = async () => {
    if (!session?.token) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: '10' });
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

  const rememberedBrands = useMemo(() => [...new Set(products.map((item) => String(item.brand || '').trim()).filter(Boolean))].sort(), [products]);
  const rememberedModels = useMemo(() => [...new Set(products.map((item) => String(item.model || '').trim()).filter(Boolean))].sort(), [products]);

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
        notify('error', t('Save a product first, then add a variant.', 'Product အရင် Save လုပ်ပါ။ ပြီးမှ Variant ထည့်ပါ။'));
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
    if (!form.name.trim()) return notify('error', t('Please enter a product name.', 'Product name ထည့်ပါ'));
    if (!form.categoryId) return notify('error', t('Please select a category.', 'Category တစ်ခု ရွေးပါ'));

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
            variants: [{
              variantName: form.name.trim(),
              barcode: form.barcode || null,
              unit: 'pcs',
              costPrice: numberValue(form.costPrice),
              standardSellingPrice: numberValue(form.standardSellingPrice),
              minimumSellingPrice: numberValue(form.standardSellingPrice),
              initialQuantity: Math.max(0, Math.trunc(numberValue(form.initialQuantity))),
              minAlertQuantity: Math.max(0, Math.trunc(numberValue(form.minAlertQuantity))),
              active: true,
            }],
          },
        });
        const createdProduct = productFromCreateResponse(created, common);
        setProductEditor(null);
        await Promise.all([loadProducts(), loadCategories()]);
        const category = categories.find((item) => item.id === form.categoryId);
        if (createdProduct?.id && allowsVariants(category) && window.confirm(t('Product saved. Add an optional variant now?', 'Product သိမ်းပြီးပါပြီ။ Optional Variant ထပ်ထည့်မလား?'))) {
          openVariant(createdProduct);
          return;
        }
        notify('success', t('Product saved successfully.', 'Product သိမ်းပြီးပါပြီ'));
        return;
      } else {
        await apiFetch(`/api/products/${editor.product.id}`, { method: 'PATCH', body: common });
        notify('success', t('Product updated successfully.', 'Product ပြင်ဆင်ပြီးပါပြီ'));
      }
      setProductEditor(null);
      await Promise.all([loadProducts(), loadCategories()]);
    } catch (error) {
      handleError(error);
    }
  };

  const deactivateProduct = async (product) => {
    if (!window.confirm(t(`Deactivate ${product.name}?`, `${product.name} ကို Deactivate လုပ်မလား?`))) return;
    try {
      await apiFetch(`/api/products/${product.id}`, { method: 'DELETE' });
      notify('success', t('Product deactivated successfully.', 'Product ကို Deactivate လုပ်ပြီးပါပြီ'));
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
    if (!form.variantName.trim()) return notify('error', t('Please enter a display name.', 'Display name ထည့်ပါ'));
    const body = {
      variantName: form.variantName.trim(),
      sku: form.sku || null,
      barcode: form.barcode || null,
      unit: form.unit || null,
      ram: form.ram || null,
      storage: form.storage || null,
      color: form.color || null,
      expiryDate: mode === 'edit' ? (variant?.expiryDate || null) : null,
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
        notify('success', t('New variant added successfully.', 'Variant အသစ် ထည့်ပြီးပါပြီ'));
      } else {
        await apiFetch(`/api/variants/${variant.id}`, { method: 'PATCH', body });
        notify('success', t('Variant and specs updated successfully.', 'Variant / specs ပြင်ဆင်ပြီးပါပြီ'));
      }
      setVariantEditor(null);
      loadProducts();
    } catch (error) {
      handleError(error);
    }
  };

  const deactivateVariant = async (variant) => {
    if (!window.confirm(t(`Deactivate ${variant.variantName}? Sale history will be kept safe.`, `${variant.variantName} ကို Deactivate လုပ်မလား? Sale history မပျက်အောင် အပြီးဖျက်မည်မဟုတ်ပါ။`))) return;
    try {
      await apiFetch(`/api/variants/${variant.id}`, { method: 'DELETE' });
      notify('success', t('Variant deactivated successfully.', 'Variant ကို Deactivate လုပ်ပြီးပါပြီ'));
      loadProducts();
    } catch (error) {
      handleError(error);
    }
  };

  const productCopy = {
    pageTitle: 'Phone Shop Products & Variants',
    pageIntro: 'ဖုန်း၊ Accessories၊ Category၊ Brand/Model၊ Specs၊ Price နဲ့ Stock ကို တစ်နေရာတည်းမှာ စီမံပါ။',
    searchPlaceholder: 'ဖုန်း/ပစ္စည်းနာမည်၊ SKU၊ IMEI သို့ Barcode ရှာရန်...',
    productNameLabel: 'Product Name *',
    productNameHint: 'ဥပမာ: Redmi Note 15 Pro, iPhone 13, Type-C Charger',
    productNamePlaceholder: 'ဥပမာ: Redmi Note 15 Pro',
    categoryHint: 'ဥပမာ: Phones, Cases, Charger, Power Bank',
    categoryFieldHint: 'Phone, Accessories, Electronics သို့ Spare Parts ရွေးပါ။ အသစ်ထည့်ချင်ရင် ဘေးက 📁 ကို နှိပ်ပါ။',
    formSubtitle: 'Product အချက်အလက်ကို ဆိုင်ရဲ့ database ထဲ သိမ်းပါမယ်။',
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

      <section className="p2-page-heading p2-page-actions-only">
        <div className="p2-heading-actions">
          {canManage ? <InventoryImportReview compact onImported={loadProducts}/> : null}
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
                      <td><div className="p2-product-name"><div><Tag size={18} /></div><span><b>{product.name}</b><small>{[product.brand, product.model, product.groupName].filter(Boolean).join(' · ') || 'No brand/model'}</small></span></div></td>
                      <td>{product.category?.name || 'Uncategorized'}</td>
                      <td>{variants.length}</td>
                      <td><b>{quantity}</b></td>
                      <td>{prices.length ? money(Math.min(...prices)) : '—'}</td>
                      {showCost ? <td>{costs.length ? money(Math.min(...costs)) : '—'}</td> : null}
                      <td><span className={`p2-status ${product.active ? 'p2-status-active' : 'p2-status-inactive'}`}>{product.active ? 'Active' : 'Inactive'}</span></td>
                      <td><div className="p2-actions">{canManage && allowsVariants(product.category) ? <button type="button" title="Add optional variant" onClick={() => openVariant(product)}><Plus size={16} /></button> : null}{canManage ? <button type="button" title="Edit product" onClick={() => openEditProduct(product)}><Edit3 size={16} /></button> : null}{canManage && product.active ? <button type="button" className="p2-danger" title="Deactivate product" onClick={() => deactivateProduct(product)}><Trash2 size={16} /></button> : null}</div></td>
                    </tr>
                    {isOpen ? <tr className="p2-variant-row"><td /><td colSpan={showCost ? 8 : 7}>
                      <div className="p2-variant-panel">
                        <div className="p2-variant-title"><div><Layers3 size={18} /><b>{allowsVariants(product.category) ? 'Variants (Optional)' : 'Stock & Price'}</b></div>{canManage && allowsVariants(product.category) ? <button type="button" onClick={() => openVariant(product)}><Plus size={16} /> Add Variant</button> : null}</div>
                        {variants.length === 0 ? <div className="p2-empty-small">Variant မရှိသေးပါ</div> : <table><thead><tr><th>Variant</th><th>SKU / Barcode</th><th>RAM / Storage</th><th>Color</th><th>Unit</th><th>Stock</th><th>Alert</th><th>Selling</th>{showCost ? <th>Cost / Min</th> : null}<th /></tr></thead><tbody>{variants.map((variant) => {
                          const stock = Number(variant.inventory?.quantity || 0);
                          const alert = Number(variant.inventory?.minAlertQuantity || 0);
                          const low = alert > 0 && stock <= alert;
                          return <tr key={variant.id} className={variant.active ? '' : 'p2-row-inactive'}><td><b>{variant.variantName}</b></td><td><span>{variant.sku || '—'}</span><small>{variant.barcode || ''}</small></td><td>{[variant.ram, variant.storage].filter(Boolean).join(' / ') || '—'}</td><td>{variant.color || '—'}</td><td>{variant.unit || '—'}</td><td><span className={low ? 'p2-stock-low' : 'p2-stock-ok'}>{stock}</span></td><td>{alert}</td><td><span>{money(variant.standardSellingPrice)}</span>{Number(variant.wholesalePrice || 0) > 0 ? <small>Wholesale: {money(variant.wholesalePrice)}</small> : null}</td>{showCost ? <td><span>{money(variant.costPrice)}</span><small>Min: {money(variant.minimumSellingPrice)}</small></td> : null}<td><div className="p2-actions">{canManage ? <button type="button" title="Edit variant details" onClick={() => openVariant(product, variant)}><Edit3 size={15} /> Edit</button> : null}{canManage && variant.active ? <button type="button" className="p2-danger" title="Deactivate variant, keeps sale history safe" onClick={() => deactivateVariant(variant)}><Trash2 size={15} /> Deactivate</button> : null}</div></td></tr>;
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

      {productEditor ? <Modal wide title={productEditor.mode === 'create' ? 'Add Product' : 'Edit Product'} subtitle={productCopy.formSubtitle} onClose={() => setProductEditor(null)}>
        <form onSubmit={saveProduct} className="p2-form">
          <div className="p2-form-grid">
            <Field label={productCopy.productNameLabel} hint={productCopy.productNameHint}><input value={productEditor.form.name} onChange={(event) => {
              const name = event.target.value;
              const inferred = inferPhoneBrandModel(name);
              setProductEditor({ ...productEditor, form: { ...productEditor.form, name, ...(inferred.brand ? inferred : {}) } });
            }} placeholder={productCopy.productNamePlaceholder} required autoFocus /></Field>
            <Field label="Category *" hint={productCopy.categoryFieldHint}><div className="p2-inline-field-action"><select required value={productEditor.form.categoryId} onChange={(event) => setProductEditor({ ...productEditor, form: { ...productEditor.form, categoryId: event.target.value } })}><option value="">{t('Select Category', 'Category ရွေးပါ')}</option>{categories.filter((category) => category.active).map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select>{canManage ? <button type="button" className="p2-icon-button" onClick={addCategoryInline} aria-label={t('Add category', 'Category အသစ်ထည့်')} title={t('Add category', 'Category အသစ်ထည့်')}><FolderPlus size={16} /></button> : null}</div></Field>
            <Field label="Brand" hint="တစ်ခါထည့်ဖူးသော Brand ကို ရိုက်ရှာပြီး ရွေးနိုင်ပါတယ်။"><input list="remembered-product-brands" value={productEditor.form.brand} onChange={(event) => setProductEditor({ ...productEditor, form: { ...productEditor.form, brand: event.target.value } })} placeholder="Vivo / Redmi / Samsung" /><datalist id="remembered-product-brands">{rememberedBrands.map((brand) => <option key={brand} value={brand} />)}</datalist></Field>
            <Field label="Model" hint="ရွေးထားသော Brand အတွက် Model အသစ် သို့မဟုတ် မှတ်ထားပြီးသား Model ထည့်ပါ။"><input list="remembered-product-models" value={productEditor.form.model} onChange={(event) => setProductEditor({ ...productEditor, form: { ...productEditor.form, model: event.target.value } })} placeholder="Y28 / Note 15 Pro" /><datalist id="remembered-product-models">{rememberedModels.map((model) => <option key={model} value={model} />)}</datalist></Field>
            {productEditor.mode === 'create' ? <>
              <Field label="Barcode" hint="Manual ရိုက်နိုင်သလို Camera နဲ့ Scan လည်းလုပ်နိုင်ပါတယ်။"><div className="p2-inline-field-action"><input value={productEditor.form.barcode} onChange={(event) => setProductEditor({ ...productEditor, form: { ...productEditor.form, barcode: event.target.value } })} placeholder="Scan / type barcode" /><button type="button" className="p2-icon-button" onClick={() => setBarcodeScannerOpen(true)} aria-label="Scan barcode"><Camera size={16} /></button></div></Field>
              <Field label="Cost Price"><input type="number" min="0" value={productEditor.form.costPrice} onChange={(event) => setProductEditor({ ...productEditor, form: { ...productEditor.form, costPrice: event.target.value } })} /></Field>
              <Field label="Selling Price"><input type="number" min="0" value={productEditor.form.standardSellingPrice} onChange={(event) => setProductEditor({ ...productEditor, form: { ...productEditor.form, standardSellingPrice: event.target.value } })} /></Field>
              <Field label="Opening Stock"><input type="number" min="0" step="1" value={productEditor.form.initialQuantity} onChange={(event) => setProductEditor({ ...productEditor, form: { ...productEditor.form, initialQuantity: event.target.value } })} /></Field>
              <Field label="Low Stock Alert"><input type="number" min="0" step="1" value={productEditor.form.minAlertQuantity} onChange={(event) => setProductEditor({ ...productEditor, form: { ...productEditor.form, minAlertQuantity: event.target.value } })} /></Field>
            </> : null}
          </div>
          <div className="p2-toggle-row"><Toggle checked={productEditor.form.requiresSerial} onChange={(checked) => setProductEditor({ ...productEditor, form: { ...productEditor.form, requiresSerial: checked } })} label="IMEI / Serial လိုအပ် (Phone stock အတွက်)" /><Toggle checked={productEditor.form.active} onChange={(checked) => setProductEditor({ ...productEditor, form: { ...productEditor.form, active: checked } })} label="Active" /></div>
          <div className="p2-modal-actions">{onboardingGuide?.show ? <div className="first-login-inline-guide"><b>Step 1</b> Product Name ထည့်ပြီး Save Product နှိပ်ပါ။ ပြီးရင် Add Variant ဆက်လုပ်ပါ။</div> : null}<button type="button" onClick={() => setProductEditor(null)}>Cancel</button><button className="primary">{productEditor.mode === 'create' ? 'Save Product' : 'Update Product'}</button></div>
        </form>
      </Modal> : null}

      {variantEditor ? <Modal wide title={variantEditor.mode === 'create' ? `Add Variant · ${variantEditor.product.name}` : `Edit Variant · ${variantEditor.product.name}`} onClose={() => setVariantEditor(null)}>
        <form onSubmit={saveVariant} className="p2-form">
          <div className="p2-form-grid p2-form-grid-3">
            <Field label={productCopy.variantLabel} hint={productCopy.variantHint}><input value={variantEditor.form.variantName} onChange={(event) => setVariantEditor({ ...variantEditor, form: { ...variantEditor.form, variantName: event.target.value } })} placeholder={productCopy.variantPlaceholder} required autoFocus /></Field>
            <Field label="SKU" hint={productCopy.skuHint}><input value={variantEditor.form.sku} onChange={(event) => setVariantEditor({ ...variantEditor, form: { ...variantEditor.form, sku: event.target.value } })} placeholder="ဥပမာ: RN15P-8-256" /></Field>
            <Field label="Barcode" hint={productCopy.barcodeHint}><input value={variantEditor.form.barcode} onChange={(event) => setVariantEditor({ ...variantEditor, form: { ...variantEditor.form, barcode: event.target.value } })} placeholder="Scan / type barcode" /></Field>
            <Field label="Unit" hint={productCopy.unitHint}><input value={variantEditor.form.unit} onChange={(event) => setVariantEditor({ ...variantEditor, form: { ...variantEditor.form, unit: event.target.value } })} placeholder="pcs" /></Field>
            <Field label="RAM" hint={productCopy.ramHint}><input value={variantEditor.form.ram} onChange={(event) => setVariantEditor({ ...variantEditor, form: { ...variantEditor.form, ram: event.target.value } })} placeholder="8GB" /></Field>
            <Field label="Storage" hint={productCopy.storageHint}><input value={variantEditor.form.storage} onChange={(event) => setVariantEditor({ ...variantEditor, form: { ...variantEditor.form, storage: event.target.value } })} placeholder="128GB / 256GB" /></Field>
            <Field label="Color" hint={productCopy.colorHint}><input value={variantEditor.form.color} onChange={(event) => setVariantEditor({ ...variantEditor, form: { ...variantEditor.form, color: event.target.value } })} placeholder="Black / Blue / Gold" /></Field>
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
      {barcodeScannerOpen ? <WebBarcodeScanner onClose={() => setBarcodeScannerOpen(false)} onDetected={(code) => {
        setProductEditor((current) => current ? { ...current, form: { ...current.form, barcode: String(code || '').trim() } } : current);
        setBarcodeScannerOpen(false);
        return { ok: true, message: 'Barcode ထည့်ပြီးပါပြီ' };
      }} /> : null}
    </div>
  );
}

function CategoryManager({ categories, onClose, onChanged, onError, notify }) {
  const [form, setForm] = useState({ id: '', name: '', kind: '', condition: 'NEW' });
  const save = async (event) => {
    event.preventDefault();
    if (!form.name.trim()) return;
    try {
      const body = { name: form.name.trim(), kind: form.kind || null, condition: form.condition === 'SECOND_HAND' ? 'SECOND_HAND' : 'NEW' };
      if (form.id) await apiFetch(`/api/categories/${form.id}`, { method: 'PATCH', body });
      else await apiFetch('/api/categories', { method: 'POST', body });
      notify('success', form.id ? t('Category updated successfully.', 'Category ပြင်ပြီးပါပြီ') : t('New category added successfully.', 'Category အသစ် ထည့်ပြီးပါပြီ'));
      setForm({ id: '', name: '', kind: '', condition: 'NEW' });
      await onChanged();
    } catch (error) {
      onError(error);
    }
  };
  const remove = async (category) => {
    if (!window.confirm(t(`Deactivate ${category.name}?`, `${category.name} ကို Deactivate လုပ်မလား?`))) return;
    try {
      await apiFetch(`/api/categories/${category.id}`, { method: 'DELETE' });
      notify('success', t('Category deactivated successfully.', 'Category ကို Deactivate လုပ်ပြီးပါပြီ'));
      await onChanged();
    } catch (error) {
      onError(error);
    }
  };
  return <Modal title="Category Management" subtitle="Product Categories ကို Add၊ Edit၊ Deactivate လုပ်ပါ။ ဖုန်း category အတွက် စက်အသစ် / စက်ဟောင်း ရွေးထားပါ — ရောင်းအား slip မှာ အာမခံစာ အလိုအလျောက် ထည့်ပေးပါမည်။" onClose={onClose}>
    <form className="p2-category-form" onSubmit={save}><input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Category name" required /><input value={form.kind} onChange={(event) => setForm({ ...form, kind: event.target.value })} placeholder="Kind (optional)" /><select value={form.condition} onChange={(event) => setForm({ ...form, condition: event.target.value })} title="ဤ category မှ ဖုန်းရောင်းလျှင် ရောင်းအား slip တွင် ထည့်ပေးမည့် အာမခံစာ"><option value="NEW">Brand New (စက်အသစ်)</option><option value="SECOND_HAND">Second-hand (စက်ဟောင်း)</option></select><button className="primary">{form.id ? 'Update' : 'Add'}</button>{form.id ? <button type="button" onClick={() => setForm({ id: '', name: '', kind: '', condition: 'NEW' })}>Cancel</button> : null}</form>
    <div className="p2-category-list">{categories.map((category) => <div key={category.id} className={category.active ? '' : 'p2-row-inactive'}><span><b>{category.name}</b><small>{category.kind || 'No kind'} · {category._count?.products || 0} products{category.condition === 'SECOND_HAND' ? ' · စက်ဟောင်း' : ''}</small></span><div className="p2-actions"><button type="button" onClick={() => setForm({ id: category.id, name: category.name, kind: category.kind || '', condition: category.condition || 'NEW' })}><Edit3 size={15} /></button>{category.active ? <button type="button" className="p2-danger" onClick={() => remove(category)}><Trash2 size={15} /></button> : null}</div></div>)}</div>
  </Modal>;
}
