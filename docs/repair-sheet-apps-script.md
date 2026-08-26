# Recording repair vouchers into the shop's Google Sheet

Mahar Shwe keeps its repair book in a spreadsheet — one tab per branch, their
own columns, their own wording. The POS writes into that book rather than
asking anyone to move: printing a voucher puts the row there, and moving the
repair through its statuses updates the same row.

## What gets sent

One row per repair, keyed on the voucher number, in the tab's existing shape:

| Col | Header | From the POS |
|-----|--------|--------------|
| A | *(blank)* | received date, `dd/mm/yyyy` |
| B | Repair ID/Voucher | voucher number without the shop prefix — `MS0551` is written `0551` |
| C | ပိုင်ရှင်နာမည် | customer name |
| D | Phone Model | brand + model |
| E | ပြင်ဆင်မှုအပိုင်း | the problem as entered |
| F | ပြင်ဆင်မှုအခြေအနေ | `ပြင်ရန် ⏳` · `ပြင်ပြီး ✅` · `ပြင်မရ ❌` |
| G | ကုန်ကျစရိတ် | left blank — the shop fills their own cost |
| H | ယူပြီး ခြေနေ | `မယူရသေး ⏳` until delivered, then blank |
| I | Customer ဈေး | final cost, or the estimate until one is set |
| J | ဆရာအမည် | technician |
| K | လာယူချိန် | set when the repair is delivered |
| L | ငွေရှင်း status | `ရှင်းပြီး` · `တစ်ဝက်` · blank |
| M | မှတ်ချက် | intake notes |

Columns the shop leaves blank stay blank. Nothing already in the sheet is
overwritten except the row for that voucher.

## Sending happens twice

- **when a voucher is printed** — the print flow mints the customer status link,
  which is the moment the shop wants the row
- **when the status changes** — so the sheet keeps up without anyone retyping

Both are sent as UPSERT on the voucher number, so a reprint updates rather than
duplicates. Delivery goes through the existing outbox, which retries; a sheet
that is unreachable never blocks a voucher printing at the counter.

## Sheet side

In the workbook: **Extensions → Apps Script**, paste this, then **Deploy → New
deployment → Web app**, execute as yourself, access "Anyone".

```js
// Receives repair rows from Mahar POS and keeps one row per voucher number.
const HEADER_ROWS = 1;      // the tab's header line
const KEY_COLUMN  = 2;      // column B, Repair ID/Voucher

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);

    if (body.secret !== PropertiesService.getScriptProperties().getProperty('POS_SYNC_SECRET')) {
      return json({ ok: false, error: 'bad secret' });
    }
    if (body.dataset !== 'repair-voucher') {
      return json({ ok: true, skipped: body.dataset });
    }

    const payload = body.payload || {};
    const tabName = payload.sheetTab || body.tab;
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(tabName);
    if (!sheet) return json({ ok: false, error: 'no tab named ' + tabName });

    const values = payload.row || [];
    const key = String(payload.key || '');
    if (!key) return json({ ok: false, error: 'no voucher number' });

    const keys = sheet.getRange(HEADER_ROWS + 1, KEY_COLUMN, Math.max(1, sheet.getLastRow() - HEADER_ROWS), 1).getValues();
    let target = 0;
    for (let i = 0; i < keys.length; i++) {
      if (String(keys[i][0]).trim() === key) { target = HEADER_ROWS + 1 + i; break; }
    }

    if (target) {
      // Update in place, but never blank a cell the shop filled in themselves.
      const existing = sheet.getRange(target, 1, 1, values.length).getValues()[0];
      const merged = values.map((v, i) => (v === '' ? existing[i] : v));
      sheet.getRange(target, 1, 1, merged.length).setValues([merged]);
      return json({ ok: true, updated: target });
    }

    sheet.appendRow(values);
    return json({ ok: true, appended: sheet.getLastRow() });
  } catch (err) {
    return json({ ok: false, error: String(err) });
  }
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
```

Then in Apps Script **Project Settings → Script properties**, add
`POS_SYNC_SECRET` with the same value as `GOOGLE_SHEET_SYNC_SECRET` on the
server. Keeping it in Script Properties rather than in the code means the
secret can be rotated without redeploying.

## Server side

In `/opt/maharshwe/maharshwe-pos/.env`:

```
GOOGLE_SHEET_WEB_APP_URL=<the /exec URL from the deployment>
GOOGLE_SHEET_SYNC_SECRET=<the same secret>
```

Then `pm2 restart maharshwe-pos-api`.

The tab a shop writes to is `settings.integrations.repairSheetTab`, falling
back to the shop's name — which is how the tabs are already named.
