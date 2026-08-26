// Mirror a repair into the shop's own Google Sheet.
//
// Mahar Shwe has kept its repair book in a spreadsheet for years — 347 rows in
// their own columns and their own wording. Rather than ask them to give that
// up, the POS writes into it: a voucher printed here appears there in the shape
// they already read.
//
// Rows are keyed on the voucher number and sent as UPSERT, so reprinting a
// voucher or moving a repair through its statuses updates the row that is
// already there instead of stacking duplicates.

const { prisma } = require('./prisma');
const { queueGoogleSheetSync } = require('./google-sheet-sync');
const { repairSheetRow } = require('./repair-sheet-row');

function plainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

// One workbook, a tab per branch. The shop names its tab on the integration
// screen; the shop name is only a fallback, and often the wrong one — Mahar
// Shwe Mobile's tab is simply "Mahar".
async function resolveSheetTab(shopId, shopName) {
  const row = await prisma.shopSettings.findFirst({ where: { shopId } }).catch(() => null);
  const settings = plainObject(row?.settings);
  const configured = String(
    plainObject(plainObject(settings.api).googleSheets).repairSheetTab
    || plainObject(settings.integrations).repairSheetTab
    || '',
  ).trim();
  return configured || String(shopName || '').trim();
}

/**
 * Queue one repair for the shop's sheet. Never throws: a spreadsheet that is
 * unreachable must not stop a voucher printing at the counter.
 */
async function syncRepairToSheet(shopId, repair, action = 'VOUCHER_PRINTED') {
  try {
    if (!shopId || !repair?.repairNumber) return null;
    const shop = await prisma.shop.findUnique({ where: { id: shopId }, select: { name: true } });
    const sheetTab = await resolveSheetTab(shopId, shop?.name);
    const mapped = repairSheetRow(repair);
    return await queueGoogleSheetSync({
      shopId,
      dataset: 'repair-voucher',
      action,
      entityId: mapped.key,
      // A deleted repair still has to reach the sheet, or the book keeps a row
      // for a voucher the POS no longer has.
      payload: { ...mapped, sheetTab, deleted: action === 'VOUCHER_DELETED' },
    });
  } catch (error) {
    console.warn('Repair sheet sync skipped:', error.message);
    return null;
  }
}

module.exports = { syncRepairToSheet, resolveSheetTab };
