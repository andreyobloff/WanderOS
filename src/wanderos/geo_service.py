import math
import random
from dataclasses import dataclass


@dataclass(frozen=True)
class GeoPoint:
    latitude: float
    longitude: float


def generate_random_point(center: GeoPoint, radius_m: int) -> GeoPoint:
    """Generate a random point within a radius from the center point."""
    earth_radius_m = 6_371_000

    distance = radius_m * math.sqrt(random.random())
    bearing = random.uniform(0, 2 * math.pi)

    lat1 = math.radians(center.latitude)
    lon1 = math.radians(center.longitude)

    lat2 = math.asin(
        math.sin(lat1) * math.cos(distance / earth_radius_m)
        + math.cos(lat1) * math.sin(distance / earth_radius_m) * math.cos(bearing)
    )

    lon2 = lon1 + math.atan2(
        math.sin(bearing) * math.sin(distance / earth_radius_m) * math.cos(lat1),
        math.cos(distance / earth_radius_m) - math.sin(lat1) * math.sin(lat2),
    )

    return GeoPoint(latitude=math.degrees(lat2), longitude=math.degrees(lon2))
