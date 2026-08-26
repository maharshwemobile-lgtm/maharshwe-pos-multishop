// Turn a repair into the row shape the shop already keeps by hand.
//
// Mahar Shwe has run its repair book in a Google Sheet for years, and the
// columns and wording there are theirs, not ours. Rather than push our field
// names at it, this maps a repair onto that sheet exactly as it stands:
//
//   A  (blank header)        dd/mm/yyyy
//   B  Repair ID/Voucher     0481          — four digits, no shop prefix
//   C  ပိုင်ရှင်နာမည်
//   D  Phone Model
//   E  ပြင်ဆင်မှုအပိုင်း      TL / Check / USB / Battery …
//   F  ပြင်ဆင်မှုအခြေအနေ     ပြင်ပြီး ✅ / ပြင်မရ ❌ / ပြင်ရန် ⏳
//   G  ကုန်ကျစရိတ်
//   H  ယူပြီး ခြေနေ          မယူရသေး ⏳ until it is collected
//   I  Customer ဈေး
//   J  ဆရာအမည်
//   K  လာယူချိန်
//   L  ငွေရှင်း status
//   M  မှတ်ချက်
//
// Columns the shop leaves blank are written blank, not filled with our own
// idea of what belongs there.

const SHEET_COLUMNS = [
  'date',
  'voucherNo',
  'customerName',
  'phoneModel',
  'repairPart',
  'repairStatus',
  'cost',
  'pickupStatus',
  'customerPrice',
  'technician',
  'pickedUpAt',
  'paymentStatus',
  'note',
];

// The three states the shop actually writes, with their ticks.
const REPAIR_STATUS_TEXT = {
  RECEIVED: 'ပြင်ရန် ⏳',
  CHECKING: 'ပြင်ရန် ⏳',
  IN_PROGRESS: 'ပြင်ရန် ⏳',
  WAITING_PART: 'ပြင်ရန် ⏳',
  COMPLETED: 'ပြင်ပြီး ✅',
  DELIVERED: 'ပြင်ပြီး ✅',
  CANNOT_REPAIR: 'ပြင်မရ ❌',
};

const PAYMENT_STATUS_TEXT = {
  PAID: 'ရှင်းပြီး',
  PARTIAL: 'တစ်ဝက်',
  PENDING: '',
};

function ddmmyyyy(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`;
}

function hhmm(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${ddmmyyyy(date)} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// The sheet records 0481, the POS issues MS0481. Keep the sheet's form so old
// and new rows sort and search together.
function voucherNumber(repairNumber) {
  const raw = String(repairNumber || '').trim();
  const digits = raw.replace(/^[A-Za-z]+/, '');
  return digits || raw;
}

function amount(value) {
  const number = Number(value || 0);
  return number > 0 ? String(Math.round(number)) : '';
}

function repairSheetRow(repair) {
  // The sheet tracks collection in its own column, so a phone that could not be
  // repaired can still be marked picked up. It follows the collection time, not
  // the repair state.
  const delivered = Boolean(repair.deliveredAt);
  const values = {
    date: ddmmyyyy(repair.receivedAt),
    voucherNo: voucherNumber(repair.repairNumber),
    customerName: String(repair.customerName || '').trim(),
    phoneModel: [repair.deviceBrand, repair.deviceModel].filter(Boolean).join(' ').trim(),
    repairPart: String(repair.problem || '').trim(),
    repairStatus: REPAIR_STATUS_TEXT[String(repair.status || '')] || '',
    // The shop uses this column for what the repair cost them, and prices the
    // customer separately. finalCost is the customer figure, so it goes there.
    cost: '',
    pickupStatus: delivered ? '' : 'မယူရသေး ⏳',
    customerPrice: amount(repair.finalCost || repair.estimatedCost),
    technician: String(repair.technicianName || repair.technicianUsername || '').trim(),
    pickedUpAt: delivered ? hhmm(repair.deliveredAt) : '',
    paymentStatus: PAYMENT_STATUS_TEXT[String(repair.paymentStatus || '')] || '',
    note: String(repair.notes || '').trim(),
  };
  return {
    // Keyed so a reprint or a status change updates the row it already wrote
    // instead of appending a second one.
    key: values.voucherNo,
    columns: SHEET_COLUMNS,
    values,
    row: SHEET_COLUMNS.map((name) => values[name]),
  };
}

module.exports = { repairSheetRow, voucherNumber, SHEET_COLUMNS, REPAIR_STATUS_TEXT };
