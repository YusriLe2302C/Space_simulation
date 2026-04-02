from __future__ import annotations

import numpy as np
from scipy.spatial import cKDTree


def build_tree(positions_km: np.ndarray) -> cKDTree:
    positions_km = np.asarray(positions_km, dtype=np.float64)
    return cKDTree(positions_km)


def query_pairs(tree: cKDTree, radius_km: float) -> set[tuple[int, int]]:
    return tree.query_pairs(r=radius_km, output_type="set")

