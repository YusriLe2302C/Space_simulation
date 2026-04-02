from __future__ import annotations

import numpy as np


def norm(vec: np.ndarray) -> float:
    return float(np.linalg.norm(vec))


def unit(vec: np.ndarray, eps: float = 1e-12) -> np.ndarray:
    n = np.linalg.norm(vec)
    if n < eps:
        return np.zeros_like(vec)
    return vec / n


def ensure_state(state: np.ndarray) -> np.ndarray:
    state = np.asarray(state, dtype=np.float64).reshape(-1)
    if state.shape != (6,):
        raise ValueError("state must be length-6 [x,y,z,vx,vy,vz]")
    return state

