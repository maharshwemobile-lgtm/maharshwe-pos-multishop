(() => {
  const page = 'vpn-ads';
  const defaults = {
    enabled: true,
    title: 'MaharShwe Premium VPN',
    message: 'Free Server message',
    imageUrl: '',
    videoUrl: '',
    mediaType: 'video',
    clickUrl: 'https://t.me/maharshwemobilebot?start=vpn_plans',
    cta: 'VPN Key ဝယ်မယ်',
    backgroundColor: '#0c120f',
    textColor: '#ffffff',
  };

  function ensurePage() {
    if (!document.getElementById('panel-vpn-ads')) {
      document.querySelector('.content')?.insertAdjacentHTML('beforeend', `
        <section id="panel-vpn-ads" class="panel">
          <div class="vpn-meta"><b>Real VPN Free Server Ads API</b><span>Public source: https://maharshwe.online/api/vpn-ads</span><span>Free Server ချိတ်ပြီး 5 seconds နောက်မှာပဲ banner ပေါ်မယ်။ Other Key ချိတ်ရင် မပေါ်ပါ။</span></div>
          <div class="vpn-ads-layout">
            <div class="card">
              <div class="card-head"><h3>VPN Ads Configuration</h3><span id="vpnSource" class="muted">Loading real data…</span></div>
              <form id="vpnAdsForm" class="vpn-ads-form">
                <label class="vpn-toggle wide"><span>Ads Enabled</span><input id="vpnEnabled" type="checkbox"></label>
                <label>Title<input id="vpnTitle" maxlength="180"></label>
                <label>CTA Text<input id="vpnCta" maxlength="80"></label>
                <label class="wide">Message<textarea id="vpnMessage" maxlength="700"></textarea></label>
                <label>Media Type<select id="vpnMediaType"><option value="auto">Auto</option><option value="image">Image</option><option value="video">Video</option></select></label>
                <label>Click URL<input id="vpnClickUrl" type="url"></label>
                <label class="wide">Video URL<input id="vpnVideoUrl" type="url"></label>
                <label class="wide">Image / Poster URL<input id="vpnImageUrl" type="url"></label>
                <label>Background Color<div class="vpn-color-row"><input id="vpnBgPicker" type="color"><input id="vpnBackgroundColor" pattern="^#[0-9A-Fa-f]{6}$"></div></label>
                <label>Text Color<div class="vpn-color-row"><input id="vpnTextPicker" type="color"><input id="vpnTextColor" pattern="^#[0-9A-Fa-f]{6}$"></div></label>
              </form>
              <div class="vpn-actions"><button id="vpnRefresh" class="btn outline" type="button">Refresh Real Data</button><button id="vpnReset" class="btn outline" type="button">Reset Form</button><button id="vpnSave" class="btn primary" type="button">Save to VPN API</button></div>
              <div id="vpnStatus" class="vpn-status">Waiting</div>
            </div>
            <div><div id="vpnPreview" class="vpn-preview"><div id="vpnPreviewMedia"></div><div class="vpn-preview-shade"></div><div class="vpn-preview-copy"><h3 id="vpnPreviewTitle"></h3><p id="vpnPreviewMessage"></p><span id="vpnPreviewCta"></span></div></div></div>
          </div>
        </section>`);
    }
  }

  const el = (id) => document.getElementById(id);
  function value() {
    return {
      enabled: el('vpnEnabled').checked,
      title: el('vpnTitle').value.trim(),
      message: el('vpnMessage').value.trim(),
      imageUrl: el('vpnImageUrl').value.trim(),
      videoUrl: el('vpnVideoUrl').value.trim(),
      mediaType: el('vpnMediaType').value,
      clickUrl: el('vpnClickUrl').value.trim(),
      cta: el('vpnCta').value.trim(),
      backgroundColor: el('vpnBackgroundColor').value.trim(),
      textColor: el('vpnTextColor').value.trim(),
    };
  }
  function fill(config = defaults) {
    const data = { ...defaults, ...config };
    el('vpnEnabled').checked = Boolean(data.enabled);
    ['Title','Message','ImageUrl','VideoUrl','ClickUrl','Cta','BackgroundColor','TextColor'].forEach((key) => { el(`vpn${key}`).value = data[key[0].toLowerCase() + key.slice(1)] || ''; });
    el('vpnMediaType').value = data.mediaType || 'auto';
    el('vpnBgPicker').value = data.backgroundColor || '#0c120f';
    el('vpnTextPicker').value = data.textColor || '#ffffff';
    preview();
  }
  function preview() {
    const data = value();
    const box = el('vpnPreview');
    box.style.backgroundColor = data.backgroundColor || '#0c120f';
    box.style.color = data.textColor || '#ffffff';
    el('vpnPreviewTitle').textContent = data.title || 'VPN Ad title';
    el('vpnPreviewMessage').textContent = data.message || 'VPN Free Server message';
    el('vpnPreviewCta').textContent = data.cta || 'Open';
    const media = el('vpnPreviewMedia');
    media.innerHTML = '';
    if ((data.mediaType === 'video' || data.mediaType === 'auto') && data.videoUrl) {
      const video = document.createElement('video'); video.className = 'vpn-preview-media'; video.src = data.videoUrl; video.poster = data.imageUrl; video.muted = true; video.loop = true; video.autoplay = true; video.playsInline = true; media.append(video);
    } else if (data.imageUrl) {
      const image = document.createElement('img'); image.className = 'vpn-preview-media'; image.src = data.imageUrl; image.alt = ''; media.append(image);
    }
  }
  function validUrl(value) { if (!value) return true; try { const url = new URL(value); return ['http:','https:'].includes(url.protocol); } catch { return false; } }
  function validate(data) {
    for (const key of ['imageUrl','videoUrl','clickUrl']) if (!validUrl(data[key])) throw new Error(`${key} must be a valid URL`);
    for (const key of ['backgroundColor','textColor']) if (!/^#[0-9a-f]{6}$/i.test(data[key])) throw new Error(`${key} must be a 6-digit hex color`);
  }
  function status(message, type = '') { el('vpnStatus').className = `vpn-status ${type}`; el('vpnStatus').textContent = message; }
  async function loadVpnAds() {
    status('Loading real VPN Ads data…');
    try {
      const result = await api('/api/admin/integrations/vpn-ads');
      fill(result.config);
      el('vpnSource').textContent = result.source || 'Real VPN API';
      el('vpnSave').disabled = result.writable === false;
      status(`Real data loaded${result.config?.updatedAt ? ` · Updated ${new Date(result.config.updatedAt).toLocaleString()}` : ''}`, 'good');
    } catch (error) { status(error.message, 'bad'); }
  }
  async function saveVpnAds() {
    try {
      const data = value(); validate(data);
      if (!window.confirm(`Save this ad to the real Mahar Shwe VPN API?\nEnabled: ${data.enabled ? 'Yes' : 'No'}`)) return;
      el('vpnSave').disabled = true; status('Saving to real VPN API…');
      const result = await api('/api/admin/integrations/vpn-ads', { method: 'POST', body: JSON.stringify(data) });
      fill(result.config || data); status('Saved successfully to real VPN API', 'good'); toast('VPN Ads saved');
    } catch (error) { status(error.message, 'bad'); }
    finally { el('vpnSave').disabled = false; }
  }

  function install() {
    ensurePage();
    if (!navs.some((item) => item[0] === page)) navs.splice(4, 0, [page, 'VPN Free Server Ads', '']);
    const originalGo = go;
    go = function nextGo(target) {
      if (target !== page) return originalGo(target);
      currentPage = target; buildNav(); document.querySelectorAll('.panel').forEach((node) => node.classList.remove('active')); el('panel-vpn-ads').classList.add('active'); el('pageTitle').innerHTML = 'VPN Free Server Ads <small>Real production configuration</small>'; loadVpnAds();
    };
    buildNav();
    el('vpnAdsForm').addEventListener('input', preview);
    el('vpnBgPicker').addEventListener('input', () => { el('vpnBackgroundColor').value = el('vpnBgPicker').value; preview(); });
    el('vpnTextPicker').addEventListener('input', () => { el('vpnTextColor').value = el('vpnTextPicker').value; preview(); });
    el('vpnBackgroundColor').addEventListener('input', () => { if (/^#[0-9a-f]{6}$/i.test(el('vpnBackgroundColor').value)) el('vpnBgPicker').value = el('vpnBackgroundColor').value; });
    el('vpnTextColor').addEventListener('input', () => { if (/^#[0-9a-f]{6}$/i.test(el('vpnTextColor').value)) el('vpnTextPicker').value = el('vpnTextColor').value; });
    el('vpnRefresh').onclick = loadVpnAds;
    el('vpnReset').onclick = () => fill(defaults);
    el('vpnSave').onclick = saveVpnAds;
  }
  install();
})();
