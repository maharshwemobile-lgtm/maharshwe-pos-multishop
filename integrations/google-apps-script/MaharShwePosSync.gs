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

function doGet(e) {
  return jsonResponse({
    ok: true,
    service: 'MaharShwe POS Google Sheet Sync',
    tabs: POS_DATASETS.map(function (item) { return item[1]; }),
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
  const value = PropertiesService.getScriptProperties().getProperty(name);
  if (!value) throw new Error(name + ' is not configured in Script Properties');
  return value;
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
  var props = PropertiesService.getScriptProperties();
  var baseUrl = String(props.getProperty('POS_BASE_URL') || '').replace(/\/$/, '');
  var shopSlug = String(props.getProperty('POS_SHOP_SLUG') || '').trim();
  var secret = String(props.getProperty('POS_SYNC_SECRET') || '').trim();
  if (!baseUrl || !shopSlug || !secret) throw new Error('POS_BASE_URL, POS_SHOP_SLUG, POS_SYNC_SECRET are required');

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
