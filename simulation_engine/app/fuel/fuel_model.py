from __future__ import annotations

import math

from ..utils.constants import (
    DEFAULT_DRY_MASS_KG,
    DEFAULT_ISP_S,
    DEFAULT_PROPELLANT_KG,
    FUEL_GRAVEYARD_THRESHOLD_PCT,
    G0_M_S2,
)


def default_mass_model() -> tuple[float, float, float]:
    """
    Returns (dry_mass_kg, propellant_kg, isp_s).
    """
    return (DEFAULT_DRY_MASS_KG, DEFAULT_PROPELLANT_KG, DEFAULT_ISP_S)


def apply_rocket_equation(mass_kg: float, dv_m_s: float, isp_s: float) -> float:
    """
    Exponential rocket equation: m1 = m0 * exp(-dv / (Isp * g0)).
    """
    if mass_kg <= 0.0:
        return 0.0
    if dv_m_s <= 0.0:
        return mass_kg
    return mass_kg * math.exp(-dv_m_s / (isp_s * G0_M_S2))


def propellant_remaining_pct(dry_mass_kg: float, propellant_kg: float, current_mass_kg: float) -> float:
    total0 = dry_mass_kg + propellant_kg
    if total0 <= 0.0:
        return 0.0
    remaining_prop = max(0.0, current_mass_kg - dry_mass_kg)
    return (remaining_prop / propellant_kg) * 100.0 if propellant_kg > 0.0 else 0.0


def is_graveyard_needed(remaining_pct: float) -> bool:
    return remaining_pct <= FUEL_GRAVEYARD_THRESHOLD_PCT

