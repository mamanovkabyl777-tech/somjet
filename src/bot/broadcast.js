const RATE_LIMIT_DELAY_MS = 40;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorCode(error) {
  return Number(error?.response?.error_code ?? error?.code) || 0;
}

function retryAfterSeconds(error) {
  return Number(error?.response?.parameters?.retry_after ?? error?.parameters?.retry_after) || 1;
}

async function sendBroadcastMessage({ telegram, chatId, broadcast, markupOptions = {}, pause = sleep, logError = () => {} }) {
  const send = async () => {
    if (broadcast.type === 'text') {
      const entities = broadcast.entities?.length ? { entities: broadcast.entities } : {};
      await telegram.sendMessage(chatId, broadcast.text, { ...entities, ...markupOptions });
    } else if (broadcast.type === 'photo') {
      const entities = broadcast.caption_entities?.length ? { caption_entities: broadcast.caption_entities } : {};
      await telegram.sendPhoto(chatId, broadcast.file_id, { caption: broadcast.caption, ...entities, ...markupOptions });
    } else if (broadcast.type === 'document') {
      const entities = broadcast.caption_entities?.length ? { caption_entities: broadcast.caption_entities } : {};
      await telegram.sendDocument(chatId, broadcast.file_id, { caption: broadcast.caption, ...entities, ...markupOptions });
    } else if (broadcast.type === 'video') {
      const entities = broadcast.caption_entities?.length ? { caption_entities: broadcast.caption_entities } : {};
      await telegram.sendVideo(chatId, broadcast.file_id, { caption: broadcast.caption, ...entities, ...markupOptions });
    } else if (broadcast.type === 'animation') {
      const entities = broadcast.caption_entities?.length ? { caption_entities: broadcast.caption_entities } : {};
      await telegram.sendAnimation(chatId, broadcast.file_id, { caption: broadcast.caption, ...entities, ...markupOptions });
    } else if (broadcast.type === 'audio') {
      const entities = broadcast.caption_entities?.length ? { caption_entities: broadcast.caption_entities } : {};
      await telegram.sendAudio(chatId, broadcast.file_id, { caption: broadcast.caption, ...entities, ...markupOptions });
    } else if (broadcast.type === 'voice') {
      await telegram.sendVoice(chatId, broadcast.file_id, markupOptions);
    } else if (broadcast.type === 'sticker') {
      await telegram.sendSticker(chatId, broadcast.file_id, markupOptions);
    } else {
      return 'failed';
    }
    return 'sent';
  };

  try {
    return await send();
  } catch (error) {
    const code = errorCode(error);
    if (code === 403) return 'blocked';
    if (code === 429) {
      await pause(retryAfterSeconds(error) * 1000);
      try {
        return await send();
      } catch (retryError) {
        const retryCode = errorCode(retryError);
        if (retryCode === 403) return 'blocked';
        logError({ chatId, code: retryCode, error: retryError });
        return 'failed';
      }
    }
    logError({ chatId, code, error });
    return 'failed';
  }
}

function createBroadcastRunner({ getRecipients, sendToUser, markBlocked, pause = sleep, sendReport, onError = () => {} }) {
  let running = false;

  function start({ telegram, adminChatId, broadcast, buttonConfig, announce }) {
    if (running) return null;
    running = true;

    const task = (async () => {
      if (announce) await announce();
      const users = await getRecipients();
      const counts = { success: 0, failed: 0, blocked: 0, total: users.length };

      for (let i = 0; i < users.length; i++) {
        const user = users[i];
        const result = await sendToUser({ telegram, chatId: user.telegram_id, broadcast, buttonConfig });
        if (result === 'sent') counts.success++;
        else if (result === 'blocked') {
          counts.blocked++;
          try {
            await markBlocked(user.telegram_id);
          } catch (_) {
            onError({ chatId: user.telegram_id, code: 0, operation: 'mark_blocked' });
          }
        } else counts.failed++;

        if (i < users.length - 1) await pause(RATE_LIMIT_DELAY_MS);
      }

      await sendReport({ telegram, adminChatId, broadcast, buttonConfig, counts });
      return counts;
    })().finally(() => {
      running = false;
    });

    return { task };
  }

  return { start, isRunning: () => running };
}

module.exports = { RATE_LIMIT_DELAY_MS, createBroadcastRunner, sendBroadcastMessage, sleep };
