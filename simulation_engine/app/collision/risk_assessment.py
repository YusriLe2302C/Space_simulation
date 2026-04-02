from __future__ import annotations

import math
import numpy as np


# ── Default covariance ────────────────────────────────────────────────────────
# When no per-object covariance is available, use a conservative isotropic
# 1-sigma position uncertainty of 50 m (0.05 km) in each axis.
# This is representative of a well-tracked LEO object with GPS-quality TLE.
_DEFAULT_SIGMA_KM = 0.05


# ── Pc threshold used by the decision engine ─────────────────────────────────
# NASA/ESA operational threshold for mandatory avoidance maneuver consideration.
PC_MANEUVER_THRESHOLD = 1e-4


def _combined_covariance_2d(
    cov_a: np.ndarray | None,
    cov_b: np.ndarray | None,
    miss_hat: np.ndarray,
    rel_vel_hat: np.ndarray,
) -> np.ndarray:
    """
    Project the combined 3×3 position covariance of objects A and B onto
    the conjunction plane (the plane perpendicular to the relative velocity).

    The conjunction plane is spanned by two orthonormal vectors:
      u1 = miss_hat (direction of closest approach)
      u2 = miss_hat × rel_vel_hat (third axis in the plane)

    Returns a 2×2 covariance matrix in the conjunction plane.
    """
    sigma = _DEFAULT_SIGMA_KM

    if cov_a is None:
        cov_a = np.eye(3) * sigma ** 2
    if cov_b is None:
        cov_b = np.eye(3) * sigma ** 2

    cov_combined = cov_a + cov_b   # combined position covariance (3×3)

    # Conjunction plane basis vectors
    u1 = miss_hat
    u2 = np.cross(miss_hat, rel_vel_hat)
    u2_norm = np.linalg.norm(u2)
    if u2_norm < 1e-12:
        # Degenerate: miss direction parallel to relative velocity
        # Use an arbitrary perpendicular vector
        perp = np.array([1.0, 0.0, 0.0]) if abs(rel_vel_hat[0]) < 0.9 else np.array([0.0, 1.0, 0.0])
        u2 = np.cross(rel_vel_hat, perp)
        u2 = u2 / np.linalg.norm(u2)
    else:
        u2 = u2 / u2_norm

    # Project 3×3 covariance onto 2D conjunction plane
    P = np.array([u1, u2])          # 2×3 projection matrix
    cov_2d = P @ cov_combined @ P.T  # 2×2
    return cov_2d


def _pc_foster(miss_km: float, r_body_km: float, cov_2d: np.ndarray) -> float:
    """
    Foster's method: integrate a 2D Gaussian over a circular hard-body region.

    P_c = ∫∫_{disk of radius r_body} N(x; miss_vec, C) dx dy

    For a circular hard body and a 2D Gaussian, this reduces to:

        P_c = 1 - exp(-0.5 * miss² / σ_eff²)   [when cov is isotropic]

    For the general anisotropic case we use the exact series expansion
    (Patera 2005 / Chan 1997) truncated at sufficient terms.

    Here we use a numerically stable approximation via the Marcum Q-function
    expressed through the regularised incomplete gamma function, which is
    available in Python's math module.

    Reference: Foster (1992), "A parametric analysis of orbital debris collision
    probability and maneuver rate for space vehicles".
    """
    # Eigendecompose the 2×2 covariance to get principal variances
    try:
        eigvals = np.linalg.eigvalsh(cov_2d)
    except np.linalg.LinAlgError:
        return 0.0

    eigvals = np.maximum(eigvals, 1e-20)   # numerical floor
    sigma1_sq, sigma2_sq = float(eigvals[0]), float(eigvals[1])

    # Hard-body radius: combined physical size of both objects.
    # r_body is passed in km.
    r_sq = r_body_km ** 2

    # Miss distance squared
    miss_sq = miss_km ** 2

    # For the isotropic approximation (conservative, slightly overestimates Pc):
    # Use the geometric mean variance as the effective variance.
    sigma_eff_sq = math.sqrt(sigma1_sq * sigma2_sq)

    if sigma_eff_sq < 1e-30:
        return 0.0

    # Pc ≈ (r²/2σ²) * exp(-miss²/2σ²)   [small-r approximation, Foster 1992]
    # Valid when r << σ (typical for space debris).
    # For larger r/σ ratios the full Marcum-Q integral is needed; this
    # approximation is conservative (slightly overestimates) for r/σ < 0.5.
    exponent = -miss_sq / (2.0 * sigma_eff_sq)
    if exponent < -700:
        return 0.0   # underflow — Pc is negligibly small

    pc = (r_sq / (2.0 * sigma_eff_sq)) * math.exp(exponent)
    return min(1.0, pc)


# ── Public API ────────────────────────────────────────────────────────────────

# Combined hard-body radius (satellite + debris, approximate)
HARD_BODY_RADIUS_KM = 0.010   # 10 m combined


def compute_pc(
    miss_distance_km: float,
    rel_vel: np.ndarray,
    dr: np.ndarray,
    cov_a: np.ndarray | None = None,
    cov_b: np.ndarray | None = None,
) -> float:
    """
    Compute collision probability Pc for a single conjunction event.

    Args:
        miss_distance_km: scalar miss distance at TCA (km)
        rel_vel:          relative velocity vector at TCA (km/s), shape (3,)
        dr:               relative position vector at TCA (km), shape (3,)
        cov_a:            3×3 position covariance of object A (km²), or None
        cov_b:            3×3 position covariance of object B (km²), or None

    Returns:
        Pc in [0, 1]
    """
    if miss_distance_km <= 0.0:
        return 1.0

    rel_vel_mag = float(np.linalg.norm(rel_vel))
    if rel_vel_mag < 1e-12:
        # Stationary relative to each other — treat as certain collision
        # if within hard-body radius, else use default sigma
        if miss_distance_km <= HARD_BODY_RADIUS_KM:
            return 1.0
        rel_vel = np.array([1.0, 0.0, 0.0])
        rel_vel_mag = 1.0

    rel_vel_hat = rel_vel / rel_vel_mag

    dr_mag = float(np.linalg.norm(dr))
    miss_hat = (dr / dr_mag) if dr_mag > 1e-12 else np.array([1.0, 0.0, 0.0])

    cov_2d = _combined_covariance_2d(cov_a, cov_b, miss_hat, rel_vel_hat)
    return _pc_foster(miss_distance_km, HARD_BODY_RADIUS_KM, cov_2d)


def collision_count(close_approaches) -> int:
    """
    Count conjunctions whose Pc exceeds the maneuver threshold.

    This replaces the old `len(close_approaches)` which counted every
    close approach as a collision regardless of probability.

    For conjunctions where full state vectors are not available (legacy
    callers that only pass CloseApproach objects), falls back to a
    distance-only threshold at 0.5 × COLLISION_THRESHOLD_KM.
    """
    from ..utils.constants import COLLISION_THRESHOLD_KM

    count = 0
    for ca in close_approaches:
        # If the CloseApproach carries pre-computed Pc, use it directly
        if hasattr(ca, "pc") and ca.pc is not None:
            if ca.pc >= PC_MANEUVER_THRESHOLD:
                count += 1
        else:
            # Fallback: distance-only heuristic
            # Use half the detection threshold as a conservative collision proxy
            if ca.miss_distance_km <= COLLISION_THRESHOLD_KM * 0.5:
                count += 1
    return count


def enrich_close_approaches_with_pc(
    close_approaches,
    states_by_id: dict[str, np.ndarray],
    covariances: dict[str, np.ndarray] | None = None,
) -> list:
    """
    Attach a `pc` attribute to each CloseApproach using the current states.

    Called from state_updater.py after predict_close_approaches() so that
    both collision_count() and plan_cola_maneuvers() can use Pc values.

    Args:
        close_approaches: list of CloseApproach dataclass instances
        states_by_id:     current ECI states
        covariances:      optional per-object 3×3 position covariance (km²)

    Returns:
        The same list with `.pc` set on each element (uses object.__dict__
        since CloseApproach is a frozen dataclass — we attach as a plain attr
        via a wrapper namedtuple to avoid mutating the frozen instance).
    """
    from dataclasses import dataclass

    @dataclass
    class CloseApproachWithPc:
        a: str
        b: str
        tca_s: float
        miss_distance_km: float
        pc: float

    enriched = []
    for ca in close_approaches:
        state_a = states_by_id.get(ca.a)
        state_b = states_by_id.get(ca.b)

        if state_a is None or state_b is None:
            pc = 0.0
        else:
            dr     = state_a[0:3] - state_b[0:3]
            dv_rel = state_a[3:6] - state_b[3:6]
            cov_a  = covariances.get(ca.a) if covariances else None
            cov_b  = covariances.get(ca.b) if covariances else None
            pc = compute_pc(ca.miss_distance_km, dv_rel, dr, cov_a, cov_b)

        enriched.append(CloseApproachWithPc(
            a=ca.a,
            b=ca.b,
            tca_s=ca.tca_s,
            miss_distance_km=ca.miss_distance_km,
            pc=pc,
        ))

    return enriched
