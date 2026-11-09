const { Markup } = require('telegraf');
const fs = require('fs');
const path = require('path');
const { Users, ReferralProgram, BotSettings } = require('../../models');
const {
  mainMenuWithReply,
  clientKeyboard,
  isBackButtonText,
  referralMenuKeyboard,
  siteSelectKeyboard,
  backKeyboard,
} = require('../keyboards/mainMenu');
const { askBookmaker } = require('./topup');
const { adminMenu } = require('../keyboards/adminKeyboard');
const { isAdmin } = require('../adminAuth');
const { clearUserState, setUserState } = require('../state');
const { welcomeHtml, tgEmoji } = require('../emoji');
const { formatSom } = require('../money');
const MIN_REFERRAL_AMOUNT_TIYIN = 100 * 100;
const { dropQrMessage, cancelQrCountdown } = require('../qrTimer');
const { startWithdraw } = require('./withdraw');
const { supportMessage } = require('./support');
const BRAND_IMAGE = path.resolve(__dirname, '../../../assets/somjet-welcome-banner.png');

async function replyHome(ctx, text) {
  if (isAdmin(ctx.from.id)) {
    await ctx.reply(text, Markup.removeKeyboard());
    await ctx.reply('🛠 Панель управления SOM JET\nВыберите раздел:', adminMenu());
    return;
  }
  await ctx.reply(text, mainMenuWithReply(false));
}

async function sendWelcome(ctx, user) {
  const caption = welcomeHtml(user);
  const keyboard = mainMenuWithReply(false);
  if (fs.existsSync(BRAND_IMAGE)) {
    await ctx.replyWithPhoto({ source: BRAND_IMAGE }, {
      caption,
      parse_mode: 'HTML',
      ...keyboard,
    });
    return;
  }
  await ctx.replyWithHTML(caption, keyboard);
}

async function startHandler(ctx) {
  const from = ctx.from;
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

  await sendWelcome(ctx, from);
}

function setupStartHandlers(bot) {
  bot.start((ctx) => startHandler(ctx));

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

  bot.hears('Пригласить друга💸', async (ctx) => {
    if (isAdmin(ctx.from.id)) return;
    await dropQrMessage(ctx.from.id);
    clearUserState(ctx.from.id);
    const summary = ReferralProgram.getSummary(ctx.from.id);
    const username = String(BotSettings.get('bot_username', 'ZenKG_bot')).replace(/^@/, '');
    const message =
      `🤝 Пригласи друга\n\n` +
      `Ваша персональная ссылка:\n` +
      `https://t.me/${username}?start=ref_${ctx.from.id}\n\n` +
      `За каждое принятое пополнение приглашенного друга начисляется 2%.\n\n` +
      `${tgEmoji('6032609071373226027', '👥')} Приглашено друзей: ${summary.invited}\n` +
      `${tgEmoji('5796168957064912286', '⭐️')} Пополнений друзей: ${summary.topupCount}\n` +
      `${tgEmoji('5796281218920095496', '💸')} Сумма пополнений друзей: ${formatSom(summary.topupAmount)} KGS\n` +
      `${tgEmoji('5769126056262898415', '👛')} Доступный баланс: ${formatSom(summary.balance)} KGS\n\n` +
      `Минимальная сумма пополнения или вывода: 100 KGS.`;
    await ctx.reply(message, { parse_mode: 'HTML', ...referralMenuKeyboard() });
  });

  bot.hears('Пополнить БК с бонусного баланса', async (ctx) => {
    if (isAdmin(ctx.from.id)) return;
    await dropQrMessage(ctx.from.id);
    clearUserState(ctx.from.id);
    const summary = ReferralProgram.getSummary(ctx.from.id);
    if (summary.balance < MIN_REFERRAL_AMOUNT_TIYIN) {
      await ctx.reply('Для пополнения бонусным балансом нужно не менее 100 KGS.', referralMenuKeyboard());
      return;
    }
    if (ReferralProgram.hasPendingRequest(ctx.from.id)) {
      await ctx.reply('У вас уже есть необработанная заявка с бонусного баланса.', referralMenuKeyboard());
      return;
    }
    setUserState(ctx.from.id, { step: 'referral_topup_choose_site' });
    await ctx.reply(
      `Выберите букмекера. Будет использован весь доступный бонусный баланс: ${formatSom(summary.balance)} KGS.`,
      siteSelectKeyboard()
    );
  });

  bot.hears('Вывести в Банк Бонусный баланс', async (ctx) => {
    if (isAdmin(ctx.from.id)) return;
    await dropQrMessage(ctx.from.id);
    clearUserState(ctx.from.id);
    const summary = ReferralProgram.getSummary(ctx.from.id);
    if (summary.balance < MIN_REFERRAL_AMOUNT_TIYIN) {
      await ctx.reply('Для вывода бонусного баланса нужно не менее 100 KGS.', referralMenuKeyboard());
      return;
    }
    if (ReferralProgram.hasPendingRequest(ctx.from.id)) {
      await ctx.reply('У вас уже есть необработанная заявка с бонусного баланса.', referralMenuKeyboard());
      return;
    }
    setUserState(ctx.from.id, { step: 'referral_withdraw_ask_qr', referral_withdraw_amount: summary.balance });
    await ctx.reply(
      `Будет оформлен вывод всего доступного бонусного баланса: ${formatSom(summary.balance)} KGS. Отправьте QR-код вашего банка фотографией или файлом изображения.`,
      backKeyboard()
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
