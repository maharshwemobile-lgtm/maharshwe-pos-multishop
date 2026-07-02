import { loadProjectSettings } from '../settings/projectSettingsClient';

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
  return `
    @page{size:${width} auto;margin:3mm}
    *{box-sizing:border-box}
    body{width:${width};max-width:100%;margin:0 auto;padding:3mm;font-family:Arial,sans-serif;color:#111;font-size:11px;background:#fff}
    .slip-logo{display:block;width:66px;height:66px;object-fit:contain;margin:0 auto 8px auto;text-align:center}
    .logo-fallback{display:flex;width:58px;height:58px;align-items:center;justify-content:center;margin:0 auto 8px auto;border-radius:50%;background:#111;color:#fff;font-weight:900;font-size:18px}
    h1,h2,p{text-align:center;margin:3px 0}h1{font-size:18px}h2{font-size:14px}.muted{color:#555}.left{text-align:left}.right{text-align:right}.center{text-align:center}
    .meta{margin:10px 0;padding:8px 0;border-top:1px dashed #777;border-bottom:1px dashed #777}.meta div,.summary div{display:flex;justify-content:space-between;gap:10px;padding:3px 0}.meta span,.summary span{color:#444}
    table{width:100%;border-collapse:collapse;margin-top:10px}th,td{padding:6px 2px;border-bottom:1px dashed #999;vertical-align:top}th{text-align:left;font-size:10px}td small{display:block;color:#555;margin-top:2px}
    .summary{margin-top:10px}.grand{font-size:15px;font-weight:bold;border-top:2px solid #111;margin-top:4px;padding-top:7px!important}.void{margin:9px 0;padding:6px;border:2px solid #b91c1c;color:#b91c1c;font-weight:bold;text-align:center;letter-spacing:2px}
    .footer{margin-top:15px;padding-top:10px;border-top:1px dashed #777;text-align:center;white-space:normal}.footer-tag{display:block;margin-top:8px;font-weight:900}.warranty{margin-top:9px;font-size:9px;color:#444;text-align:center}.qr-link{word-break:break-all;font-size:9px;color:#333}
    @media print{body{padding:0}.no-print{display:none!important}}
  `;
}

function brandBlock(settings, title) {
  const business = settings?.business || {};
  const slip = settings?.slip || {};
  const logo = slip.showLogo && business.logoUrl
    ? `<img class="slip-logo" src="${escapeHtml(business.logoUrl)}" alt="Logo"/>`
    : slip.showLogo ? '<div class="logo-fallback">MS</div>' : '';
  const contacts = [business.phone, business.secondaryPhone, business.address].filter(Boolean).map(escapeHtml).join(' · ');
  return `${logo}<h1>${escapeHtml(business.name || 'Mahar Shwe Mobile')}</h1><p>${escapeHtml(title)}</p>${business.subtitle ? `<p class="muted">${escapeHtml(business.subtitle)}</p>` : ''}${contacts ? `<p class="muted">${contacts}</p>` : ''}`;
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
    <div class="footer">${slip.saleFooter ? nl2br(slip.saleFooter) : 'Thank you.'}${slip.footerTag ? `<span class="footer-tag">${nl2br(slip.footerTag)}</span>` : ''}${slip.warrantyText ? `<div class="warranty">${nl2br(slip.warrantyText)}</div>` : ''}</div>
    <script>window.onload=()=>window.print();</script></body></html>`;
  return printWindow(targetWindow, html);
}

export async function printRepairVoucher(repair, targetWindow = null) {
  const settings = await loadProjectSettings(true);
  const slip = settings?.slip || {};
  const business = settings?.business || {};
  const repairNumber = repair.repairNumber || repair.repairId || '-';
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(repairNumber)}</title><style>${baseStyles(slip.repairPaperSize)}</style></head><body>
    ${brandBlock(settings, 'Repair Voucher')}
    ${slip.repairVoucherHeader ? `<p>${nl2br(slip.repairVoucherHeader)}</p>` : ''}
    <div class="meta"><div><span>Repair ID</span><b>${escapeHtml(repairNumber)}</b></div><div><span>Received</span><b>${escapeHtml(new Date(repair.receivedAt || Date.now()).toLocaleString())}</b></div><div><span>Customer</span><b>${escapeHtml(repair.customerName || '-')}</b></div>${repair.customerPhone ? `<div><span>Phone</span><b>${escapeHtml(repair.customerPhone)}</b></div>` : ''}</div>
    <table><tbody><tr><th>Device</th><td>${escapeHtml([repair.deviceBrand, repair.deviceModel].filter(Boolean).join(' ') || '-')}</td></tr><tr><th>IMEI / Serial</th><td>${escapeHtml(repair.identityMasked || repair.imeiSerial || '-')}</td></tr><tr><th>Problem</th><td>${escapeHtml(repair.problem || '-')}</td></tr><tr><th>Condition</th><td>${escapeHtml(repair.intakeCondition || '-')}</td></tr><tr><th>Accessories</th><td>${escapeHtml(Array.isArray(repair.accessories) ? repair.accessories.join(', ') : repair.accessories || '-')}</td></tr><tr><th>Status</th><td>${escapeHtml(String(repair.status || '-').replaceAll('_', ' '))}</td></tr></tbody></table>
    <div class="summary"><div><span>Estimated</span><b>${Number(repair.estimatedCost || 0).toLocaleString()} MMK</b></div><div><span>Deposit</span><b>${Number(repair.deposit || 0).toLocaleString()} MMK</b></div><div class="grand"><span>Balance</span><b>${Number(repair.balanceDue || Math.max(0, Number(repair.finalCost || 0) - Number(repair.deposit || 0))).toLocaleString()} MMK</b></div></div>
    ${business.website ? `<p class="qr-link">${escapeHtml(business.website)}</p>` : ''}
    <div class="footer">${slip.repairVoucherFooter ? nl2br(slip.repairVoucherFooter) : 'Please keep this voucher.'}${slip.footerTag ? `<span class="footer-tag">${nl2br(slip.footerTag)}</span>` : ''}${slip.warrantyText ? `<div class="warranty">${nl2br(slip.warrantyText)}</div>` : ''}</div>
    <script>window.onload=()=>window.print();</script></body></html>`;
  return printWindow(targetWindow, html);
}
