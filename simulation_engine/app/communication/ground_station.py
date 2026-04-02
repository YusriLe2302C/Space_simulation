from __future__ import annotations

import math
from dataclasses import dataclass, field

import numpy as np

from ..utils.constants import EARTH_RADIUS_KM
from .los import any_station_has_los

# ── Constants ─────────────────────────────────────────────────────────────────
COMM_DELAY_S      = 10.0
# Sidereal rotation rate: one full rotation in 86164.1 s
OMEGA_EARTH_RAD_S = 7.2921159e-5

_DEG2RAD = math.pi / 180.0


# ── GMST ──────────────────────────────────────────────────────────────────────

def compute_gmst(sim_time_s: float) -> float:
    """
    Greenwich Mean Sidereal Time in radians at sim_time_s seconds from epoch.
    Epoch is defined as GMST=0 (prime meridian aligned with vernal equinox),
    consistent with the ECI frame used throughout the simulation.
    """
    return (OMEGA_EARTH_RAD_S * sim_time_s) % (2.0 * math.pi)


def _geodetic_to_ecef(lat_deg: float, lon_deg: float, alt_km: float = 0.0) -> np.ndarray:
    """Geodetic → ECEF (Earth-fixed frame, rotates with Earth)."""
    lat = lat_deg * _DEG2RAD
    lon = lon_deg * _DEG2RAD
    r   = EARTH_RADIUS_KM + alt_km
    return np.array([
        r * math.cos(lat) * math.cos(lon),
        r * math.cos(lat) * math.sin(lon),
        r * math.sin(lat),
    ], dtype=np.float64)


def ecef_to_eci(pos_ecef: np.ndarray, gmst: float) -> np.ndarray:
    """
    Rotate ECEF → ECI by applying GMST rotation around Z-axis.
    ECI_x =  ECEF_x * cos(gmst) - ECEF_y * sin(gmst)
    ECI_y =  ECEF_x * sin(gmst) + ECEF_y * cos(gmst)
    ECI_z =  ECEF_z
    """
    c, s = math.cos(gmst), math.sin(gmst)
    return np.array([
        pos_ecef[0] * c - pos_ecef[1] * s,
        pos_ecef[0] * s + pos_ecef[1] * c,
        pos_ecef[2],
    ], dtype=np.float64)


# ── Ground station ────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class GroundStation:
    name:    str
    lat_deg: float
    lon_deg: float
    alt_km:  float = 0.0

    def __hash__(self):
        return hash(self.name)

    def eci_position(self, sim_time_s: float) -> np.ndarray:
        """ECI position at sim_time_s, accounting for Earth rotation."""
        gmst     = compute_gmst(sim_time_s)
        pos_ecef = _geodetic_to_ecef(self.lat_deg, self.lon_deg, self.alt_km)
        return ecef_to_eci(pos_ecef, gmst)


GROUND_STATIONS: list[GroundStation] = [
    GroundStation("Bangalore",  12.97,   77.59),   # ISRO
    GroundStation("Svalbard",   78.23,   15.40),   # ESA/KSAT
    GroundStation("Goldstone",  35.43, -116.89),   # NASA DSN
    GroundStation("Kourou",      5.23,  -52.77),   # ESA
    GroundStation("Dongara",   -29.05,  115.35),   # ESA
]


# ── Pending command queue ─────────────────────────────────────────────────────

@dataclass
class PendingCommand:
    obj_id:       str
    dv_km_s:      np.ndarray
    execute_at_s: float
    command_type: str = "COLA"


@dataclass
class CommLayer:
    _queue: list[PendingCommand] = field(default_factory=list)

    def satellite_in_los(self, sat_pos_km: np.ndarray, sim_time_s: float) -> bool:
        """LOS check with dynamically rotated ground station positions."""
        positions = [gs.eci_position(sim_time_s) for gs in GROUND_STATIONS]
        return any_station_has_los(sat_pos_km, positions)

    def schedule_if_visible(
        self,
        obj_id:         str,
        sat_pos_km:     np.ndarray,
        dv_km_s:        np.ndarray,
        current_time_s: float,
        command_type:   str = "COLA",
    ) -> bool:
        if not self.satellite_in_los(sat_pos_km, current_time_s):
            return False
        self._queue.append(PendingCommand(
            obj_id=obj_id,
            dv_km_s=np.asarray(dv_km_s, dtype=np.float64),
            execute_at_s=current_time_s + COMM_DELAY_S,
            command_type=command_type,
        ))
        return True

    def pop_due_commands(self, current_time_s: float) -> list[PendingCommand]:
        due    = [c for c in self._queue if c.execute_at_s <= current_time_s]
        remain = [c for c in self._queue if c.execute_at_s >  current_time_s]
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
