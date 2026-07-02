const MOBILE_QUERY = '(max-width: 700px)';

export function installResponsiveViewportV21() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => {};

  const media = window.matchMedia(MOBILE_QUERY);
  let syncing = false;

  const sync = () => {
    if (syncing) return;
    const sidebar = document.querySelector('.phase9-sidebar');
    const toggle = document.querySelector('.topbar .icon');
    const mobile = media.matches;

    document.body.classList.toggle('mobile-nav-open', mobile && Boolean(sidebar));

    if (!toggle) return;
    if (mobile && sidebar) {
      syncing = true;
      toggle.click();
      window.requestAnimationFrame(() => { syncing = false; });
      return;
    }
    if (!mobile && !sidebar) {
      syncing = true;
      toggle.click();
      window.requestAnimationFrame(() => { syncing = false; });
    }
  };

  const updateLockOnly = () => {
    const sidebar = document.querySelector('.phase9-sidebar');
    document.body.classList.toggle('mobile-nav-open', media.matches && Boolean(sidebar));
  };

  const observer = new MutationObserver(updateLockOnly);
  observer.observe(document.getElementById('root') || document.body, { childList: true, subtree: true });

  media.addEventListener?.('change', sync);
  window.addEventListener('orientationchange', sync);
  window.requestAnimationFrame(updateLockOnly);

  return () => {
    observer.disconnect();
    media.removeEventListener?.('change', sync);
    window.removeEventListener('orientationchange', sync);
    document.body.classList.remove('mobile-nav-open');
  };
}
