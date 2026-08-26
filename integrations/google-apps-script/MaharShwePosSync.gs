const POS_CONFIG = {
  BASE_URL: '__POS_BASE_URL__',
  SHOP_SLUG: '__POS_SHOP_SLUG__',
  SYNC_SECRET: '__POS_SYNC_SECRET__',
  // Voucher prefix for this shop — MS0978 and so on. The tab is named for the
  // branch, not the prefix, so this cannot be read off the sheet.
  REPAIR_PREFIX: '__POS_REPAIR_PREFIX__',
};

// Bump this whenever the script's behaviour changes. doGet reports it, and it
// is the only way to tell a workbook running current code from one still on a
// version pasted weeks ago — the failures otherwise look identical.
const SCRIPT_VERSION = 'repair-sync-2';

const POS_DATASETS = [
  ['remittances', 'Remittances'],
  ['sale-history', 'Sale History'],
  ['other-income', 'Other Income'],
  ['service-income', 'Service Income'],
  ['expense', 'Expense'],
  ['stock', 'STOCK'],
  ['user-audit', 'User audit'],
];

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('MaharShwe POS')
    .addItem('Setup Tabs', 'setupMaharShwePosSync')
    .addItem('Sync All Now', 'syncAllTabs')
    .addItem('Install 5-Min Backup Sync', 'installBackupSyncTrigger')
    .addToUi();
}

// A wrong POS_SYNC_SECRET looks exactly like every other failure from outside:
// "Invalid secret", with no way to tell a typo from an unset property from the
// wrong project answering. This reports a hash of the secret, never the secret,
// so the POS can say whether the two match.
function secretFingerprint() {
  const value = PropertiesService.getScriptProperties().getProperty('POS_SYNC_SECRET');
  if (!value) return '';
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, value, Utilities.Charset.UTF_8);
  return bytes.slice(0, 4).map(function (b) {
    return ('0' + (b & 0xFF).toString(16)).slice(-2);
  }).join('');
}

function doGet(e) {
  return jsonResponse({
    ok: true,
    service: 'MaharShwe POS Google Sheet Sync',
    version: SCRIPT_VERSION,
    tabs: POS_DATASETS.map(function (item) { return item[1]; }),
    repairSync: true,
    secretConfigured: Boolean(secretFingerprint()),
    secretFingerprint: secretFingerprint(),
    time: new Date().toISOString(),
  });
}

function doPost(e) {
  try {
    const payload = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const secret = getRequiredProperty('POS_SYNC_SECRET');
    if (String(payload.secret || '') !== secret) {
      return jsonResponse({ ok: false, message: 'Invalid secret' });
    }
    // The repair book is the shop's own tab with the shop's own columns, so it
    // is written by voucher number rather than through the generic tab sync.
    if (String(payload.dataset || '') === 'repair-voucher') {
      const repairRow = payload.payload || {};
      if (repairRow.deleted === true) {
        return jsonResponse(deleteRepairRow(repairRow, payload.tab));
      }
      return jsonResponse(writeRepairRow(repairRow, payload.tab));
    }
    const tabName = String(payload.tab || '').trim();
    if (!POS_DATASETS.some(function (item) { return item[1] === tabName; })) {
      return jsonResponse({ ok: false, message: 'Unsupported tab' });
    }
    const row = liveEventRow(payload);
    upsertRow(tabName, 'Event ID', row);
    return jsonResponse({ ok: true, tab: tabName, eventId: payload.eventId });
  } catch (error) {
    return jsonResponse({ ok: false, message: error.message || String(error) });
  }
}

function setupMaharShwePosSync() {
  POS_DATASETS.forEach(function (item) {
    ensureSheet(item[1]);
  });
  return 'Tabs ready';
}

function installBackupSyncTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (trigger.getHandlerFunction() === 'syncAllTabs') ScriptApp.deleteTrigger(trigger);
  });
  ScriptApp.newTrigger('syncAllTabs').timeBased().everyMinutes(5).create();
  return '5-minute backup sync installed';
}

function syncAllTabs() {
  POS_DATASETS.forEach(function (item) {
    syncDataset(item[0], item[1]);
  });
  return 'All tabs synced';
}

function syncDataset(dataset, tabName) {
  const baseUrl = getRequiredProperty('POS_BASE_URL').replace(/\/$/, '');
  const shopSlug = getRequiredProperty('POS_SHOP_SLUG');
  const secret = getRequiredProperty('POS_SYNC_SECRET');
  const properties = PropertiesService.getScriptProperties();
  const sinceKey = 'LAST_SYNC_' + dataset.toUpperCase().replace(/-/g, '_');
  const since = properties.getProperty(sinceKey) || '2000-01-01T00:00:00.000Z';
  const checkpoint = new Date().toISOString();
  const path = '/api/project-settings/integrations/google-sheet/export/' + encodeURIComponent(dataset);
  const url = baseUrl + path
    + '?shopSlug=' + encodeURIComponent(shopSlug)
    + '&since=' + encodeURIComponent(since)
    + '&limit=10000';
  const response = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: { 'x-google-sheet-secret': secret },
    muteHttpExceptions: true,
  });
  const body = JSON.parse(response.getContentText() || '{}');
  if (response.getResponseCode() >= 300 || !body.ok) {
    throw new Error(body.message || ('Sync failed: ' + response.getResponseCode()));
  }
  const rows = body.rows || [];
  rows.forEach(function (record) {
    upsertObjectRow(tabName, record);
  });
  properties.setProperty(sinceKey, checkpoint);
  return rows.length;
}

function liveEventRow(event) {
  const flat = flattenObject(event.payload || {});
  return Object.assign({
    'Event ID': String(event.eventId || ''),
    'Synced At': new Date(),
    'Created At': event.createdAt || '',
    'Action': event.action || '',
    'Entity ID': event.entityId || '',
    'Shop Slug': event.shopSlug || '',
    'Shop Name': event.shopName || '',
  }, flat, {
    'Payload JSON': JSON.stringify(event.payload || {}),
  });
}

function flattenObject(value, prefix, result) {
  const output = result || {};
  const base = prefix || '';
  if (value === null || value === undefined) return output;
  Object.keys(value).forEach(function (key) {
    const nextKey = base ? base + ' / ' + key : key;
    const item = value[key];
    if (item && typeof item === 'object' && !Array.isArray(item) && Object.keys(item).length <= 30) {
      flattenObject(item, nextKey, output);
    } else {
      output[nextKey] = Array.isArray(item) || (item && typeof item === 'object') ? JSON.stringify(item) : item;
    }
  });
  return output;
}

function upsertObjectRow(tabName, record) {
  const row = flattenObject(record || {});
  const key = row.id || row.ID || row.transactionNumber || row.invoiceNumber || Utilities.getUuid();
  row['Record ID'] = String(key);
  row['Last Synced At'] = new Date();
  upsertRow(tabName, 'Record ID', row);
}

function upsertRow(tabName, keyHeader, objectRow) {
  const sheet = ensureSheet(tabName);
  const headers = ensureHeaders(sheet, Object.keys(objectRow));
  const keyColumn = headers.indexOf(keyHeader) + 1;
  const keyValue = String(objectRow[keyHeader] || '');
  let targetRow = sheet.getLastRow() + 1;
  if (keyValue && keyColumn > 0 && sheet.getLastRow() > 1) {
    const values = sheet.getRange(2, keyColumn, sheet.getLastRow() - 1, 1).getDisplayValues();
    for (let index = 0; index < values.length; index += 1) {
      if (String(values[index][0]) === keyValue) {
        targetRow = index + 2;
        break;
      }
    }
  }
  const values = headers.map(function (header) {
    const value = objectRow[header];
    if (value instanceof Date) return value;
    if (value === null || value === undefined) return '';
    if (typeof value === 'object') return JSON.stringify(value);
    return value;
  });
  sheet.getRange(targetRow, 1, 1, headers.length).setValues([values]);
}

function ensureSheet(name) {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  return spreadsheet.getSheetByName(name) || spreadsheet.insertSheet(name);
}

function ensureHeaders(sheet, incomingHeaders) {
  const lastColumn = Math.max(1, sheet.getLastColumn());
  let headers = sheet.getLastRow() ? sheet.getRange(1, 1, 1, lastColumn).getDisplayValues()[0].filter(String) : [];
  incomingHeaders.forEach(function (header) {
    if (headers.indexOf(header) < 0) headers.push(header);
  });
  if (!headers.length) headers = incomingHeaders.slice();
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.setFrozenRows(1);
  return headers;
}

function getRequiredProperty(name) {
  // Script Properties always win — update POS_SYNC_SECRET here without re-deploying the script
  var fromProps = PropertiesService.getScriptProperties().getProperty(name);
  if (fromProps) return fromProps;
  // Fall back to values embedded at deploy time (POS Integrations page → Copy Apps Script Code)
  var configMap = {
    POS_BASE_URL: POS_CONFIG.BASE_URL,
    POS_SHOP_SLUG: POS_CONFIG.SHOP_SLUG,
    POS_SYNC_SECRET: POS_CONFIG.SYNC_SECRET,
  };
  var configured = configMap[name];
  if (configured && configured.indexOf('__') !== 0) return configured;
  throw new Error(name + ' is not configured. Open Apps Script → Project Settings → Script Properties and add ' + name);
}

function jsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}


/**
 * Google Sheet -> Mahar POS repair status sync.
 * When Repair Records status cell is changed to "ပြင်ပြီး" / Completed,
 * Mahar POS repair status will be updated automatically.
 */
function handleRepairStatusEdit_(e) {
  if (!e || !e.range) return;
  var sheet = e.range.getSheet();
  var sheetName = sheet.getName();
  var allowed = ['Repair Records', 'ဖုန်းပြင်စနစ်', 'Repair'];
  if (allowed.indexOf(sheetName) === -1) return;
  if (e.range.getRow() <= 1) return;

  var lastColumn = sheet.getLastColumn();
  if (lastColumn < 1) return;
  var headers = sheet.getRange(1, 1, 1, lastColumn).getValues()[0].map(function (x) {
    return String(x || '').trim();
  });

  var statusCol = findRepairHeader_(headers, ['status', 'repairStatus', 'repair_status', 'Status', 'အခြေအနေ', 'ပြင်ဆင်မှုအခြေအနေ']);
  var idCol = findRepairHeader_(headers, ['repairNumber', 'repair_number', 'Repair Number', 'Repair ID', 'repairId', 'id', 'Ticket No.', 'Voucher']);
  if (!statusCol || !idCol) return;
  if (e.range.getColumn() !== statusCol) return;

  var rawStatus = String(e.value || e.range.getValue() || '').trim();
  var status = normalizeRepairStatusForPos_(rawStatus);
  if (!status) return;

  var repairId = String(sheet.getRange(e.range.getRow(), idCol).getValue() || '').trim();
  if (!repairId) return;

  postRepairStatusToPos_(repairId, status, rawStatus);
}

function findRepairHeader_(headers, names) {
  var lower = headers.map(function (x) { return String(x || '').trim().toLowerCase(); });
  for (var i = 0; i < names.length; i++) {
    var idx = lower.indexOf(String(names[i]).toLowerCase());
    if (idx !== -1) return idx + 1;
  }
  return 0;
}

function normalizeRepairStatusForPos_(value) {
  var text = String(value || '').trim().toLowerCase();
  if (!text) return '';
  if (text.indexOf('ပြင်ပြီး') !== -1 || text.indexOf('completed') !== -1 || text.indexOf('complete') !== -1 || text.indexOf('done') !== -1 || text.indexOf('finished') !== -1) return 'COMPLETED';
  if (text.indexOf('ယူပြီး') !== -1 || text.indexOf('delivered') !== -1 || text.indexOf('collected') !== -1 || text.indexOf('picked') !== -1) return 'DELIVERED';
  if (text.indexOf('ပြင်မရ') !== -1 || text.indexOf('cannot') !== -1) return 'CANNOT_REPAIR';
  if (text.indexOf('ပစ္စည်း') !== -1 || text.indexOf('waiting') !== -1 || text.indexOf('part') !== -1) return 'WAITING_PART';
  if (text.indexOf('ပြင်နေ') !== -1 || text.indexOf('progress') !== -1) return 'IN_PROGRESS';
  if (text.indexOf('စစ်') !== -1 || text.indexOf('checking') !== -1) return 'CHECKING';
  if (text.indexOf('လက်ခံ') !== -1 || text.indexOf('pending') !== -1 || text.indexOf('received') !== -1) return 'RECEIVED';
  var upper = String(value || '').trim().toUpperCase().replace(/ /g, '_');
  return ['RECEIVED', 'CHECKING', 'IN_PROGRESS', 'WAITING_PART', 'COMPLETED', 'CANNOT_REPAIR', 'DELIVERED'].indexOf(upper) !== -1 ? upper : '';
}

function postRepairStatusToPos_(repairId, status, rawStatus) {
  var baseUrl = String(getRequiredProperty('POS_BASE_URL') || '').replace(/\/$/, '');
  var shopSlug = String(getRequiredProperty('POS_SHOP_SLUG') || '').trim();
  var secret = String(getRequiredProperty('POS_SYNC_SECRET') || '').trim();

  var response = UrlFetchApp.fetch(baseUrl + '/api/project-settings/integrations/google-sheet/repair-status', {
    method: 'post',
    contentType: 'application/json',
    muteHttpExceptions: true,
    payload: JSON.stringify({
      secret: secret,
      shopSlug: shopSlug,
      repairId: repairId,
      status: status,
      rawStatus: rawStatus,
      source: 'GOOGLE_SHEET_ON_EDIT'
    })
  });

  var code = response.getResponseCode();
  if (code < 200 || code >= 300) {
    throw new Error('Mahar POS repair status sync failed: HTTP ' + code + ' ' + response.getContentText());
  }
}

function onEdit(e) {
  try { handleRepairStatusEdit_(e); } catch (err) { Logger.log(err); }
}

// ---------------------------------------------------------------------------
// Repair book
//
// One row per voucher in the shop's existing tab. Two rules matter here:
// the row is found by voucher number so a reprint updates instead of piling
// up, and a blank coming from the POS never wipes a cell somebody typed in by
// hand — the shop fills in cost and remarks themselves.
// ---------------------------------------------------------------------------

const REPAIR_HEADER_ROWS = 1;
const REPAIR_KEY_COLUMN = 2;   // column B, Repair ID/Voucher

// Both writing and deleting start by finding the voucher's row, and the two
// must agree on what counts as a match.
function findRepairRow(sheet, key) {
  const lastRow = sheet.getLastRow();
  if (lastRow <= REPAIR_HEADER_ROWS) return 0;
  const keys = sheet
    .getRange(REPAIR_HEADER_ROWS + 1, REPAIR_KEY_COLUMN, lastRow - REPAIR_HEADER_ROWS, 1)
    .getDisplayValues();
  for (let i = 0; i < keys.length; i += 1) {
    if (String(keys[i][0]).trim() === key) return REPAIR_HEADER_ROWS + 1 + i;
  }
  return 0;
}

// Deleting removes the whole line so the rows below close up, rather than
// leaving a blank gap in the middle of the book.
function deleteRepairRow(payload, fallbackTab) {
  const tabName = String(payload.sheetTab || fallbackTab || '').trim();
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(tabName);
  if (!sheet) return { ok: false, message: 'No tab named ' + tabName };

  const key = String(payload.key || '').trim();
  if (!key) return { ok: false, message: 'Row has no voucher number' };

  const target = findRepairRow(sheet, key);
  // Already gone is the outcome that was asked for, so it is not a failure —
  // otherwise the row would be retried until it gave up.
  if (!target) return { ok: true, tab: tabName, deleted: 0, voucher: key };

  sheet.deleteRow(target);
  return { ok: true, tab: tabName, deleted: target, voucher: key };
}

function writeRepairRow(payload, fallbackTab) {
  const tabName = String(payload.sheetTab || fallbackTab || '').trim();
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(tabName);
  if (!sheet) return { ok: false, message: 'No tab named ' + tabName };

  const values = payload.row || [];
  const key = String(payload.key || '').trim();
  if (!key || !values.length) return { ok: false, message: 'Row has no voucher number' };

  const lastRow = sheet.getLastRow();
  const target = findRepairRow(sheet, key);

  if (target) {
    const existing = sheet.getRange(target, 1, 1, values.length).getValues()[0];
    const merged = values.map(function (value, i) { return value === '' ? existing[i] : value; });
    sheet.getRange(target, 1, 1, merged.length).setValues([merged]);
    return { ok: true, tab: tabName, updated: target, voucher: key };
  }

  sheet.getRange(lastRow + 1, 1, 1, values.length).setValues([values]);
  return { ok: true, tab: tabName, appended: lastRow + 1, voucher: key };
}

// Sheet -> POS. Install with Triggers -> Add trigger -> pushRepairEditsToPos ->
// From spreadsheet -> On change, so a status ticked off at the bench reaches
// the counter.
// Runs from an On edit trigger, which hands over the exact range that changed.
// getActiveRange is only a guess — right when the person editing is the one the
// trigger runs as, wrong otherwise — so it is the fallback, not the source.
//
// A status is often dragged down several rows at once, so every row the edit
// touched is reported, not just the first.
function pushRepairEditsToPos(e) {
  const range = (e && e.range) ? e.range : SpreadsheetApp.getActiveSheet().getActiveRange();
  if (!range) return;
  const sheet = range.getSheet();

  const firstRow = Math.max(range.getRow(), REPAIR_HEADER_ROWS + 1);
  const lastRow = Math.min(range.getLastRow(), sheet.getLastRow());
  if (lastRow < firstRow) return;

  const values = sheet.getRange(firstRow, 1, lastRow - firstRow + 1, 13).getDisplayValues();
  const rows = [];
  for (let i = 0; i < values.length; i += 1) {
    const v = values[i];
    const voucherNo = String(v[REPAIR_KEY_COLUMN - 1] || '').trim();
    if (!voucherNo) continue;
    rows.push({
      voucherNo: voucherNo,
      repairStatus: String(v[5] || ''),
      pickupStatus: String(v[7] || ''),
      customerPrice: String(v[8] || ''),
      paymentStatus: String(v[11] || ''),
    });
  }
  if (!rows.length) return;

  const response = UrlFetchApp.fetch(POS_CONFIG.BASE_URL + '/api/google-sheet-sync/repair-status', {
    method: 'post',
    contentType: 'application/json',
    muteHttpExceptions: true,
    payload: JSON.stringify({
      secret: getRequiredProperty('POS_SYNC_SECRET'),
      shopSlug: POS_CONFIG.SHOP_SLUG,
      prefix: POS_CONFIG.REPAIR_PREFIX,
      rows: rows,
    }),
  });
  return response.getContentText();
}

