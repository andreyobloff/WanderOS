import os
from dataclasses import dataclass
from dotenv import load_dotenv


load_dotenv()


@dataclass(frozen=True)
class Settings:
    telegram_bot_token: str = os.getenv("TELEGRAM_BOT_TOKEN", "")
    database_url: str = os.getenv("DATABASE_URL", "sqlite:///wanderos.db")

    webhook_secret: str = os.getenv("WEBHOOK_SECRET", "wanderos-webhook-secret")

    llm_api_key: str = os.getenv("LLM_API_KEY", "")
    llm_api_url: str = os.getenv("LLM_API_URL", "")
    llm_model: str = os.getenv("LLM_MODEL", "gpt-4o-mini")
    llm_max_tokens: int = int(os.getenv("LLM_MAX_TOKENS", "700"))
    llm_temperature: float = float(os.getenv("LLM_TEMPERATURE", "0.4"))

    open_meteo_url: str = os.getenv("OPEN_METEO_URL", "https://api.open-meteo.com/v1/forecast")
    nominatim_reverse_url: str = os.getenv("NOMINATIM_REVERSE_URL", "https://nominatim.openstreetmap.org/reverse")
    nominatim_user_agent: str = os.getenv("NOMINATIM_USER_AGENT", "WanderOS educational project")

    default_city: str = os.getenv("DEFAULT_CITY", "Москва")
    default_radius_m: int = int(os.getenv("DEFAULT_RADIUS_M", "1500"))


settings = Settings()
