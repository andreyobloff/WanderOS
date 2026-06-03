import logging

from flask import Flask, abort, request
from telebot.types import Update

from wanderos.bot import create_bot
from wanderos.config import settings
from wanderos.logger import setup_logging


setup_logging()
logger = logging.getLogger(__name__)

app = Flask(__name__)
bot = create_bot()


@app.get("/")
def healthcheck():
    return {
        "service": "WanderOS",
        "status": "ok",
        "mode": "webhook",
    }


@app.post("/webhook/<secret>")
def telegram_webhook(secret: str):
    if secret != settings.webhook_secret:
        logger.warning("Rejected webhook request with invalid secret")
        abort(403)

    if not request.is_json:
        logger.warning("Rejected webhook request without JSON body")
        abort(400)

    update = Update.de_json(request.get_data().decode("utf-8"))
    bot.process_new_updates([update])
    return "", 200
