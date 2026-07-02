require('dotenv').config();

// Google Sheet webhook URL and shared secret are administered per shop in
// Project Settings. Legacy VPS environment values are intentionally ignored
// to prevent duplicate delivery and cross-tenant configuration leaks.
delete process.env.GOOGLE_SHEET_WEB_APP_URL;
delete process.env.GOOGLE_SHEET_SYNC_SECRET;

const originalAttachSalesPostgresApi = require('./sales-postgres-api');
const originalAttachPaymentsAccountsPostgresApi = require('./payments-accounts-postgres-api');
const originalGoogleSheetSync = require('./google-sheet-sync');
const attachPosAllWalletsV24 = require('./pos-all-wallets-v24');
const attachPosSalePaymentMethodsV23 = require('./pos-sale-payment-methods-v23');
const attachPaymentsAccountsDynamicV23 = require('./payments-accounts-dynamic-v23');
const {
  attachGoogleSheetProjectSettingsApi,
  startGoogleSheetProjectSettingsRunner,
} = require('./google-sheet-project-settings-v23');

const salesModulePath = require.resolve('./sales-postgres-api');
require.cache[salesModulePath].exports = function attachSalesWithDynamicPaymentMethods(app) {
  attachPosAllWalletsV24(app);
  attachPosSalePaymentMethodsV23(app);
  return originalAttachSalesPostgresApi(app);
};

const accountsModulePath = require.resolve('./payments-accounts-postgres-api');
require.cache[accountsModulePath].exports = function attachAccountsWithDynamicPaymentMethods(app) {
  attachPaymentsAccountsDynamicV23(app);
  return originalAttachPaymentsAccountsPostgresApi(app);
};

const googleSheetModulePath = require.resolve('./google-sheet-sync');
require.cache[googleSheetModulePath].exports = {
  ...originalGoogleSheetSync,
  attachGoogleSheetSyncApi(app) {
    originalGoogleSheetSync.attachGoogleSheetSyncApi(app);
    attachGoogleSheetProjectSettingsApi(app);
  },
  startGoogleSheetSyncRunner: startGoogleSheetProjectSettingsRunner,
};

require('./api-connected-pr23-v2');
