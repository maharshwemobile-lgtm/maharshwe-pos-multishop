import React, { useState } from 'react';
import { Loader2, Printer, Repeat2, X } from 'lucide-react';
import { printSaleReceipt } from './projectPrintUtils';
import './quick-voucher.css';

/**
 * Print a voucher without recording a sale.
 *
 * A part-exchange is not a sale the till understands: the customer hands over a
 * phone, the shop knocks its worth off the price, and the money that changes
 * hands is the difference. Ringing that up as an ordinary sale puts a figure in
 * the day's takings that nobody received, and the shop was left with no paper
 * for the customer at all.
 *
 * So this prints, and only prints. Nothing is written down, no stock moves, and
 * the sales list does not gain a row. The slip itself is the same slip the till
 * prints, built from a plain object rather than a saved record -- which is why
 * the warranty notice still comes out for a phone.
 */
const blank = {
  reference: '',
  customerName: '',
  customerPhone: '',
  item: '',
  imeiSerial: '',
  price: '',
  condition: 'SECOND_HAND',
  tradeInDevice: '',
  tradeInImei: '',
  tradeInValue: '',
  note: '',
};

const amountOf = (value) => {
  const number = Number(String(value ?? '').trim());
  return Number.isFinite(number) && number > 0 ? number : 0;
};

export default function QuickVoucherModal({ onClose, notify }) {
  const [form, setForm] = useState(blank);
  const [printing, setPrinting] = useState(false);
  const field = (key, value) => setForm((current) => ({ ...current, [key]: value }));

  const price = amountOf(form.price);
  const tradeInValue = amountOf(form.tradeInValue);

  // "Vivo Y28 နဲ့ လဲ → Redmi 9A" -- what came in and what went out, on one line,
  // because that is how the counter says it.
  const swapLine = form.tradeInDevice.trim()
    ? `${form.tradeInDevice.trim()}${form.tradeInImei.trim() ? ` (${form.tradeInImei.trim()})` : ''} နှင့် လဲလှယ်${
      form.item.trim() ? ` → ${form.item.trim()}` : ''}${tradeInValue ? ` · လဲဖုန်း တန်ဖိုး ${tradeInValue.toLocaleString()} ကျပ်` : ''}`
    : '';

  const print = async () => {
    if (!form.item.trim()) { notify?.('error', 'ရောင်းလိုက်တဲ့ ပစ္စည်း ရေးပါ'); return; }
    setPrinting(true);
    try {
      const printed = await printSaleReceipt({
        invoice: form.reference.trim() || '-',
        dateTime: new Date().toISOString(),
        customer: form.customerName.trim() || 'Walk-in Customer',
        customerPhone: form.customerPhone.trim(),
        subtotal: price,
        discount: 0,
        amount: price,
        total: price,
        payment: swapLine ? 'လဲလှယ်မှု' : 'ငွေသား',
        // Shaped like a sale line so the slip -- and the warranty notice that
        // reads the line's condition -- work exactly as they do for a real one.
        items: [{
          productName: form.item.trim(),
          variantName: '',
          categoryName: 'Phone',
          condition: form.condition,
          imeiSerial: form.imeiSerial.trim(),
          quantity: 1,
          unitPrice: price,
        }],
        // The two lines the counter wants on the paper: what was swapped, and
        // anything else worth saying.
        noteLines: [swapLine, form.note.trim()].filter(Boolean),
      });
      if (!printed) { notify?.('error', 'Print window မဖွင့်နိုင်ပါ'); return; }
      notify?.('success', 'ဘောက်ချာ ထုတ်ပြီးပါပြီ — အရောင်းစာရင်းထဲ မဝင်ပါ');
      onClose();
    } catch (error) {
      notify?.('error', error.message || 'ဘောက်ချာ ထုတ်၍ မရပါ');
    } finally {
      setPrinting(false);
    }
  };

  return (
    <div className="qv-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="qv-modal" role="dialog" aria-modal="true">
        <header>
          <div className="qv-icon"><Repeat2 size={22} /></div>
          <div>
            <h3>ဘောက်ချာ သီးသန့် ထုတ်မည်</h3>
            <p>ဖုန်းလဲလှယ်မှုလို အရောင်းစာရင်းထဲ မထည့်လိုသည့် အရောင်းအတွက်။ ဘောက်ချာသာ ထွက်ပြီး စာရင်း၊ စတော့ မထိပါ။</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close"><X size={20} /></button>
        </header>

        <div className="qv-body">
          <div className="qv-grid">
            <label><span>ဘောက်ချာနံပါတ်</span><input value={form.reference} onChange={(event) => field('reference', event.target.value)} placeholder="M0027" /><small>စာရွက်စာရင်းက နံပါတ် ရှိရင် ရိုက်ပါ</small></label>
            <label><span>ဖောက်သည် အမည်</span><input value={form.customerName} onChange={(event) => field('customerName', event.target.value)} placeholder="ဦးမောင်မောင်" /></label>
            <label><span>ဖုန်းနံပါတ်</span><input value={form.customerPhone} onChange={(event) => field('customerPhone', event.target.value)} placeholder="09-…" /></label>
          </div>

          <h4>ရောင်းလိုက်သည့် ပစ္စည်း</h4>
          <div className="qv-grid">
            <label className="qv-wide"><span>ပစ္စည်း *</span><input value={form.item} onChange={(event) => field('item', event.target.value)} placeholder="Redmi 9A" autoFocus /></label>
            <label><span>IMEI / Serial</span><input value={form.imeiSerial} onChange={(event) => field('imeiSerial', event.target.value)} placeholder="356938…" /></label>
            <label><span>ဈေးနှုန်း</span><input type="number" min="0" inputMode="numeric" value={form.price} onChange={(event) => field('price', event.target.value)} placeholder="0" /><small>ဖောက်သည်ဆီက ကောက်တဲ့ ငွေ</small></label>
            <label><span>အခြေအနေ</span>
              <select value={form.condition} onChange={(event) => field('condition', event.target.value)}>
                <option value="SECOND_HAND">Second-hand (စက်ဟောင်း)</option>
                <option value="NEW">Brand New (စက်အသစ်)</option>
              </select>
              <small>ဘောက်ချာမှာ ထည့်ပေးမည့် အာမခံစာကို ဒီအတိုင်း ရွေးပါမည်</small>
            </label>
          </div>

          <h4>လဲလှယ်ယူသည့် ဖုန်း</h4>
          <div className="qv-grid">
            <label className="qv-wide"><span>ဘယ်ဖုန်းနဲ့ လဲသလဲ</span><input value={form.tradeInDevice} onChange={(event) => field('tradeInDevice', event.target.value)} placeholder="Vivo Y28" /></label>
            <label><span>IMEI / Serial</span><input value={form.tradeInImei} onChange={(event) => field('tradeInImei', event.target.value)} placeholder="867123…" /></label>
            <label><span>လဲဖုန်း တန်ဖိုး</span><input type="number" min="0" inputMode="numeric" value={form.tradeInValue} onChange={(event) => field('tradeInValue', event.target.value)} placeholder="0" /></label>
          </div>

          <label className="qv-note"><span>မှတ်ချက်</span><textarea value={form.note} onChange={(event) => field('note', event.target.value)} placeholder="ဘောက်ချာအောက်မှာ ထပ်ပြချင်တာ ရှိရင် ရေးပါ" /></label>

          {swapLine ? <p className="qv-preview"><b>ဘောက်ချာတွင် ဤသို့ ပါပါမည်</b><span>{swapLine}</span></p> : null}
        </div>

        <footer>
          <button type="button" onClick={onClose} disabled={printing}>မလုပ်တော့ပါ</button>
          <button type="button" className="qv-print" onClick={print} disabled={printing}>
            {printing ? <Loader2 className="qv-spin" size={18} /> : <Printer size={18} />} ဘောက်ချာ ထုတ်မည်
          </button>
        </footer>
      </section>
    </div>
  );
}
