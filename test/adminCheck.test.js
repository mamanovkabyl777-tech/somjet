const test = require('node:test');
const assert = require('node:assert/strict');
const { createAdminChecker } = require('../src/bot/adminCheck');

test('admin check allows configured and active database admins only', () => {
  const records = new Map([
    [22, { active: 1 }],
    [33, { active: 0 }],
  ]);
  const isAdmin = createAdminChecker({
    telegramIds: [11],
    getAdmin: (id) => records.get(id),
  });

  assert.equal(isAdmin(undefined), false);
  assert.equal(isAdmin(11), true);
  assert.equal(isAdmin(22), true);
  assert.equal(isAdmin(33), false);
  assert.equal(isAdmin(44), false);
});
