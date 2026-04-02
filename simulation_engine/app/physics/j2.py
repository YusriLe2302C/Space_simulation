from __future__ import annotations

import numpy as np

from ..utils.constants import EARTH_J2, EARTH_MU_KM3_S2, EARTH_RADIUS_KM


def j2_accel_km_s2(r_km: np.ndarray) -> np.ndarray:
    """
    J2 perturbation acceleration in ECI, km/s^2.
    Reference form (Vallado): a_J2 = (3/2) J2 mu Re^2 / r^5 * [...]
    """
    x, y, z = r_km
    r2 = x * x + y * y + z * z
    if r2 <= 0.0:
        return np.zeros(3, dtype=np.float64)

    r = np.sqrt(r2)
    z2 = z * z
    r5 = r2 * r2 * r
    factor = 1.5 * EARTH_J2 * EARTH_MU_KM3_S2 * (EARTH_RADIUS_KM**2) / r5
    k = 5.0 * z2 / r2

    ax = factor * x * (k - 1.0)
    ay = factor * y * (k - 1.0)
    az = factor * z * (k - 3.0)
    return np.array([ax, ay, az], dtype=np.float64)


def j2_accel_batch_km_s2(r_km: np.ndarray) -> np.ndarray:
    """
    Vectorized J2 perturbation acceleration in ECI, km/s^2.
    r_km: (N,3)
    """
    r_km = np.asarray(r_km, dtype=np.float64)
    if r_km.size == 0:
        return np.zeros((0, 3), dtype=np.float64)

    x = r_km[:, 0]
    y = r_km[:, 1]
    z = r_km[:, 2]

    r2 = x * x + y * y + z * z
    # Avoid division by zero
    r2 = np.where(r2 <= 0.0, np.nan, r2)

    r = np.sqrt(r2)
    z2 = z * z
    r5 = r2 * r2 * r
    factor = 1.5 * EARTH_J2 * EARTH_MU_KM3_S2 * (EARTH_RADIUS_KM**2) / r5
    k = 5.0 * z2 / r2

    ax = factor * x * (k - 1.0)
    ay = factor * y * (k - 1.0)
    az = factor * z * (k - 3.0)

    a = np.stack([ax, ay, az], axis=1)
    a = np.where(np.isfinite(a), a, 0.0)
    return a.astype(np.float64, copy=False)
