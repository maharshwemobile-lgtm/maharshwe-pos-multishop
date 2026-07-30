// Date fields, project wide.
//
// Every date input in the app is a native <input type="date">, which on desktop
// only opens its calendar when the small indicator icon is hit. Tapping the
// field itself — what people actually do, and what the Wallet Note app does —
// did nothing. This walks the DOM once, marks each date-like input, and opens
// the native picker on click. Inputs that already sit inside a bordered wrapper
// are marked "bare" so the stylesheet leaves their frame alone.

const SELECTOR = 'input[type="date"],input[type="datetime-local"],input[type="month"],input[type="time"]';

function isBare(input) {
  try {
    const style = window.getComputedStyle(input);
    return style.borderTopStyle === 'none' || style.borderTopWidth === '0px';
  } catch {
    return false;
  }
}

function enhance(input) {
  if (!input || input.dataset.mpDateField === '1') return;
  input.dataset.mpDateField = '1';
  input.classList.add('mp-date-field');
  if (isBare(input)) input.classList.add('mp-date-field-bare');

  input.addEventListener('click', () => {
    if (input.disabled || input.readOnly) return;
    try {
      input.showPicker?.();
    } catch {
      // Safari and older browsers keep their own behaviour
    }
  });
}

function scan(root) {
  if (!root?.querySelectorAll) return;
  root.querySelectorAll(SELECTOR).forEach(enhance);
}

export function installDateFieldRuntimeV25() {
  if (typeof document === 'undefined' || window.__mpDateFieldRuntime) return;
  window.__mpDateFieldRuntime = true;

  const run = () => {
    scan(document);
    const observer = new MutationObserver((entries) => {
      entries.forEach((entry) => {
        entry.addedNodes.forEach((node) => {
          if (node.nodeType !== Node.ELEMENT_NODE) return;
          if (node.matches?.(SELECTOR)) enhance(node);
          scan(node);
        });
      });
    });
    observer.observe(document.body, { childList: true, subtree: true });
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run, { once: true });
  else run();
}
