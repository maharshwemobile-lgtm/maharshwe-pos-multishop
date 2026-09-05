import QRCode from 'qrcode';
import { loadProjectSettings } from '../settings/projectSettingsClient';
import { warrantyBlocksForSale } from './phoneWarrantyText';

// Printed on every repair voucher. The shop asked for this wording verbatim,
// so it is not built from settings — changing it is a code change on purpose.
const REPAIR_VOUCHER_NOTICE = [
  'အရေးကြီး ဆင်းကဒ်များ မိမိကိုယ်တိုင် သိမ်းဆည်းရန်။',
  'ဖုန်းအတွင်းအရေးကြီးဖိုင်၊ အဆက်အသွယ်များ မပြုပြင်မှီကြိုပြောရန်။',
  'ဖုန်းကာဗာများနှင့် အခြားဆက်စပ်ပစ္စည်းပါလာပါက ပြန်တောင်းယူရန်။',
  'အထက်ပါအကြောင်းကြောင့် ပျောက်ရှ ပျက်စီးပါက တာဝန်မယူပါ။',
  'တစ်လကျော်အပ်နှံပစ္စည်းများ တာဝန်မယူပါ။',
  'ဖုန်းလာရောက်ရွေးယူသူမှာ ကိုယ်တိုင်မဟုတ်ပါက လက်ခံ Voucher ပါမှသာ ဖုန်းထုတ်ပေးပါသည်။',
];

const REPAIR_STATUS_MY = {
  RECEIVED: 'လက်ခံပြီး',
  CHECKING: 'စစ်ဆေးနေ',
  IN_PROGRESS: 'ပြင်ဆင်နေ',
  WAITING_PART: 'ပစ္စည်းစောင့်',
  COMPLETED: 'ပြင်ပြီး',
  CANNOT_REPAIR: 'ပြင်၍မရ',
  DELIVERED: 'ယူသွားပြီး',
};

function repairStatusMyanmar(status) {
  const key = String(status || '').toUpperCase();
  return REPAIR_STATUS_MY[key] || key.replaceAll('_', ' ');
}

// Thermal printers render a dithered photo badly, so keep the QR pure black
// and give it a wide quiet zone — that is what makes it scan off 80mm paper.
async function qrDataUrl(text) {
  if (!text) return '';
  try {
    return await QRCode.toDataURL(text, {
      errorCorrectionLevel: 'M',
      margin: 2,
      scale: 6,
      color: { dark: '#000000', light: '#FFFFFF' },
    });
  } catch {
    return '';
  }
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function nl2br(value) {
  return escapeHtml(value).replaceAll('\n', '<br/>');
}

// Products with no real variant are stored under a placeholder name, which has
// no business being on a customer's receipt.
const PLACEHOLDER_VARIANTS = new Set(['default', 'standard', 'normal', 'n/a', '-']);

function realVariantName(value) {
  const name = String(value || '').trim();
  return PLACEHOLDER_VARIANTS.has(name.toLowerCase()) ? '' : name;
}

// Print through a hidden iframe rather than a popup window.
//
// A phone browser either blocks window.open or opens a tab that will not print
// on demand, so printing from the mobile web view never worked. An iframe is
// part of the page that is already open, so there is nothing to block, and the
// markup carries its own window.print() call once it loads.
//
// A popup passed in by an older caller is still honoured, so a window opened
// during the click is not left hanging.
function printWindow(targetWindow, html) {
  if (targetWindow && !targetWindow.closed) {
    targetWindow.document.open();
    targetWindow.document.write(html);
    targetWindow.document.close();
    return true;
  }

  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  // Off the side of the screen rather than hidden and zero-sized. A frame with
  // no layout gives Chrome nothing to paginate and print() returns without ever
  // opening the dialog — which is what "nothing happens" looked like at the
  // counter. It needs real dimensions and it must not be visibility:hidden.
  frame.setAttribute('style', 'position:fixed;left:-10000px;top:0;width:80mm;height:297mm;border:0;opacity:0;pointer-events:none');
  document.body.appendChild(frame);

  const remove = () => { if (frame.parentNode) frame.remove(); };
  window.setTimeout(remove, 60000);

  const doc = frame.contentWindow.document;
  doc.open();
  doc.write(html);
  doc.close();

  // document.open() drops every listener registered on the frame's window, so
  // afterprint is bound here, on the document this call actually wrote.
  frame.contentWindow.addEventListener('afterprint', () => window.setTimeout(remove, 500));

  // The written document asks to print itself on load, but that never fires in
  // some engines once document.write has already closed the stream. Printing is
  // driven from here instead, and the flag keeps the two from stacking.
  return new Promise((resolve) => {
    let done = false;
    const start = () => {
      if (done) return;
      done = true;
      try {
        frame.contentWindow.focus();
        frame.contentWindow.print();
        resolve(true);
      } catch (error) {
        remove();
        resolve(false);
      }
    };

    // A slip carries at most the shop logo. Wait for it so the paper is not
    // printed with a gap where the logo should be, but never wait on a broken
    // URL for longer than it takes to notice.
    const images = Array.from(doc.images || []);
    const pending = images.filter((image) => !image.complete);
    if (!pending.length) { window.setTimeout(start, 60); return; }

    let left = pending.length;
    const settle = () => { left -= 1; if (left <= 0) window.setTimeout(start, 60); };
    pending.forEach((image) => {
      image.addEventListener('load', settle, { once: true });
      image.addEventListener('error', settle, { once: true });
    });
    window.setTimeout(start, 3000);
  });
}

function baseStyles(paperSize) {
  const width = paperSize === '58mm' ? '58mm' : '80mm';
  // Thermal heads render grey as sparse dots, so a #555 label comes out faint
  // and a hairline dashed rule almost disappears. Everything is pure black and
  // bold with solid rules. Sizes stay as they were — weight is what makes it
  // readable, and bumping the type only spends more paper per slip.
  const twoUp = width === '58mm' ? '1fr' : '1fr 1fr';
  // @page takes 2mm each side and the body another 2mm, so 80mm paper leaves
  // 72mm of content and 58mm leaves 50mm. The logo fills most of that — at
  // 48mm it read as small on 80mm paper — while staying clear of the edge.
  const logoWidth = width === '58mm' ? '46mm' : '64mm';
  return `
    @page{size:${width} auto;margin:0 2mm 3mm}
    *{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}
    body{width:${width};max-width:100%;margin:0 auto;padding:0 2mm;font-family:Arial,sans-serif;color:#000;font-size:11px;font-weight:400;background:#fff;-webkit-font-smoothing:none}
    /* A thermal head prints one dot or no dot — there is no grey. A logo scaled
       by the browser comes back with soft edges the driver then has to halftone,
       which is what turns a wordmark into a smudge. The artwork is prepared as a
       1-bit bitmap at 203dpi, so it is placed at exactly the width it was built
       for and told not to interpolate: one image pixel, one printer dot. */
    .slip-logo{display:block;width:${logoWidth};height:auto;max-width:100%;margin:0 auto 6px auto;
      image-rendering:pixelated;image-rendering:-moz-crisp-edges;image-rendering:crisp-edges;
      -ms-interpolation-mode:nearest-neighbor}
    @media print{.slip-logo{image-rendering:pixelated;-webkit-print-color-adjust:exact;print-color-adjust:exact}}
    .logo-fallback{display:flex;width:58px;height:58px;align-items:center;justify-content:center;margin:0 auto 8px auto;border-radius:50%;background:#000;color:#fff;font-weight:700;font-size:18px}
    h1,h2,p{text-align:center;margin:3px 0}h1{font-size:18px;font-weight:700}h2{font-size:14px;font-weight:700}.muted{color:#000;font-weight:400}.left{text-align:left}.right{text-align:right}.center{text-align:center}
    .meta{margin:7px 0;padding:6px 0;border-top:1px solid #000;border-bottom:1px solid #000}.meta div,.summary div{display:flex;justify-content:space-between;gap:10px;padding:3px 0}.meta span,.summary span{color:#000;font-weight:400}.meta b,.summary b{font-weight:700}
    table{width:100%;border-collapse:collapse;margin-top:7px}th,td{padding:4px 2px;border-bottom:1px solid #000;vertical-align:top;font-weight:400}th{text-align:left;font-size:10px;font-weight:700}td small{display:block;color:#000;font-weight:400;margin-top:2px}
    .estimate-note{margin-top:5px;font-size:9.5px;text-align:center;line-height:1.4}
    /* The voucher number block carries the date too. They used to be separate
       bordered rows, which cost two rules and a row of padding to print one
       short line of text. */
    .voucher-no{margin-top:6px;padding:4px 0;border-top:2px solid #000;border-bottom:2px solid #000;text-align:center}
    .voucher-no span{display:block;font-size:9.5px;font-weight:400}
    .voucher-no b{display:block;font-size:19px;font-weight:700;letter-spacing:1.5px;line-height:1.25}
    .voucher-no small{display:block;font-size:9px;font-weight:400;margin-top:2px}
    /* No rule on top: the voucher number block above already closes with one. */
    .fields{display:grid;grid-template-columns:${twoUp};gap:3px 8px;margin-top:5px;padding-bottom:5px;border-bottom:1px solid #000}
    .fields div{min-width:0;line-height:1.45}.fields .wide{grid-column:1/-1}
    .fields span{font-size:9px;font-weight:400}.fields b{font-size:11px;font-weight:700;word-break:break-word}
    .summary{margin-top:7px}.grand{font-size:15px;font-weight:700;border-top:2px solid #000;margin-top:4px;padding-top:7px!important}.void{margin:9px 0;padding:6px;border:2px solid #000;color:#000;font-weight:700;text-align:center;letter-spacing:2px}
    /* A single rule above the warning instead of a box around it: the heading
       is already centred and bold, so three more sides only spent paper. */
    .notice{margin-top:6px;padding-top:5px;border-top:1px solid #000}.notice>b{display:block;text-align:center;font-size:10.5px;font-weight:700;margin-bottom:3px}.notice ul{margin:0;padding-left:13px}.notice li{font-size:9px;font-weight:400;line-height:1.4;margin-bottom:1px}
    /* Same treatment as the repair voucher's warning: a rule and a centred
       heading rather than a box. Two of these can print back to back, and each
       one's own rule and title is enough to show where the next begins. */
    .warranty-block{margin-top:6px;padding-top:5px;border-top:1px solid #000;text-align:left}
    .warranty-block>b{display:block;text-align:center;font-size:10px;font-weight:700;line-height:1.45;margin-bottom:3px}
    .warranty-block h4{margin:4px 0 1px 0;font-size:9px;font-weight:700;line-height:1.45}
    .warranty-block ul{margin:0;padding-left:12px}
    /* Not smaller than the repair voucher's warning: these are the terms the
       customer is being held to, so they have to stay readable off a thermal
       head, and a couple of millimetres is not worth trading for that. */
    .warranty-block li{font-size:9px;font-weight:400;line-height:1.45;margin-bottom:1px}
    .sign-row{display:flex;gap:12px;margin-top:10px}.sign-row div{flex:1;text-align:center}.sign-row span{display:block;border-top:1px solid #000;padding-top:3px;font-size:9px;font-weight:400}.sign-name{display:block;font-size:11px;font-weight:700;padding-bottom:3px}
    .qr-block{margin-top:6px;text-align:center}.qr-block img{width:26mm;height:26mm;display:block;margin:0 auto 3px auto}.qr-block b{display:block;font-size:9px;font-weight:700}
    .footer{margin-top:11px;padding-top:8px;border-top:1px solid #000;text-align:center;white-space:normal;font-weight:400}
    /* The two signature rules already close the voucher, so its footer does not
       need a third one directly under them. */
    .footer-plain{margin-top:7px;padding-top:0;border-top:0}.footer-tag{display:block;margin-top:8px;font-weight:700}.warranty{margin-top:9px;font-size:9px;color:#000;font-weight:400;text-align:center}.qr-link{word-break:break-all;font-size:9px;color:#000;font-weight:400}
    @media print{body{padding:0 2mm}.no-print{display:none!important}}
  `;
}

// 169 of the 170 shops carry a receipt header that is just their own name,
// left over from an older settings screen. Printed under the heading it named
// the shop twice on every slip. A header that says something else still prints.
function customHeader(text, settings) {
  const value = String(text || '').trim();
  if (!value) return '';
  const name = String(settings?.business?.name || '').trim();
  if (name && value.toLowerCase() === name.toLowerCase()) return '';
  return `<p>${nl2br(value)}</p>`;
}

// Replacing a logo usually means putting a new file at the same address, and a
// slip printed after that kept showing the old one — the browser had it cached
// and nothing in the URL had changed. Stamping the shop's last-updated time on
// it means saving settings is enough to fetch the new artwork.
function logoUrlFor(settings) {
  const business = settings?.business || {};
  const src = String(business.printLogoUrl || business.logoUrl || '').trim();
  if (!src) return '';
  const stamp = business.logoUpdatedAt || business.updatedAt || '';
  if (!stamp) return src;
  const version = String(stamp).replace(/[^0-9]/g, '').slice(0, 14);
  if (!version) return src;
  return `${src}${src.includes('?') ? '&' : '?'}v=${version}`;
}

function brandBlock(settings, title) {
  const business = settings?.business || {};
  const slip = settings?.slip || {};
  // A thermal head has one colour and no grey. Brand artwork is usually mid-tone
  // — this shop's wordmark barely registers — so a slip can name its own
  // black-and-white copy and leave the colour one for the screen and storefront.
  const logoSrc = logoUrlFor(settings);
  const logo = slip.showLogo && logoSrc
    ? `<img class="slip-logo" src="${escapeHtml(logoSrc)}" alt="Logo"/>`
    : '';
  const contacts = [business.phone, business.secondaryPhone, business.address].filter(Boolean).map(escapeHtml).join(' · ');
  return `${logo}${business.name ? `<h1>${escapeHtml(business.name)}</h1>` : ''}${title ? `<p>${escapeHtml(title)}</p>` : ''}${business.subtitle ? `<p class="muted">${escapeHtml(business.subtitle)}</p>` : ''}${contacts ? `<p class="muted">${contacts}</p>` : ''}`;
}

// Slips print as ordinary markup and let the driver rasterise them.
//
// They were rendered to a 1-bit image for a while, to get around a driver that
// dithered the text into nothing. The real fix turned out to be the printer:
// the XP-80C exposes a density setting that was sitting on its lowest step.
// With that raised the text prints properly, and rasterising only cost weight
// control and a logo that had to survive a canvas round trip.
function emitSlip(targetWindow, { title, body, styles }) {
  // A popup has to print itself; the iframe path is driven from the parent, so
  // adding the script there would only ask for the dialog twice.
  const selfPrint = targetWindow && !targetWindow.closed
    ? '<script>window.onload=()=>window.print();<\/script>'
    : '';
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>${styles}</style></head><body>${body}
    ${selfPrint}</body></html>`;
  return printWindow(targetWindow, html);
}

function warrantyBlockHtml(block) {
  const sections = block.sections.map((section) => `
    <h4>${escapeHtml(section.heading)}</h4>
    <ul>${section.lines.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ul>`).join('');
  return `<div class="warranty-block"><b>${escapeHtml(block.title)}</b>${sections}</div>`;
}

export async function printSaleReceipt(sale, targetWindow = null) {
  const settings = await loadProjectSettings(true);
  const slip = settings?.slip || {};
  // Second-hand and brand new carry different promises, so the slip prints the
  // one that matches what was actually sold — and both, labelled, if the sale
  // had one of each.
  const warranties = warrantyBlocksForSale(sale).map(warrantyBlockHtml).join('');
  const items = (sale.itemRows || sale.items || []).map((item) => {
    const meta = [
      item.imeiSerial ? `Serial: ${item.imeiSerial}` : '',
      item.unit ? `Unit: ${item.unit}` : '',
      item.expiryDate ? `Exp: ${item.expiryDate}` : '',
    ].filter(Boolean).join(' · ');
    return `
    <tr>
      <td>${escapeHtml([item.productName, realVariantName(item.variantName)].filter(Boolean).join(' · '))}${meta ? `<small>${escapeHtml(meta)}</small>` : ''}</td>
      <td class="center">${Number(item.quantity || 0)}${item.unit ? ` ${escapeHtml(item.unit)}` : ''}</td>
      <td class="right">${Number(item.unitPrice || 0).toLocaleString()}</td>
      <td class="right">${(Number(item.unitPrice || 0) * Number(item.quantity || 0)).toLocaleString()}</td>
    </tr>`;
  }).join('');
  const invoice = sale.invoice || sale.invoiceNumber || '-';
  const isVoided = String(sale.status || sale.raw?.status || '').toUpperCase().includes('VOID');
  const customerLine = sale.customer || sale.customerName || 'Walk-in Customer';
  const customerPhone = sale.customerPhone || '';
  const payment = sale.payment || sale.paymentMethod || '-';
  const cashier = sale.cashier || sale.cashierName || '-';
  const body = `
    ${brandBlock(settings, 'Sale Receipt')}
    ${customHeader(slip.saleHeader, settings)}
    <div class="meta"><div><span>Invoice</span><b>${escapeHtml(invoice)}</b></div><div><span>Date</span><b>${escapeHtml(new Date(sale.dateTime || sale.date || Date.now()).toLocaleString())}</b></div>${slip.showCustomerPhone && customerPhone ? `<div><span>Phone</span><b>${escapeHtml(customerPhone)}</b></div>` : ''}${slip.showCashierName ? `<div><span>Cashier</span><b>${escapeHtml(cashier)}</b></div>` : ''}</div>
    ${isVoided ? '<div class="void">VOIDED</div>' : ''}
    <table><thead><tr><th>Item</th><th class="center">Qty</th><th class="right">Price</th><th class="right">Total</th></tr></thead><tbody>${items}</tbody></table>
    <div class="summary"><div><span>Subtotal</span><b>${Number(sale.subtotal || sale.amount || 0).toLocaleString()}</b></div><div><span>Discount</span><b>${Number(sale.discount || 0).toLocaleString()}</b></div><div class="grand"><span>Total</span><b>${Number(sale.amount || sale.total || 0).toLocaleString()} MMK</b></div>${slip.showPaymentType ? `<div><span>Payment</span><b>${escapeHtml(payment)}</b></div>` : ''}<div><span>Customer</span><b>${escapeHtml(customerLine)}</b></div></div>
    ${warranties}
    <div class="footer">${slip.saleFooter ? nl2br(slip.saleFooter) : ''}${slip.footerTag ? `<span class="footer-tag">${nl2br(slip.footerTag)}</span>` : ''}${slip.warrantyText ? `<div class="warranty">${nl2br(slip.warrantyText)}</div>` : ''}</div>`;
  return emitSlip(targetWindow, {
    title: escapeHtml(invoice),
    body,
    styles: baseStyles(slip.salePaperSize),
  });
}

export async function printRepairVoucher(repair, targetWindow = null, statusUrl = '') {
  const settings = await loadProjectSettings(true);
  const slip = settings?.slip || {};
  const business = settings?.business || {};
  const repairNumber = repair.repairNumber || repair.repairId || '-';
  const qr = await qrDataUrl(statusUrl);
  const notice = `<div class="notice"><b>⚠️ သတိပြုရန် ⚠️</b><ul>${REPAIR_VOUCHER_NOTICE.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ul></div>`;
  const qrBlock = qr
    ? `<div class="qr-block"><img src="${qr}" alt="Repair status QR"/><b>QR ဖတ်ပြီး ပြင်ဆင်မှု အခြေအနေ ကြည့်နိုင်ပါသည်</b></div>`
    : '';
  const receivedBy = String(repair.technicianName || repair.technicianUsername || '').trim();
  // Same order as the shop's pre-printed pad, so staff read the two the same way.
  // A field nobody filled in is left off the paper rather than printed as a dash.
  // Two to a line: a voucher that ran one field per row wasted most of the
  // roll's width and half its length. Free text keeps the full width, since
  // a problem description wraps to nothing useful in half a column.
  const fieldRows = [
    ['နာမည်', repair.customerName],
    ['ဖုန်းနံပါတ်', repair.customerPhone],
    ['ဖုန်းအမျိုးအစား', repair.deviceBrand],
    ['မော်ဒယ်', repair.deviceModel],
    ['IMEI', repair.imeiSerial || repair.identityValue || repair.identityMasked, 'wide'],
    ['ပြင်ရန်', repair.problem, 'wide'],
    ['ဖုန်းအခြေအနေ', repair.intakeCondition, 'wide'],
    ['ပါလာသောပစ္စည်း', Array.isArray(repair.accessories) ? repair.accessories.join(', ') : repair.accessories, 'wide'],
    ['အခြေအနေ', repairStatusMyanmar(repair.status)],
  ]
    .filter(([, value]) => String(value ?? '').trim())
    .map(([label, value, span]) => `<div${span ? ` class="${span}"` : ''}><span>${escapeHtml(label)}:</span> <b>${escapeHtml(String(value).trim())}</b></div>`)
    .join('');
  const estimated = Number(repair.estimatedCost || 0);
  const settled = Number(repair.finalCost || 0);
  const deposit = Number(repair.deposit || 0);
  const kyat = (value) => `${Number(value || 0).toLocaleString()} ကျပ်`;
  const depositRow = deposit > 0 ? `<div><span>စရံ</span><b>${kyat(deposit)}</b></div>` : '';

  let money;
  if (settled > 0) {
    // Repaired and priced: this is the real figure.
    const due = Number(repair.balanceDue ?? Math.max(0, settled - deposit));
    money = `<div class="summary"><div><span>ပြင်ခ</span><b>${kyat(settled)}</b></div>${depositRow}<div class="grand"><span>စုစုပေါင်း ကျန်ရှိငွေ</span><b>${kyat(due)}</b></div></div>`;
  } else if (estimated > 0) {
    // Quoted but not final — say so, and do not call it a total.
    money = `<div class="summary"><div><span>ခန့်မှန်းပြင်ခ</span><b>${kyat(estimated)}</b></div>${depositRow}<div class="grand"><span>ခန့်မှန်း ကျန်ငွေ</span><b>${kyat(Math.max(0, estimated - deposit))}</b></div></div>
    <p class="estimate-note">* ခန့်မှန်းချက်သာ ဖြစ်ပါသည်။ အတိအကျ ကျသင့်ငွေကို ပြင်ပြီးမှ အတည်ပြုပါမည်။</p>`;
  } else {
    // Nothing priced yet. Show the deposit if one was taken, and nothing else.
    money = `${depositRow ? `<div class="summary">${depositRow}</div>` : ''}
    <p class="estimate-note">ကျသင့်ငွေ — စစ်ဆေးပြီးမှ အတည်ပြုပါမည်။</p>`;
  }

  const body = `
    ${brandBlock(settings, '')}
    ${customHeader(slip.repairVoucherHeader, settings)}
    <div class="voucher-no"><span>ဘောက်ချာနံပါတ်</span><b>${escapeHtml(repairNumber)}</b><small>${escapeHtml(new Date(repair.receivedAt || Date.now()).toLocaleString())}</small></div>
    <div class="fields">${fieldRows}</div>
    ${money}
    ${notice}
    ${qrBlock}
    <div class="sign-row"><div><b class="sign-name">${receivedBy ? escapeHtml(receivedBy) : '&nbsp;'}</b><span>လက်ခံသူ</span></div><div><b class="sign-name">&nbsp;</b><span>ရွေးယူသူ</span></div></div>
    ${business.website ? `<p class="qr-link">${escapeHtml(business.website)}</p>` : ''}
    <div class="footer footer-plain">${slip.repairVoucherFooter ? nl2br(slip.repairVoucherFooter) : ''}${slip.footerTag ? `<span class="footer-tag">${nl2br(slip.footerTag)}</span>` : ''}${slip.warrantyText ? `<div class="warranty">${nl2br(slip.warrantyText)}</div>` : ''}</div>`;
  return emitSlip(targetWindow, {
    title: escapeHtml(repairNumber),
    body,
    styles: baseStyles(slip.repairPaperSize),
  });
}
