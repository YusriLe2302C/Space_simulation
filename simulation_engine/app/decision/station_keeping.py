from __future__ import annotations

import math
import numpy as np

from ..utils.constants import (
    EARTH_MU_KM3_S2, MANEUVER_COOLDOWN_S, MAX_DV_M_S, m_s_to_km_s
)
from ..utils.math_utils import norm, unit


def _hohmann_dv_prograde(r_current: float, r_target: float) -> float:
    """
    First burn of a Hohmann transfer: prograde ΔV (km/s) to raise/lower
    the orbit from r_current to r_target (both in km from Earth centre).
    Returns signed value: positive = prograde (raise), negative = retrograde (lower).
    """
    mu = EARTH_MU_KM3_S2
    v_circ   = math.sqrt(mu / r_current)
    a_trans  = (r_current + r_target) / 2.0
    v_trans  = math.sqrt(mu * (2.0 / r_current - 1.0 / a_trans))
    return v_trans - v_circ


def plan_station_keeping(
    states_by_id: dict[str, np.ndarray],
    target_radius_km_by_id: dict[str, float],
    tolerance_km_by_id: dict[str, float],
    last_maneuver_time_by_id: dict[str, float],
    current_time_s: float,
) -> dict[str, np.ndarray]:
    """
    Hohmann-based station-keeping (doc §5.2):
    - If satellite drifts outside 10 km tolerance box, apply a prograde/
      retrograde burn to correct the semi-major axis back to target.
    - ΔV capped at MAX_DV_M_S per burn.
    - Cooldown enforced between burns.
    """
    dv_by_id: dict[str, np.ndarray] = {}

    for obj_id, state in states_by_id.items():
        last_t = last_maneuver_time_by_id.get(obj_id)
        if last_t is not None and (current_time_s - last_t) < MANEUVER_COOLDOWN_S:
            continue

        target_r   = target_radius_km_by_id.get(obj_id)
        tolerance  = tolerance_km_by_id.get(obj_id)
        if target_r is None or tolerance is None:
            continue

        r_vec  = state[0:3]
        v_vec  = state[3:6]
        radius = norm(r_vec)
        err    = radius - target_r

        if abs(err) <= tolerance:
            continue

        # Hohmann first-burn ΔV to correct semi-major axis
        dv_km_s = _hohmann_dv_prograde(radius, target_r)

        # Cap at MAX_DV_M_S
        dv_m_s  = abs(dv_km_s) * 1000.0
        if dv_m_s > MAX_DV_M_S:
            dv_km_s = math.copysign(m_s_to_km_s(MAX_DV_M_S), dv_km_s)

        # Apply along prograde direction
        prograde = unit(v_vec)
        dv_by_id[obj_id] = dv_km_s * prograde

    return dv_by_id
