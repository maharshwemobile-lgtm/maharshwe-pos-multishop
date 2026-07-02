const OPTIONAL_NUMERIC_FIELDS = [
  'costPrice',
  'standardSellingPrice',
  'minimumSellingPrice',
  'stockQuantity',
  'minAlertQuantity',
];

function normalizeRow(source) {
  const row = { ...(source || {}) };
  for (const field of OPTIONAL_NUMERIC_FIELDS) {
    if (row[field] === '' || row[field] === null || row[field] === undefined) {
      delete row[field];
    }
  }
  return row;
}

function attachInventoryImportNormalizer(app) {
  app.use('/api/inventory/import', (req, _res, next) => {
    if (Array.isArray(req.body?.rows)) {
      req.body = {
        ...req.body,
        rows: req.body.rows.map(normalizeRow),
      };
    }
    next();
  });
}

module.exports = attachInventoryImportNormalizer;
