from __future__ import annotations

import numpy as np

from ..utils.constants import MANEUVER_COOLDOWN_S, MAX_DV_M_S, m_s_to_km_s
from ..utils.math_utils import norm, unit


def plan_station_keeping(
    states_by_id: dict[str, np.ndarray],
    target_radius_km_by_id: dict[str, float],
    tolerance_km_by_id: dict[str, float],
    last_maneuver_time_by_id: dict[str, float],
    current_time_s: float,
) -> dict[str, np.ndarray]:
    """
    Minimal station-keeping placeholder:
    - Keep |r| close to a target radius (captured at first sighting).
    - If deviation exceeds tolerance, apply a small along-track Δv to correct energy.

    Returns dv vectors in km/s keyed by object id.
    """
    dv_by_id: dict[str, np.ndarray] = {}
    dv_km_s_mag = m_s_to_km_s(min(1.0, MAX_DV_M_S))  # 1 m/s placeholder

    for obj_id, state in states_by_id.items():
        last_t = last_maneuver_time_by_id.get(obj_id)
        if last_t is not None and (current_time_s - last_t) < MANEUVER_COOLDOWN_S:
            continue

        target_r = target_radius_km_by_id.get(obj_id)
        tolerance_km = tolerance_km_by_id.get(obj_id)
        if target_r is None or tolerance_km is None:
            continue

        r = state[0:3]
        v = state[3:6]
        radius = norm(r)
        err = radius - target_r
        if abs(err) <= tolerance_km:
            continue

        # Simple energy adjustment: increase speed if radius too low, decrease if too high.
        direction = unit(v)
        sign = -1.0 if err > 0.0 else 1.0
        dv_by_id[obj_id] = sign * dv_km_s_mag * direction

    return dv_by_id
