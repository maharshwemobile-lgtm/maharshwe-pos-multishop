export const EXPENSE_CATEGORY_EVENT = 'mahar:expense-categories-changed';
export const EXPENSE_CATEGORY_OPEN_EVENT = 'mahar:expense-categories-open';

export function installExpenseCategoryRuntimeV23() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => {};
  let categories = [];
  let frame = 0;

  const apply = () => {
    const panels = [...document.querySelectorAll('.bc-expense-panel')];
    const panel = panels.find((item) => item.textContent?.includes('Record Business Expense')) || panels.at(-1);
    const label = panel ? [...panel.querySelectorAll('label')].find((item) => item.textContent?.trim().startsWith('Category')) : null;
    const input = label?.querySelector('input');
    if (!label || !input) return;

    input.setAttribute('list', 'business-expense-category-options');
    input.setAttribute('autocomplete', 'off');

    let list = document.getElementById('business-expense-category-options');
    if (!list) {
      list = document.createElement('datalist');
      list.id = 'business-expense-category-options';
      document.body.appendChild(list);
    }
    list.replaceChildren(...categories.filter((item) => item.active !== false).map((item) => {
      const option = document.createElement('option');
      option.value = item.name;
      return option;
    }));

    const oldButton = label.querySelector('.expense-category-manage-button');
    if (oldButton) oldButton.remove();
  };

  const schedule = () => {
    if (frame) return;
    frame = window.requestAnimationFrame(() => {
      frame = 0;
      apply();
    });
  };

  const onChanged = (event) => {
    categories = Array.isArray(event.detail) ? event.detail : [];
    schedule();
  };

  window.addEventListener(EXPENSE_CATEGORY_EVENT, onChanged);
  const observer = new MutationObserver(schedule);
  observer.observe(document.getElementById('root') || document.body, { childList: true, subtree: true });
  schedule();

  return () => {
    window.removeEventListener(EXPENSE_CATEGORY_EVENT, onChanged);
    observer.disconnect();
    if (frame) window.cancelAnimationFrame(frame);
  };
}
