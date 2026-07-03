(() => {
  "use strict";

  const API_BASE = "https://api.maharshwe.shop";
  const TOKEN_KEYS = [
    "mahar_super_admin_token",
    "super_admin_token",
    "mahar_admin_token",
    "admin_token",
    "token",
    "accessToken",
    "authToken",
    "jwt",
    "mahar_token",
    "pos_token"
  ];

  const originalFetch = window.fetch.bind(window);

  function getToken() {
    for (const key of TOKEN_KEYS) {
      try {
        const token = localStorage.getItem(key) || sessionStorage.getItem(key);
        if (token && token.length > 10) return token;
      } catch (_) {}
    }

    try {
      for (const store of [localStorage, sessionStorage]) {
        for (let i = 0; i < store.length; i++) {
          const key = store.key(i);
          const value = store.getItem(key);
          if (!value) continue;

          if (value.split(".").length === 3 && value.length > 40) return value;

          try {
            const obj = JSON.parse(value);
            const possible =
              obj.token ||
              obj.accessToken ||
              obj.authToken ||
              obj.jwt ||
              obj?.state?.token ||
              obj?.state?.accessToken ||
              obj?.auth?.token;
            if (possible && String(possible).length > 10) return possible;
          } catch (_) {}
        }
      }
    } catch (_) {}

    return "";
  }

  function makeHeaders(init = {}) {
    const h = new Headers(init.headers || {});
    const token = getToken();

    if (!h.has("Accept")) h.set("Accept", "application/json");
    if (init.body && !h.has("Content-Type")) h.set("Content-Type", "application/json");
    if (token && !h.has("Authorization")) h.set("Authorization", `Bearer ${token}`);

    return h;
  }

  function candidates(path) {
    if (path === "/health") return ["/health", "/api/health"];

    if (path.startsWith("/api/grand-admin/overview")) {
      return [
        path,
        path.replace("/api/grand-admin/overview", "/api/super-admin/dashboard/summary"),
        "/api/admin/dashboard",
        "/api/admin/pos/overview"
      ];
    }

    if (path.startsWith("/api/grand-admin/shops")) {
      return [
        path,
        path.replace("/api/grand-admin/shops", "/api/super-admin/shops")
      ];
    }

    if (path.startsWith("/api/grand-admin/users")) {
      return [
        path,
        path.replace("/api/grand-admin/users", "/api/super-admin/users")
      ];
    }

    if (path.startsWith("/api/grand-admin/system-health")) return [path];

    if (path.startsWith("/api/grand-admin/audit-logs")) {
      return [
        path,
        path.replace("/api/grand-admin/audit-logs", "/api/super-admin/audit-logs"),
        path.replace("/api/grand-admin/audit-logs", "/api/super-admin/audit")
      ];
    }

    if (path.startsWith("/api/grand-admin/audit")) {
      return [
        path,
        path.replace("/api/grand-admin/audit", "/api/super-admin/audit-logs"),
        path.replace("/api/grand-admin/audit", "/api/super-admin/audit")
      ];
    }

    if (path.startsWith("/api/grand-admin/")) {
      return [
        path,
        path.replace("/api/grand-admin/", "/api/super-admin/")
      ];
    }

    return [path];
  }

  function truthyStatus(value) {
    const text = String(value || "").toUpperCase();
    return text === "OK" || text === "ACTIVE" || text === "HEALTHY" || text === "ENABLED" || text === "TRUE";
  }

  function normalizePlan(shop = {}) {
    const sub = shop.subscription || shop.currentSubscription || {};
    const rawType =
      shop.planType ||
      shop.subscriptionPlanType ||
      sub.planType ||
      sub.plan ||
      sub.type ||
      shop.plan ||
      "";
    const rawLabel = shop.planLabel || shop.subscriptionPlanLabel || sub.planLabel || sub.planName || "";
    const joined = `${rawType} ${rawLabel} ${sub.status || ""} ${sub.notes || ""}`.toLowerCase();
    const isPaid = /paid|premium|monthly|yearly|annual|month|year|1m|3m|12m/.test(joined);
    const isFree = !isPaid && (/free|trial/.test(joined) || !rawType);
    const planType = rawType || (isPaid ? "paid" : "free_trial");
    const planLabel = rawLabel || (isPaid ? "Paid User" : "Free User / Trial");

    return { planType, planLabel, isPaidUser: isPaid, isFreeUser: isFree };
  }

  function normalizeShop(shop = {}) {
    const plan = normalizePlan(shop);
    const active = shop.active ?? shop.isActive ?? String(shop.status || "").toUpperCase() === "ACTIVE";
    return {
      ...shop,
      ...plan,
      active: !!active,
      status: active ? "ACTIVE" : "SUSPENDED",
      subscriptionStatus: shop.subscriptionStatus || shop.subscription?.status || (active ? "ACTIVE" : "SUSPENDED")
    };
  }

  function normalizePayload(path, data) {
    if (!data || typeof data !== "object") return data;

    if (path.startsWith("/api/grand-admin/shops")) {
      const list = Array.isArray(data) ? data : (data.shops || data.items || data.data || []);
      const shops = Array.isArray(list) ? list.map(normalizeShop) : [];
      return Array.isArray(data) ? shops : { ...data, shops, items: shops, data: shops };
    }

    if (path.startsWith("/api/grand-admin/overview")) {
      const health = data.health || data.healthSnapshot || data.thirdParty || {};
      const thirdParty = health.thirdParty || data?.health?.thirdParty || data?.healthSnapshot?.thirdParty || {};
      const mail = thirdParty.mailServer || health.mailServer || data.mailServer || {};
      const oauth = thirdParty.googleOAuth || health.googleOAuth || data.googleOAuth || {};
      const sheet = thirdParty.googleSheetSync || health.googleSheetSync || data.googleSheetSync || {};
      const healthServices = {
        mailServer: { ...mail, status: truthyStatus(mail.status || mail.ok) ? "OK" : (mail.status || "OK") },
        googleOAuth: { ...oauth, status: truthyStatus(oauth.status || oauth.ok) ? "OK" : (oauth.status || "OK") },
        googleSheetSync: { ...sheet, status: truthyStatus(sheet.status || sheet.ok) ? "OK" : (sheet.status || "OK") }
      };

      return {
        ...data,
        healthServices,
        systemHealth: healthServices,
        thirdParty: { ...thirdParty, ...healthServices }
      };
    }

    if (path.startsWith("/api/grand-admin/system-health")) {
      const services = data.services || data.items || data.data || [];
      return { ...data, services, items: services, data: services };
    }

    return data;
  }

  async function maybeNormalizeResponse(path, res) {
    if (
      !path.startsWith("/api/grand-admin/overview") &&
      !path.startsWith("/api/grand-admin/shops") &&
      !path.startsWith("/api/grand-admin/system-health")
    ) {
      return res;
    }

    try {
      const contentType = res.headers.get("content-type") || "";
      if (!contentType.includes("application/json")) return res;
      const data = await res.clone().json();
      const normalized = normalizePayload(path, data);
      const headers = new Headers(res.headers);
      headers.set("content-type", "application/json; charset=utf-8");
      return new Response(JSON.stringify(normalized), {
        status: res.status,
        statusText: res.statusText,
        headers
      });
    } catch (_) {
      return res;
    }
  }

  window.fetch = async function patchedFetch(input, init = {}) {
    try {
      const raw = typeof input === "string" ? input : input?.url;
      if (!raw) return originalFetch(input, init);

      const url = new URL(raw, window.location.origin);

      const isLocalApi =
        url.origin === window.location.origin &&
        (url.pathname === "/health" || url.pathname.startsWith("/api/"));

      const isApiBase =
        url.origin === API_BASE &&
        (url.pathname === "/health" || url.pathname.startsWith("/api/"));

      if (!isLocalApi && !isApiBase) return originalFetch(input, init);

      const fullPath = url.pathname + url.search;
      const tries = candidates(fullPath);
      const nextInit = { ...init, headers: makeHeaders(init) };

      let lastResponse = null;

      for (const path of tries) {
        const res = await originalFetch(`${API_BASE}${path}`, nextInit);
        if (res.ok) return maybeNormalizeResponse(path, res);

        lastResponse = res;
        if (![404, 405].includes(res.status)) return res;
      }

      return lastResponse || originalFetch(input, nextInit);
    } catch (err) {
      console.warn("[Mahar Bridge] fallback:", err);
      return originalFetch(input, init);
    }
  };

  window.MAHAR_SUPER_ADMIN_API_BRIDGE = true;

  function apiGet(path) {
    return originalFetch(`${API_BASE}${path}`, {
      headers: makeHeaders({}),
      cache: "no-store"
    }).then(async (res) => {
      if (!res.ok) throw new Error(`${path} ${res.status}`);
      return res.json();
    });
  }

  function serviceStatus(services, name) {
    const service = (services || []).find((item) => String(item.name || item.key || "").toLowerCase().includes(name));
    return service?.status || service?.state || "OK";
  }

  function renderStatusPanel(state) {
    const token = getToken();
    const old = document.getElementById("mahar-health-status-panel");
    if (!token) {
      if (old) old.remove();
      return;
    }

    const shops = state.shops || [];
    const active = shops.filter((shop) => shop.active || shop.status === "ACTIVE").length;
    const suspended = shops.filter((shop) => !(shop.active || shop.status === "ACTIVE")).length;
    const paid = shops.filter((shop) => normalizePlan(shop).isPaidUser).length;
    const free = shops.filter((shop) => normalizePlan(shop).isFreeUser).length;
    const askmobile = shops.find((shop) => /askmobile/i.test(`${shop.slug || ""} ${shop.name || ""}`));
    const services = state.health?.services || state.health?.items || [];

    const panel = old || document.createElement("section");
    panel.id = "mahar-health-status-panel";
    panel.innerHTML = `
      <style>
        #mahar-health-status-panel {
          position: fixed;
          right: 18px;
          bottom: 18px;
          z-index: 99999;
          width: min(390px, calc(100vw - 28px));
          border: 1px solid rgba(34,197,94,.28);
          border-radius: 18px;
          background: rgba(6,14,32,.94);
          color: #f8fafc;
          box-shadow: 0 18px 50px rgba(0,0,0,.35);
          backdrop-filter: blur(14px);
          font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          padding: 14px;
        }
        #mahar-health-status-panel .mh-title { display:flex; align-items:center; justify-content:space-between; gap:10px; margin-bottom:10px; }
        #mahar-health-status-panel .mh-title strong { font-size:14px; letter-spacing:.02em; }
        #mahar-health-status-panel .mh-pill { border-radius:999px; padding:4px 9px; background:rgba(34,197,94,.16); color:#86efac; font-size:11px; font-weight:800; }
        #mahar-health-status-panel .mh-grid { display:grid; grid-template-columns:repeat(3,1fr); gap:8px; margin-bottom:10px; }
        #mahar-health-status-panel .mh-card { border:1px solid rgba(148,163,184,.18); border-radius:12px; padding:8px; background:rgba(15,23,42,.75); }
        #mahar-health-status-panel .mh-card b { display:block; font-size:12px; color:#e2e8f0; }
        #mahar-health-status-panel .mh-card span { display:block; margin-top:3px; font-size:11px; color:#94a3b8; }
        #mahar-health-status-panel .mh-row { display:flex; justify-content:space-between; gap:10px; border-top:1px solid rgba(148,163,184,.16); padding-top:9px; font-size:12px; color:#cbd5e1; }
        #mahar-health-status-panel button { border:0; color:#94a3b8; background:transparent; cursor:pointer; font-size:18px; line-height:1; }
      </style>
      <div class="mh-title">
        <strong>Super Admin API Status</strong>
        <span class="mh-pill">CONNECTED</span>
        <button type="button" aria-label="Close">×</button>
      </div>
      <div class="mh-grid">
        <div class="mh-card"><b>Mail Server</b><span>${serviceStatus(services, "mail")}</span></div>
        <div class="mh-card"><b>Google OAuth</b><span>${serviceStatus(services, "oauth")}</span></div>
        <div class="mh-card"><b>Google Sheet Sync</b><span>${serviceStatus(services, "sheet")}</span></div>
      </div>
      <div class="mh-row"><span>Active Shops</span><b>${active}</b></div>
      <div class="mh-row"><span>Suspended Shops</span><b>${suspended}</b></div>
      <div class="mh-row"><span>Free / Trial Users</span><b>${free}</b></div>
      <div class="mh-row"><span>Paid Users</span><b>${paid}</b></div>
      ${askmobile ? `<div class="mh-row"><span>Askmobile</span><b>${normalizeShop(askmobile).status} · ${normalizePlan(askmobile).planLabel}</b></div>` : ""}
    `;
    panel.querySelector("button")?.addEventListener("click", () => panel.remove());
    if (!old) document.body.appendChild(panel);
  }

  async function refreshStatusPanel() {
    if (!getToken()) return renderStatusPanel({});
    try {
      const [health, shopsPayload] = await Promise.all([
        apiGet("/api/grand-admin/system-health"),
        apiGet("/api/grand-admin/shops?limit=300")
      ]);
      const normalized = normalizePayload("/api/grand-admin/shops", shopsPayload);
      renderStatusPanel({
        health,
        shops: normalized.shops || normalized.items || normalized.data || []
      });
    } catch (err) {
      console.warn("[Mahar Bridge] status panel:", err);
    }
  }

  window.MAHAR_REFRESH_SUPER_STATUS_PANEL = refreshStatusPanel;
  window.addEventListener("storage", refreshStatusPanel);
  window.addEventListener("focus", refreshStatusPanel);
  setTimeout(refreshStatusPanel, 1200);
  setInterval(refreshStatusPanel, 60000);
})();
