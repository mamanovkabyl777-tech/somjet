require('dotenv').config();

const adminTelegramIdsRaw = process.env.ADMIN_TELEGRAM_IDS || '';
const adminTelegramIdParts = adminTelegramIdsRaw.split(',').map((part) => part.trim()).filter(Boolean);
const adminTelegramIdsInvalid = adminTelegramIdParts.some((part) => !/^\d+$/.test(part) || !Number.isSafeInteger(Number(part)));
const botEnabledInvalid = process.env.BOT_ENABLED !== undefined && !['0', '1'].includes(process.env.BOT_ENABLED);

const config = {

  bot: {
    token: process.env.BOT_TOKEN || '',
    enabled: process.env.BOT_ENABLED !== '0',
    channels: {
      topup: process.env.CHANNEL_TOPUP_ID || '',
      withdraw: process.env.CHANNEL_WITHDRAW_ID || '',
    },
    requiredSubscriptions: [
      {
        id: process.env.REQUIRED_SUBSCRIPTION_CHANNEL_ID || '',
        title: process.env.REQUIRED_SUBSCRIPTION_CHANNEL_TITLE || 'Чат пользователей',
        url: process.env.REQUIRED_SUBSCRIPTION_URL || '',
      },
    ],
  },
  admin: {
    telegramIds: adminTelegramIdParts.map(Number),
    telegramIdsInvalid: adminTelegramIdsInvalid,
  },
  database: {
    path: process.env.DB_PATH || './data/somjet.db',
    backupDir: process.env.DB_BACKUP_DIR || './data/backups',
  },
  isDevelopment: process.env.NODE_ENV !== 'production',
};

function getConfigErrors() {
  const missing = [];
  if (botEnabledInvalid) missing.push('BOT_ENABLED (use 0 or 1)');
  if (config.admin.telegramIdsInvalid) missing.push('ADMIN_TELEGRAM_IDS (comma-separated numeric Telegram IDs)');
  if (config.bot.enabled) {
    if (!config.bot.token) missing.push('BOT_TOKEN');
    if (!config.bot.channels.topup) missing.push('CHANNEL_TOPUP_ID');
    if (!config.bot.channels.withdraw) missing.push('CHANNEL_WITHDRAW_ID');
    if (config.admin.telegramIds.length === 0 && !config.admin.telegramIdsInvalid) missing.push('ADMIN_TELEGRAM_IDS');
  }
  return missing;
}

module.exports = { ...config, getConfigErrors };
