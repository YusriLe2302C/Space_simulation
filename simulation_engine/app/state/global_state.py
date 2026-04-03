from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from ..fuel.fuel_model import default_mass_model
from ..utils.math_utils import ensure_state, norm

# ── Snapshot file path ────────────────────────────────────────────────────────
# Written on every simulate_step so a restart can resume from last known state.
# Override with ACM_SNAPSHOT_PATH env var.
import tempfile as _tempfile
_SNAPSHOT_PATH = Path(
    os.environ.get(
        "ACM_SNAPSHOT_PATH",
        str(Path(__file__).parent.parent.parent / "data" / "acm_global_state.json")
    )
)


@dataclass
class ObjectRecord:
    state: np.ndarray  # km, km/s
    dry_mass_kg: float
    propellant_kg: float
    isp_s: float
    current_mass_kg: float
    target_radius_km: float
    station_tolerance_km: float
    last_maneuver_time_s: float | None = None
    status: str = "NOMINAL"


class GlobalState:
    def __init__(self) -> None:
        self.objects: dict[str, ObjectRecord] = {}
        self.sim_time_s: float = 0.0
        self._step_count: int = 0
        self._save_every: int = 10  # only persist every N steps

    def upsert_object(self, obj_id: str, state: list[float]) -> None:
        st = ensure_state(np.asarray(state, dtype=np.float64))
        rec = self.objects.get(obj_id)
        if rec is None:
            dry, prop, isp = default_mass_model()
            target_r = norm(st[0:3])
            self.objects[obj_id] = ObjectRecord(
                state=st,
                dry_mass_kg=dry,
                propellant_kg=prop,
                isp_s=isp,
                current_mass_kg=dry + prop,
                target_radius_km=target_r,
                station_tolerance_km=10.0,  # doc §5.2: 10 km spherical box
            )
            return
        rec.state = st
        if rec.target_radius_km <= 0.0:
            rec.target_radius_km = norm(st[0:3])

    def get_ids_and_states(self) -> tuple[list[str], np.ndarray]:
        ids = list(self.objects.keys())
        states = np.stack([self.objects[i].state for i in ids], axis=0) if ids else np.zeros((0, 6))
        return ids, states

    # ── Persistence ───────────────────────────────────────────────────────────

    def save(self) -> None:
        """Persist state to disk — throttled to every _save_every steps."""
        self._step_count += 1
        if self._step_count % self._save_every != 0:
            return
        payload = {
            "sim_time_s": self.sim_time_s,
            "objects": {
                obj_id: {
                    "state":               rec.state.tolist(),
                    "dry_mass_kg":         rec.dry_mass_kg,
                    "propellant_kg":       rec.propellant_kg,
                    "isp_s":               rec.isp_s,
                    "current_mass_kg":     rec.current_mass_kg,
                    "target_radius_km":    rec.target_radius_km,
                    "station_tolerance_km": rec.station_tolerance_km,
                    "last_maneuver_time_s": rec.last_maneuver_time_s,
                    "status":              rec.status,
                }
                for obj_id, rec in self.objects.items()
            },
        }
        # Write atomically: write to .tmp then rename to avoid corrupt reads
        tmp = _SNAPSHOT_PATH.with_suffix(".tmp")
        tmp.write_text(json.dumps(payload), encoding="utf-8")
        tmp.replace(_SNAPSHOT_PATH)

    def load(self) -> bool:
        """
        Load state from the snapshot file if it exists.
        Returns True if state was restored, False if no snapshot found.
        Called once at startup before the first simulate_step.
        """
        if not _SNAPSHOT_PATH.exists():
            return False

        try:
            payload = json.loads(_SNAPSHOT_PATH.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            return False

        self.sim_time_s = float(payload.get("sim_time_s", 0.0))
        self.objects = {}

        for obj_id, d in payload.get("objects", {}).items():
            self.objects[obj_id] = ObjectRecord(
                state=ensure_state(np.array(d["state"], dtype=np.float64)),
                dry_mass_kg=float(d["dry_mass_kg"]),
                propellant_kg=float(d["propellant_kg"]),
                isp_s=float(d["isp_s"]),
                current_mass_kg=float(d["current_mass_kg"]),
                target_radius_km=float(d["target_radius_km"]),
                station_tolerance_km=float(d["station_tolerance_km"]),
                last_maneuver_time_s=(
                    float(d["last_maneuver_time_s"])
                    if d.get("last_maneuver_time_s") is not None
                    else None
                ),
                status=str(d.get("status", "NOMINAL")),
            )

        return True


GLOBAL_STATE = GlobalState()
# Attempt to restore from last snapshot on module load (process restart)
GLOBAL_STATE.load()
