require('dotenv').config();

module.exports = {
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
    telegramIds: (process.env.ADMIN_TELEGRAM_IDS || '')
      .split(',')
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => !Number.isNaN(n)),
  },
  database: {
    path: process.env.DB_PATH || './data/gkassa.db',
  },
  isDevelopment: process.env.NODE_ENV !== 'production',
};
