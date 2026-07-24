const test = require('node:test');
const assert = require('node:assert/strict');
const { businessRecordCategories, normalizeBusinessRecordCategory } = require('./business-record-categories');

test('business record categories remain four stable choices per type', () => {
  assert.equal(businessRecordCategories.income.length, 4);
  assert.equal(businessRecordCategories.expense.length, 4);
});

test('every displayed category round-trips without becoming the first category', () => {
  for (const type of ['income', 'expense']) {
    for (const category of businessRecordCategories[type]) {
      assert.equal(normalizeBusinessRecordCategory(type, category.value), category.value);
      assert.equal(normalizeBusinessRecordCategory(type, category.en), category.value);
      assert.equal(normalizeBusinessRecordCategory(type, category.my), category.value);
    }
  }
});

test('Other Income resolves to the distinct Other Income category', () => {
  assert.equal(
    normalizeBusinessRecordCategory('income', 'Other Income'),
    businessRecordCategories.income[3].value,
  );
});

test('legacy Other Sale spelling is normalized to the current sales category', () => {
  assert.equal(
    normalizeBusinessRecordCategory('income', 'အခြား အရောင်းပိုင် ဝင်ငွေ'),
    businessRecordCategories.income[1].value,
  );
});

test('unknown edit values are rejected instead of becoming service records', () => {
  assert.equal(
    normalizeBusinessRecordCategory('expense', 'stale-old-category'),
    null,
  );
});
