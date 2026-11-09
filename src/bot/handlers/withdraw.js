const path = require('path');
const { Users, Transactions, ReferralProgram } = require('../../models');
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
  referralMenuKeyboard,
} = require('../keyboards/mainMenu');
const { isAdmin } = require('../adminAuth');
const { tgEmoji } = require('../emoji');
const { getSiteLabel } = require('../../providers');
const { safeTelegramErrorSummary } = require('../safeLog');
const { isReceiptImageTooLarge, rejectOversizedReceiptImage } = require('../receiptImage');
const { isUserPrivacyRestricted } = require('../contactFallback');
const { formatSom } = require('../money');

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
    };
    const contactDetails = {
        bookmakerId: state.withdraw_site_id,
        withdrawCode: state.withdraw_code,
        userId: user.telegram_id,
    };
    const send = (contactUnavailable) => {
      const sendOptions = { ...options, ...confirmWithdrawKeyboard(transactionId, contactDetails, contactUnavailable) };
      return fileType === 'photo'
        ? ctx.telegram.sendPhoto(config.bot.channels.withdraw, fileId, sendOptions)
        : ctx.telegram.sendDocument(config.bot.channels.withdraw, fileId, sendOptions);
    };
    try { await send(false); } catch (error) {
      if (!isUserPrivacyRestricted(error)) throw error;
      await send(true);
    }
  } catch (error) {
    console.error('[Bot] Failed to send to withdraw channel:', safeTelegramErrorSummary(error));
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

async function submitReferralWithdrawal(ctx, state, fileId, fileType) {
  if (state.receipt_submit_in_progress) return;
  setUserState(ctx.from.id, { receipt_submit_in_progress: true });
  const user = Users.getByTelegramId(ctx.from.id);
  if (!user) {
    clearUserState(ctx.from.id);
    return;
  }
  const amount = Number(state.referral_withdraw_amount);
  if (!Number.isSafeInteger(amount) || amount < 100 * 100) {
    clearUserState(ctx.from.id);
    await ctx.reply('Для вывода бонусного баланса нужно не менее 100 KGS.', referralMenuKeyboard());
    return;
  }

  const transactionId = Transactions.create({
    user_id: user.id,
    type: 'withdraw',
    amount,
    provider: 'referral_balance',
    withdraw_details: `Вывод бонусного баланса\nСумма: ${formatSom(amount)} KGS`,
    receipt_photo_id: fileType === 'photo' ? fileId : null,
    receipt_file: fileType === 'document' ? fileId : null,
  }).transaction_id;
  const reservation = ReferralProgram.reserveBalance(ctx.from.id, transactionId, amount);
  if (!reservation.ok) {
    Transactions.updateStatus(Transactions.getByTransactionId(transactionId).id, 'cancelled');
    clearUserState(ctx.from.id);
    await ctx.reply(
      reservation.reason === 'pending_request'
        ? 'У вас уже есть необработанная заявка с бонусного баланса.'
        : 'Баланс изменился. Откройте реферальное меню и попробуйте снова.',
      referralMenuKeyboard()
    );
    return;
  }

  const details = `
💸 <b>SOM JET · ВЫВОД БОНУСНОГО БАЛАНСА #${transactionId}</b>

👤 Пользователь: ${escapeHtml(user.first_name || user.username || user.telegram_id)}
🆔 Telegram ID: <code>${user.telegram_id}</code>
💰 Сумма: <b>${formatSom(amount)} KGS</b>
💳 QR-код банка для выплаты приложен
  `.trim();
  const send = (contactUnavailable) => {
    const options = {
      caption: details,
      parse_mode: 'HTML',
      ...confirmWithdrawKeyboard(transactionId, {
        payoutDetails: `Вывод бонусного баланса · ${formatSom(amount)} KGS`,
        userId: user.telegram_id,
      }, contactUnavailable),
    };
    return fileType === 'photo'
      ? ctx.telegram.sendPhoto(config.bot.channels.withdraw, fileId, options)
      : ctx.telegram.sendDocument(config.bot.channels.withdraw, fileId, options);
  };
  try {
    try { await send(false); } catch (error) {
      if (!isUserPrivacyRestricted(error)) throw error;
      await send(true);
    }
  } catch (error) {
    Transactions.updateStatus(Transactions.getByTransactionId(transactionId).id, 'cancelled');
    ReferralProgram.refundTransaction(transactionId);
    console.error('[Referral] Failed to send bonus withdrawal request:', safeTelegramErrorSummary(error));
    setUserState(ctx.from.id, { receipt_submit_in_progress: false });
    await ctx.reply('Не получилось отправить заявку. Бонусный баланс возвращён. Попробуйте отправить QR-код ещё раз.', backKeyboard());
    return;
  }

  clearUserState(ctx.from.id);
  await ctx.reply(`Заявка на вывод ${formatSom(amount)} KGS отправлена на проверку. Номер: ${transactionId}.`, referralMenuKeyboard());
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
      if (state.step === 'referral_withdraw_ask_qr') {
        clearUserState(ctx.from.id);
        await ctx.reply('Меню реферальной программы:', referralMenuKeyboard());
        return;
      }
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
      if (!/^\d{8,11}$/.test(siteId)) {
        await ctx.reply('Для 1XBET нужен ID из 8-11 цифр. Проверьте профиль и отправьте номер ещё раз:', backKeyboard());
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
        'Отправьте QR-код банка для зачисления средств (изображение до 15 МБ). Если разрешение высокое, отправьте его как файл <tg-emoji emoji-id="5224257782013769471">💰</tg-emoji>',
        { parse_mode: 'HTML', ...backKeyboard() }
      );
      return;
    }

    if (state.step === 'withdraw_ask_bank_qr') {
      await ctx.replyWithHTML(
        'Отправьте QR-код фотографией или файлом изображения (до 15 МБ). Для высокого разрешения используйте отправку как файл <tg-emoji emoji-id="5224257782013769471">💰</tg-emoji>',
        backKeyboard()
      );
      return;
    }

    if (state.step === 'referral_withdraw_ask_qr') {
      await ctx.reply('Отправьте QR-код банка фотографией или файлом изображения.', backKeyboard());
      return;
    }

    await next();
  });

  bot.on(['photo', 'document'], async (ctx, next) => {
    const state = getUserState(ctx.from.id);
    if (state.step !== 'withdraw_ask_bank_qr' && state.step !== 'referral_withdraw_ask_qr') return next();

    if (ctx.message.photo?.length) {
      const photo = ctx.message.photo.at(-1);
      if (isReceiptImageTooLarge(photo)) {
        await rejectOversizedReceiptImage(ctx);
        return;
      }
      if (state.step === 'referral_withdraw_ask_qr') await submitReferralWithdrawal(ctx, state, photo.file_id, 'photo');
      else await submitWithdrawal(ctx, state, photo.file_id, 'photo');
      return;
    }
    const document = ctx.message.document;
    if (document?.mime_type?.startsWith('image/')) {
      if (isReceiptImageTooLarge(document)) {
        await rejectOversizedReceiptImage(ctx);
        return;
      }
      if (state.step === 'referral_withdraw_ask_qr') await submitReferralWithdrawal(ctx, state, document.file_id, 'document');
      else await submitWithdrawal(ctx, state, document.file_id, 'document');
      return;
    }
    await ctx.replyWithHTML(
      'Это не изображение QR-кода. Отправьте QR фотографией или файлом изображения <tg-emoji emoji-id="5224257782013769471">💰</tg-emoji>',
      backKeyboard()
    );
  });
}

module.exports = { setupWithdrawHandlers, startWithdraw, isValidKgPhone };
