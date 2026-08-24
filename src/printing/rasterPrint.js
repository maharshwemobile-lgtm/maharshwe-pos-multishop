// Print the slip as a 1-bit image instead of as text.
//
// The POS80 driver runs every page through a dithering pass ("Adaptive
// Threshold") before it reaches the head. That pass reads the grey pixels a
// browser leaves along the edge of antialiased glyphs and throws most of them
// away, which is why a slip printed faint no matter what the stylesheet asked
// for — font-weight 700, 900 and Arial Black all came out identical.
//
// So we hand the driver something its threshold cannot damage: an image that is
// already pure black and pure white. Every grey edge pixel is rounded to black
// first, which also fattens each stroke by a fraction of a dot — free ink.
//
// Nothing here needs a library. The page is serialised into an SVG
// foreignObject and drawn to a canvas, which is a plain browser capability.

// 203dpi is the standard thermal head. 80mm of paper is 640 dots across.
const DOTS_PER_MM = 203 / 25.4;

// Any pixel darker than this becomes black. It sits high on purpose: the grey
// halo around a glyph is what we want to claim, not discard.
const INK_THRESHOLD = 205;

function mmToDots(mm) {
  return Math.round(mm * DOTS_PER_MM);
}

// A cross-origin logo taints the canvas and toDataURL() then throws, losing the
// whole slip. Inline it first; if that fails the logo is dropped and the rest
// of the slip still prints.
async function inlineImages(root) {
  const images = [...root.querySelectorAll('img')];
  await Promise.all(images.map(async (image) => {
    const src = image.getAttribute('src') || '';
    if (!src || src.startsWith('data:')) return;
    try {
      // A CDN that cached this image before the origin started sending CORS
      // headers will keep serving the header-less copy. A stable extra param
      // is a different cache key, so the fetch gets a fresh response with the
      // header — and still caches, unlike a random buster.
      const url = src.includes('?') ? `${src}&cors=1` : `${src}?cors=1`;
      const response = await fetch(url, { mode: 'cors' });
      if (!response.ok) throw new Error(String(response.status));
      const blob = await response.blob();
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
      image.setAttribute('src', dataUrl);
    } catch {
      image.remove();
    }
  }));
}

function svgWrapper(innerHtml, styles, widthPx, heightPx) {
  // xmlns on the div is required or the foreignObject renders empty.
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${widthPx}" height="${heightPx}" viewBox="0 0 ${widthPx} ${heightPx}">
    <foreignObject width="100%" height="100%">
      <div xmlns="http://www.w3.org/1999/xhtml" style="background:#fff">
        <style>/*<![CDATA[*/${styles}/*]]>*/</style>
        ${innerHtml}
      </div>
    </foreignObject>
  </svg>`;
}

// A slip that never finishes rendering would leave the cashier staring at an
// empty popup, so the load is bounded and failure falls back to text.
function loadImage(source, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const timer = setTimeout(() => reject(new Error('slip image timed out')), timeoutMs);
    image.onload = () => { clearTimeout(timer); resolve(image); };
    image.onerror = () => { clearTimeout(timer); reject(new Error('slip image failed to load')); };
    image.src = source;
  });
}

function lumaAt(pixels, index) {
  // transparent counts as paper
  if (pixels[index + 3] < 128) return 255;
  return (pixels[index] * 0.299) + (pixels[index + 1] * 0.587) + (pixels[index + 2] * 0.114);
}

function writeGrey(pixels, index, value) {
  pixels[index] = value;
  pixels[index + 1] = value;
  pixels[index + 2] = value;
  pixels[index + 3] = 255;
}

// A shop logo is flat brand colour, and brand colour is light. Measured on the
// Mahar Shwe wordmark: a quarter of it is darker than 128, but 40% sits around
// 175 and another third is lighter still — the yellow and the pale blue. Error
// diffusion turns a value of 175 into roughly seven dots in ten, which reads as
// grey, and the mark looked washed out even after the first contrast pass.
//
// So the curve is steep: anything clearly darker than paper collapses to solid
// ink, and only genuinely near-white is left for the dither to shade. A
// photographic logo comes out heavy under this, which is the right trade — at
// 203dpi in one colour a photo was never going to reproduce anyway, and a
// visible mark beats a faithful smudge.
function inkCurve(luma) {
  const adjusted = ((luma - 212) * 3.5) + 128;
  return Math.min(255, Math.max(0, adjusted));
}

function captureRegion(pixels, width, region) {
  const { left, top, right, bottom } = region;
  // Float, so the error carried between pixels is not truncated.
  const shades = new Float32Array((right - left) * (bottom - top));
  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      shades[((y - top) * (right - left)) + (x - left)] = inkCurve(lumaAt(pixels, ((y * width) + x) * 4));
    }
  }
  return shades;
}

// Floyd–Steinberg, for the logo only.
//
// A hard threshold is right for text — it keeps strokes solid — but it wrecks a
// logo, because every mid-tone falls to one side and the shape comes out half
// missing. Error diffusion keeps the shading by trading it for dot density,
// which is what a one-colour head can actually reproduce.
function ditherRegion(pixels, width, region, shades) {
  const { left, top, right, bottom } = region;
  const spanWidth = right - left;
  const spread = (x, y, error, factor) => {
    if (x < 0 || x >= spanWidth || y >= bottom - top) return;
    shades[(y * spanWidth) + x] += error * factor;
  };

  for (let y = 0; y < bottom - top; y += 1) {
    for (let x = 0; x < spanWidth; x += 1) {
      const old = shades[(y * spanWidth) + x];
      const value = old < 128 ? 0 : 255;
      const error = old - value;
      spread(x + 1, y, error, 7 / 16);
      spread(x - 1, y + 1, error, 3 / 16);
      spread(x, y + 1, error, 5 / 16);
      spread(x + 1, y + 1, error, 1 / 16);
      writeGrey(pixels, (((y + top) * width) + (x + left)) * 4, value);
    }
  }
}

// Round every pixel to black or white. After this the driver's threshold pass
// has nothing left to decide, so it cannot thin the strokes. Regions listed in
// `ditherRegions` are shaded instead of thresholded.
function binarise(canvas, ditherRegions = []) {
  const context = canvas.getContext('2d');
  const frame = context.getImageData(0, 0, canvas.width, canvas.height);
  const pixels = frame.data;

  // Snapshot the logo's real shading before the threshold pass flattens it.
  const captured = ditherRegions.map((region) => captureRegion(pixels, canvas.width, region));

  for (let index = 0; index < pixels.length; index += 4) {
    writeGrey(pixels, index, lumaAt(pixels, index) < INK_THRESHOLD ? 0 : 255);
  }
  ditherRegions.forEach((region, at) => ditherRegion(pixels, canvas.width, region, captured[at]));

  context.putImageData(frame, 0, 0);
}

// The slip stylesheet targets `body`, but the raster stage is a div, so those
// rules would be dropped — width, padding and the base font size with them.
function scopeBodyRules(styles) {
  return styles
    .replace(/@page\{[^}]*\}/g, '')
    .replace(/(^|[},;\s])body\{/g, '$1.slip-root{')
    .replace(/@media print\{[\s\S]*?\}\s*\}/g, '');
}

/**
 * Render slip markup to a black-and-white PNG sized for the paper.
 * Returns null if anything goes wrong, so the caller can print the HTML as-is.
 */
export async function slipToBitmap(bodyHtml, styles, paperSize) {
  try {
    if (typeof document === 'undefined') return null;
    const widthMm = paperSize === '58mm' ? 58 : 80;
    const scopedStyles = scopeBodyRules(styles);

    // Lay the slip out at its real paper width in CSS units first.
    const stage = document.createElement('div');
    stage.setAttribute('style', 'position:fixed;left:-10000px;top:0;background:#fff');
    stage.innerHTML = `<style>${scopedStyles}</style><div class="slip-root" style="width:${widthMm}mm">${bodyHtml}</div>`;
    document.body.appendChild(stage);
    await inlineImages(stage);
    await new Promise((resolve) => window.requestAnimationFrame(resolve));

    const root = stage.querySelector('.slip-root');
    const rootBox = root.getBoundingClientRect();
    const cssWidth = rootBox.width;
    const cssHeight = Math.max(1, Math.ceil(rootBox.height));

    // Rasterise at head resolution. The foreignObject content is still vector at
    // this point, so scaling up sharpens the glyphs rather than blurring them.
    const targetWidth = mmToDots(widthMm);
    const scale = cssWidth ? targetWidth / cssWidth : 0;
    const targetHeight = Math.max(1, Math.ceil(cssHeight * scale));

    // Only the shop logo gets shaded. The QR is already one bit per dot and
    // diffusing it would break the scan.
    const logoRegions = [...root.querySelectorAll('img.slip-logo')].map((image) => {
      const box = image.getBoundingClientRect();
      return {
        left: Math.max(0, Math.floor((box.left - rootBox.left) * scale)),
        top: Math.max(0, Math.floor((box.top - rootBox.top) * scale)),
        right: Math.min(targetWidth, Math.ceil((box.right - rootBox.left) * scale)),
        bottom: Math.min(targetHeight, Math.ceil((box.bottom - rootBox.top) * scale)),
      };
    }).filter((region) => region.right > region.left && region.bottom > region.top);

    // outerHTML leaves <img> unclosed, which is valid HTML and invalid XML —
    // the SVG then refuses to parse and the slip silently falls back to text.
    const inner = new XMLSerializer().serializeToString(root);
    stage.remove();
    if (!cssWidth) return null;

    // A data: URL, not a blob: one. Chrome treats an SVG image loaded from a
    // blob URL as cross-origin, and getImageData then throws on the tainted
    // canvas — which would lose the binarising step the whole approach rests on.
    const svg = svgWrapper(inner, scopedStyles, cssWidth, cssHeight);
    const rendered = await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);

    const canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const context = canvas.getContext('2d');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, targetWidth, targetHeight);
    context.drawImage(rendered, 0, 0, targetWidth, targetHeight);
    binarise(canvas, logoRegions);

    return { dataUrl: canvas.toDataURL('image/png'), widthMm };
  } catch (error) {
    console.warn('Slip bitmap render failed, printing as text:', error.message);
    return null;
  }
}

/** Wrap a rendered slip bitmap in a printable page. */
export function bitmapPage(title, bitmap) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>
    @page{size:${bitmap.widthMm}mm auto;margin:0}
    html,body{margin:0;padding:0;background:#fff}
    img{display:block;width:${bitmap.widthMm}mm;height:auto;image-rendering:pixelated}
    @media print{body{margin:0}}
  </style></head><body><img src="${bitmap.dataUrl}" alt=""/>
  <script>window.onload=()=>window.print();</script></body></html>`;
}
