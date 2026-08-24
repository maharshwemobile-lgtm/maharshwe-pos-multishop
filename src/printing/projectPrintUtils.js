import QRCode from 'qrcode';
import { loadProjectSettings } from '../settings/projectSettingsClient';

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

function printWindow(targetWindow, html) {
  const popup = targetWindow || window.open('', '_blank', 'width=430,height=760');
  if (!popup) return false;
  popup.document.open();
  popup.document.write(html);
  popup.document.close();
  return true;
}

function baseStyles(paperSize) {
  const width = paperSize === '58mm' ? '58mm' : '80mm';
  // Thermal heads render grey as sparse dots, so a #555 label comes out faint
  // and a hairline dashed rule almost disappears. Everything is pure black and
  // bold with solid rules. Sizes stay as they were — weight is what makes it
  // readable, and bumping the type only spends more paper per slip.
  const twoUp = width === '58mm' ? '1fr' : '1fr 1fr';
  return `
    @page{size:${width} auto;margin:3mm}
    *{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}
    body{width:${width};max-width:100%;margin:0 auto;padding:3mm;font-family:Arial,sans-serif;color:#000;font-size:11px;font-weight:700;background:#fff;-webkit-font-smoothing:none}
    .slip-logo{display:block;width:66px;height:66px;object-fit:contain;margin:0 auto 8px auto;text-align:center}
    .logo-fallback{display:flex;width:58px;height:58px;align-items:center;justify-content:center;margin:0 auto 8px auto;border-radius:50%;background:#000;color:#fff;font-weight:900;font-size:18px}
    h1,h2,p{text-align:center;margin:3px 0}h1{font-size:18px;font-weight:900}h2{font-size:14px;font-weight:900}.muted{color:#000;font-weight:700}.left{text-align:left}.right{text-align:right}.center{text-align:center}
    .meta{margin:10px 0;padding:8px 0;border-top:1px solid #000;border-bottom:1px solid #000}.meta div,.summary div{display:flex;justify-content:space-between;gap:10px;padding:3px 0}.meta span,.summary span{color:#000;font-weight:700}.meta b,.summary b{font-weight:900}
    table{width:100%;border-collapse:collapse;margin-top:10px}th,td{padding:6px 2px;border-bottom:1px solid #000;vertical-align:top;font-weight:700}th{text-align:left;font-size:10px;font-weight:900}td small{display:block;color:#000;font-weight:700;margin-top:2px}
    .fields{display:grid;grid-template-columns:${twoUp};gap:5px 10px;margin-top:9px;padding:7px 0;border-top:1px solid #000;border-bottom:1px solid #000}
    .fields div{min-width:0;line-height:1.45}.fields .wide{grid-column:1/-1}
    .fields span{font-size:9px;font-weight:700}.fields b{font-size:11px;font-weight:900;word-break:break-word}
    .summary{margin-top:10px}.grand{font-size:15px;font-weight:900;border-top:2px solid #000;margin-top:4px;padding-top:7px!important}.void{margin:9px 0;padding:6px;border:2px solid #000;color:#000;font-weight:900;text-align:center;letter-spacing:2px}
    .notice{margin-top:11px;padding:7px 8px;border:1.5px solid #000;border-radius:4px}.notice>b{display:block;text-align:center;font-size:11px;font-weight:900;margin-bottom:5px}.notice ul{margin:0;padding-left:14px}.notice li{font-size:9.5px;font-weight:700;line-height:1.45;margin-bottom:3px}
    .sign-row{display:flex;gap:12px;margin-top:16px}.sign-row div{flex:1;text-align:center}.sign-row span{display:block;border-top:1px solid #000;padding-top:4px;font-size:9px;font-weight:700}
    .qr-block{margin-top:11px;text-align:center}.qr-block img{width:34mm;height:34mm;display:block;margin:0 auto 4px auto}.qr-block b{display:block;font-size:9px;font-weight:900}
    .footer{margin-top:15px;padding-top:10px;border-top:1px solid #000;text-align:center;white-space:normal;font-weight:700}.footer-tag{display:block;margin-top:8px;font-weight:900}.warranty{margin-top:9px;font-size:9px;color:#000;font-weight:700;text-align:center}.qr-link{word-break:break-all;font-size:9px;color:#000;font-weight:700}
    @media print{body{padding:0}.no-print{display:none!important}}
  `;
}

function brandBlock(settings, title) {
  const business = settings?.business || {};
  const slip = settings?.slip || {};
  const logo = slip.showLogo && business.logoUrl
    ? `<img class="slip-logo" src="${escapeHtml(business.logoUrl)}" alt="Logo"/>`
    : '';
  const contacts = [business.phone, business.secondaryPhone, business.address].filter(Boolean).map(escapeHtml).join(' · ');
  return `${logo}${business.name ? `<h1>${escapeHtml(business.name)}</h1>` : ''}<p>${escapeHtml(title)}</p>${business.subtitle ? `<p class="muted">${escapeHtml(business.subtitle)}</p>` : ''}${contacts ? `<p class="muted">${contacts}</p>` : ''}`;
}

export async function printSaleReceipt(sale, targetWindow = null) {
  const settings = await loadProjectSettings(true);
  const slip = settings?.slip || {};
  const items = (sale.itemRows || sale.items || []).map((item) => {
    const meta = [
      item.imeiSerial ? `Serial: ${item.imeiSerial}` : '',
      item.unit ? `Unit: ${item.unit}` : '',
      item.expiryDate ? `Exp: ${item.expiryDate}` : '',
    ].filter(Boolean).join(' · ');
    return `
    <tr>
      <td>${escapeHtml([item.productName, item.variantName].filter(Boolean).join(' · '))}${meta ? `<small>${escapeHtml(meta)}</small>` : ''}</td>
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
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(invoice)}</title><style>${baseStyles(slip.salePaperSize)}</style></head><body>
    ${brandBlock(settings, 'Sale Receipt')}
    ${slip.saleHeader ? `<p>${nl2br(slip.saleHeader)}</p>` : ''}
    <div class="meta"><div><span>Invoice</span><b>${escapeHtml(invoice)}</b></div><div><span>Date</span><b>${escapeHtml(new Date(sale.dateTime || sale.date || Date.now()).toLocaleString())}</b></div>${slip.showCustomerPhone && customerPhone ? `<div><span>Phone</span><b>${escapeHtml(customerPhone)}</b></div>` : ''}${slip.showCashierName ? `<div><span>Cashier</span><b>${escapeHtml(cashier)}</b></div>` : ''}</div>
    ${isVoided ? '<div class="void">VOIDED</div>' : ''}
    <table><thead><tr><th>Item</th><th class="center">Qty</th><th class="right">Price</th><th class="right">Total</th></tr></thead><tbody>${items}</tbody></table>
    <div class="summary"><div><span>Subtotal</span><b>${Number(sale.subtotal || sale.amount || 0).toLocaleString()}</b></div><div><span>Discount</span><b>${Number(sale.discount || 0).toLocaleString()}</b></div><div class="grand"><span>Total</span><b>${Number(sale.amount || sale.total || 0).toLocaleString()} MMK</b></div>${slip.showPaymentType ? `<div><span>Payment</span><b>${escapeHtml(payment)}</b></div>` : ''}<div><span>Customer</span><b>${escapeHtml(customerLine)}</b></div></div>
    <div class="footer">${slip.saleFooter ? nl2br(slip.saleFooter) : ''}${slip.footerTag ? `<span class="footer-tag">${nl2br(slip.footerTag)}</span>` : ''}${slip.warrantyText ? `<div class="warranty">${nl2br(slip.warrantyText)}</div>` : ''}</div>
    <script>window.onload=()=>window.print();</script></body></html>`;
  return printWindow(targetWindow, html);
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
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(repairNumber)}</title><style>${baseStyles(slip.repairPaperSize)}</style></head><body>
    ${brandBlock(settings, 'ဖုန်းပြင် ဘောင်ချာ')}
    ${slip.repairVoucherHeader ? `<p>${nl2br(slip.repairVoucherHeader)}</p>` : ''}
    <div class="meta"><div><span>ပြင်ဆင်မှု ID</span><b>${escapeHtml(repairNumber)}</b></div><div><span>နေ့စွဲ</span><b>${escapeHtml(new Date(repair.receivedAt || Date.now()).toLocaleString())}</b></div></div>
    <div class="fields">${fieldRows}</div>
    <div class="summary"><div><span>ခန့်မှန်းကျသင့်ငွေ</span><b>${Number(repair.estimatedCost || 0).toLocaleString()} ကျပ်</b></div><div><span>စရံ</span><b>${Number(repair.deposit || 0).toLocaleString()} ကျပ်</b></div><div class="grand"><span>စုစုပေါင်းကျသင့်ငွေ</span><b>${Number(repair.balanceDue || Math.max(0, Number(repair.finalCost || 0) - Number(repair.deposit || 0))).toLocaleString()} ကျပ်</b></div></div>
    ${notice}
    ${qrBlock}
    <div class="sign-row"><div><span>လက်ခံသူလက်မှတ်</span></div><div><span>ရွေးယူသူလက်မှတ်</span></div></div>
    ${business.website ? `<p class="qr-link">${escapeHtml(business.website)}</p>` : ''}
    <div class="footer">${slip.repairVoucherFooter ? nl2br(slip.repairVoucherFooter) : ''}${slip.footerTag ? `<span class="footer-tag">${nl2br(slip.footerTag)}</span>` : ''}${slip.warrantyText ? `<div class="warranty">${nl2br(slip.warrantyText)}</div>` : ''}</div>
    <script>window.onload=()=>window.print();</script></body></html>`;
  return printWindow(targetWindow, html);
}
