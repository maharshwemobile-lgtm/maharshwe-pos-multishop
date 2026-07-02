import { apiFetch } from './phase2Api';
import './pos/pos-payment-methods-v23.css';

const PAYMENT_METHODS_CHANGED = 'mahar:payment-methods-changed';

export function installPosPaymentMethodsRuntimeV23() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => {};

  const originalFetch = window.fetch.bind(window);
  let methods = [];
  let selected = null;
  let loading = false;
  let lastLoadAt = 0;
  let frame = 0;

  function corePaymentContainer() {
    return [...document.querySelectorAll('.compact-pos-payment-methods')]
      .find((node) => !node.hasAttribute('data-pos-dynamic-payment-ui')) || null;
  }

  function coreButton(container, method) {
    const buttons = [...container.querySelectorAll('button')];
    const exact = (text) => buttons.find((button) => button.textContent.trim().toLowerCase() === text.toLowerCase());
    if (method.code === 'CREDIT') return exact('Credit');
    if (method.kind === 'CASH' || method.legacyMethod === 'CASH') return exact('Cash');
    if (method.legacyMethod === 'WAVE_PAY') return exact('Wave');
    return exact('KPay') || exact('Wave');
  }

  function selectedFromCore(container) {
    const active = [...container.querySelectorAll('button')].find((button) => button.classList.contains('active'));
    const text = active?.textContent.trim().toLowerCase();
    if (text === 'credit') return methods.find((method) => method.code === 'CREDIT') || null;
    if (text === 'cash') return methods.find((method) => method.kind === 'CASH' || method.legacyMethod === 'CASH') || null;
    if (text === 'wave') return methods.find((method) => method.legacyMethod === 'WAVE_PAY') || null;
    if (text === 'kpay') return methods.find((method) => method.legacyMethod === 'KPAY') || null;
    return null;
  }

  function signature() {
    return methods.map((method) => `${method.id || method.code}:${method.name}:${method.kind}`).join('|');
  }

  function updateReviewLabel() {
    if (!selected) return;
    const blocks = [...document.querySelectorAll('.smart-pos-review-meta > div')];
    const paymentBlock = blocks.find((block) => block.querySelector('span')?.textContent.trim() === 'Payment');
    const value = paymentBlock?.querySelector('b');
    if (value) value.textContent = selected.name;
  }

  function choose(method, core) {
    selected = method;
    window.__maharPosSelectedPaymentMethod = method;
    const button = coreButton(core, method);
    if (button) button.click();
    schedule();
  }

  function buildMethodButton(method, core) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.paymentCode = method.code;
    button.dataset.paymentId = method.id || '';
    const name = document.createElement('b');
    name.textContent = method.name;
    const type = document.createElement('small');
    type.textContent = method.kind === 'CREDIT' ? 'Customer Debt' : method.kind === 'CASH' ? 'Cash' : method.kind;
    button.append(name, type);
    button.addEventListener('click', () => choose(method, core));
    return button;
  }

  function render() {
    const core = corePaymentContainer();
    updateReviewLabel();
    if (!core) return;

    if (!methods.length) {
      core.style.display = '';
      if (!loading && Date.now() - lastLoadAt > 5000) load();
      return;
    }

    if (!selected) selected = selectedFromCore(core) || methods.find((method) => method.kind === 'CASH') || methods[0];
    window.__maharPosSelectedPaymentMethod = selected;
    core.style.display = 'none';

    let dynamic = core.parentElement.querySelector('[data-pos-dynamic-payment-ui]');
    if (!dynamic) {
      dynamic = document.createElement('div');
      dynamic.className = 'compact-pos-payment-methods compact-pos-payment-methods-dynamic';
      dynamic.setAttribute('data-pos-dynamic-payment-ui', '');
      core.insertAdjacentElement('afterend', dynamic);
    }

    const nextSignature = signature();
    if (dynamic.dataset.signature !== nextSignature) {
      dynamic.dataset.signature = nextSignature;
      dynamic.replaceChildren(...methods.map((method) => buildMethodButton(method, core)));
    }

    [...dynamic.querySelectorAll('button')].forEach((button) => {
      const sameId = selected?.id && button.dataset.paymentId === selected.id;
      const sameCode = !selected?.id && button.dataset.paymentCode === selected?.code;
      button.classList.toggle('active', Boolean(sameId || sameCode));
    });

    let hint = core.parentElement.querySelector('[data-pos-payment-hint]');
    if (!hint) {
      hint = document.createElement('div');
      hint.className = 'compact-pos-payment-hint';
      hint.setAttribute('data-pos-payment-hint', '');
      dynamic.insertAdjacentElement('afterend', hint);
    }
    hint.textContent = selected?.kind === 'CREDIT'
      ? 'Credit Sale — Customer name or phone is required.'
      : `${selected?.name || 'Payment'} ကို ရွေးထားသည်${selected?.accountId ? ` · Balance ${Number(selected.balance || 0).toLocaleString()} MMK` : ''}`;
  }

  async function load() {
    loading = true;
    lastLoadAt = Date.now();
    try {
      const response = await apiFetch('/api/pos/payment-methods');
      methods = [...(response.paymentMethods || []), ...(response.credit ? [response.credit] : [])];
      if (selected) {
        selected = methods.find((method) => (selected.id && method.id === selected.id) || method.code === selected.code) || null;
      }
    } catch (error) {
      console.warn('POS payment methods load failed:', error.message);
      methods = [];
    } finally {
      loading = false;
      schedule();
    }
  }

  function schedule() {
    if (frame) return;
    frame = window.requestAnimationFrame(() => {
      frame = 0;
      render();
    });
  }

  function resetMethods() {
    methods = [];
    selected = null;
    lastLoadAt = 0;
    schedule();
  }

  function isSalesPath(pathname) {
    return pathname === '/api/sales' || pathname.endsWith('/api/sales');
  }

  function isPaymentSettingsPath(pathname) {
    return pathname.includes('/api/finance/settings/payment-methods');
  }

  window.fetch = function posDynamicPaymentFetch(input, init = {}) {
    let url;
    let method;
    try {
      url = new URL(typeof input === 'string' ? input : input.url, window.location.origin);
      method = String(init.method || (typeof input !== 'string' ? input.method : 'GET') || 'GET').toUpperCase();
      if (isSalesPath(url.pathname) && method === 'POST' && selected && init.body && typeof init.body === 'string') {
        const body = JSON.parse(init.body);
        if (Array.isArray(body.items)) {
          if (selected.code === 'CREDIT') {
            body.paymentMethod = 'CREDIT';
            delete body.paymentMethodId;
            delete body.paymentMethodCode;
            delete body.paymentMethodName;
          } else {
            body.paymentMethod = selected.legacyMethod || 'OTHER';
            body.paymentMethodId = selected.id;
            body.paymentMethodCode = selected.code;
            body.paymentMethodName = selected.name;
          }
          init = { ...init, body: JSON.stringify(body) };
        }
      }
    } catch (error) {
      console.warn('POS payment request transform skipped:', error.message);
    }

    const response = originalFetch(input, init);
    if (url && isPaymentSettingsPath(url.pathname) && ['POST', 'PATCH', 'DELETE'].includes(method)) {
      response.then((result) => {
        if (result.ok) {
          resetMethods();
          window.dispatchEvent(new Event(PAYMENT_METHODS_CHANGED));
        }
      }).catch(() => {});
    }
    return response;
  };

  window.addEventListener(PAYMENT_METHODS_CHANGED, resetMethods);
  const observer = new MutationObserver(schedule);
  observer.observe(document.getElementById('root') || document.body, { childList: true, subtree: true });
  schedule();

  return () => {
    window.fetch = originalFetch;
    window.removeEventListener(PAYMENT_METHODS_CHANGED, resetMethods);
    observer.disconnect();
    if (frame) window.cancelAnimationFrame(frame);
  };
}
