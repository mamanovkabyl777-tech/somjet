const { Admins } = require('../models');
const config = require('../config');
const { createAdminChecker } = require('./adminCheck');

const isAdmin = createAdminChecker({
  telegramIds: config.admin.telegramIds,
  getAdmin: (userId) => Admins.getByUserId(userId),
});

function getAdminRecord(userId) {
  return Admins.getByUserId(userId) || Admins.getByTelegramId(userId) || null;
}

module.exports = { isAdmin, getAdminRecord };
