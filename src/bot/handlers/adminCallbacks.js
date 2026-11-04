const { Users, Transactions, BotSettings } = require('../../models');
const { isAdmin, getAdminRecord } = require('../adminAuth');
const { clearUserState } = require('../state');
const { tgEmoji } = require('../emoji');
const {
  confirmTopupFinalKeyboard,
  confirmTopupKeyboard,
  copyTopupKeyboard,
  copyWithdrawKeyboard,
} = require('../keyboards/adminKeyboard');

const CHECK_EMOJI = tgEmoji('6269163801178804220', '✅');
const SAD_EMOJI = tgEmoji('6269245551586316810', '😢');

function callbackMessage(ctx) {
  return ctx.callbackQuery?.message;
}

function messageText(msg) {
  return msg?.caption || msg?.text || '';
}

function withdrawCopyDetails(transaction) {
  const details = String(transaction?.withdraw_details || '');
  const user = transaction ? Users.getById(transaction.user_id) : null;
  return {
    bookmakerId: details.match(/^ID букмекера:\s*(.*)$/mi)?.[1]?.trim() || '',
    withdrawCode: details.match(/^Код получения:\s*(.*)$/mi)?.[1]?.trim() || '',
    payoutDetails: details.match(/^Реквизиты для выплаты:\s*([\s\S]*)$/mi)?.[1]?.trim() || '',
    userId: user?.telegram_id,
  };
}

function transactionUserId(transaction) {
  return transaction ? Users.getById(transaction.user_id)?.telegram_id : null;
}

async function updateChannelMessage(ctx, text, extra = {}) {
  const msg = callbackMessage(ctx);
  if (!msg) return;
  try {
    if (msg.photo || msg.document) {
      await ctx.editMessageCaption(text, extra);
    } else {
      await ctx.editMessageText(text, extra);
    }
  } catch (e) {
    console.error('[Admin] Failed to edit channel message:', e.message);
  }
}

async function applyTopupConfirm(ctx, transactionId) {
  let txn = Transactions.getByTransactionId(transactionId);
  if (!txn || txn.type !== 'topup') {
    await ctx.answerCbQuery('⚠️ Заявка на пополнение не найдена');
    return false;
  }

  if (txn.status === 'pending') {
    const admin = getAdminRecord(ctx.from.id);
    const result = Transactions.updatePendingStatus(txn.id, 'topup', 'confirmed', admin?.id || null);
    if (result.changes !== 1) {
      txn = Transactions.getByTransactionId(transactionId);
      if (txn?.status !== 'confirmed') {
        await ctx.answerCbQuery('⚠️ Заявка уже обработана');
        return false;
      }
    } else {
      recordTopupStats(txn);
    }
  } else if (txn.status !== 'confirmed') {
    await ctx.answerCbQuery('⚠️ Заявка уже обработана');
    return false;
  }

  recordTopupStats(txn);
  await notifyTopupConfirmed(ctx, txn);
  return true;
}

function recordTopupStats(txn) {
  const key = `topup_stats_counted:${txn.transaction_id}`;
  if (BotSettings.get(key, '0') === '1') return;
  Transactions.incrementStat('total_topups');
  Transactions.incrementStat('total_transactions');
  Transactions.incrementStat('total_volume', txn.amount);
  BotSettings.set(key, '1');
}

async function notifyTopupConfirmed(ctx, txn) {
  const key = `topup_notified:${txn.transaction_id}`;
  if (BotSettings.get(key, '0') === '1') return;
  const user = Users.getById(txn.user_id);
  if (!user) return;
  try {
    await ctx.telegram.sendMessage(
      user.telegram_id,
      `${CHECK_EMOJI} <b>SOM JET · ПОПОЛНЕНИЕ ПОДТВЕРЖДЕНО</b>\n\n` +
        `На игровой счёт отправлено <b>${Number(txn.amount).toFixed(2)} сом</b>.\n` +
        `Номер заявки: <code>${txn.transaction_id}</code>`,
      { parse_mode: 'HTML' }
    );
    BotSettings.set(key, '1');
  } catch (error) {
    console.error('[Bot] Failed to notify user:', error.message);
  }
}

async function applyWithdrawConfirm(ctx, transactionId) {
  const txn = Transactions.getByTransactionId(transactionId);
  if (!txn || txn.status !== 'pending' || txn.type !== 'withdraw') {
    await ctx.answerCbQuery('⚠️ Транзакция не найдена или уже обработана');
    return false;
  }

  const admin = getAdminRecord(ctx.from.id);
  Transactions.updateStatus(txn.id, 'confirmed', admin?.id || null);

  const user = Users.getById(txn.user_id);
  if (user) {
    const payoutText = Number(txn.amount) > 0
      ? `Со счета списано <b>${Number(txn.amount).toFixed(2)} сом</b>\n`
      : 'Заявка обработана.\n';
    await ctx.telegram.sendMessage(
      user.telegram_id,
      `✅ <b>SOM JET · ВЫВОД ОБРАБОТАН</b>\n\n` +
        payoutText +
        `Транзакция: <code>${transactionId}</code>`,
      { parse_mode: 'HTML' }
    ).catch((e) => console.error('[Bot] Failed to notify user:', e.message));
  }

  Transactions.incrementStat('total_withdrawals');
  Transactions.incrementStat('total_transactions');
  Transactions.incrementStat('total_volume', txn.amount);
  return true;
}

function setupAdminCallbacks(bot) {
  bot.action(/^topup_confirm:(.+)$/, async (ctx) => {
    const transactionId = ctx.match[1];
    if (!isAdmin(ctx.from.id)) {
      await ctx.answerCbQuery('⛔ Доступ запрещен');
      return;
    }

    const txn = Transactions.getByTransactionId(transactionId);
    if (!txn || txn.status !== 'pending' || txn.type !== 'topup') {
      await ctx.answerCbQuery('⚠️ Транзакция не найдена или уже обработана');
      return;
    }

    await ctx.answerCbQuery();
    const caption = messageText(callbackMessage(ctx));
    await ctx.editMessageReplyMarkup(confirmTopupFinalKeyboard(transactionId).reply_markup);
    await updateChannelMessage(ctx, caption + '\n\n🔐 <b>Ожидается финальное подтверждение…</b>', {
      parse_mode: 'HTML',
      ...confirmTopupFinalKeyboard(transactionId),
    });
  });

  bot.action(/^topup_undo_confirm:(.+)$/, async (ctx) => {
    const transactionId = ctx.match[1];
    if (!isAdmin(ctx.from.id)) {
      await ctx.answerCbQuery('⛔ Доступ запрещен');
      return;
    }
    const txn = Transactions.getByTransactionId(transactionId);
    await ctx.answerCbQuery();
    const caption = messageText(callbackMessage(ctx)).replace(
      '\n\n🔐 <b>Ожидается финальное подтверждение…</b>',
      ''
    );
    await updateChannelMessage(ctx, caption, {
      parse_mode: 'HTML',
      ...confirmTopupKeyboard(transactionId, txn.payment_id, transactionUserId(txn)),
    });
  });

  bot.action(/^topup_final_confirm:(.+)$/, async (ctx) => {
    const transactionId = ctx.match[1];
    if (!isAdmin(ctx.from.id)) {
      await ctx.answerCbQuery('⛔ Доступ запрещен');
      return;
    }

    const ok = await applyTopupConfirm(ctx, transactionId);
    if (!ok) return;
    const txn = Transactions.getByTransactionId(transactionId);

    await ctx.answerCbQuery('✅ Подтверждено');
    const adminName = ctx.from.first_name || ctx.from.username || 'Admin';
    const caption = messageText(callbackMessage(ctx)).replace(
      '\n\n🔐 <b>Ожидается финальное подтверждение…</b>',
      ''
    );
    await updateChannelMessage(ctx, caption + `\n\n✅ <b>Подтверждено: ${adminName}</b>`, {
      parse_mode: 'HTML',
      ...copyTopupKeyboard(txn.payment_id, transactionUserId(txn)),
    });
  });

  bot.action(/^topup_reject:(.+)$/, async (ctx) => {
    const transactionId = ctx.match[1];
    if (!isAdmin(ctx.from.id)) {
      await ctx.answerCbQuery('⛔ Доступ запрещен');
      return;
    }

    const txn = Transactions.getByTransactionId(transactionId);
    if (!txn || txn.status !== 'pending' || txn.type !== 'topup') {
      await ctx.answerCbQuery('⚠️ Транзакция не найдена или уже обработана');
      return;
    }

    const admin = getAdminRecord(ctx.from.id);
    Transactions.updateStatus(txn.id, 'rejected', admin?.id || null);
    await ctx.answerCbQuery('❌ Отклонено');

    const user = Users.getById(txn.user_id);
    if (user) {
      await ctx.telegram.sendMessage(
        user.telegram_id,
        `${SAD_EMOJI} <b>Не удалось подтвердить пополнение.</b>\n\nЗаявка: <code>${transactionId}</code>\nЕсли вы уже оплатили, свяжитесь с администраторами SOM JET.`,
        { parse_mode: 'HTML' }
      ).catch(() => {});
    }

    const adminName = ctx.from.first_name || ctx.from.username || 'Admin';
    const caption = messageText(callbackMessage(ctx));
    await updateChannelMessage(ctx, caption + `\n\n❌ <b>Отклонено: ${adminName}</b>`, {
      parse_mode: 'HTML',
      ...copyTopupKeyboard(txn.payment_id, transactionUserId(txn)),
    });
  });

  bot.action(/^withdraw_confirm:(.+)$/, async (ctx) => {
    const transactionId = ctx.match[1];
    if (!isAdmin(ctx.from.id)) {
      await ctx.answerCbQuery('⛔ Доступ запрещен');
      return;
    }

    const ok = await applyWithdrawConfirm(ctx, transactionId);
    if (!ok) return;

    await ctx.answerCbQuery('✅ Подтверждено');
    const adminName = ctx.from.first_name || ctx.from.username || 'Admin';
    const caption = messageText(callbackMessage(ctx));
    await updateChannelMessage(ctx, caption + `\n\n✅ <b>Вывод подтвержден: ${adminName}</b>`, {
      parse_mode: 'HTML',
      ...copyWithdrawKeyboard(withdrawCopyDetails(Transactions.getByTransactionId(transactionId))),
    });
  });

  bot.action(/^withdraw_reject:(.+)$/, async (ctx) => {
    const transactionId = ctx.match[1];
    if (!isAdmin(ctx.from.id)) {
      await ctx.answerCbQuery('⛔ Доступ запрещен');
      return;
    }

    const txn = Transactions.getByTransactionId(transactionId);
    if (!txn || txn.status !== 'pending' || txn.type !== 'withdraw') {
      await ctx.answerCbQuery('⚠️ Транзакция не найдена или уже обработана');
      return;
    }

    const admin = getAdminRecord(ctx.from.id);
    Transactions.updateStatus(txn.id, 'rejected', admin?.id || null);
    await ctx.answerCbQuery('❌ Отклонено');

    const user = Users.getById(txn.user_id);
    if (user) {
      await ctx.telegram.sendMessage(
        user.telegram_id,
        `❌ <b>Заявка на вывод отклонена.</b>\n\nНомер заявки: <code>${transactionId}</code>\nНапишите администраторам SOM JET, если нужна помощь.`,
        { parse_mode: 'HTML' }
      ).catch(() => {});
    }

    const adminName = ctx.from.first_name || ctx.from.username || 'Admin';
    const caption = messageText(callbackMessage(ctx));
    await updateChannelMessage(ctx, caption + `\n\n❌ <b>Отклонено: ${adminName}</b>`, {
      parse_mode: 'HTML',
      ...copyWithdrawKeyboard(withdrawCopyDetails(txn)),
    });
  });

  bot.action(/^channel_ban:(.+)$/, async (ctx) => {
    if (!isAdmin(ctx.from.id)) {
      await ctx.answerCbQuery('⛔ Доступ запрещен');
      return;
    }

    const txn = Transactions.getByTransactionId(ctx.match[1]);
    const user = txn ? Users.getById(txn.user_id) : null;
    if (!user) {
      await ctx.answerCbQuery('Пользователь не найден', { show_alert: true });
      return;
    }
    if (isAdmin(user.telegram_id)) {
      await ctx.answerCbQuery('Нельзя банить администратора', { show_alert: true });
      return;
    }

    Users.banByTelegramId(user.telegram_id, {
      username: user.username,
      first_name: user.first_name,
      last_name: user.last_name,
    });
    clearUserState(user.telegram_id);
    await ctx.telegram.sendMessage(
      user.telegram_id,
      '🚫 Доступ к SOM JET ограничен. Если считаете, что это ошибка, напишите администраторам: @SOMGET_ADMIN или @Qyykgz.'
    ).catch(() => {});

    await ctx.answerCbQuery('🚫 Пользователь забанен', { show_alert: true });
    const caption = messageText(callbackMessage(ctx));
    if (!caption.includes('Пользователь забанен')) {
      await updateChannelMessage(ctx, caption + `\n\n🚫 <b>Пользователь забанен</b>`, {
        parse_mode: 'HTML',
      });
    }
  });
}

module.exports = { setupAdminCallbacks, applyTopupConfirm, applyWithdrawConfirm };
