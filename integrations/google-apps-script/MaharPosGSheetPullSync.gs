/***************************************
 * Mahar POS → Google Sheet Pull Sync
 * No hardcoding — credentials auto-filled from POS Settings.
 ***************************************/

const CONFIG = {
  BASE_URL: '__POS_BASE_URL__',
  PULL_KEY: '__POS_PULL_KEY__',
  TZ: 'Asia/Yangon',
  SHEET_TRANSACTION_RECORD: 'transaction Record',
  SHEET_BILLER: 'Daily Report For Account',
  TRANSACTION_FIRST_DATA_ROW: 2,
  BILLER_START_ROW: 2,
  BILLER_TOTAL_ROW: 10,
  DEFAULT_BILLERS: ['NearMe','Atom','Mytel','MPT','U9','MPT ELoad','Mytel Eload','ATOM ELOAD']
};

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Mahar POS Sync')
    .addItem('Pull Today', 'pullToday')
    .addItem('Pull Yesterday', 'pullYesterday')
    .addItem('Pull Selected Date', 'pullSelectedDate')
    .addSeparator()
    .addItem('Install Auto-Sync (Daily 1 AM)', 'installAutoSync')
    .addItem('Remove Auto-Sync', 'removeAutoSync')
    .addItem('Check Config', 'checkConfig')
    .addToUi();
}

function installAutoSync() {
  removeAutoSync();
  ScriptApp.newTrigger('pullYesterday').timeBased().everyDays(1).atHour(1).create();
  alert_('Auto-Sync installed! Every day at 1 AM.');
}

function removeAutoSync() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'pullYesterday') ScriptApp.deleteTrigger(t);
  });
}

function pullToday() {
  pullDailyClose(Utilities.formatDate(new Date(), CONFIG.TZ, 'yyyy-MM-dd'));
}

function pullYesterday() {
  var d = new Date(); d.setDate(d.getDate() - 1);
  pullDailyClose(Utilities.formatDate(d, CONFIG.TZ, 'yyyy-MM-dd'));
}

function pullSelectedDate() {
  var range = SpreadsheetApp.getActiveRange();
  if (!range) { alert_('Date cell ရွေးပါ'); return; }
  var date = normalizeDate_(range.getValue());
  if (!date) { alert_('yyyy-MM-dd format ဖြစ်ရမယ်'); return; }
  pullDailyClose(date);
}

function checkConfig() {
  ensureSheetLayout_();
  var hasTrigger = ScriptApp.getProjectTriggers().some(function(t) { return t.getHandlerFunction() === 'pullYesterday'; });
  alert_('Config OK\n\nBASE_URL: ' + CONFIG.BASE_URL + '\nPULL_KEY: ' + CONFIG.PULL_KEY.slice(0,8) + '...\n\nAuto-Sync: ' + (hasTrigger ? 'INSTALLED' : 'NOT installed'));
}

function pullDailyClose(date) {
  date = normalizeDate_(date);
  if (!date) throw new Error('Invalid date');
  var lock = LockService.getScriptLock(); var locked = false;
  try {
    lock.waitLock(30000); locked = true;
    ensureSheetLayout_();
    var biller   = apiGet_('/api/google-sheet/pull/biller-balance?startDate=' + date + '&endDate=' + date);
    var business = apiGet_('/api/google-sheet/pull/business?from=' + date + '&to=' + date + '&closePeriod=daily');
    var bd = normalizeBillerReport_(biller);
    var cr = normalizeDailyCloseRow_(business);
    fillBillerTable_(bd.rows, bd.totals);
    fillTransactionRecord_(date, cr);
    SpreadsheetApp.flush();
    try { targetSpreadsheet_().toast('Pull completed: ' + date, 'Mahar POS Sync', 5); } catch (e) { Logger.log('Pull completed: ' + date); }
  } catch (err) {
    alert_('Sync failed:\n\n' + getErrorMessage_(err)); throw err;
  } finally { if (locked) lock.releaseLock(); }
}

function apiGet_(path) {
  var res = UrlFetchApp.fetch(CONFIG.BASE_URL + path, {
    method: 'get', muteHttpExceptions: true,
    headers: { 'x-pull-key': CONFIG.PULL_KEY }
  });
  var code = res.getResponseCode(), text = res.getContentText();
  if (code < 200 || code >= 300) throw new Error('HTTP ' + code + ' ' + path + ': ' + text.slice(0, 200));
  return safeJson_(text);
}

function ensureSheetLayout_() {
  var trx = getOrCreateSheet_(CONFIG.SHEET_TRANSACTION_RECORD);
  trx.getRange('A1:R1').setValues([['Day / Date','IN - Product Sales','IN - Service Income','IN - Money Service Fee','IN - Other Sale','IN - Other Service','IN - Other Top-up','IN - Other Income','IN - Other Income Subtotal','IN - Total Income','OUT - Other Sale Expense','OUT - Other Service Expense','OUT - Other Top-up Expense','OUT - Other Expense','OUT - Expense Subtotal','OUT - Total Expense','NET - Income/(Expense)','Status']]);
  var bil = getOrCreateSheet_(CONFIG.SHEET_BILLER);
  bil.getRange('A1:G1').setValues([['Biller Name','Opening','Refill','Sold','Closing','Check / Note','Adjustment / Variance']]);
}

// Bound to the sheet, getActive() is the workbook. In a standalone project it
// is null and every call below fails on it — which is what "Pull Today" was
// dying on. A script property names the workbook in that case, and if neither
// is there the message says so instead of a null reference.
function targetSpreadsheet_() {
  var active = null;
  try { active = SpreadsheetApp.getActive(); } catch (e) { active = null; }
  if (active) return active;

  var id = String(PropertiesService.getScriptProperties().getProperty('POS_PULL_SHEET_ID') || '').trim();
  var match = id.match(/\/spreadsheets\/d\/([A-Za-z0-9_-]+)/);
  if (match) id = match[1];
  if (id) return SpreadsheetApp.openById(id);

  throw new Error(
    'ဤ script ကို Sheet နှင့် တွဲမထားပါ။ Sheet ကို ဖွင့်ပြီး Extensions → Apps Script မှ ထည့်ပါ၊ '
    + 'သို့မဟုတ် Project Settings → Script properties တွင် POS_PULL_SHEET_ID = Sheet ၏ link ကို ထည့်ပါ။');
}

function getOrCreateSheet_(name) { var ss = targetSpreadsheet_(); return ss.getSheetByName(name) || ss.insertSheet(name); }
function getSheet_(name) { var sh = targetSpreadsheet_().getSheetByName(name); if (!sh) throw new Error('Sheet not found: ' + name); return sh; }

function normalizeBillerReport_(res) {
  var body = unwrap_(res), rows = body.rows || body.items || [];
  if (!Array.isArray(rows)) rows = [];
  rows = rows.map(function(r) {
    return { billerName: r.billerName || r.name || '', openingBalance: pickNum_(r,['openingBalance','opening']), refill: pickNum_(r,['refill']), sold: pickNum_(r,['sold']), balanceSold: pickNum_(r,['balanceSold','sold']), adjustment: pickNum_(r,['adjustment']), closingBalance: pickNum_(r,['closingBalance','closing']) };
  });
  var tot = body.totals || {};
  return { rows: rows, totals: { sold: pickOrSum_(tot,['sold'],rows,'sold'), closingBalance: pickOrSum_(tot,['closingBalance'],rows,'closingBalance'), adjustment: pickOrSum_(tot,['adjustment'],rows,'adjustment') } };
}

function normalizeDailyCloseRow_(res) {
  var body = unwrap_(res), dc = body.dailyCloseReport || {}, rows = dc.rows || [];
  if (Array.isArray(rows) && rows.length) return rows[0];
  return dc.totals || body.totals || {};
}

function fillTransactionRecord_(date, row) {
  var sh = getSheet_(CONFIG.SHEET_TRANSACTION_RECORD), tr = findOrCreateDateRow_(sh, date);
  var ps=num_(row.salePosIncome), si=num_(row.servicePosIncome), mf=num_(row.moneyServiceFee);
  var os=num_(row.otherSaleIncome), ov=num_(row.otherServiceIncome), ot=num_(row.otherTopupIncome), oo=num_(row.otherOtherIncome);
  var otherSub=os+ov+ot+oo, totalIn=ps+si+mf+otherSub;
  var es=num_(row.otherSaleExpense), ev=num_(row.otherServiceExpense), et=num_(row.otherTopupExpense), eo=num_(row.otherOtherExpense);
  var expSub=es+ev+et+eo, net=totalIn-expSub;
  sh.getRange(tr,1,1,18).setValues([[dateToSheetDate_(date),ps,si,mf,os,ov,ot,oo,otherSub,totalIn,es,ev,et,eo,expSub,expSub,net,net>=0?'Net Income':'Net Expense']]);
  sh.getRange(tr,1).setNumberFormat('yyyy-mm-dd');
  sh.getRange(tr,2,1,16).setNumberFormat('#,##0;[Red](#,##0);-');
}

function fillBillerTable_(rows, totals) {
  var sh = getSheet_(CONFIG.SHEET_BILLER), map = {};
  rows.forEach(function(r) { var k=nk_(r.billerName); if(k) map[k]=r; });
  var out = CONFIG.DEFAULT_BILLERS.map(function(name) {
    var r=map[nk_(name)]||{};
    var op=num_(r.openingBalance), rf=num_(r.refill), sd=num_(r.sold), bs=num_(r.balanceSold||r.sold), adj=num_(r.adjustment), cl=num_(r.closingBalance);
    var vr=cl-(op+rf-bs+adj), note=cl<0?'Negative':Math.abs(vr)>1?'Check':adj!==0?'Adjusted':'OK';
    return [name,op,rf,sd,cl,note,adj||vr];
  });
  sh.getRange(CONFIG.BILLER_START_ROW,1,out.length,7).setValues(out);
  sh.getRange(CONFIG.BILLER_TOTAL_ROW,1,1,7).setValues([['TOTAL','','',num_(totals.sold),'',num_(totals.closingBalance),num_(totals.adjustment)]]);
  sh.getRange(CONFIG.BILLER_START_ROW,2,out.length+1,6).setNumberFormat('#,##0;[Red](#,##0);-');
}

function findOrCreateDateRow_(sh, date) {
  var first=CONFIG.TRANSACTION_FIRST_DATA_ROW, vals=sh.getRange(first,1,Math.max(sh.getMaxRows(),first)-first+1,1).getValues(), last=first-1;
  for(var i=0;i<vals.length;i++){var ex=normalizeDate_(vals[i][0]); if(ex) last=first+i; if(ex===date) return first+i;}
  var row=Math.max(last+1,first); if(row>sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(),row-sh.getMaxRows()); return row;
}

function unwrap_(r) { if(!r) return {}; if(r.data!=null) return r.data; if(r.result!=null) return r.result; return r; }
function pickNum_(obj,keys) { if(!obj) return 0; for(var i=0;i<keys.length;i++){if(obj[keys[i]]!=null&&obj[keys[i]]!=='') return num_(obj[keys[i]]);} return 0; }
function pickOrSum_(obj,keys,rows,sumKey) { for(var i=0;i<keys.length;i++){if(obj&&obj[keys[i]]!=null) return num_(obj[keys[i]]);} return rows.reduce(function(t,r){return t+num_(r[sumKey]);},0); }
function num_(v) { if(v==null||v==='') return 0; if(typeof v==='number') return v; var t=String(v).replace(/MMK/gi,'').replace(/,/g,'').replace(/\s/g,'').trim(); var neg=/^\(.*\)$/.test(t); t=t.replace(/[()]/g,''); var n=Number(t); return isNaN(n)?0:(neg?-n:n); }
function nk_(v) { return String(v||'').trim().toLowerCase(); }
function normalizeDate_(v) {
  if(!v) return '';
  if(Object.prototype.toString.call(v)==='[object Date]') return isNaN(v.getTime())?'':Utilities.formatDate(v,CONFIG.TZ,'yyyy-MM-dd');
  var t=String(v).trim();
  if(/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  var dmy=t.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/); if(dmy) return dmy[3]+'-'+pad2_(dmy[2])+'-'+pad2_(dmy[1]);
  var d=new Date(t); return isNaN(d.getTime())?'':Utilities.formatDate(d,CONFIG.TZ,'yyyy-MM-dd');
}
function dateToSheetDate_(s) { return new Date(s+'T00:00:00+06:30'); }
function pad2_(v) { return String(v).padStart(2,'0'); }
function safeJson_(t) { try { return JSON.parse(t); } catch(e) { throw new Error('Invalid JSON: '+t.slice(0,200)); } }
function alert_(msg) { Logger.log(msg); try { SpreadsheetApp.getUi().alert(msg); } catch(e) {} }
function getErrorMessage_(err) { return err&&err.message?err.message:String(err); }
