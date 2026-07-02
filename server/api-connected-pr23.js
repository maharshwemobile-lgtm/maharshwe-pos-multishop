const express = require('express');
require('dotenv').config();
const { getDb } = require('./db');
const { attachSecurity } = require('./security');
const { attachAuthApi, requireAuth } = require('./auth-api');
const attachGoogleAuthApi = require('./google-auth-api');
const attachAuthAuditMiddleware = require('./auth-audit-middleware');
const attachAuditTrailMiddleware = require('./audit-trail-middleware');
const attachAuditTrailApi = require('./audit-trail-api');
const attachTenantUsersPostgresApi = require('./tenant-users-postgres-api');
const attachTenantUserPasswordResetApi = require('./tenant-user-password-reset-api');
const attachShopAdminSettingsLock = require('./shop-admin-settings-lock');
const attachTenantIntegrityApi = require('./tenant-integrity-api');
const attachBackupStatusApi = require('./backup-status-api');
const attachDashboardPostgresApi = require('./dashboard-postgres-api');
const attachBusinessControlApi = require('./business-control-api-v2');
const attachBusinessControlServiceIncomeExtension = require('./business-control-service-income-extension');
const attachBusinessAlertsPendingFix = require('./business-alerts-pending-fix');
const attachRepairListNewestApi = require('./repair-list-newest-api');
const attachRepairPlatformApi = require('./repair-platform-api');
const attachRepairFinanceApi = require('./repair-finance-api');
const attachRepairPublicPortalApi = require('./repair-public-portal-api');
const attachRepairCustomerAdminApi = require('./repair-customer-admin-api');
const attachRepairStatusNotificationMiddleware = require('./repair-status-notification-middleware');
const { startRepairOutboxRunner } = require('./repair-outbox-runner');
const attachPartnerSettlementApi = require('./partner-settlement-api');
const attachSupplierPurchasingApi = require('./supplier-purchasing-api');
const attachCatalogStockApi = require('./catalog-stock-api');
const attachInventoryImportNormalizer = require('./inventory-import-normalizer');
const attachInventoryConfirmedImportApi = require('./inventory-confirmed-import-api');
const attachInventoryToolsApi = require('./inventory-tools-api');
const attachInventoryImportPreviewApi = require('./inventory-import-preview-api');
const attachPosCatalogNewestOrder = require('./pos-catalog-newest-order');
const attachAvailablePosCatalogApi = require('./pos-available-catalog-api');
const attachSalesPostgresApi = require('./sales-postgres-api');
const attachTenantSalesHistoryPostgresApi = require('./tenant-sales-history-postgres-api');
const attachSalesV10ListApi = require('./sales-v10-list-api');
const attachCustomerCreditPostgresApi = require('./customer-credit-postgres-api');
const attachPaymentsAccountsPostgresApi = require('./payments-accounts-postgres-api');
const attachProjectSettingsPostgresApi = require('./project-settings-postgres-api');
const attachProjectSettingsResponseSanitizer = require('./project-settings-response-sanitizer');
const attachProjectSettingsRead = require('./project-settings-read');
const attachProjectSettingsPreferencesWrite = require('./project-settings-preferences-write');
const attachProjectSettingsBusinessWrite = require('./project-settings-business-write');
const attachProjectSettingsAppearanceWrite = require('./project-settings-appearance-write');
const attachProjectFunctionAccessMiddleware = require('./project-function-access-middleware');
const attachHardDbApi = require('./hard-db-api');
const attachProductImportApi = require('./product-import-api');
const attachProductCrudApi = require('./product-crud-api');
const attachServiceCrudApi = require('./service-crud-api');
const attachBusinessApi = require('./business-api');
const attachExpenseCategoriesApi = require('./expense-categories-api');
const { attachFinanceSettingsV23Api } = require('./finance-settings-v23-api');
const { attachMoneyServiceV23Api } = require('./money-service-v23-api');
const attachGoogleSheetSyncV23Extension = require('./google-sheet-sync-v23-extension');
const { attachGoogleSheetSyncApi, attachGoogleSheetSyncCapture, startGoogleSheetSyncRunner } = require('./google-sheet-sync');

const app = express();
attachSecurity(app);
app.use(express.json({ limit: '50mb' }));
attachInventoryImportNormalizer(app);
attachAuthAuditMiddleware(app);
attachAuthApi(app);
attachGoogleAuthApi(app);
attachAuditTrailMiddleware(app);
attachRepairStatusNotificationMiddleware(app);
attachGoogleSheetSyncCapture(app);
attachAuditTrailApi(app);
attachBackupStatusApi(app);

const protect = process.env.AUTH_REQUIRED === 'true' ? requireAuth : (_req, _res, next) => next();
const isPostgreSql = process.env.DATABASE_URL?.startsWith('postgresql://') || process.env.DATABASE_URL?.startsWith('postgres://');
const healthHandler = (_req, res) => res.json({ ok: true, server: 'mahar-pos-full-api', database: isPostgreSql ? 'postgresql-configured' : 'legacy-sqlite-configured' });
app.get('/health', healthHandler);
app.get('/api/health', healthHandler);

if (isPostgreSql) {
  attachProjectSettingsResponseSanitizer(app);
  attachProjectSettingsRead(app);
  attachProjectSettingsPreferencesWrite(app);
  attachProjectSettingsBusinessWrite(app);
  attachProjectSettingsAppearanceWrite(app);
  attachProjectFunctionAccessMiddleware(app);
  attachGoogleSheetSyncV23Extension(app);
  attachGoogleSheetSyncApi(app);
  attachFinanceSettingsV23Api(app);
  attachMoneyServiceV23Api(app);
  attachExpenseCategoriesApi(app);
  attachDashboardPostgresApi(app);
  attachBusinessAlertsPendingFix(app);
  attachBusinessControlServiceIncomeExtension(app);
  attachBusinessControlApi(app);
  attachRepairPublicPortalApi(app);
  attachShopAdminSettingsLock(app);
  attachTenantUserPasswordResetApi(app);
  attachTenantUsersPostgresApi(app);
  attachTenantIntegrityApi(app);
  attachRepairListNewestApi(app);
  attachRepairPlatformApi(app);
  attachRepairFinanceApi(app);
  attachRepairCustomerAdminApi(app);
  attachPartnerSettlementApi(app);
  attachSupplierPurchasingApi(app);
  attachCatalogStockApi(app);
  attachInventoryConfirmedImportApi(app);
  attachInventoryToolsApi(app);
  attachInventoryImportPreviewApi(app);
  attachPosCatalogNewestOrder(app);
  attachAvailablePosCatalogApi(app);
  attachSalesPostgresApi(app);
  attachSalesV10ListApi(app);
  attachTenantSalesHistoryPostgresApi(app);
  attachCustomerCreditPostgresApi(app);
  attachPaymentsAccountsPostgresApi(app);
  attachProjectSettingsPostgresApi(app);
} else {
  attachProductCrudApi(app, { protect });
  attachHardDbApi(app, { protect });
}

attachProductImportApi(app, { protect });
attachServiceCrudApi(app, { protect });
attachBusinessApi(app, { protect });

const PORT = process.env.PORT || 4000;
async function start() {
  if (!isPostgreSql) await getDb();
  app.listen(PORT, '127.0.0.1', () => {
    console.log('Mahar POS Full API running on 127.0.0.1:' + PORT);
    if (isPostgreSql) {
      startRepairOutboxRunner();
      startGoogleSheetSyncRunner();
    }
  });
}

start().catch((error) => {
  console.error('Mahar POS API failed to start:', error);
  process.exit(1);
});
