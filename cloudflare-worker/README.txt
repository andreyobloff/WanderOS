WanderOS Cloudflare Worker

Эта папка содержит serverless-версию Telegram-бота.

Команды для деплоя:
cd C:\PROJECTSPE\WanderOS\cloudflare-worker
npm install
npx wrangler login
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put WEBHOOK_SECRET
npx wrangler deploy

После деплоя выполнить:
cd C:\PROJECTSPE\WanderOS
.\scripts\set_cloudflare_webhook.ps1
