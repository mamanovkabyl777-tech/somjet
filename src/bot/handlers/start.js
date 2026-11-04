const { Markup } = require('telegraf');
const fs = require('fs');
const path = require('path');
const { Users } = require('../../models');
const { mainMenuWithReply, clientKeyboard, isBackButtonText } = require('../keyboards/mainMenu');
const { askBookmaker } = require('./topup');
const { adminMenu } = require('../keyboards/adminKeyboard');
const { isAdmin } = require('../adminAuth');
const { clearUserState } = require('../state');
const { welcomeHtml } = require('../emoji');
const { dropQrMessage, cancelQrCountdown } = require('../qrTimer');
const { startWithdraw } = require('./withdraw');
const { supportMessage } = require('./support');
const BRAND_IMAGE = path.resolve(__dirname, '../../../assets/somjet-welcome-banner.png');
const {
  isSubscriptionConfigured,
  getUserSubscriptionStatus,
  isUserSubscribed,
  sendSubscriptionPrompt,
  invalidateMembership,
} = require('../subscription');

async function replyHome(ctx, text) {
  if (isAdmin(ctx.from.id)) {
    await ctx.reply(text, Markup.removeKeyboard());
    await ctx.reply('🛠 Панель управления SOM JET\nВыберите раздел:', adminMenu());
    return;
  }
  await ctx.reply(text, mainMenuWithReply(false));
}

async function sendWelcome(ctx, user) {
  await ctx.replyWithHTML(welcomeHtml(user), mainMenuWithReply(false));
}

async function startHandler(ctx, explicitPayload = '') {
  const from = ctx.from;
  const payload = explicitPayload || ctx.startPayload || String(ctx.message?.text || '').trim().split(/\s+/)[1] || '';
  if (!isAdmin(from.id) && isSubscriptionConfigured() && !await isUserSubscribed(ctx)) {
    await sendSubscriptionPrompt(ctx, false, payload);
    return;
  }

  await dropQrMessage(from.id);
  clearUserState(from.id);
  Users.createOrUpdate(from.id, {
    username: from.username,
    first_name: from.first_name,
    last_name: from.last_name,
  });
  if (isAdmin(from.id)) {
    await ctx.reply('🛠 Панель управления SOM JET', Markup.removeKeyboard());
    await ctx.reply('Выберите раздел:', adminMenu());
    return;
  }

  if (fs.existsSync(BRAND_IMAGE)) await ctx.replyWithPhoto({ source: BRAND_IMAGE });

  await sendWelcome(ctx, from);
}

function setupStartHandlers(bot) {
  bot.start((ctx) => startHandler(ctx));

  bot.action(/^subscription_check(?::(.+))?$/, async (ctx) => {
    invalidateMembership(ctx.from.id);
    const payload = ctx.match?.[1] || '';
    const status = await getUserSubscriptionStatus(ctx, { force: true });
    if (!status.subscribed) {
      const reason = status.errors.length
        ? 'Подписка на канал не найдена❌\nпопытайтесь позже ⌛'
        : `Сначала вступите в чат: ${status.missing.join(', ')}.`;
      await ctx.answerCbQuery(reason, { show_alert: true }).catch(() => {});
      await sendSubscriptionPrompt(ctx, true, payload);
      return;
    }
    await ctx.answerCbQuery('Вы в чате SOM JET').catch(() => {});
    await startHandler(ctx, payload);
  });

  bot.action('btn_back_to_menu', async (ctx) => {
    await ctx.answerCbQuery();
    await dropQrMessage(ctx.from.id);
    clearUserState(ctx.from.id);
    if (isAdmin(ctx.from.id)) {
      await ctx.reply('🛠 Панель управления SOM JET\nВыберите раздел:', adminMenu());
      return;
    }
    await sendWelcome(ctx, ctx.from);
  });

  bot.action('btn_cancel', async (ctx) => {
    await ctx.answerCbQuery();
    const expired = await cancelQrCountdown(ctx.from.id, ctx.telegram);
    clearUserState(ctx.from.id);
    if (expired) return;
    await replyHome(ctx, 'Действие остановлено. Если потребуется, начните заново из меню.');
  });

  bot.hears('Пополнить', async (ctx) => {
    if (isAdmin(ctx.from.id)) return;
    await dropQrMessage(ctx.from.id);
    clearUserState(ctx.from.id);
    await askBookmaker(ctx);
  });


  bot.hears(isBackButtonText, async (ctx) => {
    if (isAdmin(ctx.from.id)) return;
    await dropQrMessage(ctx.from.id);
    clearUserState(ctx.from.id);
    await sendWelcome(ctx, ctx.from);
  });

  bot.hears('Поддержка', async (ctx) => {
    await dropQrMessage(ctx.from.id);
    clearUserState(ctx.from.id);
    await ctx.reply(
      supportMessage(),
      {
        parse_mode: 'HTML',
        ...clientKeyboard(),
      }
    );
  });

  bot.hears('Вывести', async (ctx) => {
    if (isAdmin(ctx.from.id)) return;
    await dropQrMessage(ctx.from.id);
    clearUserState(ctx.from.id);
    const user = Users.getByTelegramId(ctx.from.id);
    if (!user) return;
    await startWithdraw(ctx);
  });
}

module.exports = { setupStartHandlers, startHandler };
