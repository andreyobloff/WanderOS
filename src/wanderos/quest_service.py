from wanderos.safety_service import safety_disclaimer


def build_demo_quest(address: str = "неизвестная городская точка") -> str:
    return (
        "<b>Квест WanderOS</b>\n\n"
        f"<b>Точка:</b> {address}\n\n"
        "<b>Задание:</b>\n"
        "1. Найдите рядом объект, который обычно остаётся незамеченным.\n"
        "2. Опишите его одним предложением.\n"
        "3. Сделайте фотографию, если это безопасно и уместно.\n\n"
        f"{safety_disclaimer()}"
    )
