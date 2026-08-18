// Order slip for the public Game Top-up storefront.
//
// A customer who has just transferred money wants something they can keep.
// This writes a plain .txt receipt rather than a PDF: it opens on any phone
// with no reader app, it is tiny, and — the reason that matters — the status
// link inside stays selectable text, so they can tap or paste it later. A
// rendered PDF would bury that link in an image on most Android viewers.
const money = (value) => `${Number(value || 0).toLocaleString('en-US')} MMK`;

function line(label, value) {
  return `${label.padEnd(18, ' ')}: ${value}`;
}

export function buildOrderSlipText({ orderNumber, productName, variationName, quantity, playerId, serverId, customerName, customerPhone, total, paymentTransactionId, statusUrl, createdAt }) {
  const when = createdAt ? new Date(createdAt) : new Date();
  const rule = '='.repeat(40);
  const rows = [
    rule,
    '      MAHAR POS — GAME TOP-UP',
    '           အော်ဒါ ဖြတ်ပိုင်း',
    rule,
    '',
    line('အော်ဒါနံပါတ်', orderNumber),
    line('နေ့စွဲ', when.toLocaleString()),
    '',
    line('ပစ္စည်း', productName || '-'),
    line('Package', `${variationName || '-'} × ${quantity || 1}`),
  ];
  if (playerId) rows.push(line('Player ID', playerId));
  if (serverId) rows.push(line('Server', serverId));
  rows.push('');
  if (customerName) rows.push(line('နာမည်', customerName));
  if (customerPhone) rows.push(line('ဖုန်း', customerPhone));
  rows.push(
    '',
    line('စုစုပေါင်း', money(total)),
    line('ငွေပေးချေမှု', 'KBZ Pay'),
    line('Txn ၄ လုံး', paymentTransactionId || '-'),
    '',
    rule,
    'အခြေအနေ စစ်ရန် link:',
    statusUrl || '-',
    rule,
    '',
    'ငွေလက်ခံရရှိကြောင်း စစ်ဆေးပြီးပါက',
    'ချက်ချင်း ဖြည့်ပေးပါမယ်။',
    'ဤဖြတ်ပိုင်းကို သိမ်းဆည်းထားပါ။',
    '',
  );
  return rows.join('\n');
}

export function downloadOrderSlip(details) {
  const text = buildOrderSlipText(details);
  // A BOM so Windows Notepad reads the Burmese correctly, same reason the
  // shop-data CSV export carries one.
  const blob = new Blob([`﻿${text}`], { type: 'text/plain;charset=utf-8' });
  const href = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = href;
  link.download = `${details.orderNumber || 'order'}-mahar-pos.txt`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(href);
}
