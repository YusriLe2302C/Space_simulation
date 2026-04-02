from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from ..spatial.neighbor_search import close_pairs_kdtree


@dataclass(frozen=True)
class CloseApproach:
    a: str
    b: str
    tca_s: float
    miss_distance_km: float


def detect_collisions_instant(
    ids: list[str], positions_km: np.ndarray, threshold_km: float
) -> list[tuple[str, str]]:
    """
    Instantaneous collision detection (same-epoch) using KD-tree to avoid O(N^2).
    """
    pairs = close_pairs_kdtree(positions_km, threshold_km=threshold_km)
    return [(ids[i], ids[j]) for i, j in pairs]


def predict_close_approaches(
    ids: list[str],
    states_km_kms: np.ndarray,
    step_seconds: float,
    threshold_km: float,
) -> list[CloseApproach]:
    """
    Predict close approaches within the next step using a constant relative-velocity
    model for time-of-closest-approach (TCA) after candidate generation via KD-tree.

    Candidate radius is expanded by a conservative bound based on max speed to avoid
    missing pairs that could cross within the step.
    """
    states = np.asarray(states_km_kms, dtype=np.float64)
    n = states.shape[0]
    if n < 2:
        return []

    r0 = states[:, 0:3]
    v0 = states[:, 3:6]

    speeds = np.linalg.norm(v0, axis=1)
    vmax = float(np.max(speeds)) if speeds.size else 0.0
    candidate_radius = float(threshold_km + (2.0 * vmax * step_seconds))

    candidate_pairs = close_pairs_kdtree(r0, threshold_km=candidate_radius)
    if not candidate_pairs:
        return []

    out: list[CloseApproach] = []
    dt = float(step_seconds)

    for i, j in candidate_pairs:
        dr = r0[j] - r0[i]
        dv = v0[j] - v0[i]
        dv2 = float(np.dot(dv, dv))
        if dv2 <= 0.0:
            tca = 0.0
        else:
            tca = float(-np.dot(dr, dv) / dv2)
            if tca < 0.0:
                tca = 0.0
            elif tca > dt:
                tca = dt

        dmin = float(np.linalg.norm(dr + dv * tca))
        if dmin <= threshold_km:
            out.append(CloseApproach(a=ids[i], b=ids[j], tca_s=tca, miss_distance_km=dmin))

    return out
