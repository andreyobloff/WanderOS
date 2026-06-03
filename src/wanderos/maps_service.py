import requests

from wanderos.config import settings


def reverse_geocode(latitude: float, longitude: float) -> dict:
    headers = {
        "User-Agent": settings.nominatim_user_agent,
    }

    params = {
        "lat": latitude,
        "lon": longitude,
        "format": "jsonv2",
        "addressdetails": 1,
    }

    response = requests.get(
        settings.nominatim_reverse_url,
        params=params,
        headers=headers,
        timeout=15,
    )
    response.raise_for_status()
    return response.json()
