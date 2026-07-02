(function () {
  const tokenKey = 'mahar_admin_token';
  const state = {
    loaded: new Set(),
    vpnAdsConfig: null,
    products: [],
  };

  const viewRoutes = {
    '/': 'central-dashboard',
    '/admin': 'central-dashboard',
    '/admin/': 'central-dashboard',
    '/admin/dashboard': 'central-dashboard',
    '/admin/products': 'products-apps',
    '/admin/push/vpn': 'vpn-push',
    '/admin/push/pos-web': 'pos-web-push',
    '/admin/vpn/free-server-ads': 'vpn-ads',
    '/admin/vpn/banner-ads': 'vpn-ads',
    '/admin/campaign-history': 'campaign-history',
    '/admin/renewal-history': 'renewal-history',
    '/admin/admin-users': 'admin-users',
    '/admin/audit-logs': 'admin-audit',
    '/admin/system-settings': 'system-settings',
  };

  const adminRootPath = '/';
  const $ = (id) => document.getElementById(id);
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const fmt = (value) => value ? new Date(value).toLocaleString('my-MM', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-';
  const number = (value) => Number(value || 0);
  const money = (value) => `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(number(value))} MMK`;

  function normalizeAdminRootUrl() {
    if (location.pathname !== adminRootPath) {
      history.replaceState({ view: 'central-dashboard' }, '', adminRootPath);
    }
  }

  function notify(text, type = 'success') {
    if (typeof window.toast === 'function') return window.toast(text, type);
    const toast = $('toast');
    if (!toast) return alert(text);
    toast.textContent = text;
    toast.className = `fixed top-5 right-5 z-[60] max-w-sm rounded-xl px-4 py-3 text-white font-bold shadow-2xl ${type === 'error' ? 'bg-red-600' : 'bg-emerald-600'}`;
    setTimeout(() => toast.classList.add('hidden'), 3600);
  }

  async function api(path, options = {}) {
    const token = sessionStorage.getItem(tokenKey) || '';
    const response = await fetch(path, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options.headers || {}),
      },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) throw new Error(data.message || `Request failed (${response.status})`);
    return data;
  }

  function card(title, value, note, color = 'blue') {
    return `<div class="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm">
      <p class="text-xs font-black uppercase tracking-wider text-slate-500">${escapeHtml(title)}</p>
      <h3 class="mt-2 text-3xl font-black text-slate-900">${escapeHtml(value)}</h3>
      <p class="mt-2 text-sm text-slate-500">${escapeHtml(note || '')}</p>
      <div class="mt-4 h-1.5 rounded-full bg-${color}-100"><div class="h-full w-2/3 rounded-full bg-${color}-500"></div></div>
    </div>`;
  }

  function shell(title, subtitle, body, actions = '') {
    return `<div class="mb-6 flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
      <div>
        <h1 class="text-3xl font-black text-slate-900 tracking-tight">${escapeHtml(title)}</h1>
        <p class="text-slate-500 mt-1">${escapeHtml(subtitle || '')}</p>
      </div>
      <div class="flex gap-2 flex-wrap">${actions}</div>
    </div>${body}`;
  }

  function field(id, label, type = 'text', extra = '') {
    return `<label class="block">
      <span class="text-xs font-black uppercase tracking-wide text-slate-500">${escapeHtml(label)}</span>
      <input id="${id}" type="${type}" ${extra} class="mt-1 w-full h-11 px-3 rounded-xl border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-brand-500">
    </label>`;
  }

  function textarea(id, label, extra = '') {
    return `<label class="block">
      <span class="text-xs font-black uppercase tracking-wide text-slate-500">${escapeHtml(label)}</span>
      <textarea id="${id}" ${extra} class="mt-1 w-full min-h-[110px] p-3 rounded-xl border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-brand-500"></textarea>
    </label>`;
  }

  function table(rows, columns, empty = 'No data found.') {
    if (!rows?.length) {
      return `<div class="bg-white rounded-2xl border border-slate-100 p-8 text-center text-slate-500">${escapeHtml(empty)}</div>`;
    }
    return `<div class="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
      <div class="overflow-x-auto">
        <table class="min-w-full divide-y divide-slate-100 text-sm">
          <thead class="bg-slate-50">${columns.map((column) => `<th class="px-4 py-3 text-left font-black text-slate-500">${escapeHtml(column.label)}</th>`).join('')}</thead>
          <tbody class="divide-y divide-slate-100">${rows.map((row) => `<tr class="hover:bg-slate-50">${columns.map((column) => `<td class="px-4 py-3 align-top">${column.render(row)}</td>`).join('')}</tr>`).join('')}</tbody>
        </table>
      </div>
    </div>`;
  }

  function jsonCell(value) {
    return `<pre class="max-w-lg whitespace-pre-wrap text-xs text-slate-600">${escapeHtml(JSON.stringify(value ?? {}, null, 2))}</pre>`;
  }

  function addNavigation() {
    const nav = $('side-nav');
    if (!nav || $('admin-ext-nav-marker')) return;
    nav.insertAdjacentHTML('beforeend', `
      <div id="admin-ext-nav-marker"></div>
      <p class="px-2 text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2 mt-6">Central Admin</p>
      ${navButton('central-dashboard', 'Dashboard')}
      ${navButton('products-apps', 'Products / Apps')}
      ${navButton('campaign-history', 'Campaign History')}
      ${navButton('renewal-history', 'Renewal History')}
      ${navButton('admin-users', 'Admin Users / Roles')}
      ${navButton('admin-audit', 'Admin Audit Logs')}
      <p class="px-2 text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2 mt-6">Push Notification Center</p>
      ${navButton('vpn-push', 'VPN Push Notification')}
      ${navButton('pos-web-push', 'POS Web Push')}
      <p class="px-2 text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2 mt-6">VPN Ads / Banner</p>
      ${navButton('vpn-ads', 'VPN Free Server Ads')}
      <p class="px-2 text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2 mt-6">System</p>
      ${navButton('system-settings', 'System Settings')}
    `);
  }

  function navButton(view, label) {
    return `<button type="button" data-view="${view}" data-admin-ext-view="${view}" class="admin-nav flex w-full items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-slate-800 hover:text-white transition-all group">
      <span class="w-2 h-2 rounded-full bg-slate-500 group-hover:bg-brand-400"></span>
      <span class="font-medium">${escapeHtml(label)}</span>
    </button>`;
  }

  function addSections() {
    const content = document.querySelector('main .flex-1.overflow-y-auto');
    if (!content || $('view-central-dashboard')) return;
    const sections = [
      'central-dashboard',
      'products-apps',
      'vpn-push',
      'pos-web-push',
      'vpn-ads',
      'campaign-history',
      'renewal-history',
      'admin-users',
      'admin-audit',
      'system-settings',
    ];
    content.insertAdjacentHTML('beforeend', sections.map((view) => `<section id="view-${view}" data-section="${view}" class="hidden"></section>`).join(''));
  }

  function showExtView(view, push = true) {
    if (typeof window.showView === 'function') window.showView(view);
    else {
      document.querySelectorAll('[data-section]').forEach((section) => section.classList.add('hidden'));
      $(`view-${view}`)?.classList.remove('hidden');
    }
    if (push && location.pathname !== adminRootPath) {
      history.replaceState({ view: 'central-dashboard' }, '', adminRootPath);
    }
    loadView(view).catch((error) => notify(error.message, 'error'));
  }

  async function loadView(view, force = false) {
    if (!force && state.loaded.has(view) && !['vpn-ads', 'campaign-history', 'renewal-history', 'central-dashboard', 'admin-audit'].includes(view)) return;
    const loaders = {
      'central-dashboard': loadCentralDashboard,
      'products-apps': loadProducts,
      'vpn-ads': loadVpnAds,
      'vpn-push': loadVpnPush,
      'pos-web-push': loadPosWebPush,
      'campaign-history': loadCampaignHistory,
      'renewal-history': loadRenewalHistory,
      'admin-users': loadAdminUsers,
      'admin-audit': loadAdminAudit,
      'system-settings': loadSystemSettings,
    };
    if (loaders[view]) {
      await loaders[view]();
      state.loaded.add(view);
    }
  }

  function setLoading(view, title = 'Loading...') {
    const target = $(`view-${view}`);
    if (target) target.innerHTML = `<div class="bg-white rounded-2xl border border-slate-100 p-8 text-slate-500 font-bold">${escapeHtml(title)}</div>`;
  }

  async function loadCentralDashboard() {
    setLoading('central-dashboard');
    const data = await api('/api/admin/dashboard');
    const body = `
      <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-5 mb-8">
        ${card('Total Products / Apps', String(data.products?.length || 0), 'Central product registry', 'blue')}
        ${card('VPN Tokens', String(data.vpn?.registeredTokens || 140), `Topic: ${data.vpn?.topic || 'maharshwe-vpn'}`, 'emerald')}
        ${card('VPN Ads Status', data.vpn?.ads?.enabled === true ? 'Enabled' : data.vpn?.ads?.enabled === false ? 'Disabled' : 'Unknown', data.vpn?.ads?.message || 'Free Server banner config', 'amber')}
        ${card('POS Web Push Tokens', String(data.pos?.webPushTokens || 0), 'Active browser tokens', 'purple')}
        ${card('Renewals This Month', String(data.pos?.renewalsThisMonth || 0), 'Tenant plan renew records', 'emerald')}
        ${card('Video Downloader', data.videoDownloader?.pushStatus || 'future', 'Future push integration slot', 'slate')}
      </div>
      <div class="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div class="bg-white rounded-2xl border border-slate-100 p-6">
          <h3 class="font-black text-slate-900">Latest VPN Push Notification</h3>
          ${data.latestPush ? `<p class="mt-3 font-bold">${escapeHtml(data.latestPush.title)}</p><p class="text-sm text-slate-500">${escapeHtml(data.latestPush.body)}</p><p class="text-xs text-slate-400 mt-2">${fmt(data.latestPush.sentAt || data.latestPush.createdAt)}</p>` : '<p class="mt-3 text-slate-500">No local campaign history yet.</p>'}
        </div>
        <div class="bg-white rounded-2xl border border-slate-100 p-6">
          <h3 class="font-black text-slate-900">Latest VPN Ads Update</h3>
          ${data.latestAdsUpdate ? `<p class="mt-3 font-bold">${escapeHtml(data.latestAdsUpdate.title || '-')}</p><p class="text-sm text-slate-500">${escapeHtml(data.latestAdsUpdate.message || '')}</p><p class="text-xs text-slate-400 mt-2">${fmt(data.latestAdsUpdate.createdAt)}</p>` : '<p class="mt-3 text-slate-500">No ads update history yet.</p>'}
        </div>
        <div class="bg-white rounded-2xl border border-slate-100 p-6">
          <h3 class="font-black text-slate-900">Latest Renewal</h3>
          ${data.latestRenewal ? `<p class="mt-3 font-bold">${escapeHtml(data.latestRenewal.shopName || data.latestRenewal.tenantId || '-')}</p><p class="text-sm text-slate-500">${escapeHtml(data.latestRenewal.plan || '-')}: ${escapeHtml(data.latestRenewal.durationLabel || '')}</p><p class="text-xs text-slate-400 mt-2">New expiry: ${fmt(data.latestRenewal.newEndsAt)}</p>` : '<p class="mt-3 text-slate-500">No renewal history yet.</p>'}
        </div>
      </div>`;
    $('view-central-dashboard').innerHTML = shell('Central Admin Dashboard', 'Mahar POS, Mahar Shwe VPN, future Video Downloader, and cross-system operations.', body, '<button data-ext-refresh="central-dashboard" class="px-4 py-2 rounded-xl bg-slate-900 text-white font-bold">Refresh</button>');
  }

  async function loadProducts() {
    setLoading('products-apps');
    const data = await api('/api/admin/products');
    state.products = data.products || [];
    $('view-products-apps').innerHTML = shell('Products / Apps', 'Seeded products managed by this central admin portal.', table(state.products, [
      { label: 'Name', render: (row) => `<b>${escapeHtml(row.name)}</b><div class="text-xs text-slate-500">${escapeHtml(row.slug)}</div>` },
      { label: 'Type', render: (row) => escapeHtml(row.type) },
      { label: 'Domain / Package', render: (row) => escapeHtml(row.domain || row.packageName || '-') },
      { label: 'Firebase / Topic', render: (row) => `${escapeHtml(row.firebaseProject || '-')}<div class="text-xs text-slate-500">${escapeHtml(row.topic || '')}</div>` },
      { label: 'Push / Ads', render: (row) => `${escapeHtml(row.pushType || '-')}<div class="text-xs ${row.adsApiEnabled ? 'text-emerald-600' : 'text-slate-400'}">${row.adsApiEnabled ? 'Ads API enabled' : 'No ads API'}</div>` },
    ]));
  }

  async function loadVpnAds() {
    setLoading('vpn-ads');
    let config = {
      enabled: true,
      title: '',
      message: '',
      imageUrl: '',
      videoUrl: '',
      mediaType: 'auto',
      clickUrl: '',
      cta: 'Open',
      backgroundColor: '#141510',
      textColor: '#ffffff',
    };
    try {
      const data = await api('/api/admin/integrations/vpn-ads');
      config = { ...config, ...(data.config || data.raw || {}) };
    } catch (error) {
      notify(error.message, 'error');
    }
    state.vpnAdsConfig = config;
    $('view-vpn-ads').innerHTML = shell('VPN Free Server Ads / Banner Manager', 'Free Server Ads only appear after a Free Server connection. The banner appears 5 seconds after connect. Ads do not appear when connecting with Other Key.', `
      <div class="grid grid-cols-1 xl:grid-cols-[1.2fr_.8fr] gap-6">
        <form id="vpn-ads-form" class="bg-white rounded-2xl border border-slate-100 p-6 space-y-4">
          <label class="flex items-center justify-between gap-4 p-4 rounded-xl bg-slate-50 border border-slate-200 font-black">Ads Enabled <input id="vpn-ads-enabled" type="checkbox" class="w-6 h-6 accent-brand-600"></label>
          ${field('vpn-ads-title', 'Title')}
          ${textarea('vpn-ads-message', 'Message')}
          <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
            <label class="block"><span class="text-xs font-black uppercase tracking-wide text-slate-500">Media Type</span><select id="vpn-ads-media-type" class="mt-1 w-full h-11 px-3 rounded-xl border border-slate-200"><option value="auto">auto</option><option value="image">image</option><option value="video">video</option></select></label>
            ${field('vpn-ads-background', 'Background Color', 'color')}
            ${field('vpn-ads-text', 'Text Color', 'color')}
          </div>
          ${field('vpn-ads-image', 'Image URL')}
          ${field('vpn-ads-video', 'Video URL')}
          ${field('vpn-ads-click', 'Click URL')}
          ${field('vpn-ads-cta', 'CTA Text')}
          <div class="flex gap-3 flex-wrap">
            <button type="submit" class="px-5 py-2.5 rounded-xl bg-brand-600 text-white font-black">Save changes</button>
            <button type="button" data-vpn-ads-refresh class="px-5 py-2.5 rounded-xl bg-slate-900 text-white font-black">Refresh current config</button>
            <button type="button" data-vpn-ads-reset class="px-5 py-2.5 rounded-xl bg-slate-100 text-slate-700 font-black">Reset form</button>
            <button type="button" data-vpn-ads-disable class="px-5 py-2.5 rounded-xl bg-red-50 text-red-700 border border-red-100 font-black">Disable ads</button>
          </div>
        </form>
        <div class="space-y-4">
          <div id="vpn-ads-preview"></div>
          <div class="bg-amber-50 text-amber-800 border border-amber-100 p-4 rounded-2xl text-sm font-bold">Security: this page calls only /api/admin/integrations/vpn-ads. x-api-key stays server-side.</div>
        </div>
      </div>`);
    fillVpnAds(config);
    renderVpnAdsPreview();
  }

  function fillVpnAds(config) {
    $('vpn-ads-enabled').checked = config.enabled !== false;
    $('vpn-ads-title').value = config.title || '';
    $('vpn-ads-message').value = config.message || '';
    $('vpn-ads-media-type').value = config.mediaType || 'auto';
    $('vpn-ads-image').value = config.imageUrl || '';
    $('vpn-ads-video').value = config.videoUrl || '';
    $('vpn-ads-click').value = config.clickUrl || '';
    $('vpn-ads-cta').value = config.cta || 'Open';
    $('vpn-ads-background').value = /^#[0-9a-f]{6}$/i.test(config.backgroundColor || '') ? config.backgroundColor : '#141510';
    $('vpn-ads-text').value = /^#[0-9a-f]{6}$/i.test(config.textColor || '') ? config.textColor : '#ffffff';
  }

  function collectVpnAds() {
    return {
      enabled: $('vpn-ads-enabled').checked,
      title: $('vpn-ads-title').value.trim(),
      message: $('vpn-ads-message').value.trim(),
      imageUrl: $('vpn-ads-image').value.trim(),
      videoUrl: $('vpn-ads-video').value.trim(),
      mediaType: $('vpn-ads-media-type').value,
      clickUrl: $('vpn-ads-click').value.trim(),
      cta: $('vpn-ads-cta').value.trim() || 'Open',
      backgroundColor: $('vpn-ads-background').value,
      textColor: $('vpn-ads-text').value,
    };
  }

  function renderVpnAdsPreview() {
    if (!$('vpn-ads-preview')) return;
    const config = collectVpnAds();
    const showVideo = config.videoUrl && (config.mediaType === 'video' || (config.mediaType === 'auto' && !config.imageUrl));
    const showImage = config.imageUrl && (config.mediaType === 'image' || config.mediaType === 'auto');
    $('vpn-ads-preview').innerHTML = `<div class="rounded-3xl p-6 shadow-xl border border-white/20" style="background:${config.backgroundColor};color:${config.textColor}">
      <p class="text-xs font-black uppercase tracking-widest opacity-75">Live Preview · Free Server only</p>
      <h3 class="mt-3 text-2xl font-black">${escapeHtml(config.title || 'Ad title')}</h3>
      <p class="mt-2 text-sm opacity-90">${escapeHtml(config.message || 'Ad message preview')}</p>
      ${showImage ? `<img class="mt-4 rounded-2xl max-h-64 w-full object-cover" src="${escapeHtml(config.imageUrl)}" alt="VPN ad preview">` : ''}
      ${showVideo ? `<video class="mt-4 rounded-2xl max-h-64 w-full" controls src="${escapeHtml(config.videoUrl)}"></video>` : ''}
      <div class="mt-5 inline-flex rounded-xl bg-white/15 px-4 py-2 font-black">${escapeHtml(config.cta || 'Open')}</div>
      <p class="mt-4 text-xs opacity-70">Appears 5 seconds after Free Server connect. Other Key connect = no ads.</p>
    </div>`;
  }

  async function loadVpnPush() {
    $('view-vpn-push').innerHTML = shell('VPN Push Notification', 'VPN Push Notification sends to Firebase topic maharshwe-vpn. Current registered tokens: 140.', `
      <div class="grid grid-cols-1 xl:grid-cols-[1.1fr_.9fr] gap-6">
        <form id="vpn-push-form" class="bg-white rounded-2xl border border-slate-100 p-6 space-y-4">
          <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
            ${card('Firebase Project', 'maharshweonlinevpn', 'VPN Android app', 'blue')}
            ${card('Topic', 'maharshwe-vpn', 'Locked for VPN page', 'emerald')}
            ${card('Registered Tokens', '140', 'Fallback count until live count API exists', 'amber')}
          </div>
          ${field('vpn-push-title', 'Title', 'text', 'value="MaharShwe VPN Update" required')}
          ${textarea('vpn-push-body', 'Body / Message', 'required')}
          ${field('vpn-push-url', 'URL', 'url', 'value="https://maharshwe.online/download/?auto=1"')}
          ${field('vpn-push-topic', 'Topic', 'text', 'value="maharshwe-vpn" readonly')}
          <div class="flex gap-3 flex-wrap">
            <button type="submit" class="px-5 py-2.5 rounded-xl bg-brand-600 text-white font-black">Send VPN notification</button>
            <button type="reset" class="px-5 py-2.5 rounded-xl bg-slate-100 text-slate-700 font-black">Reset form</button>
            <button type="button" disabled class="px-5 py-2.5 rounded-xl bg-slate-50 text-slate-400 border border-slate-100 font-black">Send test unavailable</button>
          </div>
        </form>
        <div id="vpn-push-preview" class="bg-white rounded-2xl border border-slate-100 p-6"></div>
      </div>`);
    renderVpnPushPreview();
  }

  function renderVpnPushPreview() {
    if (!$('vpn-push-preview')) return;
    $('vpn-push-preview').innerHTML = `<p class="text-xs font-black uppercase tracking-wider text-slate-500">Preview Card</p>
      <div class="mt-4 rounded-2xl bg-slate-900 text-white p-5">
        <h3 class="font-black text-lg">${escapeHtml($('vpn-push-title')?.value || 'MaharShwe VPN Update')}</h3>
        <p class="mt-2 text-sm text-slate-300">${escapeHtml($('vpn-push-body')?.value || 'Message text')}</p>
        <p class="mt-4 text-xs text-blue-300">${escapeHtml($('vpn-push-url')?.value || '')}</p>
      </div>
      <p class="mt-4 text-sm text-amber-700 bg-amber-50 border border-amber-100 rounded-xl p-3 font-bold">Confirmation appears before sending. x-api-key is added only by backend proxy.</p>`;
  }

  async function loadPosWebPush() {
    const shops = await api('/api/admin/pos/shops?limit=300').catch(() => ({ shops: [] }));
    const users = await api('/api/admin/pos/users?limit=300').catch(() => ({ users: [] }));
    $('view-pos-web-push').innerHTML = shell('app.maharshwe.shop Web Push Management', 'Send POS web push to all users, selected shop, selected user, or role. Tokens remain scoped by user_id + shop_id.', `
      <form id="pos-push-form" class="bg-white rounded-2xl border border-slate-100 p-6 space-y-4">
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          ${field('pos-push-title', 'Title', 'text', 'value="Mahar POS Update" required')}
          ${field('pos-push-url', 'App Path', 'text', 'value="/dashboard"')}
        </div>
        ${textarea('pos-push-body', 'Body', 'required')}
        <div class="grid grid-cols-1 md:grid-cols-4 gap-4">
          <label class="block"><span class="text-xs font-black uppercase tracking-wide text-slate-500">Target</span><select id="pos-push-target" class="mt-1 w-full h-11 px-3 rounded-xl border border-slate-200"><option value="all">All POS web users</option><option value="shop">Selected shop</option><option value="user">Selected user</option><option value="role">Selected role</option></select></label>
          <label class="block"><span class="text-xs font-black uppercase tracking-wide text-slate-500">Shop</span><select id="pos-push-shop" class="mt-1 w-full h-11 px-3 rounded-xl border border-slate-200"><option value="">Choose shop</option>${(shops.shops || []).map((shop) => `<option value="${shop.id}">${escapeHtml(shop.name)} · ${escapeHtml(shop.code || shop.slug)}</option>`).join('')}</select></label>
          <label class="block"><span class="text-xs font-black uppercase tracking-wide text-slate-500">User</span><select id="pos-push-user" class="mt-1 w-full h-11 px-3 rounded-xl border border-slate-200"><option value="">Choose user</option>${(users.users || []).map((user) => `<option value="${user.id}">${escapeHtml(user.name)} · ${escapeHtml(user.shop?.name || '')}</option>`).join('')}</select></label>
          <label class="block"><span class="text-xs font-black uppercase tracking-wide text-slate-500">Role</span><select id="pos-push-role" class="mt-1 w-full h-11 px-3 rounded-xl border border-slate-200"><option value="">Choose role</option><option value="SHOP_ADMIN">SHOP_ADMIN</option><option value="CASHIER">CASHIER</option></select></label>
        </div>
        <button class="px-5 py-2.5 rounded-xl bg-brand-600 text-white font-black" type="submit">Send POS web push</button>
        <div class="bg-blue-50 text-blue-800 border border-blue-100 rounded-xl p-4 text-sm font-bold">Privacy: payload should stay short/generic. Full sale, customer, payment, or credit details are not sent in push payload.</div>
      </form>`);
  }

  async function loadCampaignHistory() {
    setLoading('campaign-history');
    const [push, ads, renewals] = await Promise.all([
      api('/api/admin/history/push-campaigns?limit=100').catch(() => ({ campaigns: [] })),
      api('/api/admin/history/ads?limit=100').catch(() => ({ adsHistory: [] })),
      api('/api/admin/history/renewals?limit=100').catch(() => ({ renewals: [] })),
    ]);
    $('view-campaign-history').innerHTML = shell('Campaign History', 'Push notification records, VPN ads changes, and POS renewal records.', `
      <div class="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <div>
          <h2 class="font-black text-xl mb-4">Push Campaigns</h2>
          ${table(push.campaigns || [], [
            { label: 'Product', render: (row) => escapeHtml(row.productSlug) },
            { label: 'Title', render: (row) => `<b>${escapeHtml(row.title)}</b><div class="text-xs text-slate-500">${escapeHtml(row.body)}</div>` },
            { label: 'Status', render: (row) => escapeHtml(row.status) },
            { label: 'Sent', render: (row) => fmt(row.sentAt || row.createdAt) },
          ])}
        </div>
        <div>
          <h2 class="font-black text-xl mb-4">Ads History</h2>
          ${table(ads.adsHistory || [], [
            { label: 'Product', render: (row) => escapeHtml(row.productSlug) },
            { label: 'Title', render: (row) => `<b>${escapeHtml(row.title || '-')}</b><div class="text-xs text-slate-500">${escapeHtml(row.message || '')}</div>` },
            { label: 'Enabled', render: (row) => row.enabled ? '<span class="text-emerald-600 font-black">Enabled</span>' : '<span class="text-red-600 font-black">Disabled</span>' },
            { label: 'Saved', render: (row) => fmt(row.createdAt) },
          ])}
        </div>
        <div class="xl:col-span-2">
          <h2 class="font-black text-xl mb-4">Renewal History</h2>
          ${renderRenewalTable(renewals.renewals || [])}
        </div>
      </div>`, '<button data-ext-refresh="campaign-history" class="px-4 py-2 rounded-xl bg-slate-900 text-white font-bold">Refresh</button>');
  }

  function renderRenewalTable(rows) {
    return table(rows || [], [
      { label: 'Shop / Tenant', render: (row) => `<b>${escapeHtml(row.shopName || '-')}</b><div class="text-xs text-slate-500">${escapeHtml(row.tenantId || row.shopId || '')}</div>` },
      { label: 'Plan', render: (row) => `<b>${escapeHtml(row.plan || '-')}</b><div class="text-xs text-slate-500">${escapeHtml(row.durationLabel || '')}</div>` },
      { label: 'Previous Expiry', render: (row) => fmt(row.previousEndsAt) },
      { label: 'New Expiry', render: (row) => `<span class="font-black text-emerald-700">${fmt(row.newEndsAt)}</span>` },
      { label: 'Note', render: (row) => escapeHtml(row.note || '-') },
      { label: 'Created', render: (row) => fmt(row.createdAt) },
    ], 'No renewal history yet.');
  }

  async function loadRenewalHistory() {
    setLoading('renewal-history');
    const data = await api('/api/admin/history/renewals?limit=200').catch(() => ({ renewals: [] }));
    $('view-renewal-history').innerHTML = shell('Renewal History', 'POS tenant renew/plan extension records. Records are written when Super Admin renews a tenant.', renderRenewalTable(data.renewals || []), '<button data-ext-refresh="renewal-history" class="px-4 py-2 rounded-xl bg-slate-900 text-white font-bold">Refresh</button>');
  }

  async function removedPosOverview(view) {
    setLoading(view);
    const data = await api('/api/admin/pos/overview');
    const item = data.overview || {};
    $('view-pos-overview').innerHTML = shell('Removed Admin Section', 'This admin management page is no longer shown in the portal.', `
      <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-5">
        ${card('Shops', `${item.activeShops || 0}/${item.shops || 0}`, 'Active / total', 'blue')}
        ${card('Users', String(item.users || 0), 'Active users', 'indigo')}
        ${card('Sales Revenue', money(item.salesRevenue || 0), `${item.sales || 0} sales`, 'emerald')}
        ${card('Today Revenue', money(item.todayRevenue || 0), `${item.todaySales || 0} sales today`, 'amber')}
        ${card('Stock Rows', String(item.stockRows || 0), `${item.stockQuantity || 0} total quantity`, 'blue')}
        ${card('Credits', String(item.customerCredits || 0), 'Customers with balance', 'red')}
        ${card('Accounts', String(item.moneyAccounts || 0), 'Across all shops', 'purple')}
        ${card('Audit Logs', String(item.auditLogs || 0), 'Existing audit logs', 'slate')}
      </div>`);
  }

  async function removedPosReports(view) {
    setLoading(view);
    const data = await api('/api/admin/pos/reports');
    const reports = data.reports || {};
    $('view-pos-reports').innerHTML = shell('Removed Reports Section', 'This reporting page is no longer shown in the portal.', `
      <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
        ${card('Sales', money(reports.sales?.revenue || 0), `${reports.sales?.count || 0} sales · Profit ${money(reports.sales?.profit || 0)}`, 'emerald')}
        ${card('Payments', money(reports.payments?.total || 0), `${reports.payments?.count || 0} payments`, 'blue')}
        ${card('Repairs', money(reports.repairs?.revenue || 0), `${reports.repairs?.count || 0} repairs`, 'amber')}
        ${card('Money Service', money(reports.moneyService?.profit || 0), `${reports.moneyService?.count || 0} transactions`, 'purple')}
        ${card('Low Stock', String(reports.stock?.lowStock || 0), 'quantity 1-3', 'red')}
        ${card('Out of Stock', String(reports.stock?.outOfStock || 0), 'quantity <= 0', 'slate')}
      </div>`);
  }

  async function removedPosList(view, path) {
    setLoading(view);
    const data = await api(path);
    const key = Object.keys(data).find((item) => Array.isArray(data[item])) || 'rows';
    const rows = data[key] || [];
    const title = {
      'pos-shops': 'Removed Section',
      'pos-users': 'Removed Section',
      'pos-sales': 'Removed Section',
      'pos-stock': 'Removed Section',
      'pos-credits': 'Removed Section',
      'pos-money': 'Removed Section',
      'pos-audit': 'Removed Section',
    }[view] || 'Removed Section';
    $('view-' + view).innerHTML = shell(title, 'This admin management page is no longer shown in the portal.', genericTable(rows), `<button data-ext-refresh="${view}" class="px-4 py-2 rounded-xl bg-slate-900 text-white font-bold">Refresh</button>`);
  }

  function genericTable(rows) {
    const normalized = rows.map((row) => flattenDisplay(row));
    const keys = [...new Set(normalized.flatMap((row) => Object.keys(row)))].slice(0, 7);
    return table(normalized, keys.map((key) => ({ label: key, render: (row) => escapeHtml(formatValue(row[key])) })));
  }

  function flattenDisplay(row) {
    const out = {};
    for (const [key, value] of Object.entries(row || {})) {
      if (['permissions', 'settings', 'responseJson', 'metadata'].includes(key)) continue;
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        if (value.name || value.slug || value.code) out[key] = value.name || value.code || value.slug;
        else if (value.toString && value.constructor?.name === 'Decimal') out[key] = value.toString();
        else out[key] = JSON.stringify(value).slice(0, 160);
      } else {
        out[key] = value;
      }
    }
    return out;
  }

  function formatValue(value) {
    if (value === null || value === undefined || value === '') return '-';
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    if (String(value).match(/^\d{4}-\d{2}-\d{2}T/)) return fmt(value);
    return String(value);
  }

  async function loadAdminUsers() {
    setLoading('admin-users');
    const [users, roles] = await Promise.all([
      api('/api/admin/admin-users').catch(() => ({ users: [], roleAssignments: [] })),
      api('/api/admin/roles').catch(() => ({ roles: [] })),
    ]);
    const roleOptions = (roles.roles || []).map((row) => `<option value="${escapeHtml(row.role)}">${escapeHtml(row.role)}</option>`).join('');
    $('view-admin-users').innerHTML = shell('Admin Users / Roles / Permissions', 'Create admin portal users and manage audited role assignments. Normal POS users cannot access admin APIs unless assigned here.', `
      <div class="grid grid-cols-1 xl:grid-cols-[.9fr_1.1fr] gap-6 mb-6">
        <form id="admin-user-form" class="bg-white rounded-2xl border border-slate-100 p-6 space-y-4">
          <h2 class="font-black text-xl">Create Admin User</h2>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            ${field('admin-user-name', 'Name', 'text', 'required')}
            ${field('admin-user-username', 'Username', 'text', 'required')}
            ${field('admin-user-email', 'Email', 'email')}
            ${field('admin-user-password', 'Password', 'password', 'required minlength="6"')}
          </div>
          <label class="block"><span class="text-xs font-black uppercase tracking-wide text-slate-500">Admin Role</span><select id="admin-user-role" class="mt-1 w-full h-11 px-3 rounded-xl border border-slate-200">${roleOptions}</select></label>
          <button class="px-5 py-2.5 rounded-xl bg-brand-600 text-white font-black" type="submit">Create admin user</button>
          <p class="text-xs text-slate-500 font-bold">super_admin gets full access. Other admin users get permission from admin_user_roles and no shop data unless admin API allows it.</p>
        </form>
        <div>
          <h2 class="font-black text-xl mb-4">Role Permission Matrix</h2>
          ${table(roles.roles || [], [
            { label: 'Role', render: (row) => `<b>${escapeHtml(row.role)}</b>` },
            { label: 'Permissions', render: (row) => escapeHtml((row.permissions || []).join(', ')) },
          ])}
        </div>
      </div>
      <div class="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <div>
          <h2 class="font-black text-xl mb-4">Admin Portal Users</h2>
          ${table(users.users || [], [
            { label: 'Name', render: (row) => `<b>${escapeHtml(row.name)}</b><div class="text-xs text-slate-500">${escapeHtml(row.username || row.email || '')}</div>` },
            { label: 'Active', render: (row) => row.active ? 'Yes' : 'No' },
            { label: 'Last Login', render: (row) => fmt(row.lastLoginAt) },
            { label: 'Action', render: (row) => `<button data-admin-user-delete="${escapeHtml(row.id)}" data-admin-username="${escapeHtml(row.username || row.email || row.name || row.id)}" class="px-3 py-1.5 rounded-lg bg-red-600 text-white text-xs font-black">Delete</button>` },
          ])}
        </div>
        <div>
          <h2 class="font-black text-xl mb-4">Active Role Assignments</h2>
          ${table(users.roleAssignments || [], [
            { label: 'User', render: (row) => `<b>${escapeHtml(row.user?.name || row.userId)}</b><div class="text-xs text-slate-500">${escapeHtml(row.user?.username || '')}</div>` },
            { label: 'Role', render: (row) => escapeHtml(row.role) },
            { label: 'Updated', render: (row) => fmt(row.updatedAt || row.createdAt) },
            { label: 'Action', render: (row) => `<button data-admin-role-disable="${escapeHtml(row.id)}" class="px-3 py-1.5 rounded-lg bg-red-50 text-red-700 border border-red-100 text-xs font-black">Deactivate</button>` },
          ])}
        </div>
      </div>`);
  }

  async function loadAdminAudit() {
    setLoading('admin-audit');
    const data = await api('/api/admin/history/audit?limit=200').catch(() => ({ logs: [] }));
    $('view-admin-audit').innerHTML = shell('Admin Audit Logs', 'Audit trail for central admin actions.', table(data.logs || [], [
      { label: 'Action', render: (row) => `<b>${escapeHtml(row.action)}</b><div class="text-xs text-slate-500">${escapeHtml(row.resourceType || '')}</div>` },
      { label: 'Resource', render: (row) => escapeHtml(row.resourceId || '-') },
      { label: 'Metadata', render: (row) => jsonCell(row.metadataJson || {}) },
      { label: 'Created', render: (row) => fmt(row.createdAt) },
    ]), '<button data-ext-refresh="admin-audit" class="px-4 py-2 rounded-xl bg-slate-900 text-white font-bold">Refresh</button>');
  }

  async function loadSystemSettings() {
    $('view-system-settings').innerHTML = shell('System Settings', 'Server-side secrets and deployment settings checklist.', `
      <div class="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <div class="bg-white rounded-2xl border border-slate-100 p-6">
          <h3 class="font-black text-slate-900">Required server env</h3>
          <ul class="mt-4 space-y-2 text-sm text-slate-600 font-bold">
            <li>MAHARSHWE_ONLINE_ADMIN_API_KEY — server-only VPN ads/push proxy key</li>
            <li>FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY — server-only Firebase Admin SDK</li>
            <li>NEXT_PUBLIC_FIREBASE_* — public web push config for app.maharshwe.shop</li>
          </ul>
        </div>
        <div class="bg-white rounded-2xl border border-slate-100 p-6">
          <h3 class="font-black text-slate-900">Security rules</h3>
          <ul class="mt-4 space-y-2 text-sm text-slate-600 font-bold">
            <li>x-api-key is never exposed to frontend.</li>
            <li>All admin APIs require auth + permission server-side.</li>
            <li>POS admin pages are read-only for destructive actions.</li>
            <li>Push payloads must stay generic and non-sensitive.</li>
          </ul>
        </div>
      </div>`);
  }

  function wireEvents() {
    document.addEventListener('click', (event) => {
      const refresh = event.target.closest('[data-ext-refresh]');
      if (refresh) {
        state.loaded.delete(refresh.dataset.extRefresh);
        loadView(refresh.dataset.extRefresh, true).then(() => notify('Refreshed.')).catch((error) => notify(error.message, 'error'));
        return;
      }
      const nav = event.target.closest('[data-admin-ext-view]');
      if (nav) {
        setTimeout(() => showExtView(nav.dataset.adminExtView), 0);
      }
      if (event.target.closest('[data-vpn-ads-refresh]')) loadVpnAds().then(() => notify('VPN ads config refreshed.')).catch((error) => notify(error.message, 'error'));
      if (event.target.closest('[data-vpn-ads-reset]')) {
        fillVpnAds(state.vpnAdsConfig || {});
        renderVpnAdsPreview();
      }
      if (event.target.closest('[data-vpn-ads-disable]')) {
        if (!confirm('Disable VPN Free Server Ads? Free Server banner will stop appearing after connect.')) return;
        $('vpn-ads-enabled').checked = false;
        $('vpn-ads-form')?.requestSubmit();
      }
      const disableRole = event.target.closest('[data-admin-role-disable]');
      if (disableRole) {
        if (!confirm('Deactivate this admin role assignment?')) return;
        api(`/api/admin/admin-users/roles/${disableRole.dataset.adminRoleDisable}`, {
          method: 'PATCH',
          body: JSON.stringify({ active: false }),
        })
          .then(() => {
            notify('Admin role deactivated.');
            state.loaded.delete('admin-users');
            return loadAdminUsers();
          })
          .catch((error) => notify(error.message, 'error'));
      }
      const deleteAdmin = event.target.closest('[data-admin-user-delete]');
      if (deleteAdmin) {
        const label = deleteAdmin.dataset.adminUsername || 'this admin account';
        if (!confirm(`Delete admin account "${label}"? This removes admin portal login access.`)) return;
        api(`/api/admin/admin-users/${deleteAdmin.dataset.adminUserDelete}`, { method: 'DELETE' })
          .then(() => {
            notify('Admin account deleted.');
            state.loaded.delete('admin-users');
            return loadAdminUsers();
          })
          .catch((error) => notify(error.message, 'error'));
      }
    });

    document.addEventListener('input', (event) => {
      if (event.target.closest('#vpn-ads-form')) renderVpnAdsPreview();
      if (event.target.closest('#vpn-push-form')) renderVpnPushPreview();
    });

    document.addEventListener('submit', async (event) => {
      if (event.target.id === 'vpn-ads-form') {
        event.preventDefault();
        const payload = collectVpnAds();
        if (!payload.enabled && !confirm('You are disabling VPN Free Server Ads. Continue?')) return;
        try {
          await api('/api/admin/integrations/vpn-ads', { method: 'POST', body: JSON.stringify(payload) });
          notify('VPN ads saved.');
          state.loaded.delete('campaign-history');
          await loadVpnAds();
        } catch (error) {
          notify(error.message, 'error');
        }
      }

      if (event.target.id === 'vpn-push-form') {
        event.preventDefault();
        if (!confirm('You are about to send this notification to the Mahar Shwe VPN topic: maharshwe-vpn. Continue?')) return;
        try {
          await api('/api/admin/integrations/vpn-notifications/send', {
            method: 'POST',
            body: JSON.stringify({
              title: $('vpn-push-title').value.trim(),
              body: $('vpn-push-body').value.trim(),
              url: $('vpn-push-url').value.trim(),
              topic: 'maharshwe-vpn',
            }),
          });
          notify('VPN push notification sent.');
          $('vpn-push-body').value = '';
          renderVpnPushPreview();
          state.loaded.delete('campaign-history');
        } catch (error) {
          notify(error.message, 'error');
        }
      }

      if (event.target.id === 'pos-push-form') {
        event.preventDefault();
        const targetType = $('pos-push-target').value;
        if (!confirm(`Send POS web push to target: ${targetType}?`)) return;
        try {
          await api('/api/admin/push/pos/send', {
            method: 'POST',
            body: JSON.stringify({
              title: $('pos-push-title').value.trim(),
              body: $('pos-push-body').value.trim(),
              url: $('pos-push-url').value.trim(),
              targetType,
              shopId: $('pos-push-shop').value || undefined,
              userId: $('pos-push-user').value || undefined,
              role: $('pos-push-role').value || undefined,
            }),
          });
          notify('POS web push sent.');
          $('pos-push-body').value = '';
          state.loaded.delete('campaign-history');
        } catch (error) {
          notify(error.message, 'error');
        }
      }

      if (event.target.id === 'admin-user-form') {
        event.preventDefault();
        if (!confirm('Create this admin portal user?')) return;
        try {
          await api('/api/admin/admin-users', {
            method: 'POST',
            body: JSON.stringify({
              name: $('admin-user-name').value.trim(),
              username: $('admin-user-username').value.trim(),
              email: $('admin-user-email').value.trim() || undefined,
              password: $('admin-user-password').value,
              adminRole: $('admin-user-role').value,
            }),
          });
          notify('Admin user created.');
          state.loaded.delete('admin-users');
          await loadAdminUsers();
        } catch (error) {
          notify(error.message, 'error');
        }
      }
    });

    window.addEventListener('popstate', () => {
      const view = viewRoutes[location.pathname];
      if (view) showExtView(view, false);
    });
  }

  function bootRoute() {
    const view = viewRoutes[location.pathname];
    if (!view) return;
    const wait = setInterval(() => {
      const shell = $('dashboard-shell');
      if (shell && !shell.classList.contains('hidden')) {
        clearInterval(wait);
        showExtView(view, false);
      }
    }, 250);
    setTimeout(() => clearInterval(wait), 10000);
  }

  function init() {
    normalizeAdminRootUrl();
    addNavigation();
    addSections();
    wireEvents();
    bootRoute();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
}());
