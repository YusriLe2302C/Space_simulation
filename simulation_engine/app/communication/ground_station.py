from __future__ import annotations

import math
from collections import deque
from dataclasses import dataclass, field

import numpy as np

from ..utils.constants import EARTH_RADIUS_KM
from .los import los_with_elevation_mask

# ── Constants ─────────────────────────────────────────────────────────────────
COMM_DELAY_S      = 10.0
OMEGA_EARTH_RAD_S = 7.2921159e-5
_DEG2RAD = math.pi / 180.0


def compute_gmst(sim_time_s: float) -> float:
    return (OMEGA_EARTH_RAD_S * sim_time_s) % (2.0 * math.pi)


def _geodetic_to_ecef(lat_deg: float, lon_deg: float, alt_km: float = 0.0) -> np.ndarray:
    lat = lat_deg * _DEG2RAD
    lon = lon_deg * _DEG2RAD
    r   = EARTH_RADIUS_KM + alt_km
    return np.array([
        r * math.cos(lat) * math.cos(lon),
        r * math.cos(lat) * math.sin(lon),
        r * math.sin(lat),
    ], dtype=np.float64)


def ecef_to_eci(pos_ecef: np.ndarray, gmst: float) -> np.ndarray:
    c, s = math.cos(gmst), math.sin(gmst)
    return np.array([
        pos_ecef[0] * c - pos_ecef[1] * s,
        pos_ecef[0] * s + pos_ecef[1] * c,
        pos_ecef[2],
    ], dtype=np.float64)


@dataclass(frozen=True)
class GroundStation:
    name:              str
    lat_deg:           float
    lon_deg:           float
    alt_km:            float = 0.0
    min_elevation_deg: float = 5.0   # doc §5.5.1 elevation mask

    def __hash__(self):
        return hash(self.name)

    def eci_position(self, sim_time_s: float) -> np.ndarray:
        gmst     = compute_gmst(sim_time_s)
        pos_ecef = _geodetic_to_ecef(self.lat_deg, self.lon_deg, self.alt_km)
        return ecef_to_eci(pos_ecef, gmst)


# ── Exact ground stations from doc §5.5.1 ────────────────────────────────────
GROUND_STATIONS: list[GroundStation] = [
    GroundStation("ISTRAC_Bengaluru",    13.0333,   77.5167, alt_km=0.820, min_elevation_deg=5.0),
    GroundStation("Svalbard_Sat_Station",78.2297,   15.4077, alt_km=0.400, min_elevation_deg=5.0),
    GroundStation("Goldstone_Tracking",  35.4266, -116.8900, alt_km=1.000, min_elevation_deg=10.0),
    GroundStation("Punta_Arenas",       -53.1500,  -70.9167, alt_km=0.030, min_elevation_deg=5.0),
    GroundStation("IIT_Delhi_Ground_Node",28.5450,   77.1926, alt_km=0.225, min_elevation_deg=15.0),
    GroundStation("McMurdo_Station",    -77.8463,  166.6682, alt_km=0.010, min_elevation_deg=5.0),
]


@dataclass
class PendingCommand:
    obj_id:       str
    dv_km_s:      np.ndarray
    execute_at_s: float
    command_type: str = "COLA"


@dataclass
class CommLayer:
    _queue: deque = field(default_factory=deque)
    _MAX_QUEUE = 2000

    def satellite_in_los(self, sat_pos_km: np.ndarray, sim_time_s: float) -> bool:
        for gs in GROUND_STATIONS:
            gs_pos = gs.eci_position(sim_time_s)
            if los_with_elevation_mask(sat_pos_km, gs_pos, gs.lat_deg, gs.lon_deg,
                                       gs.alt_km, gs.min_elevation_deg, sim_time_s):
                return True
        return False

    def schedule_if_visible(
        self,
        obj_id:         str,
        sat_pos_km:     np.ndarray,
        dv_km_s:        np.ndarray,
        current_time_s: float,
        command_type:   str = "COLA",
    ) -> bool:
        if len(self._queue) >= self._MAX_QUEUE:
            return False
        if not self.satellite_in_los(sat_pos_km, current_time_s):
            return False
        self._queue.append(PendingCommand(
            obj_id=obj_id,
            dv_km_s=np.asarray(dv_km_s, dtype=np.float64),
            execute_at_s=current_time_s + COMM_DELAY_S,
            command_type=command_type,
        ))
        return True

    def pre_upload_if_upcoming_blackout(
        self,
        obj_id:         str,
        sat_pos_km:     np.ndarray,
        sat_vel_km_s:   np.ndarray,
        dv_km_s:        np.ndarray,
        current_time_s: float,
        tca_s:          float,
        command_type:   str = "COLA",
    ) -> bool:
        """
        Pre-upload a command before a predicted blackout window.
        If the satellite currently has LOS, upload immediately.
        If not, check whether it will have LOS within the next
        BLACKOUT_LOOKAHEAD_S seconds by stepping the satellite
        position forward in 30-second increments.
        If a future LOS window is found before TCA, schedule the
        command to execute at TCA - COMM_DELAY_S.
        """
        if len(self._queue) >= self._MAX_QUEUE:
            return False

        # Already in LOS — normal upload
        if self.satellite_in_los(sat_pos_km, current_time_s):
            self._queue.append(PendingCommand(
                obj_id=obj_id,
                dv_km_s=np.asarray(dv_km_s, dtype=np.float64),
                execute_at_s=current_time_s + COMM_DELAY_S,
                command_type=command_type,
            ))
            return True

        # Scan ahead for a future LOS window before TCA
        from ..physics.propagator import eci_derivative_batch
        from ..physics.rk4 import rk4_step_batch
        STEP_S = 30.0
        state = np.concatenate([sat_pos_km, sat_vel_km_s]).reshape(1, 6)
        t = current_time_s
        while t < tca_s - COMM_DELAY_S:
            state = rk4_step_batch(state, STEP_S, eci_derivative_batch)
            t += STEP_S
            pos = state[0, 0:3]
            if self.satellite_in_los(pos, t):
                # Found a future LOS window — schedule to execute at TCA
                execute_at = max(t + COMM_DELAY_S, tca_s - COMM_DELAY_S)
                self._queue.append(PendingCommand(
                    obj_id=obj_id,
                    dv_km_s=np.asarray(dv_km_s, dtype=np.float64),
                    execute_at_s=execute_at,
                    command_type=command_type,
                ))
                return True

        return False  # no LOS window found before TCA

    def pop_due_commands(self, current_time_s: float) -> list[PendingCommand]:
        due    = [c for c in self._queue if c.execute_at_s <= current_time_s]
        remain = deque(c for c in self._queue if c.execute_at_s >  current_time_s)
        self._queue = remain
        return due

    def pending_count(self) -> int:
        return len(self._queue)

    def clear(self) -> None:
        self._queue.clear()


COMM_LAYER = CommLayer()


def apply_comm_delay(
    obj_id:         str,
    sat_pos_km:     np.ndarray,
    dv_km_s:        np.ndarray,
    current_time_s: float,
    command_type:   str = "COLA",
) -> bool:
    return COMM_LAYER.schedule_if_visible(
        obj_id=obj_id,
        sat_pos_km=sat_pos_km,
        dv_km_s=dv_km_s,
        current_time_s=current_time_s,
        command_type=command_type,
    )
