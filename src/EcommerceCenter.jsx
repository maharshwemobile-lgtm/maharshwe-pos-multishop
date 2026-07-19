import { useEffect, useState } from 'react';
import { ChevronDown, ExternalLink, ImagePlus, LayoutGrid, List, PackageCheck, Save, ShoppingBag, Store } from 'lucide-react';
import { apiFetch, getSession } from './phase2Api';
import './ecommerce-center.css';
import './ecommerce-center-filters.css';
import './ecommerce-image-manager.css';

const money = (value) => `${Number(value || 0).toLocaleString()} MMK`;
const emptyMeta = { page: 1, totalPages: 1, total: 0, onlineTotal: 0, brands: [], categories: [] };

export default function EcommerceCenter() {
  const [tab, setTab] = useState('setup');
  const [meta, setMeta] = useState(null);
  const [settings, setSettings] = useState({ enabled: false, deliveryEnabled: true, pickupEnabled: true, deliveryFee: 0 });
  const [products, setProducts] = useState([]);
  const [productMeta, setProductMeta] = useState(emptyMeta);
  const [filters, setFilters] = useState({ brand: '', categoryId: '', stockLevel: '' });
  const [orders, setOrders] = useState([]);
  const [productView, setProductView] = useState('list');
  const [expandedProductId, setExpandedProductId] = useState(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  async function load(nextPage = productMeta.page || 1, nextFilters = filters) {
    setBusy(true); setMessage('');
    try {
      const query = new URLSearchParams({ page: String(nextPage), ...nextFilters });
      const [settingsData, productsData, ordersData] = await Promise.all([apiFetch('/api/ecommerce/settings'), apiFetch(`/api/ecommerce/products?${query}`), apiFetch('/api/ecommerce/orders?page=1')]);
      setMeta(settingsData); setSettings((current) => ({ ...current, ...(settingsData.settings || {}) }));
      setProducts(productsData.products || []); setProductMeta({ ...emptyMeta, ...productsData }); setOrders(ordersData.orders || []);
    } catch (error) { setMessage(error.message); } finally { setBusy(false); }
  }
  useEffect(() => { load(1, filters); }, []);

  async function saveSettings() {
    setBusy(true); try { const data = await apiFetch('/api/ecommerce/settings', { method: 'PUT', body: settings }); setSettings(data.settings); setMessage('Online shop settings saved.'); } catch (error) { setMessage(error.message); } finally { setBusy(false); }
  }
  async function openStore() {
    if (!meta?.storeUrl) return;
    if (settings.enabled) return window.open(meta.storeUrl, '_blank', 'noopener,noreferrer');
    if (!window.confirm('Online Shop မဖွင့်ရသေးပါ။ အခုဖွင့်ပြီး Store ကိုကြည့်မလား?')) return;
    const popup = window.open('about:blank', '_blank'); setBusy(true);
    try { const data = await apiFetch('/api/ecommerce/settings', { method: 'PUT', body: { ...settings, enabled: true } }); setSettings(data.settings); if (popup) { popup.opener = null; popup.location.replace(meta.storeUrl); } else window.location.assign(meta.storeUrl); }
    catch (error) { if (popup) popup.close(); setMessage(error.message); } finally { setBusy(false); }
  }
  async function saveProduct(product, patch) {
    setBusy(true); try { await apiFetch(`/api/ecommerce/products/${product.id}`, { method: 'PUT', body: patch }); setMessage(`${product.name} updated.`); await load(productMeta.page, filters); }
    catch (error) { setMessage(error.message); setBusy(false); throw error; }
  }
  async function uploadImages(product, files) {
    if (!files?.length) return false;
    const form = new FormData(); [...files].slice(0, 3).forEach((file) => form.append('images', file));
    const token = getSession()?.token; setBusy(true);
    try { const response = await fetch(`/api/ecommerce/products/${product.id}/images`, { method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {}, body: form }); const data = await response.json().catch(() => ({})); if (!response.ok) throw new Error(data.message || `Image upload failed (HTTP ${response.status})`); setMessage('Product Photo တင်ပြီးပါပြီ။'); await load(productMeta.page, filters); return true; }
    catch (error) { setMessage(error.message); setBusy(false); return false; }
  }
  async function deleteImage(image) { if (!window.confirm('Delete this product image?')) return; setBusy(true); try { await apiFetch(`/api/ecommerce/images/${image.id}`, { method: 'DELETE' }); setMessage('Image deleted.'); await load(productMeta.page, filters); } catch (error) { setMessage(error.message); setBusy(false); } }
  async function setPrimaryImage(image) { setBusy(true); try { await apiFetch(`/api/ecommerce/images/${image.id}/primary`, { method: 'PATCH' }); setMessage('Main product photo updated.'); await load(productMeta.page, filters); } catch (error) { setMessage(error.message); setBusy(false); } }
  async function updateOrder(order, status) { setBusy(true); try { await apiFetch(`/api/ecommerce/orders/${order.id}/status`, { method: 'PATCH', body: { status } }); setMessage(`${order.orderNumber} updated.`); await load(productMeta.page, filters); } catch (error) { setMessage(error.message); setBusy(false); } }
  function changeFilter(key, value) { const next = { ...filters, [key]: value }; setFilters(next); setExpandedProductId(null); load(1, next); }

  const tabs = [['setup', 'Store Setup', Store, 'ဆိုင်အချက်အလက်'], ['products', 'Products & Images', ImagePlus, 'ပစ္စည်းနှင့်ပုံများ'], ['orders', 'Orders', ShoppingBag, 'အော်ဒါများ']];
  return <section className="ecom-center">
    <header className="ecom-head"><div><span>ONLINE STORE</span><h2>E-commerce Website</h2><p>POS Product နှင့် Stock ချိတ်ထားသော အခမဲ့ Online Shop</p></div>{meta?.storeUrl && <button type="button" className={`ecom-view-store ${settings.enabled ? 'online' : 'offline'}`} onClick={openStore}><ExternalLink size={17}/> View Store <small>{settings.enabled ? 'Online' : 'ဖွင့်ရန်'}</small></button>}</header>
    <div className="ecom-stats"><div><Store/><span><small>Store</small><b>{settings.enabled ? 'Online' : 'Offline'}</b></span></div><div><ShoppingBag/><span><small>Online Listed Products</small><b>{productMeta.onlineTotal}</b></span></div><div><PackageCheck/><span><small>New Orders</small><b>{orders.filter((order) => order.status === 'PENDING').length}</b></span></div></div>
    <nav className="ecom-tabs">{tabs.map(([key, label, Icon, subtitle]) => <button key={key} className={tab === key ? 'active' : ''} onClick={() => setTab(key)}><Icon size={19}/><span><b>{label}</b><small>{subtitle}</small></span></button>)}</nav>
    {message && <div className="ecom-message">{message}</div>}{busy && <div className="ecom-loading">Working...</div>}
    {tab === 'setup' && <div className="ecom-card ecom-form"><label className="ecom-toggle"><input type="checkbox" checked={!!settings.enabled} onChange={(e) => setSettings({ ...settings, enabled: e.target.checked })}/><span>Online Shop ဖွင့်မည်</span></label><label>Store Name<input value={settings.storeName || ''} onChange={(e) => setSettings({ ...settings, storeName: e.target.value })} placeholder={meta?.shop?.name || 'My Shop'}/></label><label className="wide">Description<textarea value={settings.description || ''} onChange={(e) => setSettings({ ...settings, description: e.target.value })}/></label><label>Contact Phone<input value={settings.contactPhone || ''} onChange={(e) => setSettings({ ...settings, contactPhone: e.target.value })}/></label><label>Telegram Chat Link<input type="url" value={settings.telegramUrl || ''} onChange={(e) => setSettings({ ...settings, telegramUrl: e.target.value })} placeholder="https://t.me/your_shop"/></label><label>Shop Google Map Link<input type="url" value={settings.mapUrl || ''} onChange={(e) => setSettings({ ...settings, mapUrl: e.target.value })} placeholder="https://maps.app.goo.gl/..."/></label><label>Delivery Fee<input type="number" min="0" value={settings.deliveryFee || 0} onChange={(e) => setSettings({ ...settings, deliveryFee: Number(e.target.value) })}/></label><label className="ecom-toggle"><input type="checkbox" checked={!!settings.deliveryEnabled} onChange={(e) => setSettings({ ...settings, deliveryEnabled: e.target.checked })}/><span>COD Delivery</span></label><label className="ecom-toggle"><input type="checkbox" checked={!!settings.pickupEnabled} onChange={(e) => setSettings({ ...settings, pickupEnabled: e.target.checked })}/><span>Shop Pickup</span></label><button className="ecom-primary" onClick={saveSettings}><Save size={17}/> Save Store</button></div>}
    {tab === 'products' && <><div className="ecom-product-toolbar"><div className="ecom-filters"><select value={filters.brand} onChange={(e) => changeFilter('brand', e.target.value)}><option value="">All Brands</option>{productMeta.brands.map((brand) => <option key={brand}>{brand}</option>)}</select><select value={filters.categoryId} onChange={(e) => changeFilter('categoryId', e.target.value)}><option value="">All Categories</option>{productMeta.categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select><select value={filters.stockLevel} onChange={(e) => changeFilter('stockLevel', e.target.value)}><option value="">All Stock Levels</option><option value="IN_STOCK">In Stock</option><option value="LOW_STOCK">Low Stock</option><option value="OUT_OF_STOCK">Out of Stock</option></select></div><div className="ecom-view-toggle"><button className={productView === 'list' ? 'active' : ''} onClick={() => { setProductView('list'); setExpandedProductId(null); }}><List size={16}/> List</button><button className={productView === 'grid' ? 'active' : ''} onClick={() => { setProductView('grid'); setExpandedProductId(null); }}><LayoutGrid size={16}/> Grid</button></div></div><div className={`ecom-list ${productView}-view`}>{products.map((product) => <ProductRow key={product.id} product={product} expanded={expandedProductId === product.id} viewMode={productView} onToggle={() => setExpandedProductId((current) => current === product.id ? null : product.id)} onSave={saveProduct} onUpload={uploadImages} onDeleteImage={deleteImage} onSetPrimary={setPrimaryImage}/>)}</div><div className="ecom-pagination"><span>{productMeta.total} Products · 10 items per page · Page {productMeta.page} / {productMeta.totalPages}</span><div><button disabled={productMeta.page <= 1 || busy} onClick={() => { setExpandedProductId(null); load(productMeta.page - 1, filters); }}>Previous</button><button disabled={productMeta.page >= productMeta.totalPages || busy} onClick={() => { setExpandedProductId(null); load(productMeta.page + 1, filters); }}>Next</button></div></div></>}
    {tab === 'orders' && <div className="ecom-card ecom-orders"><table><thead><tr><th>Order</th><th>Customer</th><th>Type</th><th>Total</th><th>Status</th><th>Action</th></tr></thead><tbody>{orders.map((order) => <tr key={order.id}><td><b>{order.orderNumber}</b><small>{new Date(order.createdAt).toLocaleString()}</small></td><td>{order.customerName}<small>{order.customerPhone}</small></td><td>{order.fulfillmentMethod}</td><td>{money(order.total)}</td><td><span className={`ecom-status ${order.status.toLowerCase()}`}>{order.status}</span></td><td><select value={order.status} onChange={(e) => updateOrder(order, e.target.value)}><option>PENDING</option><option>CONFIRMED</option><option>READY</option><option>COMPLETED</option><option>CANCELLED</option></select></td></tr>)}</tbody></table>{!orders.length && <p className="ecom-empty">No online orders yet.</p>}</div>}
  </section>;
}

function ProductRow({ product, expanded, viewMode, onToggle, onSave, onUpload, onDeleteImage, onSetPrimary }) {
  const [description, setDescription] = useState(product.ecommerceDetail?.description || '');
  const [links, setLinks] = useState(product.ecommerceImages?.filter((image) => image.source !== 'UPLOAD').map((image) => image.url).join('\n') || '');
  const [visible, setVisible] = useState(product.ecommerceDetail?.visible !== false);
  const [uploading, setUploading] = useState(false);
  const stock = product.variants?.reduce((sum, variant) => sum + Number(variant.inventoryBalance?.quantity || 0), 0) || 0;
  const uploadedCount = product.ecommerceImages?.filter((image) => image.source === 'UPLOAD').length || 0;
  const uploadSlots = Math.max(0, 3 - uploadedCount);
  async function saveAll() { await onSave(product, { visible, description, imageUrls: links.split(/\r?\n|,/).map((item) => item.trim()).filter(Boolean) }); }
  async function choosePhotos(event) { const selected = [...(event.target.files || [])]; event.target.value = ''; if (!selected.length) return; if (selected.some((file) => file.size > 5 * 1024 * 1024)) return window.alert('Photo တစ်ပုံလျှင် 5 MB ထက်မကြီးရပါ။'); if (selected.length > uploadSlots) return window.alert(`Upload Photo ${uploadSlots} ပုံသာ ထပ်တင်နိုင်ပါတယ်။`); setUploading(true); try { await onUpload(product, selected); } finally { setUploading(false); } }
  return <article className={`ecom-product ${expanded ? 'expanded' : ''} ${viewMode}-card`}><button type="button" className="ecom-product-title" onClick={onToggle} aria-expanded={expanded}><div className="ecom-thumb"><img src={product.ecommerceImages?.[0]?.url || '/default-product-image.svg'} alt="" onError={(event) => { event.currentTarget.src = '/default-product-image.svg'; }}/></div><div className="ecom-product-copy"><h3>{product.name}</h3><p>{product.category?.name || 'Uncategorized'} · Stock {stock}</p><small>{product.ecommerceImages?.length || 0} photos · {visible ? 'Online' : 'Hidden'}</small></div><span className={`ecom-online-badge ${visible ? 'online' : 'hidden'}`}>{visible ? 'Online' : 'Hidden'}</span><ChevronDown className="ecom-expand-icon" size={18}/></button>{expanded && <div className="ecom-product-detail"><label className="ecom-switch"><input type="checkbox" checked={visible} onChange={(e) => setVisible(e.target.checked)}/><span>Show this product in Online Shop</span></label><div className="ecom-image-manager">{product.ecommerceImages?.length ? product.ecommerceImages.map((image, index) => <div className="ecom-image-item" key={image.id}><img src={image.url} alt="" onError={(event) => { event.currentTarget.src = '/default-product-image.svg'; }}/><span>{index === 0 ? 'Main Photo' : `Photo ${index + 1}`}</span><div>{index !== 0 && <button type="button" onClick={() => onSetPrimary(image)}>Set Main</button>}<button type="button" className="danger" onClick={() => onDeleteImage(image)}>Delete</button></div></div>) : <div className="ecom-no-image"><img src="/default-product-image.svg" alt=""/><span>Default Photo</span></div>}</div><div className="ecom-product-fields"><label>Description<textarea value={description} onChange={(e) => setDescription(e.target.value)}/></label><label>Google Drive / Image Links<textarea value={links} onChange={(e) => { setLinks(e.target.value); if (e.target.value.trim()) setVisible(true); }} placeholder="One HTTPS link per line (unlimited)"/></label></div><div className="ecom-product-actions"><label className={`ecom-upload ${uploadSlots === 0 ? 'disabled' : ''}`}><ImagePlus size={16}/> {uploading ? 'Uploading...' : uploadSlots ? `Upload Photo (${uploadSlots} slots)` : 'Photo Limit (3/3)'}<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple disabled={uploading || uploadSlots === 0} onChange={choosePhotos}/></label><button className="ecom-save-one" onClick={saveAll}><Save size={16}/> Save Details</button></div></div>}</article>;
}
