(function () {
  'use strict';

  if (location.hostname !== 'super.maharshwe.shop') return;

  var config = null;
  var captchaRequired = false;
  var captchaToken = '';
  var widgetId = null;
  var originalFetch = window.fetch.bind(window);

  function loadScript() {
    if (window.turnstile) return Promise.resolve();
    return new Promise(function (resolve, reject) {
      var existing = document.querySelector('script[data-super-turnstile]');
      if (existing) {
        existing.addEventListener('load', resolve, { once: true });
        existing.addEventListener('error', reject, { once: true });
        return;
      }
      var script = document.createElement('script');
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      script.async = true;
      script.defer = true;
      script.dataset.superTurnstile = 'true';
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  function findLoginForm() {
    var password = document.querySelector('input[type="password"]');
    return password && password.closest('form');
  }

  function ensureChallenge() {
    if (!captchaRequired || !config || !config.turnstile || !config.turnstile.enabled) return;
    var form = findLoginForm();
    if (!form) return;
    var box = document.getElementById('super-admin-turnstile-box');
    if (!box) {
      box = document.createElement('div');
      box.id = 'super-admin-turnstile-box';
      box.style.cssText = 'display:flex;justify-content:center;min-height:66px;margin:4px 0;';
      var submit = form.querySelector('button[type="submit"]');
      form.insertBefore(box, submit || null);
    }
    loadScript().then(function () {
      if (widgetId !== null || !window.turnstile) return;
      widgetId = window.turnstile.render(box, {
        sitekey: config.turnstile.siteKey,
        theme: 'auto',
        callback: function (token) { captchaToken = token || ''; },
        'expired-callback': function () { captchaToken = ''; },
        'error-callback': function () { captchaToken = ''; },
      });
    }).catch(function () {
      box.textContent = 'Security check could not load. Please refresh the page.';
      box.style.color = '#ef4444';
      box.style.fontSize = '13px';
    });
  }

  window.fetch = async function (input, init) {
    var url = typeof input === 'string' ? input : input && input.url;
    var isLogin = url && /\/api\/(?:auth\/)?login(?:\?|$)/.test(url);
    var nextInit = init;
    if (isLogin && init && typeof init.body === 'string') {
      try {
        var payload = JSON.parse(init.body);
        if (captchaToken) payload.turnstileToken = captchaToken;
        nextInit = Object.assign({}, init, { body: JSON.stringify(payload) });
      } catch (_) {}
    }

    var response = await originalFetch(input, nextInit);
    if (isLogin) {
      try {
        var data = await response.clone().json();
        if (data && data.captchaRequired) {
          captchaRequired = true;
          captchaToken = '';
          if (widgetId !== null && window.turnstile) window.turnstile.reset(widgetId);
          setTimeout(ensureChallenge, 0);
        }
      } catch (_) {}
    }
    return response;
  };

  originalFetch('/api/auth/super-security-config', { credentials: 'same-origin', cache: 'no-store' })
    .then(function (response) { return response.json(); })
    .then(function (data) { config = data; })
    .catch(function () {});

  new MutationObserver(ensureChallenge).observe(document.documentElement, { childList: true, subtree: true });
})();
