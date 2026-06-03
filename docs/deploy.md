# Деплой WanderOS без VPS

WanderOS может запускаться не только локально, но и в облачной PaaS-среде через GitHub.

Рекомендуемая схема:

GitHub -> Koyeb/Render/Railway -> Telegram Webhook

Для облачного запуска используется файл Procfile:

web: PYTHONPATH=src gunicorn -w 1 -b 0.0.0.0:$PORT wanderos.webhook_app:app

Необходимые переменные окружения на хостинге:

- TELEGRAM_BOT_TOKEN
- WEBHOOK_SECRET
- DATABASE_URL
- DEFAULT_CITY
- DEFAULT_RADIUS_M

После получения публичного HTTPS-адреса сервиса нужно выполнить локально:

.\scripts\set_webhook.ps1

После этого Telegram будет отправлять обновления на облачный URL, а локальный PowerShell больше не потребуется.
