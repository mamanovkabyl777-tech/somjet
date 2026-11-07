const path = require('path');
const { Users, Transactions } = require('../../models');
const { setUserState, getUserState, clearUserState } = require('../state');
const config = require('../../config');
const { confirmWithdrawKeyboard } = require('../keyboards/adminKeyboard');
const {
  backKeyboard,
  clientKeyboard,
  mainMenuWithReply,
  isMenuButtonText,
  siteSelectKeyboard,
  isSiteButtonText,
  siteIdFromButton,
  isBackButtonText,
} = require('../keyboards/mainMenu');
const { isAdmin } = require('../adminAuth');
const { tgEmoji } = require('../emoji');
const { getSiteLabel } = require('../../providers');
const { safeErrorSummary } = require('../safeLog');

const WITHDRAW_EMOJI = tgEmoji('5312441427764989435', '💱');

function isValidKgPhone(phone) {
  const digits = String(phone).replace(/\s/g, '');
  if (/^\+996\d{9}$/.test(digits)) return true;
  if (/^996\d{9}$/.test(digits)) return true;
  if (/^0\d{9}$/.test(digits)) return true;
  if (/^\d{9}$/.test(digits)) return true;
  return false;
}

function withdrawGuideText(siteId) {
  const siteName = getSiteLabel(siteId);
  return (
    `КАК ПОЛУЧИТЬ КОД ВЫВОДА · ${siteName}\n\n` +
    '1. Откройте настройки игрового аккаунта.\n' +
    '2. Выберите вывод средств и способ «Наличные».\n' +
    '3. Укажите сумму и данные точки получения SOM JET.\n' +
    '4. Подтвердите заявку и дождитесь кода.\n' +
    '5. Отправьте полученный код сюда.'
  );
}

async function startWithdraw(ctx) {
  setUserState(ctx.from.id, { step: 'withdraw_choose_site' });
  await ctx.reply(`${WITHDRAW_EMOJI} <b>SOM JET · ВЫВОД</b>\n\nСначала выберите букмекера:`, {
    parse_mode: 'HTML',
    ...siteSelectKeyboard(),
  });
}

function escapeHtml(value) {
  return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function submitWithdrawal(ctx, state, fileId, fileType) {
  if (state.receipt_submit_in_progress) return;
  setUserState(ctx.from.id, { receipt_submit_in_progress: true });
  const user = Users.getByTelegramId(ctx.from.id);
  if (!user) {
    clearUserState(ctx.from.id);
    return;
  }

  const withdrawDetails =
    `Букмекер: ${getSiteLabel(state.withdraw_site)}\n` +
    `ID букмекера: ${state.withdraw_site_id}\n` +
    `Код получения: ${state.withdraw_code}\n` +
    'QR-код банка для зачисления: приложен';
  const receipt = {
    receipt_photo_id: fileType === 'photo' ? fileId : null,
    receipt_file: fileType === 'document' ? fileId : null,
  };
  let transactionId = state.pending_transaction_id;
  if (transactionId) {
    const updated = Transactions.updatePendingReceipt(transactionId, receipt);
    if (!updated.changes) transactionId = null;
  }
  if (!transactionId) {
    transactionId = Transactions.create({
      user_id: user.id,
      type: 'withdraw',
      amount: 0,
      withdraw_details: withdrawDetails,
      ...receipt,
      site: state.withdraw_site,
    }).transaction_id;
    setUserState(ctx.from.id, { pending_transaction_id: transactionId });
  }
  setUserState(ctx.from.id, { receipt_submit_in_progress: true, pending_transaction_id: transactionId });
  const txn = Transactions.getByTransactionId(transactionId);
  const userLink = user.username
    ? `<a href="https://t.me/${user.username}">${escapeHtml(user.first_name || user.username)}</a>`
    : escapeHtml(user.first_name || user.telegram_id);
  const channelText = `
⚡ <b>SOM JET · ЗАЯВКА НА ВЫВОД #${transactionId}</b>

👤 Пользователь: ${userLink}
🆔 Telegram ID: <code>${user.telegram_id}</code>
🎰 Букмекер: <b>${getSiteLabel(state.withdraw_site)}</b>
🎰 ID букмекера: <code>${escapeHtml(state.withdraw_site_id)}</code>
🔐 Код получения: <code>${escapeHtml(state.withdraw_code)}</code>
💰 QR-код банка для зачисления средств приложен
🕐 Создано: ${new Date(txn.created_at).toLocaleString('ru-RU')}

──────────────
📋 Копирование данных и управление заявкой:
  `.trim();

  try {
    const options = {
      caption: channelText,
      parse_mode: 'HTML',
      ...confirmWithdrawKeyboard(transactionId, {
        bookmakerId: state.withdraw_site_id,
        withdrawCode: state.withdraw_code,
        userId: user.telegram_id,
      }),
    };
    if (fileType === 'photo') {
      await ctx.telegram.sendPhoto(config.bot.channels.withdraw, fileId, options);
    } else {
      await ctx.telegram.sendDocument(config.bot.channels.withdraw, fileId, options);
    }
  } catch (error) {
    console.error('[Bot] Failed to send to withdraw channel:', safeErrorSummary(error));
    setUserState(ctx.from.id, { receipt_submit_in_progress: false, pending_transaction_id: transactionId });
    await ctx.reply('Заявка пока не ушла на обработку. Попробуйте позже или напишите администраторам SOM JET.');
    return;
  }

  clearUserState(ctx.from.id);
  await ctx.reply(
    `⚡ SOM JET получил вашу заявку *${transactionId}*.\n\nСообщим сюда, когда вывод будет обработан.`,
    { parse_mode: 'Markdown', ...mainMenuWithReply(isAdmin(ctx.from.id)) }
  );
}

function setupWithdrawHandlers(bot) {
  bot.action('btn_withdraw', async (ctx) => {
    await ctx.answerCbQuery();
    if (isAdmin(ctx.from.id)) return;
    const user = Users.getByTelegramId(ctx.from.id);
    if (!user) return;

    await startWithdraw(ctx);
  });

  bot.on('text', async (ctx, next) => {
    const text = ctx.message.text || '';
    if (text.startsWith('/') || isMenuButtonText(text)) return next();

    const state = getUserState(ctx.from.id);

    if (isBackButtonText(text)) {
      if (state.step === 'withdraw_choose_site') {
        clearUserState(ctx.from.id);
        await ctx.reply('Главное меню SOM JET:', clientKeyboard());
        return;
      }
      if (state.step === 'withdraw_ask_site_id') {
        setUserState(ctx.from.id, { step: 'withdraw_choose_site' });
        await ctx.reply(`${WITHDRAW_EMOJI} <b>SOM JET · ВЫВОД</b>\n\nВыберите букмекера:`, {
          parse_mode: 'HTML',
          ...siteSelectKeyboard(),
        });
        return;
      }
      if (state.step === 'withdraw_ask_code') {
        setUserState(ctx.from.id, { ...state, step: 'withdraw_ask_site_id' });
        await ctx.reply(`Отправьте ID аккаунта на площадке ${getSiteLabel(state.withdraw_site)}:`, backKeyboard());
        return;
      }
      if (state.step === 'withdraw_ask_bank_qr') {
        const { withdraw_code, ...previousState } = state;
        setUserState(ctx.from.id, { ...previousState, step: 'withdraw_ask_code' });
        await ctx.reply('Отправьте код, который выдала площадка после оформления вывода:', backKeyboard());
        return;
      }
      return next();
    }

    if (state.step === 'withdraw_choose_site') {
      if (!isSiteButtonText(text)) {
        await ctx.reply('Выберите букмекера с помощью кнопки ниже.', siteSelectKeyboard());
        return;
      }
      const siteId = siteIdFromButton(text);
      setUserState(ctx.from.id, { step: 'withdraw_ask_site_id', withdraw_site: siteId });
      await ctx.reply(
        `${WITHDRAW_EMOJI} <b>${getSiteLabel(siteId)}</b>\n\nОтправьте ID игрового аккаунта на этой площадке:`,
        { parse_mode: 'HTML', ...backKeyboard() }
      );
      return;
    }

    if (state.step === 'withdraw_ask_site_id') {
      const siteId = ctx.message.text.trim();
      if (!siteId) {
        await ctx.reply('Не вижу ID аккаунта. Отправьте его текстовым сообщением:', backKeyboard());
        return;
      }
      if (state.withdraw_site === '1xbet' && !/^\d{10}$/.test(siteId)) {
        await ctx.reply('Для 1XBET ID должен состоять ровно из 10 цифр. Проверьте его и отправьте ещё раз:', backKeyboard());
        return;
      }
      setUserState(ctx.from.id, { ...state, step: 'withdraw_ask_code', withdraw_site_id: siteId });
      const guidePath = path.join(process.cwd(), 'img', 'withdraw-guide.png');
      const guideText = withdrawGuideText(state.withdraw_site);
      try {
        await ctx.replyWithPhoto({ source: guidePath }, {
          caption: guideText,
          ...backKeyboard(),
        });
      } catch (error) {
        console.error('[Bot] Failed to send withdraw guide image:', safeErrorSummary(error));
        await ctx.reply(guideText, backKeyboard());
      }
      return;
    }

    if (state.step === 'withdraw_ask_code') {
      const code = ctx.message.text.trim();
      if (!code) {
        await ctx.reply('Отправьте код, который выдала площадка после оформления вывода:', backKeyboard());
        return;
      }
      setUserState(ctx.from.id, { ...state, withdraw_code: code, step: 'withdraw_ask_bank_qr' });
      await ctx.reply(
        'Отправьте QR-код вашего банка для зачисления средств <tg-emoji emoji-id="5224257782013769471">💰</tg-emoji>',
        { parse_mode: 'HTML', ...backKeyboard() }
      );
      return;
    }

    if (state.step === 'withdraw_ask_bank_qr') {
      await ctx.replyWithHTML(
        'Пожалуйста, отправьте QR-код вашего банка фотографией <tg-emoji emoji-id="5224257782013769471">💰</tg-emoji>',
        backKeyboard()
      );
      return;
    }

    await next();
  });

  bot.on(['photo', 'document'], async (ctx, next) => {
    const state = getUserState(ctx.from.id);
    if (state.step !== 'withdraw_ask_bank_qr') return next();

    if (ctx.message.photo?.length) {
      await submitWithdrawal(ctx, state, ctx.message.photo.at(-1).file_id, 'photo');
      return;
    }
    const document = ctx.message.document;
    if (document?.mime_type?.startsWith('image/')) {
      await submitWithdrawal(ctx, state, document.file_id, 'document');
      return;
    }
    await ctx.replyWithHTML(
      'Это не изображение QR-кода. Отправьте QR фотографией или файлом изображения <tg-emoji emoji-id="5224257782013769471">💰</tg-emoji>',
      backKeyboard()
    );
  });
}

module.exports = { setupWithdrawHandlers, startWithdraw, isValidKgPhone };
