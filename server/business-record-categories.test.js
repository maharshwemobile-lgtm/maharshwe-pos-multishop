const test = require('node:test');
const assert = require('node:assert/strict');
const { businessRecordCategories, normalizeBusinessRecordCategory } = require('./business-record-categories');

test('business record categories remain four stable choices per type', () => {
  assert.equal(businessRecordCategories.income.length, 4);
  assert.equal(businessRecordCategories.expense.length, 4);
});

test('legacy Other Income is normalized to Other Service Income', () => {
  assert.equal(
    normalizeBusinessRecordCategory('income', 'Other Income'),
    businessRecordCategories.income[0].value,
  );
});

test('legacy Other Sale spelling is normalized to the current sales category', () => {
  assert.equal(
    normalizeBusinessRecordCategory('income', 'အခြား အရောင်းပိုင် ဝင်ငွေ'),
    businessRecordCategories.income[1].value,
  );
});

test('unknown edit values cannot recreate stale categories', () => {
  assert.equal(
    normalizeBusinessRecordCategory('expense', 'stale-old-category'),
    businessRecordCategories.expense[0].value,
  );
});
