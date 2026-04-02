from __future__ import annotations

import numpy as np

from ..utils.constants import MANEUVER_COOLDOWN_S, MAX_DV_M_S, m_s_to_km_s
from ..utils.math_utils import unit, norm


# ── RTN frame helpers ─────────────────────────────────────────────────────────

def rtn_axes(r: np.ndarray, v: np.ndarray):
    """
    Return the three unit vectors of the RTN (Radial-Transverse-Normal) frame.

    R — radial: points from Earth centre toward the satellite
    T — transverse (along-track): perpendicular to R in the orbital plane,
        in the direction of motion
    N — normal (cross-track): perpendicular to the orbital plane = R × V direction

    All inputs in ECI km / km·s⁻¹.
    """
    r_hat = unit(r)                        # radial
    n_hat = unit(np.cross(r, v))           # normal = h-direction
    t_hat = np.cross(n_hat, r_hat)         # transverse = N × R
    return r_hat, t_hat, n_hat


def eci_to_rtn(vec_eci: np.ndarray, r_hat, t_hat, n_hat) -> np.ndarray:
    """Project an ECI vector onto the RTN frame."""
    return np.array([
        np.dot(vec_eci, r_hat),
        np.dot(vec_eci, t_hat),
        np.dot(vec_eci, n_hat),
    ])


def rtn_to_eci(vec_rtn: np.ndarray, r_hat, t_hat, n_hat) -> np.ndarray:
    """Convert an RTN vector back to ECI."""
    return vec_rtn[0] * r_hat + vec_rtn[1] * t_hat + vec_rtn[2] * n_hat


# ── Avoidance direction ───────────────────────────────────────────────────────

def avoidance_dv_eci(
    state_sat: np.ndarray,
    state_threat: np.ndarray,
    dv_mag_km_s: float,
) -> np.ndarray:
    """
    Compute a ΔV in ECI that moves `state_sat` away from `state_threat`.

    Strategy (geometry-aware, not fixed along-track):
      1. Compute relative position dr = r_sat − r_threat and relative
         velocity dv_rel = v_sat − v_threat in the satellite's RTN frame.
      2. The miss vector at TCA is approximately dr + dv_rel * tca.
         We want to increase the component of this vector that is
         perpendicular to the relative velocity (the miss distance).
      3. Apply ΔV in the RTN direction that maximises miss distance
         increase per unit ΔV — this is the direction perpendicular to
         dv_rel within the RTN plane, pointing away from the threat.

    If the relative velocity is near-zero (parallel orbits), fall back to
    a radial maneuver (altitude change) which is always safe.
    """
    r_sat = state_sat[0:3]
    v_sat = state_sat[3:6]
    r_thr = state_threat[0:3]
    v_thr = state_threat[3:6]

    r_hat, t_hat, n_hat = rtn_axes(r_sat, v_sat)

    dr     = r_sat - r_thr          # separation vector (ECI)
    dv_rel = v_sat - v_thr          # relative velocity (ECI)

    dv_rel_mag = norm(dv_rel)

    if dv_rel_mag < 1e-9:
        # Parallel / co-moving objects — radial maneuver changes altitude,
        # guaranteed to increase separation over time.
        return dv_mag_km_s * r_hat

    dv_rel_hat = dv_rel / dv_rel_mag

    # Component of separation perpendicular to relative velocity
    # (this is the miss-distance direction)
    dr_perp = dr - np.dot(dr, dv_rel_hat) * dv_rel_hat
    dr_perp_mag = norm(dr_perp)

    if dr_perp_mag > 1e-9:
        # Push further in the existing miss direction — increases miss distance
        miss_hat_eci = dr_perp / dr_perp_mag
    else:
        # Objects on exact collision course — pick radial as safe default
        miss_hat_eci = r_hat

    # Express in RTN and zero out the normal component to keep the maneuver
    # in-plane (cheaper in fuel for most LEO scenarios).
    miss_rtn = eci_to_rtn(miss_hat_eci, r_hat, t_hat, n_hat)
    miss_rtn[2] = 0.0   # zero normal component
    miss_rtn_mag = norm(miss_rtn)

    if miss_rtn_mag < 1e-9:
        # Degenerate — fall back to radial
        return dv_mag_km_s * r_hat

    avoidance_rtn = (miss_rtn / miss_rtn_mag) * dv_mag_km_s
    return rtn_to_eci(avoidance_rtn, r_hat, t_hat, n_hat)


# ── Fuel gate ─────────────────────────────────────────────────────────────────

# Minimum propellant fraction required to attempt a COLA maneuver.
# Below this the satellite is considered fuel-critical; attempting a burn
# risks leaving it unable to deorbit or reach graveyard orbit.
COLA_MIN_FUEL_PCT = 8.0


def _fuel_pct(rec) -> float:
    """Return remaining propellant as a percentage of original load."""
    if rec.propellant_kg <= 0.0:
        return 0.0
    remaining = max(0.0, rec.current_mass_kg - rec.dry_mass_kg)
    return (remaining / rec.propellant_kg) * 100.0


# ── Public API ────────────────────────────────────────────────────────────────

def plan_cola_maneuvers(
    collision_pairs,
    states_by_id: dict[str, np.ndarray],
    last_maneuver_time_by_id: dict[str, float],
    current_time_s: float,
    object_records: dict | None = None,
) -> dict[str, np.ndarray]:
    """
    RTN-based COLA: for each close approach, compute a geometry-aware ΔV
    that increases miss distance by moving the satellite away from the
    relative velocity vector.

    Improvements over the old placeholder:
      - ΔV direction derived from relative geometry (RTN frame), not fixed
        along-track. This guarantees the maneuver increases miss distance.
      - Both objects in a pair are considered; only the one with more fuel
        maneuvers if both are controllable satellites.
      - Fuel gate: objects below COLA_MIN_FUEL_PCT are not commanded.
      - ΔV magnitude scales with miss distance — closer approach → larger burn,
        up to MAX_DV_M_S.

    Args:
        collision_pairs: list of CloseApproach(a, b, tca_s, miss_distance_km)
        states_by_id:    current ECI states keyed by object id
        last_maneuver_time_by_id: last burn time per object (for cooldown)
        current_time_s:  current simulation clock
        object_records:  optional dict of ObjectRecord for fuel checking;
                         if None, fuel gate is skipped (backward-compatible)

    Returns:
        dict mapping object_id → ΔV vector in km/s (ECI)
    """
    if not collision_pairs:
        return {}

    dv_by_id: dict[str, np.ndarray] = {}

    for pair in collision_pairs:
        # ── Cooldown check ────────────────────────────────────────────────
        a_ok = True
        b_ok = True

        last_a = last_maneuver_time_by_id.get(pair.a)
        if last_a is not None and (current_time_s - last_a) < MANEUVER_COOLDOWN_S:
            a_ok = False

        last_b = last_maneuver_time_by_id.get(pair.b)
        if last_b is not None and (current_time_s - last_b) < MANEUVER_COOLDOWN_S:
            b_ok = False

        if not a_ok and not b_ok:
            continue

        # ── Fuel gate ─────────────────────────────────────────────────────
        if object_records is not None:
            rec_a = object_records.get(pair.a)
            rec_b = object_records.get(pair.b)
            if rec_a is not None and _fuel_pct(rec_a) < COLA_MIN_FUEL_PCT:
                a_ok = False
            if rec_b is not None and _fuel_pct(rec_b) < COLA_MIN_FUEL_PCT:
                b_ok = False

        if not a_ok and not b_ok:
            continue

        state_a = states_by_id.get(pair.a)
        state_b = states_by_id.get(pair.b)

        # ── Choose which object maneuvers ─────────────────────────────────
        # Prefer the one with more fuel; if fuel info unavailable, prefer A.
        if a_ok and b_ok and object_records is not None:
            rec_a = object_records.get(pair.a)
            rec_b = object_records.get(pair.b)
            fuel_a = _fuel_pct(rec_a) if rec_a else 100.0
            fuel_b = _fuel_pct(rec_b) if rec_b else 100.0
            # Only one object maneuvers per pair to avoid symmetric burns
            # that cancel each other out.
            if fuel_b > fuel_a:
                a_ok = False
            else:
                b_ok = False

        # ── ΔV magnitude: proportional to threat severity ─────────────────
        # miss_distance_km is in [0, COLLISION_THRESHOLD_KM].
        # Closer approach → larger burn, capped at MAX_DV_M_S.
        # Linear scale: 0 km miss → MAX_DV_M_S, threshold km miss → 1 m/s.
        from ..utils.constants import COLLISION_THRESHOLD_KM
        miss_ratio = max(0.0, 1.0 - pair.miss_distance_km / COLLISION_THRESHOLD_KM)
        dv_m_s = max(1.0, miss_ratio * MAX_DV_M_S)
        dv_km_s = m_s_to_km_s(dv_m_s)

        # ── Compute avoidance vectors ─────────────────────────────────────
        if a_ok and state_a is not None and state_b is not None:
            dv_by_id[pair.a] = avoidance_dv_eci(state_a, state_b, dv_km_s)

        if b_ok and state_b is not None and state_a is not None:
            dv_by_id[pair.b] = avoidance_dv_eci(state_b, state_a, dv_km_s)

    return dv_by_id
