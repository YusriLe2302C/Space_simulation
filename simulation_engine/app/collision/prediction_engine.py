from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from ..physics.propagator import eci_derivative_batch
from ..physics.rk4 import rk4_step_batch
from ..spatial.neighbor_search import close_pairs_kdtree
from ..utils.constants import COLLISION_THRESHOLD_KM

# ── Prediction parameters ─────────────────────────────────────────────────────
PREDICTION_HORIZON_S  = 86_400   # 24 hours
PREDICTION_DT_S       = 60.0     # propagation sub-step (1 minute)
KDTREE_REBUILD_EVERY  = 10       # rebuild KD-tree every N sub-steps
# Candidate search radius: threshold + generous buffer for orbital curvature
CANDIDATE_RADIUS_KM   = 50.0


@dataclass
class FutureConjunction:
    """A predicted close approach at a future time."""
    a:                str
    b:                str
    tca_s:            float   # seconds from NOW when closest approach occurs
    miss_distance_km: float
    time_to_event_s:  float   # same as tca_s, kept for API clarity


def predict_conjunctions_24h(
    ids:           list[str],
    states_km_kms: np.ndarray,
    horizon_s:     float = PREDICTION_HORIZON_S,
    dt_s:          float = PREDICTION_DT_S,
    threshold_km:  float = COLLISION_THRESHOLD_KM,
) -> list[FutureConjunction]:
    """
    Predict all close approaches within the next `horizon_s` seconds using
    full RK4+J2 propagation.

    Algorithm:
      1. At t=0 build a KD-tree over all positions.
         Extract candidate pairs within CANDIDATE_RADIUS_KM — only these
         pairs are tracked through the prediction window.  This reduces
         the per-step work from O(N²) to O(K) where K << N².

      2. Propagate ALL objects forward in dt_s steps using the vectorized
         RK4 batch integrator (same physics as the live simulation).

      3. Rebuild the KD-tree every KDTREE_REBUILD_EVERY steps to catch
         pairs that drift into proximity during the window.

      4. For each candidate pair at each step, compute the linear TCA
         within that sub-step and record the minimum miss distance.

      5. Return the earliest (minimum miss distance) conjunction per pair.

    Args:
        ids:           list of object IDs, length N
        states_km_kms: (N, 6) array of current ECI states [km, km/s]
        horizon_s:     prediction window in seconds (default 24h)
        dt_s:          sub-step size in seconds (default 60s)
        threshold_km:  miss-distance threshold to record an event

    Returns:
        List of FutureConjunction sorted by time_to_event_s ascending.
    """
    states = np.asarray(states_km_kms, dtype=np.float64).copy()
    n = states.shape[0]
    if n < 2:
        return []

    n_steps = int(horizon_s / dt_s)

    # best_conjunction[pair] = FutureConjunction with smallest miss distance
    best: dict[tuple[int, int], FutureConjunction] = {}

    # Candidate pairs — refreshed every KDTREE_REBUILD_EVERY steps
    candidate_pairs: set[tuple[int, int]] = set()

    elapsed_s = 0.0

    for step in range(n_steps):
        # Rebuild KD-tree periodically
        if step % KDTREE_REBUILD_EVERY == 0:
            candidate_pairs = close_pairs_kdtree(
                states[:, 0:3], threshold_km=CANDIDATE_RADIUS_KM
            )

        r0 = states[:, 0:3]
        v0 = states[:, 3:6]

        # Check each candidate pair for close approach within this sub-step
        for i, j in candidate_pairs:
            dr = r0[j] - r0[i]
            dv = v0[j] - v0[i]
            dv2 = float(np.dot(dv, dv))

            if dv2 <= 0.0:
                tca_local = 0.0
            else:
                tca_local = float(-np.dot(dr, dv) / dv2)
                tca_local = max(0.0, min(float(dt_s), tca_local))

            miss = float(np.linalg.norm(dr + dv * tca_local))

            if miss <= threshold_km:
                tca_abs = elapsed_s + tca_local
                key = (min(i, j), max(i, j))
                existing = best.get(key)
                if existing is None or miss < existing.miss_distance_km:
                    best[key] = FutureConjunction(
                        a=ids[i],
                        b=ids[j],
                        tca_s=tca_abs,
                        miss_distance_km=miss,
                        time_to_event_s=tca_abs,
                    )

        # Propagate all objects one sub-step with RK4+J2
        states = rk4_step_batch(states, dt_s, eci_derivative_batch)
        elapsed_s += dt_s

    return sorted(best.values(), key=lambda c: c.time_to_event_s)
