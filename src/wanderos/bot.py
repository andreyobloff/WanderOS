import logging
import telebot

from wanderos.config import settings
from wanderos.quest_service import build_demo_quest
from wanderos.report_service import build_user_report


logger = logging.getLogger(__name__)


def run_bot() -> None:
    if not settings.telegram_bot_token:
        logger.error("TELEGRAM_BOT_TOKEN не задан. Создайте .env на основе .env.example.")
        raise RuntimeError("TELEGRAM_BOT_TOKEN is missing")

    bot = telebot.TeleBot(settings.telegram_bot_token, parse_mode="HTML")

    @bot.message_handler(commands=["start"])
    def handle_start(message):
        text = (
            "<b>WanderOS</b>\n\n"
            "Telegram-бот для генерации безопасных городских маршрутов "
            "и мини-квестов по Москве.\n\n"
            "Доступные команды:\n"
            "/help - справка\n"
            "/profile - профиль\n"
            "/point - сгенерировать демо-квест\n"
            "/history - история маршрутов\n"
            "/report - отчёт по активности\n\n"
            "Важно: бот предлагает идею прогулки, но не гарантирует безопасность маршрута. "
            "Не заходите на частные, закрытые и опасные территории."
        )
        bot.reply_to(message, text)

    @bot.message_handler(commands=["help"])
    def handle_help(message):
        text = (
            "<b>Справка WanderOS</b>\n\n"
            "/start - запуск бота\n"
            "/profile - профиль пользователя\n"
            "/point - генерация демо-квеста\n"
            "/history - история маршрутов\n"
            "/report - отчёт\n"
            "/weather - проверка погоды\n"
            "/ask - вопрос ассистенту\n"
            "/batch - пакетная генерация квестов\n"
            "/schedule - маршрут по расписанию"
        )
        bot.reply_to(message, text)

    @bot.message_handler(commands=["profile"])
    def handle_profile(message):
        text = (
            "<b>Профиль WanderOS</b>\n\n"
            "Город: Москва\n"
            "Радиус по умолчанию: 1500 м\n"
            "Уровень безопасности: базовый\n"
            "Тариф: free\n\n"
            "На следующем этапе профиль будет сохраняться в SQLite."
        )
        bot.reply_to(message, text)

    @bot.message_handler(commands=["point"])
    def handle_point(message):
        text = build_demo_quest("демонстрационная городская точка в Москве")
        bot.reply_to(message, text)

    @bot.message_handler(commands=["history"])
    def handle_history(message):
        text = (
            "<b>История маршрутов</b>\n\n"
            "Пока история пуста. После подключения SQLite здесь будут отображаться "
            "последние сгенерированные точки и квесты."
        )
        bot.reply_to(message, text)

    @bot.message_handler(commands=["report"])
    def handle_report(message):
        bot.reply_to(message, build_user_report())

    logger.info("WanderOS bot started")
    bot.infinity_polling(skip_pending=True)
