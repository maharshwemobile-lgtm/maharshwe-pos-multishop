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
        path.replace("/api/grand-admin/overview", "/api/super-admin/dashboard/summary"),
        path,
        "/api/admin/dashboard",
        "/api/admin/pos/overview"
      ];
    }

    if (path.startsWith("/api/grand-admin/shops")) {
      return [
        path.replace("/api/grand-admin/shops", "/api/super-admin/shops"),
        path
      ];
    }

    if (path.startsWith("/api/grand-admin/users")) {
      return [
        path.replace("/api/grand-admin/users", "/api/super-admin/users"),
        path
      ];
    }

    if (path.startsWith("/api/grand-admin/audit-logs")) {
      return [
        path.replace("/api/grand-admin/audit-logs", "/api/super-admin/audit-logs"),
        path.replace("/api/grand-admin/audit-logs", "/api/super-admin/audit"),
        path
      ];
    }

    if (path.startsWith("/api/grand-admin/audit")) {
      return [
        path.replace("/api/grand-admin/audit", "/api/super-admin/audit-logs"),
        path.replace("/api/grand-admin/audit", "/api/super-admin/audit"),
        path
      ];
    }

    if (path.startsWith("/api/grand-admin/")) {
      return [
        path.replace("/api/grand-admin/", "/api/super-admin/"),
        path
      ];
    }

    return [path];
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
        if (res.ok) return res;

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
})();
