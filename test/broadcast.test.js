const test = require('node:test');
const assert = require('node:assert/strict');
const { createBroadcastRunner, sendBroadcastMessage, RATE_LIMIT_DELAY_MS } = require('../src/bot/broadcast');

test('broadcast start returns immediately and rejects a concurrent run', async () => {
  let releaseSend;
  let recipientQueries = 0;
  const gate = new Promise((resolve) => { releaseSend = resolve; });
  const runner = createBroadcastRunner({
    getRecipients: async () => {
      recipientQueries++;
      return [{ telegram_id: 101 }, { telegram_id: 102 }];
    },
    sendToUser: async () => {
      await gate;
      return 'sent';
    },
    markBlocked: async () => {},
    pause: async () => {},
    sendReport: async () => {},
  });

  const first = runner.start({});
  assert.ok(first);
  assert.equal(runner.isRunning(), true);
  assert.equal(runner.start({}), null);
  assert.equal(recipientQueries, 1);

  releaseSend();
  await first.task;
  assert.equal(runner.isRunning(), false);
  assert.equal(recipientQueries, 1);
});

test('rate limit waits retry_after and retries once', async () => {
  let attempts = 0;
  const waits = [];
  const telegram = {
    sendMessage: async () => {
      attempts++;
      if (attempts === 1) {
        const error = new Error('rate limited');
        error.response = { error_code: 429, parameters: { retry_after: 3 } };
        throw error;
      }
    },
  };

  const result = await sendBroadcastMessage({
    telegram,
    chatId: 101,
    broadcast: { type: 'text', text: 'hello' },
    pause: async (ms) => waits.push(ms),
  });

  assert.equal(result, 'sent');
  assert.equal(attempts, 2);
  assert.deepEqual(waits, [3000]);
});

test('403 is counted separately and marks the user blocked', async () => {
  let markedId = null;
  let report = null;
  const runner = createBroadcastRunner({
    getRecipients: async () => [{ telegram_id: 101 }],
    sendToUser: ({ telegram, chatId, broadcast }) => sendBroadcastMessage({
      telegram,
      chatId,
      broadcast,
      pause: async () => {},
    }),
    markBlocked: async (id) => { markedId = id; },
    pause: async () => {},
    sendReport: async (result) => { report = result; },
  });

  const telegram = {
    sendMessage: async () => {
      const error = new Error('blocked');
      error.response = { error_code: 403 };
      throw error;
    },
  };
  const run = runner.start({ broadcast: { type: 'text', text: 'hello' }, telegram });
  const counts = await run.task;
  assert.equal(markedId, 101);
  assert.equal(counts.blocked, 1);
  assert.equal(counts.failed, 0);
  assert.equal(report.counts.blocked, 1);
});

test('broadcast inserts the requested delay between recipients', async () => {
  const waits = [];
  const runner = createBroadcastRunner({
    getRecipients: async () => [{ telegram_id: 101 }, { telegram_id: 102 }],
    sendToUser: async () => 'sent',
    markBlocked: async () => {},
    pause: async (ms) => waits.push(ms),
    sendReport: async () => {},
  });

  await runner.start({}).task;
  assert.deepEqual(waits, [RATE_LIMIT_DELAY_MS]);
  assert.equal(RATE_LIMIT_DELAY_MS, 40);
});
