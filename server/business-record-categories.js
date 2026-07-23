const categories = require('../shared/business-record-categories.json');

function rows(type) {
  return type === 'expense' ? categories.expense : categories.income;
}

function normalizeBusinessRecordCategory(type, value) {
  const input = String(value || '').trim().toLowerCase();
  const match = rows(type).find((item) => (
    item.value.toLowerCase() === input
    || item.my.toLowerCase() === input
    || item.en.toLowerCase() === input
    || (item.aliases || []).some((alias) => String(alias).toLowerCase() === input)
  ));
  return match?.value || rows(type)[0].value;
}

module.exports = { businessRecordCategories: categories, normalizeBusinessRecordCategory };
