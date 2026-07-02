import { productIconInfo } from './ProductCategoryIcon.jsx';

const SELECTORS = [
  '.p2-product-name > div',
  '.stock-product-cell > div',
];

const ICON_PATHS = {
  phone: '<rect width="14" height="20" x="5" y="2" rx="2"/><path d="M12 18h.01"/>',
  accessories: '<path d="m7.5 4.27 9 5.15"/><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>',
  earphone: '<path d="M4 14a8 8 0 0 1 16 0"/><path d="M18 19c0 1.7-1.3 3-3 3h-1"/><path d="M4 14h3v7H4z"/><path d="M17 14h3v7h-3z"/>',
  charger: '<path d="M12 22v-5"/><path d="M9 8V2"/><path d="M15 8V2"/><path d="M18 8v5a6 6 0 0 1-12 0V8Z"/>',
  cable: '<path d="M17 19h1a4 4 0 0 0 4-4v-1"/><path d="M7 5H6a4 4 0 0 0-4 4v1"/><rect width="10" height="5" x="7" y="14" rx="1"/><rect width="10" height="5" x="7" y="5" rx="1"/>',
  battery: '<rect width="16" height="10" x="2" y="7" rx="2"/><path d="M22 11v2"/><path d="M6 11v2"/><path d="M10 11v2"/><path d="M14 11v2"/>',
  cover: '<path d="M20 13c0 5-3.5 7.5-8 9-4.5-1.5-8-4-8-9V5l8-3 8 3z"/>',
  speaker: '<rect width="16" height="20" x="4" y="2" rx="2"/><path d="M12 6h.01"/><circle cx="12" cy="14" r="4"/>',
  watch: '<path d="M10 2h4"/><path d="M10 22h4"/><rect width="12" height="16" x="6" y="4" rx="4"/>',
  tablet: '<rect width="16" height="20" x="4" y="2" rx="2"/><path d="M12 18h.01"/>',
  computer: '<path d="M20 16V7a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v9"/><path d="M2 20h20"/><path d="M6 16h12"/>',
  storage: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 1.7 4 3 9 3s9-1.3 9-3V5"/><path d="M3 12c0 1.7 4 3 9 3s9-1.3 9-3"/>',
  mouse: '<rect x="5" y="2" width="14" height="20" rx="7"/><path d="M12 2v4"/>',
  camera: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z"/><circle cx="12" cy="13" r="3"/>',
  gaming: '<path d="M6 11h4"/><path d="M8 9v4"/><path d="M15 12h.01"/><path d="M18 10h.01"/><path d="M17.32 5H6.68a4 4 0 0 0-3.84 2.9l-1.33 4.66C.7 15.4 2.82 18 5.77 18c1.7 0 3.28-.86 4.21-2.29l.49-.74h3.06l.49.74A5 5 0 0 0 18.23 18c2.95 0 5.07-2.6 4.26-5.44L21.16 7.9A4 4 0 0 0 17.32 5Z"/>',
  repair: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94z"/>',
  product: '<path d="m7.5 4.27 9 5.15"/><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>',
};

function iconSvg(kind) {
  const paths = ICON_PATHS[kind] || ICON_PATHS.product;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
}

function decorate(node) {
  if (!(node instanceof HTMLElement)) return;
  const row = node.closest('tr');
  const productCell = node.closest('.p2-product-name, .stock-product-cell');
  const text = [row?.textContent, productCell?.textContent].filter(Boolean).join(' ');
  const { kind, label, tone } = productIconInfo({ name: text });

  if (node.dataset.productKind === kind && node.dataset.productIconReady === 'true') return;

  [...node.classList].filter((name) => name.startsWith('product-kind-')).forEach((name) => node.classList.remove(name));
  node.classList.add('product-kind-runtime', `product-kind-${tone}`);
  node.dataset.productKind = kind;
  node.dataset.productIconReady = 'true';
  node.title = label;
  node.setAttribute('aria-label', label);
  node.innerHTML = iconSvg(kind);
}

function scan() {
  SELECTORS.forEach((selector) => document.querySelectorAll(selector).forEach(decorate));
}

export function installProductIconRuntimeV22() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => {};

  let frame = 0;
  const schedule = () => {
    if (frame) return;
    frame = window.requestAnimationFrame(() => {
      frame = 0;
      scan();
    });
  };

  const observer = new MutationObserver(schedule);
  observer.observe(document.getElementById('root') || document.body, {
    childList: true,
    subtree: true,
    characterData: true,
  });

  schedule();
  return () => {
    observer.disconnect();
    if (frame) window.cancelAnimationFrame(frame);
  };
}
