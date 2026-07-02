(() => {
  const localLogoUrl = new URL('./maharshwe-logo.png', window.location.href).href;

  const removeThemeToggles = () => {
    localStorage.removeItem('ms_theme');
    document.documentElement.dataset.msTheme = 'light';
    document.querySelectorAll('[data-ms-theme-toggle], .ms-theme-toggle').forEach((el) => el.remove());
  };

  const preferLocalLogo = () => {
    document.querySelectorAll('img').forEach((img) => {
      const src = img.getAttribute('src') || '';
      const alt = img.getAttribute('alt') || '';
      if (/raw\.githubusercontent\.com|avatars\.githubusercontent\.com/i.test(src) || /Mahar Shwe|POS Logo|logo/i.test(alt)) {
        img.src = localLogoUrl;
      }
    });
    document.querySelectorAll('link[rel="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"]').forEach((link) => {
      link.href = localLogoUrl;
    });
  };

  const improveBrand = () => {
    removeThemeToggles();
    preferLocalLogo();

    const headings = [...document.querySelectorAll('h1')];
    headings.forEach((h) => {
      if (h.textContent.includes('မဟာရွှေ') || h.textContent.includes('Mahar')) {
        h.classList.add('ms-brand-title');
      }
    });

    [...document.querySelectorAll('button')].forEach((btn) => {
      const text = btn.textContent || '';
      if (text.includes('English') || text.includes('မြန်မာ')) btn.classList.add('ms-lang-button');
    });
  };

  document.addEventListener('DOMContentLoaded', () => {
    improveBrand();
    const mo = new MutationObserver(improveBrand);
    mo.observe(document.body, { childList: true, subtree: true });
  });
})();
