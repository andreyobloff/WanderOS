import requests

from wanderos.config import settings


def get_weather(latitude: float, longitude: float) -> dict:
    params = {
        "latitude": latitude,
        "longitude": longitude,
        "current": "temperature_2m,precipitation,wind_speed_10m",
    }

    response = requests.get(settings.open_meteo_url, params=params, timeout=15)
    response.raise_for_status()
    return response.json()
