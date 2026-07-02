const attachPurchaseOrderReadApi = require('./purchase-order-read-api');
const attachPoCreateApi = require('./po-create-api');
const attachPoApproveApi = require('./po-approve-api');
const attachGoodsReceivingApi = require('./goods-receiving-api');
const attachSupplierPayablesApi = require('./supplier-payables-api');
const attachPurchaseReturnsApi = require('./purchase-returns-api');
const attachRepairPartsInventoryApi = require('./repair-parts-inventory-api');
const attachPurchasingReportsApi = require('./purchasing-reports-api');

module.exports = function attachPurchaseOrderApi(app) {
  attachPurchaseOrderReadApi(app);
  attachPoCreateApi(app);
  attachPoApproveApi(app);
  attachGoodsReceivingApi(app);
  attachSupplierPayablesApi(app);
  attachPurchaseReturnsApi(app);
  attachRepairPartsInventoryApi(app);
  attachPurchasingReportsApi(app);
};
