from __future__ import annotations

import math
import numpy as np
from ..utils.constants import EARTH_RADIUS_KM

_BLOCKING_RADIUS_KM = EARTH_RADIUS_KM + 100.0
_DEG2RAD = math.pi / 180.0


def los_available(
    sat_pos_km: np.ndarray,
    station_pos_km: np.ndarray,
) -> bool:
    a = np.asarray(sat_pos_km,     dtype=np.float64)
    b = np.asarray(station_pos_km, dtype=np.float64)
    d = b - a
    d2 = float(np.dot(d, d))
    if d2 < 1e-12:
        return True
    t_star = max(0.0, min(1.0, float(-np.dot(a, d) / d2)))
    closest = a + t_star * d
    return float(np.dot(closest, closest)) >= _BLOCKING_RADIUS_KM ** 2


def los_with_elevation_mask(
    sat_pos_km:        np.ndarray,
    station_pos_km:    np.ndarray,
    station_lat_deg:   float,
    station_lon_deg:   float,
    station_alt_km:    float,
    min_elevation_deg: float,
    sim_time_s:        float,
) -> bool:
    """
    LOS check with per-station minimum elevation angle mask (doc §5.5.1).
    Returns True only if:
      1. Earth does not occlude the path, AND
      2. Satellite elevation above the station horizon >= min_elevation_deg
    """
    if not los_available(sat_pos_km, station_pos_km):
        return False

    # Compute elevation angle: angle between sat-station vector and local horizon
    sat  = np.asarray(sat_pos_km,     dtype=np.float64)
    gs   = np.asarray(station_pos_km, dtype=np.float64)
    vec  = sat - gs                          # vector from station to satellite
    gs_norm = np.linalg.norm(gs)
    if gs_norm < 1e-9:
        return True
    up_hat = gs / gs_norm                    # local zenith unit vector
    vec_norm = np.linalg.norm(vec)
    if vec_norm < 1e-9:
        return True
    sin_el = float(np.dot(vec, up_hat) / vec_norm)
    elevation_deg = math.degrees(math.asin(max(-1.0, min(1.0, sin_el))))
    return elevation_deg >= min_elevation_deg


def los_available_batch(
    sat_pos_km: np.ndarray,
    station_positions_km: list[np.ndarray],
) -> list[bool]:
    return [los_available(sat_pos_km, gs) for gs in station_positions_km]


def any_station_has_los(
    sat_pos_km: np.ndarray,
    station_positions_km: list[np.ndarray],
) -> bool:
    return any(los_available(sat_pos_km, gs) for gs in station_positions_km)
