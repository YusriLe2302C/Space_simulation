from __future__ import annotations

import math

# Units:
# - Position: km (ECI)
# - Velocity: km/s
# - Time: s

EARTH_MU_KM3_S2 = 398600.4418  # km^3 / s^2  (doc §3.2)
EARTH_RADIUS_KM = 6378.137     # km           (doc §3.2)
EARTH_J2        = 1.08263e-3   # dimensionless (doc §3.2)

COLLISION_THRESHOLD_KM = 0.1   # km — 100 m   (doc §3.3)

MAX_DV_M_S         = 15.0      # m/s per burn  (doc §5.1)
MANEUVER_COOLDOWN_S = 600.0    # s             (doc §5.1)

G0_M_S2 = 9.80665              # m/s²          (doc §5.1)

# Propulsion constants — identical for every satellite (doc §5.1)
DEFAULT_DRY_MASS_KG    = 500.0   # kg
DEFAULT_PROPELLANT_KG  =  50.0   # kg  (wet mass = 550.0 kg)
DEFAULT_ISP_S          = 300.0   # s

FUEL_GRAVEYARD_THRESHOLD_PCT = 5.0


def km_s_to_m_s(value_km_s: float) -> float:
    return value_km_s * 1000.0


def m_s_to_km_s(value_m_s: float) -> float:
    return value_m_s / 1000.0


def clamp(value: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, value))


def is_finite_number(value: float) -> bool:
    return isinstance(value, (int, float)) and math.isfinite(value)

