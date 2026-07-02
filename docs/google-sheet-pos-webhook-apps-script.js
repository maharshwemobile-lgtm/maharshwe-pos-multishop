function doPost(e) {
  const body = JSON.parse((e && e.postData && e.postData.contents) || "{}");
  const dataset = normalizeDataset(body.dataset || body.eventType || "test");
  const now = new Date();
  const syncId = String(body.syncId || body.eventId || Utilities.getUuid());
  const sheet = ensureSheet(now, dataset);
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  if (isDuplicate(sheet, headers, syncId)) {
    return json({ ok: true, duplicate: true, syncId: syncId });
  }
  sheet.appendRow(makeRow(dataset, body, headers, syncId));
  updateSummary(now);
  return json({ ok: true, dataset: dataset, syncId: syncId, sheet: sheet.getName() });
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const SCHEMAS = {
  repair: ["Date", "Repair ID/Voucher", "Owner Name", "Phone", "Phone Model", "Repair Part", "Repair Status", "Cost", "Collect Status", "Customer Price", "Profit", "Technician", "Collected At", "Payment Status", "Payment Method", "Note", "Sync ID", "Synced At"],
  sale: ["Date", "Voucher No", "Customer Name", "Phone", "Items", "Total Amount", "Paid Amount", "Balance", "Profit", "Payment Method", "Cashier", "Sale Status", "Note", "Sync ID", "Synced At"],
  "income-expense": ["Date", "Type", "Category", "Account", "Amount", "Payment Method", "Related Voucher", "Staff", "Note", "Sync ID", "Synced At"],
  "product-stock": ["Date", "Product ID", "Product Name", "Category", "SKU / Barcode", "Stock In", "Stock Out", "Current Stock", "Cost Price", "Sale Price", "Stock Value", "Low Stock Alert", "Note", "Sync ID", "Synced At"],
  "money-service": ["Date", "Transaction ID", "Service Type", "Customer Name", "Phone", "From Account", "To Account", "Amount", "Fee", "Total Receive", "Total Pay", "Profit", "Status", "Staff", "Note", "Sync ID", "Synced At"],
  debt: ["Date", "Debt ID", "Customer Name", "Phone", "Related Voucher", "Type", "Original Amount", "Paid Amount", "Balance", "Due Date", "Debt Status", "Last Paid Date", "Staff", "Note", "Sync ID", "Synced At"],
  test: ["Date", "Tenant ID", "Shop Name", "Message", "Sync ID", "Synced At"]
};
const SUFFIX = { repair: "Repair", sale: "Sale", "income-expense": "IncomeExpense", "product-stock": "ProductStock", "money-service": "MoneyService", debt: "Debt", test: "Test" };

function normalizeDataset(v) {
  const s = String(v || "").toLowerCase().replace(/_/g, "-");
  if (s.includes("repair")) return "repair";
  if (s.includes("sale")) return "sale";
  if (s.includes("income") || s.includes("expense")) return "income-expense";
  if (s.includes("stock") || s.includes("product")) return "product-stock";
  if (s.includes("money") || s.includes("remittance")) return "money-service";
  if (s.includes("debt") || s.includes("credit")) return "debt";
  return "test";
}

function monthName(date) { return date.getFullYear() + "-" + MONTHS[date.getMonth()]; }
function ensureSheet(date, dataset) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const name = monthName(date) + "_" + (SUFFIX[dataset] || "Test");
  let sheet = ss.getSheetByName(name) || ss.insertSheet(name);
  const headers = SCHEMAS[dataset] || SCHEMAS.test;
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(headers);
    sheet.setFrozenRows(1);
  }
  return sheet;
}
function isDuplicate(sheet, headers, syncId) {
  const col = headers.indexOf("Sync ID") + 1;
  if (col < 1 || sheet.getLastRow() < 2) return false;
  return sheet.getRange(2, col, sheet.getLastRow() - 1, 1).getValues().flat().map(String).includes(String(syncId));
}
function payload(body) { return body.data || body.payload || {}; }
function req(body) { return payload(body).request || {}; }
function res(body) { return payload(body).response || {}; }
function pick(obj, paths, fallback) {
  for (const p of paths) {
    let cur = obj;
    for (const key of p.split(".")) cur = cur && cur[key];
    if (cur !== undefined && cur !== null && cur !== "") return cur;
  }
  return fallback || "";
}
function makeRow(dataset, body, headers, syncId) {
  const all = { body: body, req: req(body), res: res(body), data: payload(body) };
  const d = parseDate(body.createdAt);
  const synced = new Date();
  if (dataset === "test") return [d, body.tenantId || "", body.shopName || "", pick(all, ["data.message"], "Connected"), syncId, synced];
  const row = headers.map(function (h) {
    if (h === "Date") return d;
    if (h === "Sync ID") return syncId;
    if (h === "Synced At") return synced;
    if (h === "Tenant ID") return body.tenantId || "";
    if (h === "Shop Name") return body.shopName || "";
    return pick(all, ["res." + camel(h), "req." + camel(h), "data." + camel(h), "res." + h, "req." + h], "");
  });
  return row;
}
function camel(label) { return String(label).replace(/[^a-zA-Z0-9 ]/g, " ").trim().split(/\s+/).map(function (w, i) { w = w.toLowerCase(); return i ? w.charAt(0).toUpperCase() + w.slice(1) : w; }).join(""); }
function updateSummary(date) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const prefix = monthName(date);
  const sheet = ss.getSheetByName(prefix + "_Summary") || ss.insertSheet(prefix + "_Summary");
  sheet.clear();
  sheet.getRange(1, 1, 8, 2).setValues([
    ["Month", prefix],
    ["Total Sale Amount", "=IFERROR(SUM('" + prefix + "_Sale'!F:F),0)"],
    ["Total Sale Profit", "=IFERROR(SUM('" + prefix + "_Sale'!I:I),0)"],
    ["Total Repair Income", "=IFERROR(SUM('" + prefix + "_Repair'!J:J),0)"],
    ["Total Repair Profit", "=IFERROR(SUM('" + prefix + "_Repair'!K:K),0)"],
    ["Money Service Profit", "=IFERROR(SUM('" + prefix + "_MoneyService'!L:L),0)"],
    ["Debt Balance", "=IFERROR(SUM('" + prefix + "_Debt'!I:I),0)"],
    ["Last Updated", new Date()]
  ]);
}
function parseDate(v) { const d = v ? new Date(v) : new Date(); return isNaN(d.getTime()) ? new Date() : d; }
function json(data) { return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON); }
