from __future__ import annotations

import math

# Units:
# - Position: km (ECI)
# - Velocity: km/s
# - Time: s

EARTH_MU_KM3_S2 = 398600.4418  # km^3 / s^2
EARTH_RADIUS_KM = 6378.1363  # km
EARTH_J2 = 1.08262668e-3

COLLISION_THRESHOLD_KM = 0.1  # km

MAX_DV_M_S = 15.0
MANEUVER_COOLDOWN_S = 600.0

G0_M_S2 = 9.80665

# Default propulsion parameters (used for placeholder fuel tracking)
DEFAULT_ISP_S = 220.0
DEFAULT_DRY_MASS_KG = 800.0
DEFAULT_PROPELLANT_KG = 200.0

FUEL_GRAVEYARD_THRESHOLD_PCT = 5.0


def km_s_to_m_s(value_km_s: float) -> float:
    return value_km_s * 1000.0


def m_s_to_km_s(value_m_s: float) -> float:
    return value_m_s / 1000.0


def clamp(value: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, value))


def is_finite_number(value: float) -> bool:
    return isinstance(value, (int, float)) and math.isfinite(value)

