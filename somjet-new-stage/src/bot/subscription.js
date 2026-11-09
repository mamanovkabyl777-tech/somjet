const { Markup } = require('telegraf');
const config = require('../config');

const CHECK_CACHE_MS = 10_000;
const membershipCache = new Map();

function isSubscriptionConfigured() {
  return config.bot.requiredSubscriptions.every((chat) => Boolean(chat.id));
}

async function getUserSubscriptionStatus(ctx, { force = false } = {}) {
  if (!isSubscriptionConfigured()) return { configured: false, subscribed: true, missing: [], errors: [] };

  const userId = Number(ctx.from?.id);
  if (!userId) return { configured: true, subscribed: false, missing: [], errors: ['Не удалось определить Telegram ID пользователя'] };
  const cached = membershipCache.get(userId);
  if (!force && cached && cached.expiresAt > Date.now()) return cached.status;

  const checks = await Promise.all(config.bot.requiredSubscriptions.map(async (chat) => {
    try {
      const member = await ctx.telegram.getChatMember(chat.id, userId);
      const joined = member.status === 'creator' || member.status === 'administrator' || member.status === 'member' ||
        (member.status === 'restricted' && member.is_member === true);
      return { title: chat.title, joined, status: member.status };
    } catch (error) {
      console.error(`[Subscription] Could not check membership in ${chat.title}:`, error.message);
      return { title: chat.title, joined: false, error: error.message };
    }
  }));

  const status = {
    configured: true,
    subscribed: checks.every((check) => check.joined),
    missing: checks.filter((check) => !check.joined && !check.error).map((check) => check.title),
    errors: checks.filter((check) => check.error).map((check) => `${check.title}: ${check.error}`),
  };
  membershipCache.set(userId, { status, expiresAt: Date.now() + CHECK_CACHE_MS });
  return status;
}

async function isUserSubscribed(ctx, options) {
  const status = await getUserSubscriptionStatus(ctx, options);
  return status.subscribed;
}

function subscriptionKeyboard(startPayload = '') {
  const rows = config.bot.requiredSubscriptions
    .filter((chat) => chat.url)
    .map((chat) => [Markup.button.url(`➕ ${chat.title}`, chat.url)]);
  const callbackData = startPayload ? `subscription_check:${startPayload}` : 'subscription_check';
  rows.push([Markup.button.callback('✅ Подписался', callbackData)]);
  return Markup.inlineKeyboard(rows);
}

async function sendSubscriptionPrompt(ctx, retry = false, startPayload = '') {
  const channelLinkIsSet = config.bot.requiredSubscriptions.every((chat) => Boolean(chat.url));
  const message = retry
    ? channelLinkIsSet
      ? 'Пока не вижу вашу подписку. Откройте канал SOM JET по кнопке, подпишитесь и нажмите «Подписался».'
      : 'Пока не вижу вашу подписку. Подпишитесь на канал SOM JET и нажмите «Подписался».'
    : channelLinkIsSet
      ? 'Чтобы пользоваться SOM JET, подпишитесь на канал по кнопке ниже, затем нажмите «Подписался».'
      : 'Чтобы пользоваться SOM JET, подпишитесь на канал SOM JET, затем нажмите «Подписался». Если канал не открывается, запросите ссылку у администратора.';
  await ctx.reply(message, subscriptionKeyboard(startPayload));
}

function invalidateMembership(userId) {
  membershipCache.delete(Number(userId));
}

module.exports = {
  isSubscriptionConfigured,
  getUserSubscriptionStatus,
  isUserSubscribed,
  sendSubscriptionPrompt,
  invalidateMembership,
};
