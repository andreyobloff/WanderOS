import logging
import telebot

from wanderos.config import settings


logger = logging.getLogger(__name__)


def run_bot() -> None:
    if not settings.telegram_bot_token:
        logger.error("TELEGRAM_BOT_TOKEN не задан. Создайте .env на основе .env.example.")
        raise RuntimeError("TELEGRAM_BOT_TOKEN is missing")

    bot = telebot.TeleBot(settings.telegram_bot_token, parse_mode="HTML")

    @bot.message_handler(commands=["start"])
    def handle_start(message):
        text = (
            "🌒 <b>WanderOS</b>\n\n"
            "Telegram-бот для генерации безопасных городских маршрутов "
            "и мини-квестов по Москве.\n\n"
            "Доступные команды:\n"
            "/help — справка\n"
            "/profile — профиль\n"
            "/point — сгенерировать точку\n"
            "/history — история маршрутов\n"
            "/report — отчёт по активности\n\n"
            "⚠️ Бот предлагает идею прогулки, но не гарантирует безопасность маршрута. "
            "Не заходите на частные, закрытые и опасные территории."
        )
        bot.reply_to(message, text)

    @bot.message_handler(commands=["help"])
    def handle_help(message):
        text = (
            "<b>Справка WanderOS</b>\n\n"
            "/start — запуск бота\n"
            "/profile — профиль пользователя\n"
            "/point — генерация точки\n"
            "/history — история маршрутов\n"
            "/report — отчёт\n"
            "/weather — проверка погоды\n"
            "/ask — вопрос ассистенту\n"
            "/batch — пакетная генерация квестов\n"
            "/schedule — маршрут по расписанию"
        )
        bot.reply_to(message, text)

    logger.info("WanderOS bot started")
    bot.infinity_polling(skip_pending=True)
