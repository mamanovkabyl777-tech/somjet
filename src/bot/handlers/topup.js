const { Markup } = require('telegraf');
const path = require('path');
const fs = require('fs');
const { Users, Requisites, Transactions, PlayerIds, BotSettings, ReferralProgram } = require('../../models');
const { setUserState, getUserState, clearUserState } = require('../state');
const config = require('../../config');
const { confirmTopupKeyboard } = require('../keyboards/adminKeyboard');
const {
  mainMenuWithReply,
  qrAmountKeyboard,
  clientKeyboard,
  siteSelectKeyboard,
  SITE_EMOJI_IDS,
  playerIdKeyboard,
  isMenuButtonText,
  isBackButtonText,
  isSiteButtonText,
  siteIdFromButton,
  referralMenuKeyboard,
} = require('../keyboards/mainMenu');
const { isAdmin } = require('../adminAuth');
const { SITE_PROVIDERS, providerLabel, getSiteLabel } = require('../../providers');
const { qrAmountHtml, tgEmoji } = require('../emoji');
const { QR_TTL_MS, qrCaption, startQrCountdown, stopQrCountdown, dropQrMessage } = require('../qrTimer');
const { readPaymentLinkFragmentFromTelegramPhoto } = require('../qrRequisites');
const { safeErrorSummary, safeTelegramErrorSummary } = require('../safeLog');
const { isReceiptImageTooLarge, rejectOversizedReceiptImage } = require('../receiptImage');
const { isUserPrivacyRestricted } = require('../contactFallback');
const { parseSomAmount, isValidTopupAmount, formatSom } = require('../money');

const HOURGLASS_EMOJI = tgEmoji('5213452215527677338', '⏳');
const BANK_PAYMENT_LINKS = [
  ['Mbank', 'https://app.mbank.kg/qr/'],
  ['O! Банк', 'https://api.dengi.o.kg/ru/qr/'],
  ['BAKAI', 'https://bakai24.app/'],
  ['MegaPay', 'https://megapay.kg/get'],
];

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function bankPaymentKeyboard(paymentLinkFragment) {
  if (!paymentLinkFragment?.startsWith('#')) return undefined;
  const buttons = BANK_PAYMENT_LINKS.map(([label, baseUrl]) =>
    Markup.button.url(label, `${baseUrl}${paymentLinkFragment}`)
  );
  return Markup.inlineKeyboard([buttons.slice(0, 2), buttons.slice(2)]);
}

function siteGuidePath(siteId) {
  return path.join(process.cwd(), 'img', `${siteId}.jpg`);
}

async function askBookmaker(ctx) {
  setUserState(ctx.from.id, { step: 'topup_choose_site' });
  await ctx.reply(
    '<b>⚡ SOM JET · ПОПОЛНЕНИЕ</b>\nВыберите площадку, на которой находится ваш игровой аккаунт:',
    { parse_mode: 'HTML', ...siteSelectKeyboard() }
  );
}

async function askSitePaymentId(ctx, siteId) {
  if (!SITE_PROVIDERS.includes(siteId) || !BotSettings.isEnabled(`site:${siteId}`)) {
    await ctx.reply(`Сейчас нельзя пополнить ${getSiteLabel(siteId)}. Выберите другую площадку или попробуйте позже.`);
    await askBookmaker(ctx);
    return;
  }
  const siteName = getSiteLabel(siteId);
  const siteEmojiId = SITE_EMOJI_IDS[siteId];
  setUserState(ctx.from.id, { step: 'topup_ask_site_id', kind: 'bank_qr', provider: 'qr_bank', site: siteId });
  const prompt =
    `<tg-emoji emoji-id="${siteEmojiId}">⚡</tg-emoji> <b>${siteName} · SOM JET</b>\n\n` +
    `Найдите игровой ID в профиле площадки и отправьте его сюда.\n` +
    `<tg-emoji emoji-id="6271786398404055377">🔎</tg-emoji> Перед отправкой сверьте цифры: платёж будет привязан к этому ID.`;
  const imgPath = siteGuidePath(siteId);
  const recentIds = PlayerIds.lastTwo(ctx.from.id, siteId);
  const extra = { parse_mode: 'HTML', ...playerIdKeyboard(recentIds) };
  if (fs.existsSync(imgPath)) {
    await ctx.replyWithPhoto({ source: imgPath }, { caption: prompt, ...extra });
    return;
  }
  await ctx.reply(prompt, extra);
}

async function askQrAmount(ctx) {
  await ctx.replyWithHTML(qrAmountHtml(), qrAmountKeyboard());
}

async function beginQrAmount(ctx, state) {
  const requisite = Requisites.getActiveByProvider('qr_bank');
  if (!requisite) {
    await ctx.replyWithHTML(
      'В данное время реквизиты отсутствуют <tg-emoji emoji-id="6269223265001017592">🥳</tg-emoji>\n' +
      'Напишите в поддержку <tg-emoji emoji-id="5443038326535759644">💬</tg-emoji>',
      mainMenuWithReply(isAdmin(ctx.from.id))
    );
    clearUserState(ctx.from.id);
    return;
  }
  setUserState(ctx.from.id, {
    ...state,
    step: 'topup_ask_amount',
    kind: 'bank_qr',
    provider: 'qr_bank',
    requisite_id: requisite.id,
  });
  await askQrAmount(ctx);
}

async function sendQrInvoice(ctx, state, requisite) {
  const caption = qrCaption(state.payment_id, state.amount, QR_TTL_MS);
  let paymentLinkFragment = requisite.provider === 'qr_bank'
    ? requisite.payment_link_fragment
    : null;
  if (!paymentLinkFragment && requisite.provider === 'qr_bank' && requisite.qr_code_photo_id) {
    try {
      paymentLinkFragment = await readPaymentLinkFragmentFromTelegramPhoto(
        ctx.telegram,
        requisite.qr_code_photo_id
      );
      Requisites.setPaymentLinkFragment(requisite.id, paymentLinkFragment);
    } catch (error) {
      console.error('[Topup] Could not extract bank payment links from saved QR:', safeErrorSummary(error));
    }
  }
  const paymentKeyboard = bankPaymentKeyboard(paymentLinkFragment);
  const extra = { caption, parse_mode: 'HTML', ...(paymentKeyboard || {}) };
  let sent = null;
  let hasPhoto = false;

  if (requisite.qr_code_photo_id) {
    sent = await ctx.replyWithPhoto(requisite.qr_code_photo_id, extra);
    hasPhoto = true;
  } else if (requisite.qr_code_file) {
    const filePath = path.join(process.cwd(), requisite.qr_code_file);
    if (fs.existsSync(filePath)) {
      sent = await ctx.replyWithPhoto({ source: filePath }, extra);
      hasPhoto = true;
    }
  }

  if (!sent) {
    sent = await ctx.reply(caption, { parse_mode: 'HTML' });
  }

  startQrCountdown(ctx.telegram, {
    userId: ctx.from.id,
    chatId: ctx.chat.id,
    messageId: sent.message_id,
    paymentId: state.payment_id,
    amount: state.amount,
    hasPhoto,
    requisiteId: requisite.id,
    replyMarkup: paymentKeyboard?.reply_markup,
  });
}

async function showRequisites(ctx, state) {
  const requisite = Requisites.getActiveByProvider(state.provider || 'qr_bank');
  if (!requisite) {
    await ctx.reply(
      'Платёжные данные временно недоступны. Вернитесь к пополнению позже или обратитесь в SOM JET.',
      mainMenuWithReply(isAdmin(ctx.from.id))
    );
    clearUserState(ctx.from.id);
    return;
  }

  setUserState(ctx.from.id, {
    ...state,
    step: 'topup_ask_receipt',
    requisite_id: requisite.id,
  });
  await sendQrInvoice(ctx, state, requisite);
}

async function sendToTopupChannel(ctx, { user, fileId, fileType, txn, amount, paymentId, provider, siteName }) {
  const displayName = escapeHtml(user.first_name || user.username || user.telegram_id);
  const userLink = user.username
    ? `<a href="https://t.me/${user.username}">${displayName}</a>`
    : displayName;
  const methodLabel = SITE_PROVIDERS.includes(provider) ? getSiteLabel(provider) : providerLabel(provider);
  const bookmaker = siteName || methodLabel;
  const bookmakerTitle = escapeHtml(bookmaker.toUpperCase().replace(/\s+/g, ''));
  const paymentLabel = siteName ? `${siteName} · ${methodLabel}` : methodLabel;

  const channelText = `
<blockquote>⚡️ <b>ПОПОЛНЕНИЕ | ${bookmakerTitle}</b></blockquote>
🎮 ID букмекера: <code>${escapeHtml(paymentId)}</code>
🎰 ${escapeHtml(paymentLabel)} · <b>${formatSom(amount)} сом</b>
👤 ${userLink} · <code>${user.telegram_id}</code>
🕐 ${new Date(txn.created_at).toLocaleString('ru-RU')}

──────────────
📎 Чек и управление заявкой:
  `.trim();

  const sendOptions = {
    caption: channelText,
    parse_mode: 'HTML',
  };

  if (fileType === 'photo') {
    const send = (contactUnavailable) => ctx.telegram.sendPhoto(config.bot.channels.topup, fileId, {
      ...sendOptions,
      ...confirmTopupKeyboard(txn.transaction_id, paymentId, user.telegram_id, contactUnavailable),
    });
    try { await send(false); } catch (error) {
      if (!isUserPrivacyRestricted(error)) throw error;
      await send(true);
    }
  } else {
    const send = (contactUnavailable) => ctx.telegram.sendDocument(config.bot.channels.topup, fileId, {
      ...sendOptions,
      ...confirmTopupKeyboard(txn.transaction_id, paymentId, user.telegram_id, contactUnavailable),
    });
    try { await send(false); } catch (error) {
      if (!isUserPrivacyRestricted(error)) throw error;
      await send(true);
    }
  }
}

async function submitTopupReceipt(ctx, state, fileId, fileType) {
  if (state.receipt_submit_in_progress) return;
  setUserState(ctx.from.id, { receipt_submit_in_progress: true });
  const user = Users.getByTelegramId(ctx.from.id);
  if (!user) {
    clearUserState(ctx.from.id);
    return;
  }

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
      type: 'topup',
      amount: state.amount,
      requisite_id: state.requisite_id,
      provider: state.provider,
      ...receipt,
      payment_id: state.payment_id,
      site: state.site,
    }).transaction_id;
    setUserState(ctx.from.id, { pending_transaction_id: transactionId });
  }
  setUserState(ctx.from.id, { receipt_submit_in_progress: true, pending_transaction_id: transactionId });
  const txn = Transactions.getByTransactionId(transactionId);

  try {
    await sendToTopupChannel(ctx, {
      user,
      fileId,
      fileType,
      txn,
      amount: state.amount,
      paymentId: state.payment_id,
      provider: state.provider,
      siteName: state.site_name,
    });
  } catch (e) {
    console.error(`[Bot] Failed to send ${fileType} receipt to top-up channel:`, safeTelegramErrorSummary(e));
    setUserState(ctx.from.id, { receipt_submit_in_progress: false, pending_transaction_id: transactionId });
    await ctx.reply('Не получилось передать заявку на проверку. Попробуйте ещё раз или свяжитесь с администраторами SOM JET.');
    return;
  }

  stopQrCountdown(ctx.from.id);
  clearUserState(ctx.from.id);
  await ctx.reply(
    `${HOURGLASS_EMOJI} SOM JET принял заявку <b>${transactionId}</b>.\n` +
      `Ожидайте проверки вашей транзакции.\n\n` +
      `<blockquote><i>Команда SOM JET</i></blockquote>`,
    { parse_mode: 'HTML', ...mainMenuWithReply(isAdmin(ctx.from.id)) }
  );
}

async function submitReferralBalanceTopup(ctx, state, bookmakerId) {
  if (state.receipt_submit_in_progress) return;
  setUserState(ctx.from.id, { receipt_submit_in_progress: true });
  const user = Users.getByTelegramId(ctx.from.id);
  if (!user) {
    clearUserState(ctx.from.id);
    return;
  }
  const summary = ReferralProgram.getSummary(ctx.from.id);
  const amount = summary.balance;
  if (amount < 100 * 100) {
    clearUserState(ctx.from.id);
    await ctx.reply('Для пополнения бонусным балансом нужно не менее 100 KGS.', referralMenuKeyboard());
    return;
  }

  const site = state.referral_topup_site;
  const siteName = getSiteLabel(site);
  const transactionId = Transactions.create({
    user_id: user.id,
    type: 'topup',
    amount,
    provider: 'referral_balance',
    payment_id: bookmakerId,
    site,
  }).transaction_id;
  const reservation = ReferralProgram.reserveBalance(ctx.from.id, transactionId, amount);
  if (!reservation.ok) {
    Transactions.updateStatus(Transactions.getByTransactionId(transactionId).id, 'cancelled');
    await ctx.reply(
      reservation.reason === 'pending_request'
        ? 'У вас уже есть необработанная заявка с бонусного баланса.'
        : 'Баланс изменился. Откройте реферальное меню и попробуйте снова.',
      referralMenuKeyboard()
    );
    clearUserState(ctx.from.id);
    return;
  }

  const displayName = escapeHtml(user.first_name || user.username || user.telegram_id);
  const userLink = user.username
    ? `<a href="https://t.me/${user.username}">${displayName}</a>`
    : displayName;
  const text =
    `⚡ <b>SOM JET · ПОПОЛНЕНИЕ С БОНУСНОГО БАЛАНСА #${transactionId}</b>\n\n` +
    `👤 Пользователь: ${userLink} · <code>${user.telegram_id}</code>\n` +
    `🎰 Букмекер: <b>${escapeHtml(siteName)}</b>\n` +
    `🎮 ID букмекера: <code>${escapeHtml(bookmakerId)}</code>\n` +
    `💰 Сумма: <b>${formatSom(amount)} KGS</b>\n\n` +
    `Заявка оплачивается из реферального бонусного баланса.`;

  const send = (contactUnavailable) => ctx.telegram.sendMessage(
    config.bot.channels.topup,
    text,
    { parse_mode: 'HTML', ...confirmTopupKeyboard(transactionId, bookmakerId, user.telegram_id, contactUnavailable) }
  );
  try {
    try { await send(false); } catch (error) {
      if (!isUserPrivacyRestricted(error)) throw error;
      await send(true);
    }
  } catch (error) {
    const txn = Transactions.getByTransactionId(transactionId);
    Transactions.updateStatus(txn.id, 'cancelled');
    ReferralProgram.refundTransaction(transactionId);
    console.error('[Referral] Failed to send bonus top-up request:', safeTelegramErrorSummary(error));
    setUserState(ctx.from.id, { step: 'referral_topup_ask_id', referral_topup_site: site, receipt_submit_in_progress: false });
    await ctx.reply('Не получилось отправить заявку. Бонусный баланс возвращён. Попробуйте ещё раз отправить ID букмекера:');
    return;
  }

  clearUserState(ctx.from.id);
  await ctx.reply(
    `Заявка на пополнение БК на ${formatSom(amount)} KGS отправлена на проверку. Номер: ${transactionId}.`,
    referralMenuKeyboard()
  );
}

function setupTopupHandlers(bot) {
  bot.action('btn_topup', async (ctx) => {
    await ctx.answerCbQuery();
    if (isAdmin(ctx.from.id)) return;
    await dropQrMessage(ctx.from.id);
    clearUserState(ctx.from.id);
    await askBookmaker(ctx);
  });

  bot.action('btn_back_to_sites', async (ctx) => {
    await ctx.answerCbQuery();
    if (isAdmin(ctx.from.id)) return;
    await askBookmaker(ctx);
  });

  bot.action(/^btn_site_topup:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    if (isAdmin(ctx.from.id)) return;
    await askSitePaymentId(ctx, ctx.match[1]);
  });

  bot.on('text', async (ctx, next) => {
    const text = ctx.message.text || '';
    if (text.startsWith('/') || isMenuButtonText(text)) return next();

    const state = getUserState(ctx.from.id);

    if (isBackButtonText(text)) {
      if (state.step === 'referral_topup_choose_site') {
        clearUserState(ctx.from.id);
        await ctx.reply('Меню реферальной программы:', referralMenuKeyboard());
        return;
      }
      if (state.step === 'referral_topup_ask_id') {
        setUserState(ctx.from.id, { step: 'referral_topup_choose_site' });
        await ctx.reply('Выберите букмекера:', siteSelectKeyboard());
        return;
      }
      if (state.step === 'topup_choose_site') {
        return next();
      }
      if (state.step === 'topup_ask_site_id') {
        await askBookmaker(ctx);
        return;
      }
      if (state.step === 'topup_ask_amount' && state.site) {
        await askSitePaymentId(ctx, state.site);
        return;
      }
      return next();
    }

    if (state.step === 'referral_topup_choose_site' && isSiteButtonText(text)) {
      const site = siteIdFromButton(text);
      setUserState(ctx.from.id, { ...state, step: 'referral_topup_ask_id', referral_topup_site: site });
      await ctx.reply(`Отправьте ID аккаунта ${getSiteLabel(site)}. Будет использован весь доступный бонусный баланс:`);
      return;
    }

    if (state.step === 'referral_topup_choose_site') {
      await ctx.reply('Выберите букмекера с помощью кнопки ниже.', siteSelectKeyboard());
      return;
    }

    if (state.step === 'referral_topup_ask_id') {
      const bookmakerId = text.trim();
      if (!bookmakerId) {
        await ctx.reply('Отправьте ID аккаунта текстовым сообщением:');
        return;
      }
      PlayerIds.remember(ctx.from.id, bookmakerId, state.referral_topup_site);
      await submitReferralBalanceTopup(ctx, state, bookmakerId);
      return;
    }

    if (state.step === 'topup_choose_site' && isSiteButtonText(text)) {
      await askSitePaymentId(ctx, siteIdFromButton(text));
      return;
    }

    if (state.step === 'topup_ask_site_id') {
      const userSiteId = ctx.message.text.trim();
      if (!userSiteId) {
        await ctx.reply('Отправьте игровой ID текстом, чтобы продолжить:');
        return;
      }
      if (!/^\d{8,11}$/.test(userSiteId)) {
        await ctx.reply(
          '<tg-emoji emoji-id="6271786398404055377">⚠️</tg-emoji> Для 1XBET нужен ID из 8-11 цифр. Проверьте профиль и отправьте номер ещё раз:',
          { parse_mode: 'HTML' }
        );
        return;
      }
      const siteName = getSiteLabel(state.site);
      PlayerIds.remember(ctx.from.id, userSiteId, state.site);
      await beginQrAmount(ctx, {
        ...state,
        payment_id: userSiteId,
        site_name: siteName,
      });
      return;
    }

    if (state.step === 'topup_ask_amount') {
      const amount = parseSomAmount(ctx.message.text);
      if (amount === null || amount <= 0) {
        await ctx.reply('Укажите сумму цифрами, например 500.');
        return;
      }
      if (!isValidTopupAmount(amount)) {
        await ctx.reply('Сумма должна быть от 40 до 10 000 сом. Укажите другое значение:');
        return;
      }
      await showRequisites(ctx, { ...state, amount });
      return;
    }

    await next();
  });

  bot.on('photo', async (ctx, next) => {
    const state = getUserState(ctx.from.id);
    if (state.step !== 'topup_ask_receipt') {
      return next();
    }

    const user = Users.getByTelegramId(ctx.from.id);
    if (!user) return;

    const photo = ctx.message.photo;
    if (isReceiptImageTooLarge(photo[photo.length - 1])) {
      await rejectOversizedReceiptImage(ctx);
      return;
    }
    const fileId = photo[photo.length - 1].file_id;
    await submitTopupReceipt(ctx, state, fileId, 'photo');
  });

  bot.on('document', async (ctx, next) => {
    const state = getUserState(ctx.from.id);
    if (state.step !== 'topup_ask_receipt') {
      return next();
    }

    const user = Users.getByTelegramId(ctx.from.id);
    if (!user) return;

    const document = ctx.message.document;
    if (document.mime_type?.startsWith('image/') && isReceiptImageTooLarge(document)) {
      await rejectOversizedReceiptImage(ctx);
      return;
    }
    await submitTopupReceipt(ctx, state, document.file_id, 'document');
  });
}

module.exports = { setupTopupHandlers, askBookmaker };
