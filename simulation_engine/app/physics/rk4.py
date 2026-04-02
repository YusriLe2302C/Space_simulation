from __future__ import annotations

from typing import Callable

import numpy as np


DerivFn = Callable[[np.ndarray], np.ndarray]


def rk4_step(state: np.ndarray, dt: float, deriv: DerivFn) -> np.ndarray:
    state = np.asarray(state, dtype=np.float64)
    k1 = deriv(state)
    k2 = deriv(state + 0.5 * dt * k1)
    k3 = deriv(state + 0.5 * dt * k2)
    k4 = deriv(state + dt * k3)
    return state + (dt / 6.0) * (k1 + 2.0 * k2 + 2.0 * k3 + k4)


def rk4_step_batch(states: np.ndarray, dt: float, deriv: DerivFn) -> np.ndarray:
    """
    Vectorized RK4 step.
    states: (N,6) array
    deriv: function accepting (N,6) and returning (N,6)
    """
    states = np.asarray(states, dtype=np.float64)
    if states.size == 0:
        return np.zeros((0, 6), dtype=np.float64)

    k1 = deriv(states)
    k2 = deriv(states + 0.5 * dt * k1)
    k3 = deriv(states + 0.5 * dt * k2)
    k4 = deriv(states + dt * k3)
    return states + (dt / 6.0) * (k1 + 2.0 * k2 + 2.0 * k3 + k4)
