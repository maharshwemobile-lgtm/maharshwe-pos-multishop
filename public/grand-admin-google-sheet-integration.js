(function () {
  const TOKEN_KEY = 'mahar_grand_admin_token';
  const API_BASE = location.hostname.includes('maharshwe.shop') ? '' : 'https://super.maharshwe.shop';
  const EVENTS = [
    ['repair', 'Repair'],
    ['sale', 'Sale'],
    ['income-expense', 'Income / Expense'],
    ['product-stock', 'Product / Stock'],
    ['money-service', 'ငွေလွဲ / ငွေထုတ်'],
    ['debt', 'အကြွေး'],
  ];

  const $ = (id) => document.getElementById(id);
  const esc = (value) => String(value ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function token() {
    return sessionStorage.getItem(TOKEN_KEY) || '';
  }

  async function api(path, options = {}) {
    const res = await fetch(API_BASE + path, {
      ...options,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token()}`,
        ...(options.headers || {}),
      },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) throw new Error(data.message || `HTTP ${res.status}`);
    return data;
  }

  function toast(message) {
    const el = $('toast');
    if (!el) return alert(message);
    el.textContent = message;
    el.classList.remove('hidden');
    setTimeout(() => el.classList.add('hidden'), 2600);
  }

  function rows(data, keys) {
    for (const key of keys) if (Array.isArray(data?.[key])) return data[key];
    return Array.isArray(data) ? data : [];
  }

  function sid(shop) {
    return shop.id || shop.shopId;
  }

  function sname(shop) {
    return shop.name || shop.shopName || shop.businessName || 'Unnamed Shop';
  }

  function tenant(shop) {
    return shop.code || shop.tenantId || shop.slug || shop.id || '-';
  }

  function ensurePanel() {
    if ($('panel-google-sheet')) return;
    const nav = $('nav');
    if (nav && !$('nav-google-sheet')) {
      const btn = document.createElement('button');
      btn.id = 'nav-google-sheet';
      btn.innerHTML = '<i class="fas fa-table"></i><span>Google Sheet</span>';
      btn.addEventListener('click', showPanel);
      nav.appendChild(btn);
    }
    const content = document.querySelector('.content');
    if (!content) return;
    const panel = document.createElement('section');
    panel.id = 'panel-google-sheet';
    panel.className = 'panel';
    panel.innerHTML = `
      <div class="card">
        <div class="card-head">
          <div><h3>Google Sheet Integration</h3><div class="muted">Tenant တစ်ခုချင်း Apps Script Web App URL ချိတ်ရန်</div></div>
          <button class="btn outline" id="gsReloadBtn">Refresh</button>
        </div>
        <div class="form-grid">
          <div class="form-group"><label>Tenant</label><select id="gsShopSelect"></select></div>
          <div class="form-group"><label>Status</label><input id="gsStatus" readonly placeholder="NOT_TESTED"></div>
        </div>
        <div class="form-group" style="margin-top:14px"><label>Google Apps Script Web App URL /exec</label><input id="gsWebhookUrl" placeholder="https://script.google.com/macros/s/.../exec"></div>
        <div class="card" style="box-shadow:none;margin-top:14px">
          <div class="card-head"><h3 style="font-size:15px">Sync Events</h3></div>
          <div id="gsEvents" class="form-grid"></div>
        </div>
        <div class="actions"><button class="btn primary" id="gsTestBtn">Test Connection</button><button class="btn success" id="gsSaveBtn">Save</button></div>
        <div id="gsMessage" class="muted" style="margin-top:12px"></div>
      </div>
      <div class="card"><h3>Monthly Sheet Tabs</h3><p class="muted">လပြောင်းရင် 2026-July_Repair, 2026-August_Repair လို Auto tab အသစ် သွားမယ်။</p><div class="table-wrap"><table><thead><tr><th>Module</th><th>Tab</th></tr></thead><tbody><tr><td>Repair</td><td><span class="code">YYYY-Month_Repair</span></td></tr><tr><td>Sale</td><td><span class="code">YYYY-Month_Sale</span></td></tr><tr><td>Income / Expense</td><td><span class="code">YYYY-Month_IncomeExpense</span></td></tr><tr><td>Product / Stock</td><td><span class="code">YYYY-Month_ProductStock</span></td></tr><tr><td>Money Service</td><td><span class="code">YYYY-Month_MoneyService</span></td></tr><tr><td>Debt</td><td><span class="code">YYYY-Month_Debt</span></td></tr><tr><td>Summary</td><td><span class="code">YYYY-Month_Summary</span></td></tr></tbody></table></div></div>`;
    content.appendChild(panel);
    $('gsReloadBtn').onclick = loadShops;
    $('gsShopSelect').onchange = loadIntegration;
    $('gsTestBtn').onclick = testConnection;
    $('gsSaveBtn').onclick = saveIntegration;
    $('gsEvents').innerHTML = EVENTS.map(([key, label]) => `<label style="display:flex;gap:8px;align-items:center"><input type="checkbox" class="gsEvent" value="${esc(key)}" checked style="width:auto">${esc(label)}</label>`).join('');
  }

  function showPanel() {
    ensurePanel();
    document.querySelectorAll('.panel').forEach((el) => el.classList.remove('active'));
    document.querySelectorAll('.nav button').forEach((el) => el.classList.remove('active'));
    $('panel-google-sheet')?.classList.add('active');
    $('nav-google-sheet')?.classList.add('active');
    if ($('pageTitle')) $('pageTitle').innerHTML = 'Google Sheet <small>Tenant integrations</small>';
    loadShops();
  }

  async function loadShops() {
    try {
      ensurePanel();
      const data = await api('/api/grand-admin/shops');
      const shops = rows(data, ['shops', 'tenants', 'data', 'rows']);
      $('gsShopSelect').innerHTML = shops.map((shop) => `<option value="${esc(sid(shop))}">${esc(sname(shop))} · ${esc(tenant(shop))}</option>`).join('');
      if (shops.length) await loadIntegration();
    } catch (error) {
      toast(error.message);
    }
  }

  function selectedEvents() {
    return [...document.querySelectorAll('.gsEvent:checked')].map((item) => item.value);
  }

  function setSelectedEvents(events) {
    document.querySelectorAll('.gsEvent').forEach((input) => {
      input.checked = !Array.isArray(events) || !events.length || events.includes(input.value);
    });
  }

  async function loadIntegration() {
    const shopId = $('gsShopSelect')?.value;
    if (!shopId) return;
    const data = await api(`/api/grand-admin/shops/${shopId}/google-sheet-integration`);
    const cfg = data.integration || {};
    $('gsWebhookUrl').value = cfg.webhookUrl || '';
    $('gsStatus').value = cfg.lastTestStatus || 'NOT_TESTED';
    $('gsMessage').textContent = cfg.lastTestMessage || '';
    setSelectedEvents(cfg.events);
  }

  async function testConnection() {
    const shopId = $('gsShopSelect')?.value;
    const webhookUrl = $('gsWebhookUrl')?.value.trim();
    if (!shopId || !webhookUrl) return toast('Webhook URL ထည့်ပါ');
    try {
      const data = await api(`/api/grand-admin/shops/${shopId}/google-sheet-integration/test`, { method: 'POST', body: JSON.stringify({ webhookUrl }) });
      $('gsStatus').value = data.integration?.lastTestStatus || 'CONNECTED';
      $('gsMessage').textContent = data.result?.message || 'CONNECTED';
      toast('Google Sheet Connected');
    } catch (error) {
      $('gsStatus').value = 'FAILED';
      $('gsMessage').textContent = error.message;
      toast(error.message);
    }
  }

  async function saveIntegration() {
    const shopId = $('gsShopSelect')?.value;
    const webhookUrl = $('gsWebhookUrl')?.value.trim();
    if (!shopId || !webhookUrl) return toast('Webhook URL ထည့်ပါ');
    try {
      await api(`/api/grand-admin/shops/${shopId}/google-sheet-integration`, { method: 'PATCH', body: JSON.stringify({ enabled: true, webhookUrl, events: selectedEvents() }) });
      toast('Saved');
      await loadIntegration();
    } catch (error) {
      toast(error.message);
    }
  }

  function boot() { ensurePanel(); }
  window.openGoogleSheetIntegration = showPanel;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
  setTimeout(boot, 1000);
})();
