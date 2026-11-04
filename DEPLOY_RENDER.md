# SOM JET Telegram bot

The bot runs as a long-lived Node.js worker. Its SQLite database is stored on the persistent disk at `/var/data/gkassa.db`.

## Deploy with Render

1. Connect this repository to Render and create a Blueprint service from `render.yaml`.
2. Set `BOT_TOKEN`, `CHANNEL_TOPUP_ID`, `CHANNEL_WITHDRAW_ID`, and `ADMIN_TELEGRAM_IDS` in the service environment.
3. Set `REQUIRED_SUBSCRIPTION_CHANNEL_ID` and `REQUIRED_SUBSCRIPTION_URL` for the SOM JET user chat. Add the bot as an administrator in the chat and both payment channels.
4. Start the worker and check its logs for `Telegram bot started successfully`.

The bot uses long polling, so only one running worker can use a given Telegram token at a time.

## Run locally

```sh
npm install
```

Create `.env` with the token, channel IDs, admin IDs, and optional user-chat subscription settings, then start the bot:

```sh
npm start
```
