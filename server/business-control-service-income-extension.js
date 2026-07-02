const attachBusinessRecordsApi = require('./business-records-api');
const attachBusinessControlServiceIncomeCore = require('./business-control-service-income-core');

function attachBusinessControlServiceIncomeExtension(app) {
  attachBusinessRecordsApi(app);
  attachBusinessControlServiceIncomeCore(app);
}

module.exports = attachBusinessControlServiceIncomeExtension;
