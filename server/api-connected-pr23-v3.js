require('dotenv').config();

const originalAttachSalesPostgresApi = require('./sales-postgres-api');
const originalAttachPaymentsAccountsPostgresApi = require('./payments-accounts-postgres-api');
const attachPosAllWalletsV24 = require('./pos-all-wallets-v24');
const attachPosSalePaymentMethodsV23 = require('./pos-sale-payment-methods-v23');
const attachPaymentsAccountsDynamicV23 = require('./payments-accounts-dynamic-v23');

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

require('./api-connected-pr23-v2');
