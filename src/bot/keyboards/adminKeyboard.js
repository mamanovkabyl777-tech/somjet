const { Markup } = require('telegraf');
const { BotSettings } = require('../../models');

function adminMenu() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('📊 Статистика', 'admin_stats'),
      Markup.button.callback('💳 Реквизиты', 'admin_requisites'),
    ],
    [
      Markup.button.callback('🔀 Вкл/Откл Беток', 'admin_bookmakers'),
      Markup.button.callback('👤 Клиенты', 'admin_users'),
    ],
    [
      Markup.button.callback('📣 Рассылка', 'admin_broadcast'),
      Markup.button.callback('⚙️ Ещё', 'admin_more'),
    ],
    [{
      ...Markup.button.callback(
        BotSettings.get('bot_paused', '0') === '1'
          ? '▶️ ВОЗОБНОВИТЬ БОТА · ВКЛЮЧИТЬ ПРИЁМ ЗАЯВОК'
          : '⏸️ ОСТАНОВИТЬ БОТА · ПРИОСТАНОВИТЬ ПРИЁМ ЗАЯВОК',
        'admin_toggle_pause'
      ),
      style: BotSettings.get('bot_paused', '0') === '1' ? 'success' : 'danger',
    }],
  ]);
}

function adminMoreMenu() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('📋 Заявки', 'admin_transactions')],
    [Markup.button.callback('📄 Отчёты', 'admin_pdf_reports')],
    [
      Markup.button.callback('🚫 Заблокировать', 'admin_ban_user'),
      Markup.button.callback('✅ Разблокировать', 'admin_unban_user'),
    ],
    [Markup.button.callback('🔙 В главное меню', 'admin_back')],
  ]);
}

function pdfReportsKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('📥 Пополнения', 'admin_pdf_report:topup'),
      Markup.button.callback('📤 Выводы', 'admin_pdf_report:withdraw'),
    ],
    [Markup.button.callback('🔙 Назад', 'admin_panel')],
  ]);
}

function copyTopupKeyboard(paymentId, userId) {
  const rows = [];
  if (canCopyText(paymentId)) {
    rows.push([{ text: '📋 Копировать ID букмекера', copy_text: { text: String(paymentId) } }]);
  }
  if (userId) rows.push([contactUserButton(userId)]);
  return Markup.inlineKeyboard(rows);
}

function confirmTopupKeyboard(transactionId, paymentId, userId) {
  const rows = [];
  if (canCopyText(paymentId)) {
    rows.push([{ text: '📋 Копировать ID букмекера', copy_text: { text: String(paymentId) } }]);
  }
  if (userId) rows.push([contactUserButton(userId)]);
  rows.push([
    Markup.button.callback('✅ Подтвердить', `topup_confirm:${transactionId}`),
    Markup.button.callback('❌ Отклонить', `topup_reject:${transactionId}`),
  ]);
  return Markup.inlineKeyboard(rows);
}

function confirmTopupFinalKeyboard(transactionId) {
  return Markup.inlineKeyboard([
    [Markup.button.callback('🔒 Вы уверены? Перепроверьте и нажмите', `topup_final_confirm:${transactionId}`)],
    [Markup.button.callback('🔙 Назад', `topup_undo_confirm:${transactionId}`)],
  ]);
}

function confirmWithdrawKeyboard(transactionId, contactDetails) {
  const rows = withdrawCopyRows(contactDetails);
  if (contactDetails?.userId) rows.push([contactUserButton(contactDetails.userId)]);
  rows.push([
      Markup.button.callback('✅ Подтвердить', `withdraw_confirm:${transactionId}`),
      Markup.button.callback('❌ Отклонить', `withdraw_reject:${transactionId}`),
  ]);
  return Markup.inlineKeyboard(rows);
}

function withdrawCopyRows(contactDetails = {}) {
  const rows = [];
  const firstRow = [];
  if (canCopyText(contactDetails.bookmakerId)) {
    firstRow.push({ text: '📋 Копировать ID букмекера', copy_text: { text: String(contactDetails.bookmakerId) } });
  }
  if (canCopyText(contactDetails.withdrawCode)) {
    firstRow.push({ text: '🔐 Копировать код', copy_text: { text: String(contactDetails.withdrawCode) } });
  }
  if (firstRow.length) rows.push(firstRow);
  if (canCopyText(contactDetails.payoutDetails)) {
    rows.push([{ text: '💳 Копировать реквизиты / телефон', copy_text: { text: String(contactDetails.payoutDetails) } }]);
  }
  return rows;
}

function canCopyText(value) {
  return value !== undefined && value !== null && String(value) !== '' && [...String(value)].length <= 256;
}

function copyWithdrawKeyboard(contactDetails) {
  const rows = withdrawCopyRows(contactDetails);
  if (contactDetails?.userId) rows.push([contactUserButton(contactDetails.userId)]);
  return Markup.inlineKeyboard(rows);
}

function contactUserButton(userId) {
  return Markup.button.url('👤 Написать клиенту', `tg://user?id=${userId}`);
}

module.exports = {
  adminMenu,
  adminMoreMenu,
  pdfReportsKeyboard,
  confirmTopupKeyboard,
  copyTopupKeyboard,
  confirmTopupFinalKeyboard,
  confirmWithdrawKeyboard,
  copyWithdrawKeyboard,
};
