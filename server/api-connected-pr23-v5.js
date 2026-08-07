require('dotenv').config();

const projectSheetSettings = require('./google-sheet-project-settings-v23');
const attachGoogleSheetProjectExportApi = require('./google-sheet-project-export-api-v23');
const googleSheetSync = require('./google-sheet-sync');
const grandAdminStep2 = require('./grand-admin-backend-step2-api');
const tenantGoogleSheet = require('./tenant-google-sheet-webhook-api');

const modulePath = require.resolve('./google-sheet-project-settings-v23');
require.cache[modulePath].exports = {
  ...projectSheetSettings,
  attachGoogleSheetProjectSettingsApi(app) {
    projectSheetSettings.attachGoogleSheetProjectSettingsApi(app);
    attachGoogleSheetProjectExportApi(app);
  },
};

const syncModulePath = require.resolve('./google-sheet-sync');
const originalSyncCapture = googleSheetSync.attachGoogleSheetSyncCapture;
const originalSyncRunner = googleSheetSync.startGoogleSheetSyncRunner;
require.cache[syncModulePath].exports = {
  ...googleSheetSync,
  attachGoogleSheetSyncCapture(app) {
    originalSyncCapture(app);
    tenantGoogleSheet.attachTenantGoogleSheetWebhookCapture(app);
  },
  startGoogleSheetSyncRunner() {
    const existingRunner = originalSyncRunner();
    tenantGoogleSheet.startTenantGoogleSheetWebhookRunner();
    return existingRunner;
  },
};

const grandAdminStep2Path = require.resolve('./grand-admin-backend-step2-api');
require.cache[grandAdminStep2Path].exports = function attachGrandAdminStep2WithGoogleSheet(app) {
  grandAdminStep2(app);
  tenantGoogleSheet.attachTenantGoogleSheetIntegrationApi(app);
};

// Same require.cache pattern the layers above use: wrap an attach function that
// the base registry already calls, so the IMEI lookup route gets mounted too.
const attachImeiLookupApi = require('./imei-lookup-api');
const repairPlatformPath = require.resolve('./repair-platform-api');
const originalRepairPlatform = require('./repair-platform-api');
const wrappedRepairPlatform = function attachRepairPlatformWithImeiLookup(app) {
  originalRepairPlatform(app);
  attachImeiLookupApi(app);
};
Object.assign(wrappedRepairPlatform, originalRepairPlatform);
require.cache[repairPlatformPath].exports = wrappedRepairPlatform;

require('./api-connected-pr23-v4');
