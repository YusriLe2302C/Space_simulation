from __future__ import annotations

import numpy as np
from ..utils.constants import EARTH_RADIUS_KM

# Atmospheric shell added to Earth radius for LOS blocking.
# Signals passing through the lower atmosphere are considered blocked.
_BLOCKING_RADIUS_KM = EARTH_RADIUS_KM + 100.0  # 100 km atmosphere buffer


def los_available(
    sat_pos_km: np.ndarray,
    station_pos_km: np.ndarray,
) -> bool:
    """
    Return True if there is an unobstructed line of sight between a satellite
    and a ground station in ECI coordinates.

    Method: check whether the line segment from sat_pos to station_pos
    passes closer to Earth's centre than _BLOCKING_RADIUS_KM.

    Derivation:
      Parametric point on segment: P(t) = A + t*(B - A),  t in [0, 1]
      Closest approach to origin:  t* = -dot(A, d) / dot(d, d)
      where d = B - A.
      If t* in [0,1] and |P(t*)| < blocking_radius → blocked.

    Args:
        sat_pos_km:     ECI position of satellite (km), shape (3,)
        station_pos_km: ECI position of ground station (km), shape (3,)

    Returns:
        True  → LOS available (no Earth occlusion)
        False → Earth blocks the signal
    """
    a = np.asarray(sat_pos_km,     dtype=np.float64)
    b = np.asarray(station_pos_km, dtype=np.float64)

    d = b - a
    d2 = float(np.dot(d, d))

    if d2 < 1e-12:
        # Same point — trivially in LOS
        return True

    # Parameter of closest approach to Earth centre
    t_star = float(-np.dot(a, d) / d2)

    # Clamp to segment [0, 1]
    t_star = max(0.0, min(1.0, t_star))

    closest = a + t_star * d
    dist_sq = float(np.dot(closest, closest))

    return dist_sq >= _BLOCKING_RADIUS_KM ** 2


def los_available_batch(
    sat_pos_km: np.ndarray,
    station_positions_km: list[np.ndarray],
) -> list[bool]:
    """
    Check LOS from one satellite to multiple ground stations.

    Returns a list of booleans, one per station.
    """
    return [los_available(sat_pos_km, gs) for gs in station_positions_km]


def any_station_has_los(
    sat_pos_km: np.ndarray,
    station_positions_km: list[np.ndarray],
) -> bool:
    """
    Return True if at least one ground station has LOS to the satellite.
    Short-circuits on first visible station.
    """
    return any(los_available(sat_pos_km, gs) for gs in station_positions_km)
