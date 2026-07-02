import { apiFetch } from './phase2Api';

export const INCOME_CATEGORY_EVENT = 'mahar:income-categories-changed';

export function installIncomeCategoryRuntimeV23() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => {};
  let categories = [];
  let frame = 0;

  const load = async () => {
    try {
      const response = await apiFetch('/api/finance/settings/catalogs');
      categories = response.incomeCategories || [];
      window.dispatchEvent(new CustomEvent(INCOME_CATEGORY_EVENT, { detail: categories }));
      schedule();
    } catch {}
  };

  const apply = () => {
    const candidates = [...document.querySelectorAll('section,article,form')];
    const panel = candidates.find((node) => /Record Other Income|Other Income/i.test(node.textContent || '') && node.querySelector('input'));
    if (!panel) return;
    const labels = [...panel.querySelectorAll('label')];
    const label = labels.find((item) => /Source|Category/i.test(item.textContent || ''));
    const input = label?.querySelector('input');
    if (!label || !input) return;
    input.setAttribute('list', 'business-income-category-options');
    input.setAttribute('autocomplete', 'off');
    let list = document.getElementById('business-income-category-options');
    if (!list) {
      list = document.createElement('datalist');
      list.id = 'business-income-category-options';
      document.body.appendChild(list);
    }
    list.replaceChildren(...categories.filter((item) => item.active !== false).map((item) => {
      const option = document.createElement('option');
      option.value = item.name;
      return option;
    }));
  };
  const schedule = () => {
    if (frame) return;
    frame = window.requestAnimationFrame(() => { frame = 0; apply(); });
  };
  const onChanged = (event) => { categories = Array.isArray(event.detail) ? event.detail : []; schedule(); };
  window.addEventListener(INCOME_CATEGORY_EVENT, onChanged);
  const observer = new MutationObserver(schedule);
  observer.observe(document.getElementById('root') || document.body, { childList: true, subtree: true });
  load();
  schedule();
  return () => {
    window.removeEventListener(INCOME_CATEGORY_EVENT, onChanged);
    observer.disconnect();
    if (frame) window.cancelAnimationFrame(frame);
  };
}
