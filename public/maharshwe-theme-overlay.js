(() => {
  const LOGO_URL = window.MS_THEME_LOGO_URL || './maharshwe-logo.png';
  const REMOTE_LOGO_RE = /raw\.githubusercontent\.com\/maharshwemobile-lgtm\/DataForPublic|avatars\.githubusercontent\.com/i;
  const PAGE_SIZE = 10;

  const logoHref = () => new URL(LOGO_URL, window.location.href).href;

  const ensureHeadAssets = () => {
    const href = logoHref();
    document.querySelectorAll('link[rel="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"]').forEach((link) => {
      if (link.href !== href) link.href = href;
    });
  };

  const replaceLogo = () => {
    const href = logoHref();
    document.querySelectorAll('img').forEach((img) => {
      const src = img.getAttribute('src') || '';
      const alt = img.getAttribute('alt') || '';
      const shouldReplace = REMOTE_LOGO_RE.test(src) || /Mahar Shwe|POS Logo|logo/i.test(alt);
      if (!shouldReplace) return;
      if (img.src !== href) img.src = href;
      img.classList.add('ms-theme-logo');
      img.onerror = () => {
        img.onerror = null;
        img.src = href;
      };
    });
  };

  const markNavigation = (aside) => {
    aside.querySelectorAll('div').forEach((el) => {
      const style = el.getAttribute('style') || '';
      if (style.includes('text-transform: uppercase')) {
        el.classList.add('ms-theme-nav-label');
      }
      if (style.includes('cursor: pointer')) {
        el.classList.add('ms-theme-nav-item');
        const bg = (el.style.background || '').trim();
        const isActive = bg && bg !== 'transparent' && bg !== 'rgba(0, 0, 0, 0)';
        el.classList.toggle('ms-active', !!isActive);
      }
    });
  };

  const getPageWindow = (page, totalPages) => {
    const pages = new Set([1, totalPages]);
    for (let n = page - 2; n <= page + 2; n += 1) {
      if (n >= 1 && n <= totalPages) pages.add(n);
    }
    return Array.from(pages).sort((a, b) => a - b);
  };

  const button = (label, disabled, active, onClick) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = label;
    btn.disabled = disabled;
    if (active) btn.classList.add('ms-page-active');
    btn.addEventListener('click', onClick);
    return btn;
  };

  const paginateTable = (table, index) => {
    const tbody = table.tBodies?.[0];
    if (!tbody) return;

    const rows = Array.from(tbody.rows).filter((row) => row.cells.length);
    const key = table.dataset.msPageKey || `table-${index}`;
    table.dataset.msPageKey = key;
    const totalItems = rows.length;
    const totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));
    let page = Number(table.dataset.msPage || 1);
    page = Math.min(Math.max(page, 1), totalPages);
    table.dataset.msPage = String(page);

    if (totalItems <= PAGE_SIZE) {
      rows.forEach((row) => { row.hidden = false; });
      table.parentElement?.querySelector(`.ms-pagination[data-ms-page-for="${key}"]`)?.remove();
      return;
    }

    const start = (page - 1) * PAGE_SIZE;
    rows.forEach((row, rowIndex) => {
      row.hidden = rowIndex < start || rowIndex >= start + PAGE_SIZE;
    });

    let controls = table.parentElement?.querySelector(`.ms-pagination[data-ms-page-for="${key}"]`);
    if (!controls) {
      controls = document.createElement('div');
      controls.className = 'ms-pagination';
      controls.dataset.msPageFor = key;
      table.insertAdjacentElement('afterend', controls);
    }

    const controlState = `${page}:${totalItems}:${totalPages}`;
    if (controls.dataset.msPageState === controlState) return;
    controls.dataset.msPageState = controlState;
    controls.replaceChildren();
    const info = document.createElement('span');
    info.className = 'ms-pagination-info';
    info.textContent = `Page ${page} / ${totalPages} - ${PAGE_SIZE} items per page (${totalItems} total)`;
    const pages = document.createElement('div');
    pages.className = 'ms-pagination-pages';
    pages.appendChild(button('Prev', page === 1, false, () => {
      table.dataset.msPage = String(page - 1);
      paginateTable(table, index);
    }));
    getPageWindow(page, totalPages).forEach((pageNo, pos, arr) => {
      if (pos > 0 && pageNo - arr[pos - 1] > 1) {
        const dots = document.createElement('span');
        dots.textContent = '...';
        dots.className = 'ms-pagination-info';
        pages.appendChild(dots);
      }
      pages.appendChild(button(String(pageNo), false, pageNo === page, () => {
        table.dataset.msPage = String(pageNo);
        paginateTable(table, index);
      }));
    });
    pages.appendChild(button('Next', page === totalPages, false, () => {
      table.dataset.msPage = String(page + 1);
      paginateTable(table, index);
    }));
    controls.append(info, pages);
  };

  const applyPagination = () => {
    document.querySelectorAll('table').forEach((table, index) => paginateTable(table, index));
    document.querySelectorAll('button').forEach((btn) => {
      const text = (btn.textContent || '').trim().toLowerCase();
      if (text === 'see more' || text === 'show more' || text === 'load more') {
        btn.style.display = 'none';
      }
    });
  };

  const visibleText = (el) => (el?.innerText || el?.textContent || '').replace(/\s+/g, ' ').trim();

  const getCurrentPageTitle = () => (
    document.querySelector('header h1, .topbar h1, h1')?.textContent?.trim()
    || document.title
    || 'POS'
  );

  const collectStats = () => {
    const rows = [];
    document.querySelectorAll('.stat').forEach((card) => {
      const title = visibleText(card.querySelector('p')) || visibleText(card.querySelector('span'));
      const value = visibleText(card.querySelector('h2, strong, b'));
      if (title && value) rows.push(`${title}: ${value}`);
    });
    document.querySelectorAll('.miniStats span').forEach((item) => {
      const text = visibleText(item);
      if (text && rows.length < 12) rows.push(text);
    });
    return Array.from(new Set(rows)).slice(0, 12);
  };

  const collectTableFacts = () => {
    const tables = Array.from(document.querySelectorAll('table'));
    let totalRows = 0;
    let visibleRows = 0;
    const samples = [];
    tables.forEach((table) => {
      const bodyRows = Array.from(table.tBodies?.[0]?.rows || []).filter((row) => row.cells.length);
      const currentRows = bodyRows.filter((row) => !row.hidden);
      totalRows += bodyRows.length;
      visibleRows += currentRows.length;
      currentRows.slice(0, 3).forEach((row) => {
        const text = visibleText(row);
        if (text) samples.push(text);
      });
    });
    return { tableCount: tables.length, totalRows, visibleRows, samples: samples.slice(0, 6) };
  };

  const countWords = (words) => {
    const text = visibleText(document.body).toLowerCase();
    return words.reduce((sum, word) => {
      const pattern = new RegExp(word.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
      return sum + (text.match(pattern) || []).length;
    }, 0);
  };

  const buildAiSummary = () => {
    const title = getCurrentPageTitle();
    const stats = collectStats();
    const tables = collectTableFacts();
    const pending = countWords(['Pending', 'ပြင်ရန်']);
    const done = countWords(['Done', 'ပြင်ပြီး']);
    const lowStock = countWords(['Low Stock', 'Out of Stock']);

    const lines = [
      `Page: ${title}`,
      `အကျဉ်းချုပ်: stats ${stats.length} ခု, tables ${tables.tableCount} ခု, records ${tables.totalRows} ခု တွေ့ပါတယ်။`,
    ];

    if (tables.totalRows > PAGE_SIZE) {
      lines.push(`List များတဲ့နေရာတွေကို ${PAGE_SIZE} items per page နဲ့ခွဲပြထားပါတယ်။ လက်ရှိ page မှာ ${tables.visibleRows} rows ပြထားပါတယ်။`);
    }
    if (stats.length) {
      lines.push('အရေးကြီး stats:');
      stats.slice(0, 6).forEach((item) => lines.push(`- ${item}`));
    }
    if (pending || done || lowStock) {
      lines.push('သတိထားရန်:');
      if (pending) lines.push(`- Pending/ပြင်ရန် item ${pending} ခုခန့် တွေ့ပါတယ်။`);
      if (done) lines.push(`- Done/ပြင်ပြီး item ${done} ခုခန့် တွေ့ပါတယ်။`);
      if (lowStock) lines.push(`- Low/Out stock warning ${lowStock} ခုခန့် တွေ့ပါတယ်။`);
    }
    if (tables.samples.length) {
      lines.push('လက်ရှိမြင်နေသော rows sample:');
      tables.samples.slice(0, 3).forEach((item) => lines.push(`- ${item.slice(0, 130)}`));
    }
    lines.push('မှတ်ချက်: ဒီ summary က current page မှာမြင်နေတဲ့ data ကို local browser ထဲမှာပဲဖတ်ပြီး ထုတ်ထားတာပါ။');
    return lines.join('\n');
  };

  const ensureAiSummary = () => {
    if (document.querySelector('.ms-ai-summary-button')) return;

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'ms-ai-summary-button';
    trigger.textContent = 'AI Summary';

    const panel = document.createElement('section');
    panel.className = 'ms-ai-summary-panel';
    panel.hidden = true;
    panel.innerHTML = `
      <div class="ms-ai-summary-head">
        <strong>AI Summary</strong>
        <button type="button" class="ms-ai-summary-close" aria-label="Close AI Summary">×</button>
      </div>
      <pre></pre>
    `;

    const render = () => {
      panel.hidden = false;
      panel.querySelector('pre').textContent = buildAiSummary();
    };
    trigger.addEventListener('click', render);
    panel.querySelector('.ms-ai-summary-close').addEventListener('click', () => {
      panel.hidden = true;
    });
    document.body.append(trigger, panel);
  };

  const decorateLayout = () => {
    document.body.classList.add('ms-theme-active');

    const aside = document.querySelector('aside');
    if (aside) {
      aside.classList.add('ms-theme-sidebar');
      const logoWrap = aside.firstElementChild;
      logoWrap?.classList.add('ms-theme-logo-wrap');
      const sidebarLogo = logoWrap?.querySelector('img');
      sidebarLogo?.classList.add('ms-theme-sidebar-logo');
      const logoText = logoWrap?.querySelectorAll('p') || [];
      logoText[0]?.classList.add('ms-theme-logo-title');
      logoText[1]?.classList.add('ms-theme-logo-subtitle');
      markNavigation(aside);
    }

    const main = aside?.nextElementSibling || document.querySelector('main');
    const topbar = main?.firstElementChild;
    const content = main?.children?.[1];
    topbar?.classList.add('ms-theme-topbar');
    content?.classList.add('ms-theme-content');

    topbar?.querySelectorAll('img.ms-theme-logo').forEach((img) => img.classList.add('ms-theme-header-logo'));

    document.querySelectorAll('div').forEach((el) => {
      const style = el.getAttribute('style') || '';
      if (style.includes('border-radius: 10px') && style.includes('padding: 16px')) el.classList.add('ms-theme-card');
      if (style.includes('border-left: 3px solid')) el.classList.add('ms-theme-metric');
      if (style.includes('box-shadow') && style.includes('rgba(83, 74, 183')) el.classList.add('ms-theme-card');
    });

    document.querySelectorAll('button').forEach((btn) => {
      const style = btn.getAttribute('style') || '';
      if (style.includes('#7F77DD') || style.includes('rgb(127, 119, 221)')) btn.classList.add('ms-theme-primary');
    });

    document.querySelectorAll('img.ms-theme-logo').forEach((img) => {
      if (!aside?.contains(img) && !topbar?.contains(img)) img.classList.add('ms-theme-login-logo');
    });

    replaceLogo();
    ensureHeadAssets();
    applyPagination();
    ensureAiSummary();
  };

  let scheduled = false;
  const run = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      decorateLayout();
    });
  };

  document.addEventListener('DOMContentLoaded', run);
  window.addEventListener('load', run);

  let attempts = 0;
  const bootTimer = window.setInterval(() => {
    run();
    attempts += 1;
    if (attempts >= 24) window.clearInterval(bootTimer);
  }, 250);

  const startObserver = () => {
    const target = document.body || document.documentElement;
    new MutationObserver(run).observe(target, { childList: true, subtree: true });
  };

  if (document.body) startObserver();
  else document.addEventListener('DOMContentLoaded', startObserver, { once: true });
})();
