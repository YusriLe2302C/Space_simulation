from __future__ import annotations

import numpy as np

from .kdtree import build_tree, query_pairs


def close_pairs_kdtree(positions_km: np.ndarray, threshold_km: float) -> set[tuple[int, int]]:
    if positions_km.shape[0] < 2:
        return set()
    tree = build_tree(positions_km)
    return query_pairs(tree, radius_km=threshold_km)

