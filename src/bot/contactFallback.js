function isUserPrivacyRestricted(error) {
  const description = String(error?.response?.description || error?.description || error?.message || '');
  return /BUTTON_USER_PRIVACY_RESTRICTED/i.test(description);
}

function withUnavailableContactButton(extra = {}) {
  const replyMarkup = extra.reply_markup;
  if (!Array.isArray(replyMarkup?.inline_keyboard)) return extra;

  return {
    ...extra,
    reply_markup: {
      ...replyMarkup,
      inline_keyboard: replyMarkup.inline_keyboard.map((row) => row.map((button) => {
        if (!String(button.url || '').startsWith('tg://user?id=')) return button;
        return { text: '⚠️', callback_data: 'contact_unavailable' };
      })),
    },
  };
}

module.exports = { isUserPrivacyRestricted, withUnavailableContactButton };
