let installed = false;

export function installDatePickerRuntime() {
  if (installed || typeof document === 'undefined') return;
  installed = true;

  document.addEventListener('dblclick', (event) => {
    const input = event.target?.closest?.('input[type="date"]');
    if (!input || input.disabled || input.readOnly) return;
    input.focus({ preventScroll: true });
    if (typeof input.showPicker === 'function') {
      try {
        input.showPicker();
      } catch {
        input.click();
      }
    } else {
      input.click();
    }
  });
}
