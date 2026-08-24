// Dev-only harness: renders a sample voucher through the raster path so the
// result can be eyeballed and measured. Not imported by the app.
import { slipToBitmap } from './rasterPrint';

const SAMPLE_STYLES = `
  body{width:80mm;margin:0 auto;padding:0 2mm;font-family:Arial,sans-serif;color:#000;font-size:11px;font-weight:900;background:#fff}
  h1,p{text-align:center;margin:3px 0}h1{font-size:18px;font-weight:900}
  .meta{margin:10px 0;padding:8px 0;border-top:1px solid #000;border-bottom:1px solid #000}
  .meta div{display:flex;justify-content:space-between;gap:10px;padding:3px 0}
  .fields{display:grid;grid-template-columns:1fr 1fr;gap:5px 10px;margin-top:9px;padding:7px 0;border-top:1px solid #000;border-bottom:1px solid #000}
  .fields .wide{grid-column:1/-1}.fields span{font-size:9px}.fields b{font-size:11px}
`;

const SAMPLE_BODY = `
  <h1>မဟာရွှေ ဖုန်းပြင်ဆိုင်</h1><p>ဖုန်းပြင် ဘောင်ချာ</p>
  <div class="meta"><div><span>ပြင်ဆင်မှု ID</span><b>MS0551</b></div><div><span>နေ့စွဲ</span><b>24/8/2026</b></div></div>
  <div class="fields">
    <div><span>နာမည်:</span> <b>ဦးအောင်အောင်</b></div>
    <div><span>ဖုန်းနံပါတ်:</span> <b>09 799 519 545</b></div>
    <div class="wide"><span>ပြင်ရန်:</span> <b>မီးမလာ၊ charge မဝင်</b></div>
  </div>`;

export async function runRasterSelfTest() {
  const bitmap = await slipToBitmap(SAMPLE_BODY, SAMPLE_STYLES, '80mm');
  if (!bitmap) return { ok: false, reason: 'slipToBitmap returned null' };

  // Measure what actually landed on the canvas: a blank render is the failure
  // mode that would otherwise ship silently.
  const image = await new Promise((resolve, reject) => {
    const element = new Image();
    element.onload = () => resolve(element);
    element.onerror = () => reject(new Error('bitmap did not decode'));
    element.src = bitmap.dataUrl;
  });
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext('2d');
  context.drawImage(image, 0, 0);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;

  let black = 0;
  let grey = 0;
  for (let index = 0; index < pixels.length; index += 4) {
    const value = pixels[index];
    if (value === 0) black += 1;
    else if (value !== 255) grey += 1;
  }
  const total = pixels.length / 4;
  return {
    ok: black > 0 && grey === 0,
    width: canvas.width,
    height: canvas.height,
    inkPercent: Number(((black / total) * 100).toFixed(2)),
    greyPixels: grey,
    dataUrl: bitmap.dataUrl,
  };
}

if (typeof window !== 'undefined') window.runRasterSelfTest = runRasterSelfTest;
