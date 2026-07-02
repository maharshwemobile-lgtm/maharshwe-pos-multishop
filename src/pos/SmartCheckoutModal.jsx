import React from 'react';
import {
  CheckCircle2,
  Loader2,
  ReceiptText,
  ShoppingCart,
  X,
} from 'lucide-react';
import { formatMoney, productTitle } from './posHelpers';

const paymentLabel = {
  CASH: 'Cash',
  KPAY: 'KBZ Pay',
  WAVE_PAY: 'Wave Pay',
  CREDIT: 'Credit',
  OTHER: 'Other',
};

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export function printSaleReceipt(sale, targetWindow = null) {
  const popup = targetWindow || window.open('', '_blank', 'width=430,height=760');
  if (!popup) return false;
  const receiptItems = sale.items || sale.itemRows || [];
  const isVoided = sale.status === 'Voided' || sale.raw?.status === 'VOIDED';
  const items = receiptItems.map((item) => `
    <tr>
      <td>${escapeHtml([item.productName, item.variantName].filter(Boolean).join(' — '))}${item.imeiSerial ? `<small>${escapeHtml(item.imeiSerial)}</small>` : ''}</td>
      <td class="center">${item.quantity}</td>
      <td class="right">${Number(item.unitPrice || 0).toLocaleString()}</td>
      <td class="right">${(Number(item.unitPrice || 0) * Number(item.quantity || 0)).toLocaleString()}</td>
    </tr>
  `).join('');

  popup.document.open();
  popup.document.write(`<!doctype html>
  <html><head><meta charset="utf-8"><title>${escapeHtml(sale.invoice)}</title>
  <style>
    body{font-family:Arial,sans-serif;color:#111;margin:0;padding:18px;font-size:12px}
    h1,h2,p{text-align:center;margin:3px 0}h1{font-size:21px}.muted{color:#555}
    .voided{margin:10px 0;padding:8px;border:2px solid #b91c1c;color:#b91c1c;font-weight:bold;font-size:18px;text-align:center;letter-spacing:2px}
    table{width:100%;border-collapse:collapse;margin-top:14px}th,td{padding:7px 3px;border-bottom:1px dashed #999;vertical-align:top}
    th{text-align:left}.center{text-align:center}.right{text-align:right}small{display:block;color:#555;margin-top:3px}
    .summary{margin-top:14px}.summary div{display:flex;justify-content:space-between;padding:4px 0}.grand{font-size:17px;font-weight:bold;border-top:2px solid #111;margin-top:5px;padding-top:8px}.footer{margin-top:22px;text-align:center;border-top:1px dashed #777;padding-top:12px}
  </style></head><body>
    <h1>Mahar Shwe Mobile</h1><p>Sale Receipt</p><p class="muted">${escapeHtml(sale.invoice)}</p>
    <p class="muted">${escapeHtml(new Date(sale.dateTime || sale.date || Date.now()).toLocaleString())}</p>
    ${isVoided ? '<div class="voided">VOIDED</div>' : ''}
    <table><thead><tr><th>Item</th><th class="center">Qty</th><th class="right">Price</th><th class="right">Total</th></tr></thead><tbody>${items}</tbody></table>
    <div class="summary"><div><span>Subtotal</span><b>${Number(sale.subtotal || 0).toLocaleString()}</b></div><div><span>Discount</span><b>${Number(sale.discount || 0).toLocaleString()}</b></div><div class="grand"><span>Total</span><b>${Number(sale.total || sale.amount || 0).toLocaleString()} MMK</b></div><div><span>Payment</span><b>${escapeHtml(sale.payment || sale.paymentMethod)}</b></div><div><span>Customer</span><b>${escapeHtml(sale.customer || 'Walk-in Customer')}</b></div></div>
    <div class="footer">Thank you for choosing Mahar Shwe Mobile.</div>
    <script>window.onload=()=>window.print();</script>
  </body></html>`);
  popup.document.close();
  return true;
}

export function SmartReviewModal({
  cart,
  customer,
  payment,
  subtotal,
  discount,
  total,
  cashReceived,
  change,
  busy,
  error,
  onClose,
  onConfirm,
}) {
  const selectedPaymentName = payment.name || paymentLabel[payment.method] || payment.method;
  return (
    <div className="smart-pos-modal-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !busy) onClose();
    }}>
      <section className="smart-pos-modal">
        <header>
          <div className="smart-pos-modal-icon"><ReceiptText size={23} /></div>
          <div><h2>Review Sale</h2><p>DB ထဲမသိမ်းခင် အောက်ပါအချက်များကို နောက်ဆုံးစစ်ပါ။</p></div>
          <button type="button" className="smart-pos-modal-close" onClick={onClose} disabled={busy}><X size={19} /></button>
        </header>

        <div className="smart-pos-modal-body">
          <section className="smart-pos-review-meta">
            <div><span>Customer</span><b>{customer.name || 'Walk-in Customer'}</b><small>{customer.phone || '-'}</small></div>
            <div><span>Payment</span><b>{selectedPaymentName}</b><small>{payment.reference || 'No reference'}</small></div>
            <div><span>Cart</span><b>{cart.reduce((sum, line) => sum + Number(line.quantity || 0), 0)} units</b><small>{cart.length} product lines</small></div>
          </section>

          <section className="smart-pos-review-items">
            <div className="smart-pos-review-table-head"><span>Product</span><span>Qty</span><span>Price</span><span>Total</span></div>
            {cart.map((line) => (
              <article key={line.key}>
                <div><b>{productTitle(line)}</b><small>{line.imeiSerial || line.sku || line.barcode || '-'}</small></div>
                <strong>{line.quantity}</strong>
                <strong>{formatMoney(line.unitPrice)}</strong>
                <strong>{formatMoney(Number(line.unitPrice || 0) * Number(line.quantity || 0))}</strong>
              </article>
            ))}
          </section>

          <section className="smart-pos-review-summary">
            <div><span>Subtotal</span><b>{formatMoney(subtotal)}</b></div>
            <div><span>Discount</span><b>-{formatMoney(discount)}</b></div>
            <div className="grand"><span>Grand Total</span><b>{formatMoney(total)}</b></div>
            {payment.method === 'CASH' ? <>
              <div><span>Cash Received</span><b>{formatMoney(cashReceived)}</b></div>
              <div className="change"><span>Change</span><b>{formatMoney(change)}</b></div>
            </> : null}
          </section>

          <div className="smart-pos-review-notice">
            Confirm နှိပ်ချိန်မှာ PostgreSQL က Stock, Minimum Price နဲ့ Permission ကို ထပ်မံစစ်ပြီး Sale၊ Payment နဲ့ Stock Movement ကို transaction တစ်ခုတည်းနဲ့ သိမ်းပါမယ်။
          </div>
          {error ? <div className="smart-pos-modal-error">{error}</div> : null}
        </div>

        <footer>
          <button type="button" onClick={onClose} disabled={busy}>Back to Cart</button>
          <button type="button" className="primary" onClick={onConfirm} disabled={busy}>
            {busy ? <Loader2 size={18} className="smart-pos-spin" /> : <CheckCircle2 size={18} />}
            Confirm & Complete Sale
          </button>
        </footer>
      </section>
    </div>
  );
}

export function SmartSuccessModal({ sale, onNewSale }) {
  return (
    <div className="smart-pos-modal-backdrop">
      <section className="smart-pos-modal smart-pos-success-modal">
        <div className="smart-pos-success-check"><CheckCircle2 size={42} /></div>
        <h2>Sale Completed</h2>
        <p>{sale.invoice}</p>
        <section className="smart-pos-success-grid">
          <div><span>Total</span><b>{formatMoney(sale.total)}</b></div>
          <div><span>Payment</span><b>{sale.payment}</b></div>
          <div><span>Change</span><b>{formatMoney(sale.change)}</b></div>
        </section>
        <p>Receipt ကို Sales History ထဲက Reprint ခလုတ်ဖြင့်သာ ထုတ်နိုင်ပါသည်။</p>
        <div className="smart-pos-success-actions">
          <button type="button" className="primary" onClick={onNewSale}><ShoppingCart size={18} /> Start New Sale</button>
        </div>
      </section>
    </div>
  );
}
