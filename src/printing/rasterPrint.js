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
      const response = await fetch(src, { mode: 'cors' });
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
        <style>${styles}</style>
        ${innerHtml}
      </div>
    </foreignObject>
  </svg>`;
}

function loadImage(source) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('slip image failed to load'));
    image.src = source;
  });
}

// Round every pixel to black or white. After this the driver's threshold pass
// has nothing left to decide, so it cannot thin the strokes.
function binarise(canvas) {
  const context = canvas.getContext('2d');
  const frame = context.getImageData(0, 0, canvas.width, canvas.height);
  const pixels = frame.data;
  for (let index = 0; index < pixels.length; index += 4) {
    const alpha = pixels[index + 3];
    // luma, with transparent treated as paper
    const luma = alpha < 128
      ? 255
      : (pixels[index] * 0.299) + (pixels[index + 1] * 0.587) + (pixels[index + 2] * 0.114);
    const value = luma < INK_THRESHOLD ? 0 : 255;
    pixels[index] = value;
    pixels[index + 1] = value;
    pixels[index + 2] = value;
    pixels[index + 3] = 255;
  }
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
    const cssWidth = root.getBoundingClientRect().width;
    const cssHeight = Math.max(1, Math.ceil(root.getBoundingClientRect().height));
    const inner = root.outerHTML;
    stage.remove();
    if (!cssWidth) return null;

    // Rasterise at head resolution. The foreignObject content is still vector at
    // this point, so scaling up sharpens the glyphs rather than blurring them.
    const targetWidth = mmToDots(widthMm);
    const scale = targetWidth / cssWidth;
    const targetHeight = Math.max(1, Math.ceil(cssHeight * scale));

    const svg = svgWrapper(inner, scopedStyles, cssWidth, cssHeight);
    const rendered = await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);

    const canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const context = canvas.getContext('2d');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, targetWidth, targetHeight);
    context.drawImage(rendered, 0, 0, targetWidth, targetHeight);
    binarise(canvas);

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
