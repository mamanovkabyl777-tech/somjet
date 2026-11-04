function tgEmoji(id, emoji) {
  return `<tg-emoji emoji-id="${id}">${emoji}</tg-emoji>`;
}

const ZAP = tgEmoji('5456140674028019486', '⚡️');
const OK = tgEmoji('6113685078825505075', '🟢');
const SHIELD = tgEmoji('5226731159190269344', '🪐');
const SUPPORT_EMOJI = tgEmoji('5224615432530461449', '💬');
const SUPPORT_CONTACTS = '@SOMJET_SUPPORT · @SOMJET_ADMIN';
const SUPPORT_USER_URL = 'https://t.me/SomjetKG_ADMIN';
const USER_CHAT_URL = 'https://t.me/+O3Mmy6MSPMoxYWEy';
const WELCOME_EMOJI_IDS = {
  exclamation: '5226886838869847084',
  live: '5298978964444834599',
  hundred: '5224295096689651881',
  check: '5395652789877632866',
  support: '5294096239464295059',
  bell: '4949489173397505757',
};

function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function welcomeHtml(from) {
  const name = escapeHtml(from.first_name || from.username || 'друг');
  return (
    `Привет, ${name} ${tgEmoji(WELCOME_EMOJI_IDS.exclamation, '‼️')}\n\n` +
    `${tgEmoji(WELCOME_EMOJI_IDS.live, '🟢')}  On live\n` +
    `Пополнения | Выводы 0${tgEmoji(WELCOME_EMOJI_IDS.hundred, '💯')}\n` +
    `Лучший сервис для пополнения ${tgEmoji(WELCOME_EMOJI_IDS.check, '✅')}\n\n` +
    `${tgEmoji(WELCOME_EMOJI_IDS.support, '🔵')} Поддержка: <a href="${SUPPORT_USER_URL}">SUPPORT SOMJET</a> ${tgEmoji(WELCOME_EMOJI_IDS.support, '🔵')}\n\n` +
    `Строгий финансовый контроль ваших средств ${tgEmoji(WELCOME_EMOJI_IDS.bell, '🔔')}`
  );
}

function qrAmountHtml() {
  return (
    `<b>Пополнение через QR код</b> <tg-emoji emoji-id="5296453673998640835">🔵</tg-emoji>\n` +
    `Все транзакции защищены <tg-emoji emoji-id="5395652789877632866">✅</tg-emoji>\n` +
    `<tg-emoji emoji-id="4947667321284986879">💰</tg-emoji> Введите сумму для пополнения:`
  );
}

module.exports = { ZAP, OK, SHIELD, SUPPORT_EMOJI, SUPPORT_CONTACTS, USER_CHAT_URL, tgEmoji, welcomeHtml, qrAmountHtml };
