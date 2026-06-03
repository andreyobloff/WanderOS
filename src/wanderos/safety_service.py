from wanderos.geo_service import GeoPoint


def is_point_safe(point: GeoPoint) -> bool:
    """Basic placeholder for future safety checks."""
    if not (-90 <= point.latitude <= 90):
        return False

    if not (-180 <= point.longitude <= 180):
        return False

    return True


def safety_disclaimer() -> str:
    return (
        "⚠️ WanderOS предлагает идею прогулки, а не гарантированно безопасный маршрут. "
        "Не заходите на частные, закрытые, промышленные и опасные территории. "
        "Если место кажется небезопасным — отмените маршрут и сгенерируйте новый."
    )
