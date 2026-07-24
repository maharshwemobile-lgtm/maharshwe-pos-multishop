const categories = require('../shared/business-record-categories.json');

function rows(type) {
  return type === 'expense' ? categories.expense : categories.income;
}

function normalizeBusinessRecordCategory(type, value) {
  const input = String(value || '').trim().toLowerCase();
  const exact = rows(type).find((item) => (
    item.value.toLowerCase() === input
    || item.my.toLowerCase() === input
    || item.en.toLowerCase() === input
  ));
  if (exact) return exact.value;
  const alias = rows(type).find((item) => (
    (item.aliases || []).some((candidate) => String(candidate).toLowerCase() === input)
  ));
  return alias?.value || null;
}

module.exports = { businessRecordCategories: categories, normalizeBusinessRecordCategory };
