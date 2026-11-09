const { Telegraf } = require('telegraf');
const config = require('./config');
const { Users, BotSettings } = require('./models');
const { isAdmin } = require('./bot/adminAuth');
const { clearUserState } = require('./bot/state');
const { setupStartHandlers } = require('./bot/handlers/start');
const { setupTopupHandlers } = require('./bot/handlers/topup');
const { setupWithdrawHandlers } = require('./bot/handlers/withdraw');
const { setupAdminCallbacks } = require('./bot/handlers/adminCallbacks');
const { setupAdminBotHandlers } = require('./bot/handlers/botAdmin');
const { setupSupportHandlers } = require('./bot/handlers/support');
const { safeErrorSummary, safeTelegramErrorSummary } = require('./bot/safeLog');

const BAN_MESSAGE = '🚫 Доступ к SOM JET ограничен. Если считаете, что это ошибка, напишите в поддержку: @SOMJET_SUPPORT.';

let bot = null;
const lastUserActionAt = new Map();
const ADMIN_CALLBACK_PREFIX = /^(?:admin_|topup_confirm:|topup_undo_confirm:|topup_final_confirm:|topup_reject:|withdraw_confirm:|withdraw_reject:|channel_ban:)/;

function setupBot() {
  if (!config.bot.token) {
    console.error('[Bot] BOT_TOKEN is not set in environment variables!');
    return null;
  }

  bot = new Telegraf(config.bot.token);

  bot.catch((err, ctx) => {
    console.error(`[Bot] Handler error for update ${ctx?.update?.update_id}: ${safeTelegramErrorSummary(err)}`);
  });

  bot.use(async (ctx, next) => {
    if (!ctx.from) return next();

    const wasRegistered = Boolean(Users.getByTelegramIdAny(ctx.from.id));
    Users.createOrUpdate(ctx.from.id, {
      username: ctx.from.username,
      first_name: ctx.from.first_name,
      last_name: ctx.from.last_name,
    });
    if (!wasRegistered && ctx.message?.text) {
      const startCommand = ctx.message.text.match(/^\/start(?:@\w+)?\s+ref_(\d+)\b/);
      if (startCommand) Users.bindReferrer(ctx.from.id, Number(startCommand[1]));
    }

    if (isAdmin(ctx.from.id)) return next();

    if (BotSettings.get('bot_paused', '0') === '1') {
      clearUserState(ctx.from.id);
      const pauseMessage =
        'SOM JET Временно не работает <tg-emoji emoji-id="6269223265001017592">🥳</tg-emoji>\n' +
        'Оповестим всех когда заработает <tg-emoji emoji-id="5348125643852758491">🔔</tg-emoji>';
      if (ctx.callbackQuery) await ctx.answerCbQuery().catch(() => {});
      await ctx.reply(pauseMessage, { parse_mode: 'HTML' }).catch(() => {});
      return;
    }

    if (Users.isBanned(ctx.from.id)) {
      clearUserState(ctx.from.id);
      if (ctx.callbackQuery) {
        await ctx.answerCbQuery('🚫 Вы забанены', { show_alert: true }).catch(() => {});
      } else if (ctx.message) {
        await ctx.reply(BAN_MESSAGE).catch(() => {});
      }
      return;
    }

    const callbackData = ctx.callbackQuery?.data || '';
    if (ADMIN_CALLBACK_PREFIX.test(callbackData) && !isAdmin(ctx.from.id)) {
      await ctx.answerCbQuery('Действие недоступно').catch(() => {});
      return;
    }

    const now = Date.now();
    const lastActionAt = lastUserActionAt.get(ctx.from.id) || 0;
    if (now - lastActionAt < 1000) {
      if (ctx.callbackQuery) await ctx.answerCbQuery('Подождите немного').catch(() => {});
      return;
    }
    lastUserActionAt.set(ctx.from.id, now);
    if (lastUserActionAt.size > 5000) {
      for (const [id, timestamp] of lastUserActionAt) {
        if (now - timestamp > 60000) lastUserActionAt.delete(id);
      }
    }

    return next();
  });

  setupTopupHandlers(bot);
  setupWithdrawHandlers(bot);
  setupAdminCallbacks(bot);
  setupAdminBotHandlers(bot);
  setupSupportHandlers(bot);
  // Menu hears last so topup/withdraw text handlers can next() menu buttons
  setupStartHandlers(bot);

  bot.launch().then(() => {
    console.log('[Bot] Telegram bot started successfully');
    bot.telegram.getMe().then((me) => {
      if (me.username) BotSettings.set('bot_username', me.username);
    }).catch((err) => console.error('[Bot] Failed to read bot username:', safeErrorSummary(err)));
    if (!config.bot.channels.topup || !config.bot.channels.withdraw) {
      console.warn('[Bot] CHANNEL_TOPUP_ID / CHANNEL_WITHDRAW_ID are not set');
    }
    if (config.admin.telegramIds.length === 0) {
      console.warn('[Bot] ADMIN_TELEGRAM_IDS is empty');
    }
  }).catch((err) => {
    console.error('[Bot] Failed to start:', safeErrorSummary(err));
  });

  const shutdown = async (signal) => {
    console.log(`[App] Shutting down (${signal})...`);
    if (bot) await bot.stop(signal);
    process.exit(0);
  };
  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));

  return bot;
}

function getBot() {
  return bot;
}

module.exports = { setupBot, getBot };
