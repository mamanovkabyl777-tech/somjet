const { Markup } = require('telegraf');
const { tgEmoji, SUPPORT_CONTACTS } = require('../emoji');

function supportMessage() {
  return (
    `${tgEmoji('5224615432530461449', '💬')} <b>Команда SOM JET на связи</b>\n\n` +
    `По вопросам пополнения и вывода напишите: ${SUPPORT_CONTACTS}\n` +
    `Чтобы мы быстрее помогли, приложите номер заявки и кратко опишите ситуацию.`
  );
}

function setupSupportHandlers(bot) {
  bot.action('btn_support', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply(
      supportMessage(),
      {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([[Markup.button.callback('🔙 Меню', 'btn_back_to_menu')]]),
      }
    );
  });
}

module.exports = { setupSupportHandlers, supportMessage };
