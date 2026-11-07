function createAdminChecker({ telegramIds, getAdmin }) {
  return function isAdmin(userId) {
    if (!userId) return false;
    if (telegramIds.includes(userId)) return true;
    const admin = getAdmin(userId);
    return Boolean(admin && admin.active === 1);
  };
}

module.exports = { createAdminChecker };
