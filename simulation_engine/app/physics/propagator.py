from __future__ import annotations

import numpy as np

from ..utils.constants import EARTH_MU_KM3_S2
from .j2 import j2_accel_batch_km_s2, j2_accel_km_s2


def two_body_accel_km_s2(r_km: np.ndarray) -> np.ndarray:
    r2 = float(np.dot(r_km, r_km))
    if r2 <= 0.0:
        return np.zeros(3, dtype=np.float64)
    r = np.sqrt(r2)
    return (-EARTH_MU_KM3_S2 / (r * r * r)) * r_km


def two_body_accel_batch_km_s2(r_km: np.ndarray) -> np.ndarray:
    r_km = np.asarray(r_km, dtype=np.float64)
    if r_km.size == 0:
        return np.zeros((0, 3), dtype=np.float64)

    r2 = np.einsum("ij,ij->i", r_km, r_km)
    r2 = np.where(r2 <= 0.0, np.nan, r2)
    r = np.sqrt(r2)
    inv_r3 = 1.0 / (r * r * r)
    a = (-EARTH_MU_KM3_S2 * inv_r3)[:, None] * r_km
    a = np.where(np.isfinite(a), a, 0.0)
    return a.astype(np.float64, copy=False)


def eci_derivative(state: np.ndarray) -> np.ndarray:
    """
    state = [x,y,z,vx,vy,vz] in km, km/s.
    returns d/dt state.
    """
    r = state[0:3]
    v = state[3:6]
    a = two_body_accel_km_s2(r) + j2_accel_km_s2(r)
    return np.concatenate((v, a), dtype=np.float64)


def eci_derivative_batch(states: np.ndarray) -> np.ndarray:
    """
    Vectorized derivative for many states.
    states: (N,6) in km, km/s
    returns: (N,6)
    """
    states = np.asarray(states, dtype=np.float64)
    if states.size == 0:
        return np.zeros((0, 6), dtype=np.float64)

    r = states[:, 0:3]
    v = states[:, 3:6]
    a = two_body_accel_batch_km_s2(r) + j2_accel_batch_km_s2(r)
    return np.concatenate((v, a), axis=1).astype(np.float64, copy=False)
