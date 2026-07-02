const SPREADSHEET_ID = '';
const TIMEZONE = 'Asia/Yangon';

const SALE_HEADERS = [
  'Date/Time',
  'Invoice',
  'Customer Name',
  'Customer Phone',
  'Items',
  'Qty',
  'Total',
  'Paid',
  'Balance',
  'Profit',
  'Payment Method',
  'Cashier / Staff',
  'Status',
  'Shop',
  'Sync ID',
  'Synced At'
];

const REPAIR_HEADERS = [
  'Date/Time',
  'Repair ID/Voucher',
  'Customer Name',
  'Phone',
  'Phone Model',
  'ပြင်ဆင်မှုအပိုင်း',
  'ကုန်ကျစရိတ်',
  'Customer ဈေး',
  'Deposit',
  'Balance',
  'အမြတ်',
  'Status',
  'ယူပြီး ခြေနေ',
  'Payment Status',
  'Technician / Staff',
  'Shop',
  'Sync ID',
  'Synced At'
];

const TEST_HEADERS = ['Date/Time', 'Message', 'Shop', 'Sync ID', 'Synced At'];
const GENERIC_HEADERS = ['Date/Time', 'Dataset', 'Action', 'Shop', 'Entity ID', 'Payload', 'Sync ID', 'Synced At'];

function doGet() {
  return json_({ ok: true, message: 'Mahar POS Google Sheet Webhook is running' });
}

function doPost(e) {
  try {
    const body = parseBody_(e);
    const dataset = normalizeDataset_(body.dataset || body.eventType || body.tab || 'generic');
    const payload = getPayload_(body);
    const now = new Date();

    if (dataset === 'test') {
      const sheet = monthlySheet_('Test', body.createdAt || now);
      ensureHeaders_(sheet, TEST_HEADERS);
      const row = [
        formatDateTime_(body.createdAt || now),
        value_(payload.message || payload.response?.message || body.data?.message || 'Mahar POS Google Sheet connection test'),
        value_(body.shopName || body.shopSlug || ''),
        value_(body.syncId || body.eventId || ''),
        formatDateTime_(now)
      ];
      sheet.appendRow(row);
      return json_({ ok: true, dataset: 'test', syncId: body.syncId || body.eventId || '', sheet: sheet.getName() });
    }

    if (dataset === 'sale') {
      const sale = extractSale_(body, payload);
      const sheet = monthlySheet_('Sale', body.createdAt || sale.dateTime || now);
      ensureHeaders_(sheet, SALE_HEADERS);
      const row = buildSaleRow_(body, sale, now);
      const result = upsertByKey_(sheet, row, ['Invoice', 'invoice', 'invoiceNumber'], sale.invoiceNumber);
      return json_({ ok: true, dataset: 'sale', mode: result.mode, row: result.row || null, key: sale.invoiceNumber || '', syncId: body.syncId || body.eventId || '', sheet: sheet.getName() });
    }

    if (dataset === 'repair') {
      const repair = extractRepair_(body, payload);
      const sheet = monthlySheet_('Repair', body.createdAt || repair.createdAt || now);
      ensureHeaders_(sheet, REPAIR_HEADERS);
      const row = buildRepairRow_(body, repair, now);
      const repairKey = repair.repairNumber || repair.voucherNo || repair.repairNo || '';
      const result = upsertByKey_(sheet, row, ['Repair ID/Voucher', 'Repair ID', 'Voucher', 'Voucher No', 'repairNumber', 'voucherNo'], repairKey);
      return json_({ ok: true, dataset: 'repair', mode: result.mode, row: result.row || null, key: repairKey, syncId: body.syncId || body.eventId || '', sheet: sheet.getName() });
    }

    const sheet = monthlySheet_(tabNameForDataset_(dataset), body.createdAt || now);
    ensureHeaders_(sheet, GENERIC_HEADERS);
    sheet.appendRow([
      formatDateTime_(body.createdAt || now),
      dataset,
      value_(body.action || ''),
      value_(body.shopName || body.shopSlug || ''),
      value_(body.entityId || ''),
      safeJson_(payload),
      value_(body.syncId || body.eventId || ''),
      formatDateTime_(now)
    ]);

    return json_({ ok: true, dataset, syncId: body.syncId || body.eventId || '', sheet: sheet.getName() });
  } catch (err) {
    return json_({ ok: false, message: err && err.message ? err.message : String(err) }, 500);
  }
}

function parseBody_(e) {
  const text = e?.postData?.contents || '{}';
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error('Invalid JSON body');
  }
}

function getPayload_(body) {
  if (body && body.payload && typeof body.payload === 'object') return body.payload;
  if (body && body.data && typeof body.data === 'object') return body.data;
  return body || {};
}

function normalizeDataset_(value) {
  const text = String(value || '').trim().toLowerCase().replaceAll('_', '-').replaceAll(' ', '-');
  if (text.includes('test')) return 'test';
  if (text.includes('repair')) return 'repair';
  if (text.includes('sale')) return 'sale';
  if (text.includes('income') || text.includes('expense')) return 'income-expense';
  if (text.includes('stock') || text.includes('product')) return 'product-stock';
  if (text.includes('money') || text.includes('remittance')) return 'money-service';
  if (text.includes('debt') || text.includes('credit')) return 'debt';
  return text || 'generic';
}

function tabNameForDataset_(dataset) {
  const map = {
    'income-expense': 'IncomeExpense',
    'product-stock': 'ProductStock',
    'money-service': 'MoneyService',
    'debt': 'Debt'
  };
  return map[dataset] || 'Generic';
}

function getSpreadsheet_() {
  if (SPREADSHEET_ID && SPREADSHEET_ID.trim()) return SpreadsheetApp.openById(SPREADSHEET_ID.trim());
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('Spreadsheet not found. Set SPREADSHEET_ID or bind script to Google Sheet.');
  return ss;
}

function monthlySheet_(tab, dateValue) {
  const ss = getSpreadsheet_();
  const date = toDate_(dateValue);
  const year = Utilities.formatDate(date, TIMEZONE, 'yyyy');
  const month = Utilities.formatDate(date, TIMEZONE, 'MMMM');
  const name = `${year}-${month}_${tab}`;
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  return sheet;
}

function ensureHeaders_(sheet, headers) {
  const lastColumn = Math.max(sheet.getLastColumn(), headers.length);
  const existing = sheet.getRange(1, 1, 1, lastColumn).getValues()[0];
  const hasAnyHeader = existing.some(v => String(v || '').trim() !== '');

  if (!hasAnyHeader) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
    return;
  }

  const current = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), headers.length)).getValues()[0];
  const lower = current.map(h => String(h || '').trim().toLowerCase());
  headers.forEach(header => {
    const exists = lower.includes(String(header).trim().toLowerCase());
    if (!exists) sheet.getRange(1, sheet.getLastColumn() + 1).setValue(header);
  });
  sheet.setFrozenRows(1);
}

function headerIndex_(headers, names) {
  const lower = headers.map(h => String(h || '').trim().toLowerCase());
  for (const name of names) {
    const idx = lower.indexOf(String(name || '').trim().toLowerCase());
    if (idx >= 0) return idx;
  }
  return -1;
}

function upsertByKey_(sheet, rowValues, keyHeaderNames, keyValue) {
  const key = String(keyValue || '').trim();
  if (!key) {
    sheet.appendRow(rowValues);
    return { mode: 'append_no_key', row: sheet.getLastRow() };
  }

  const lastRow = sheet.getLastRow();
  const lastCol = Math.max(sheet.getLastColumn(), rowValues.length);
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const keyColIndex = headerIndex_(headers, keyHeaderNames);

  if (keyColIndex < 0) {
    sheet.appendRow(rowValues);
    return { mode: 'append_no_key_column', row: sheet.getLastRow() };
  }

  if (lastRow >= 2) {
    const values = sheet.getRange(2, keyColIndex + 1, lastRow - 1, 1).getValues();
    for (let i = 0; i < values.length; i++) {
      const current = String(values[i][0] || '').trim();
      if (current === key) {
        const targetRow = i + 2;
        sheet.getRange(targetRow, 1, 1, rowValues.length).setValues([rowValues]);
        return { mode: 'update', row: targetRow };
      }
    }
  }

  sheet.appendRow(rowValues);
  return { mode: 'append_new', row: sheet.getLastRow() };
}

function extractSale_(body, payload) {
  const response = payload.response || body.response || {};
  const sale = response.sale || payload.sale || body.sale || payload || {};
  const items = Array.isArray(sale.items) ? sale.items : [];
  const qty = number_(sale.quantity, items.reduce((sum, item) => sum + number_(item.quantity), 0));
  const total = number_(sale.total, number_(sale.amount));
  const paid = number_(sale.paidAmount, total);
  const balance = number_(sale.balance, Math.max(0, total - paid));
  const profit = number_(sale.profitTotal, number_(sale.profit));

  return {
    dateTime: sale.dateTime || sale.soldAt || sale.createdAt || body.createdAt,
    invoiceNumber: value_(sale.invoiceNumber || sale.invoice || body.entityId),
    customerName: value_(sale.customerName || sale.customer || 'Walk-in Customer'),
    customerPhone: value_(sale.customerPhone || ''),
    itemsText: formatSaleItems_(items, sale.items),
    quantity: qty,
    total,
    paidAmount: paid,
    balance,
    profit,
    paymentMethod: value_(sale.paymentMethod || sale.payment || ''),
    staffName: value_(sale.staffName || sale.staffUsername || sale.cashier || ''),
    status: value_(sale.status || '')
  };
}

function buildSaleRow_(body, sale, now) {
  return [
    formatDateTime_(sale.dateTime || body.createdAt || now),
    sale.invoiceNumber,
    sale.customerName,
    sale.customerPhone,
    sale.itemsText,
    sale.quantity,
    sale.total,
    sale.paidAmount,
    sale.balance,
    sale.profit,
    sale.paymentMethod,
    sale.staffName,
    sale.status,
    value_(body.shopName || body.shopSlug || ''),
    value_(body.syncId || body.eventId || ''),
    formatDateTime_(now)
  ];
}

function formatSaleItems_(items, rawItems) {
  if (typeof rawItems === 'string') return rawItems;
  if (!Array.isArray(items)) return '';
  return items.map(item => {
    const name = [item.productName, item.variantName].filter(Boolean).join(' - ');
    const qty = number_(item.quantity);
    const price = number_(item.unitPrice);
    return `${name || 'Item'} x${qty}${price ? ` @${price}` : ''}`;
  }).join('; ');
}

function extractRepair_(body, payload) {
  const response = payload.response || body.response || {};
  const repair = response.repair || payload.repair || body.repair || payload || {};
  const repairNo = value_(repair.repairNumber || repair.voucherNo || repair.repairNo || '');
  const phoneModel = value_(repair.phoneModel || [repair.deviceBrand, repair.deviceModel].filter(Boolean).join(' ') || repair.model || '');
  const repairCost = firstNumber_([repair.repairCost, repair.cost, repair.estimatedCost]);
  const customerPrice = firstNumber_([repair.customerPrice, repair.price, repair.finalCost]);
  const deposit = firstNumber_([repair.deposit, 0]);
  const balance = firstNumber_([repair.balanceDue, Math.max(0, customerPrice - deposit)]);
  const profit = firstNumber_([repair.profit, customerPrice - repairCost]);
  const statusText = String(repair.status || '').toUpperCase();
  const deliveryStatus = value_(repair.deliveryStatus === 'DELIVERED' ? 'ယူပြီး' : repair.deliveryStatus === 'PENDING_PICKUP' ? 'မယူရသေး' : repair.deliveryStatus || repair.pickupStatus || (statusText === 'DELIVERED' ? 'ယူပြီး' : 'မယူရသေး'));

  return {
    createdAt: repair.createdAt || repair.receivedAt || body.createdAt,
    repairNumber: repairNo,
    voucherNo: repairNo,
    repairNo,
    customerName: value_(repair.customerName || ''),
    customerPhone: value_(repair.customerPhone || repair.phone || ''),
    phoneModel,
    repairPart: value_(repair.repairPart || repair.issue || repair.problem || ''),
    repairCost,
    customerPrice,
    deposit,
    balance,
    profit,
    status: value_(repair.status || ''),
    deliveryStatus,
    paymentStatus: value_(repair.paymentStatus || ''),
    technicianName: value_(repair.technicianName || repair.technicianUsername || '')
  };
}

function buildRepairRow_(body, repair, now) {
  return [
    formatDateTime_(repair.createdAt || body.createdAt || now),
    repair.repairNumber,
    repair.customerName,
    repair.customerPhone,
    repair.phoneModel,
    repair.repairPart,
    repair.repairCost,
    repair.customerPrice,
    repair.deposit,
    repair.balance,
    repair.profit,
    repair.status,
    repair.deliveryStatus,
    repair.paymentStatus,
    repair.technicianName,
    value_(body.shopName || body.shopSlug || ''),
    value_(body.syncId || body.eventId || ''),
    formatDateTime_(now)
  ];
}

function firstNumber_(values) {
  for (const value of values) {
    if (value === null || value === undefined || value === '') continue;
    const n = number_(value);
    if (!isNaN(n)) return n;
  }
  return 0;
}

function number_(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback === undefined ? 0 : fallback;
  if (typeof value === 'number') return isNaN(value) ? (fallback || 0) : value;
  if (typeof value === 'object') {
    if (typeof value.toString === 'function' && value.toString() !== '[object Object]') {
      const parsed = Number(value.toString());
      return isNaN(parsed) ? (fallback || 0) : parsed;
    }
    return fallback === undefined ? 0 : fallback;
  }
  const parsed = Number(String(value).replace(/,/g, '').trim());
  return isNaN(parsed) ? (fallback || 0) : parsed;
}

function value_(value) {
  if (value === null || value === undefined) return '';
  return String(value);
}

function toDate_(value) {
  if (value instanceof Date) return value;
  if (!value) return new Date();
  const d = new Date(value);
  return !isNaN(d.getTime()) ? d : new Date();
}

function formatDateTime_(value) {
  return Utilities.formatDate(toDate_(value), TIMEZONE, 'dd/MM/yyyy HH:mm:ss');
}

function safeJson_(value) {
  try {
    return JSON.stringify(value || {});
  } catch (err) {
    return String(value || '');
  }
}

function json_(obj, statusCode) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
