const config = require('./src/config');
const { safeErrorSummary } = require('./src/bot/safeLog');

process.on('unhandledRejection', (reason) => {
  console.error(`[App] Unhandled rejection: ${safeErrorSummary(reason)}`);
});

process.on('uncaughtException', (error) => {
  console.error(`[App] Uncaught exception: ${safeErrorSummary(error)}`);
});

async function main() {
  const configErrors = config.getConfigErrors();
  if (configErrors.length) {
    console.error(`[App] Missing or invalid environment settings: ${configErrors.join(', ')}`);
    process.exitCode = 1;
    return;
  }

  const { initDatabase, startDatabaseBackups } = require('./src/database');
  await initDatabase();
  console.log('[App] Database initialized');
  await startDatabaseBackups();

  if (config.bot.enabled) {
    if (!config.bot.token) {
      console.error('[App] BOT_ENABLED is on, but BOT_TOKEN is not set.');
      process.exit(1);
    }
    const { setupBot } = require('./src/bots');
    setupBot();
  } else {
    console.log('[App] Telegram polling is disabled (BOT_ENABLED=0).');
  }
}

main().catch((error) => {
  console.error(`[App] Startup failed: ${safeErrorSummary(error)}`);
  process.exitCode = 1;
});
