const test = require('node:test');
const assert = require('node:assert/strict');
const { parseSomAmount, isValidTopupAmount, formatSom } = require('../src/bot/money');

test('amount parser requires digits and at most two decimal places', () => {
  assert.equal(parseSomAmount('100'), 10000);
  assert.equal(parseSomAmount('40,05'), 4005);
  assert.equal(parseSomAmount('0.5'), 50);
  assert.equal(parseSomAmount('100abc'), null);
  assert.equal(parseSomAmount('1.234'), null);
  assert.equal(parseSomAmount('-40'), null);
  assert.equal(parseSomAmount(''), null);
});

test('top-up limits stay between 40 and 10,000 som', () => {
  assert.equal(isValidTopupAmount(parseSomAmount('40')), true);
  assert.equal(isValidTopupAmount(parseSomAmount('10000')), true);
  assert.equal(isValidTopupAmount(parseSomAmount('39.99')), false);
  assert.equal(isValidTopupAmount(parseSomAmount('10000.01')), false);
});

test('stored tiyin format back to som with two decimals', () => {
  assert.equal(formatSom(4005), '40.05');
});
