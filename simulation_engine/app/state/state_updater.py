from __future__ import annotations

import numpy as np

from ..collision.predictor import predict_close_approaches
from ..collision.risk_assessment import enrich_close_approaches_with_pc
from ..collision.prediction_engine import predict_conjunctions_24h
from ..communication.ground_station import COMM_LAYER, apply_comm_delay
from ..decision.optimizer import plan_optimised_cola
from ..decision.station_keeping import plan_station_keeping
from ..fuel.fuel_model import apply_rocket_equation, is_graveyard_needed, propellant_remaining_pct
from ..physics.propagator import eci_derivative_batch
from ..physics.rk4 import rk4_step_batch
from ..utils.constants import (
    COLLISION_THRESHOLD_KM,
    MAX_DV_M_S,
)
from ..utils.math_utils import ensure_state
from .global_state import GLOBAL_STATE

# Object IDs whose prefix marks them as uncontrollable debris.
# Station-keeping and COLA maneuvers are never applied to these.
# The backend sets object IDs from objectId which starts with "DEB-" for debris.
_DEBRIS_PREFIXES = ("DEB-", "DEBRIS-", "deb-")


def _is_debris(obj_id: str) -> bool:
    """Return True if this object is uncontrollable debris (no thruster)."""
    return any(obj_id.startswith(p) for p in _DEBRIS_PREFIXES)


import math as _math


def _eci_to_latlon(r_km: np.ndarray) -> tuple[float, float, float]:
    """Convert ECI position vector to geodetic lat / lon / alt."""
    from ..utils.constants import EARTH_RADIUS_KM
    x, y, z = float(r_km[0]), float(r_km[1]), float(r_km[2])
    r_mag = _math.sqrt(x*x + y*y + z*z)
    if r_mag < 1e-9:
        return 0.0, 0.0, 0.0
    lat = _math.degrees(_math.asin(max(-1.0, min(1.0, z / r_mag))))
    lon = _math.degrees(_math.atan2(y, x))
    alt = r_mag - EARTH_RADIUS_KM
    return lat, lon, alt


def generate_orbit_path(
    state: np.ndarray,
    steps: int = 60,
    dt_s: float = 90.0,
) -> list[dict]:
    """
    Propagate one object forward steps x dt_s seconds using RK4+J2.
    Reduced to 60 steps x 90s = 90 min orbit with fewer points for speed.
    """
    s = np.asarray(state, dtype=np.float64).copy().reshape(1, 6)
    path: list[dict] = []
    for _ in range(steps):
        s = rk4_step_batch(s, dt_s, eci_derivative_batch)
        lat, lon, alt = _eci_to_latlon(s[0, 0:3])
        path.append({"lat": round(lat, 3), "lon": round(lon, 3), "alt": round(alt, 1)})
    return path


def predict_conjunctions(
    horizon_s: float = 86_400,
    dt_s: float = 60.0,
) -> list[dict]:
    ids, states = GLOBAL_STATE.get_ids_and_states()
    if states.shape[0] < 2:
        return []
    conjunctions = predict_conjunctions_24h(
        ids=ids, states_km_kms=states, horizon_s=horizon_s, dt_s=dt_s,
    )
    return [
        {"a": c.a, "b": c.b, "tca_s": c.tca_s,
         "miss_distance_km": c.miss_distance_km, "time_to_event_s": c.time_to_event_s}
        for c in conjunctions
    ]


def predict_conjunctions_24h_from_snapshot(
    ids: list[str],
    states: np.ndarray,
    horizon_s: float = 86_400,
    dt_s: float = 60.0,
) -> list[dict]:
    """Run prediction on a pre-copied state snapshot (no lock needed)."""
    if states.shape[0] < 2:
        return []
    conjunctions = predict_conjunctions_24h(
        ids=ids, states_km_kms=states, horizon_s=horizon_s, dt_s=dt_s,
    )
    return [
        {"a": c.a, "b": c.b, "tca_s": c.tca_s,
         "miss_distance_km": c.miss_distance_km, "time_to_event_s": c.time_to_event_s}
        for c in conjunctions
    ]


def propagate_states(states: np.ndarray, step_seconds: float) -> np.ndarray:
    return rk4_step_batch(states, step_seconds, eci_derivative_batch)


def apply_maneuvers(
    ids: list[str],
    states: np.ndarray,
    dv_by_id_km_s: dict[str, np.ndarray],
) -> tuple[np.ndarray, int]:
    if not dv_by_id_km_s:
        return states, 0

    updated = states.copy()
    maneuvers = 0
    id_to_idx = {obj_id: i for i, obj_id in enumerate(ids)}
    for obj_id, dv_km_s in dv_by_id_km_s.items():
        idx = id_to_idx.get(obj_id)
        if idx is None:
            continue
        dv = np.asarray(dv_km_s, dtype=np.float64).reshape(3)
        dv_m_s = float(np.linalg.norm(dv) * 1000.0)
        if dv_m_s <= 0.0:
            continue
        if dv_m_s > MAX_DV_M_S:
            dv = (MAX_DV_M_S / dv_m_s) * dv
            dv_m_s = MAX_DV_M_S

        updated[idx, 3:6] = updated[idx, 3:6] + dv
        GLOBAL_STATE.objects[obj_id].last_maneuver_time_s = GLOBAL_STATE.sim_time_s

        rec = GLOBAL_STATE.objects[obj_id]
        rec.current_mass_kg = apply_rocket_equation(rec.current_mass_kg, dv_m_s, rec.isp_s)
        remaining_pct = propellant_remaining_pct(rec.dry_mass_kg, rec.propellant_kg, rec.current_mass_kg)
        if is_graveyard_needed(remaining_pct):
            rec.status = "GRAVEYARD"

        maneuvers += 1

    return updated, maneuvers


def simulate_step(step_seconds: float) -> dict:
    ids, states = GLOBAL_STATE.get_ids_and_states()
    states = np.asarray(states, dtype=np.float64)
    if states.shape[0] == 0:
        GLOBAL_STATE.sim_time_s += step_seconds
        return {"objects": {}, "collisions": 0, "maneuvers": 0}

    for i in range(states.shape[0]):
        states[i] = ensure_state(states[i])

    close_approaches = predict_close_approaches(
        ids=ids,
        states_km_kms=states,
        step_seconds=step_seconds,
        threshold_km=COLLISION_THRESHOLD_KM,
    )

    states_by_id = dict(zip(ids, states))  # O(N) but single pass, no enumerate

    close_approaches = enrich_close_approaches_with_pc(
        close_approaches,
        states_by_id=states_by_id,
    )

    last_maneuver = {
        obj_id: rec.last_maneuver_time_s
        for obj_id, rec in GLOBAL_STATE.objects.items()
        if rec.last_maneuver_time_s is not None
    }

    # ── Decision engine: optimised multi-objective COLA ────────────────
    optimised = plan_optimised_cola(
        collision_pairs=close_approaches,
        states_by_id=states_by_id,
        last_maneuver_time_by_id=last_maneuver,
        current_time_s=GLOBAL_STATE.sim_time_s,
        object_records=GLOBAL_STATE.objects,
    )
    # Extract dv vectors; reasoning is stored for API response
    dv_cola_by_id = {obj_id: dv for obj_id, (dv, _) in optimised.items()}
    maneuver_reasoning = {
        obj_id: scored.reasoning for obj_id, (_, scored) in optimised.items()
    }

    sat_ids_only = [oid for oid in ids if not _is_debris(oid)]
    target_radius  = {oid: GLOBAL_STATE.objects[oid].target_radius_km   for oid in sat_ids_only}
    tolerance_by_id = {oid: GLOBAL_STATE.objects[oid].station_tolerance_km for oid in sat_ids_only}
    states_sat_only = {oid: states_by_id[oid] for oid in sat_ids_only}

    dv_sk_by_id = plan_station_keeping(
        states_by_id=states_sat_only,
        target_radius_km_by_id=target_radius,
        tolerance_km_by_id=tolerance_by_id,
        last_maneuver_time_by_id=last_maneuver,
        current_time_s=GLOBAL_STATE.sim_time_s,
    )

    # Merge: COLA overrides station-keeping for the same object
    desired_dv = {**dv_sk_by_id, **dv_cola_by_id}

    # ── Communication layer: gate on LOS, apply 10-second delay ──────────
    # For high-risk conjunctions (Pc >= 1e-4), use pre_upload_if_upcoming_blackout
    # so the command survives a blackout window before TCA.
    # For routine burns (station-keeping), use normal schedule_if_visible.
    tca_by_id: dict[str, float] = {}
    for ca in close_approaches:
        if getattr(ca, "pc", 0) >= 1e-4:
            for oid in (ca.a, ca.b):
                if oid not in tca_by_id or ca.tca_s < tca_by_id[oid]:
                    tca_by_id[oid] = GLOBAL_STATE.sim_time_s + ca.tca_s

    for obj_id, dv in desired_dv.items():
        sat_pos = states_by_id[obj_id][0:3]
        sat_vel = states_by_id[obj_id][3:6]
        tca_s   = tca_by_id.get(obj_id)
        if tca_s is not None:
            uploaded = COMM_LAYER.pre_upload_if_upcoming_blackout(
                obj_id=obj_id,
                sat_pos_km=sat_pos,
                sat_vel_km_s=sat_vel,
                dv_km_s=dv,
                current_time_s=GLOBAL_STATE.sim_time_s,
                tca_s=tca_s,
            )
            # Tag reasoning so backend can detect no-LOS pre-upload
            if uploaded and not COMM_LAYER.satellite_in_los(sat_pos, GLOBAL_STATE.sim_time_s):
                existing = maneuver_reasoning.get(obj_id, "")
                maneuver_reasoning[obj_id] = existing + " [pre_upload:no_los]"
        else:
            apply_comm_delay(
                obj_id=obj_id,
                sat_pos_km=sat_pos,
                dv_km_s=dv,
                current_time_s=GLOBAL_STATE.sim_time_s,
            )

    # Collect commands that have completed their delay window
    due_commands = COMM_LAYER.pop_due_commands(GLOBAL_STATE.sim_time_s)
    dv_by_id: dict[str, np.ndarray] = {
        cmd.obj_id: cmd.dv_km_s for cmd in due_commands
    }

    # ── Execute burns, propagate, update state ────────────────────────────
    after_burn, maneuvers = apply_maneuvers(ids, states, dv_by_id_km_s=dv_by_id)

    propagated = propagate_states(after_burn, step_seconds=step_seconds)

    for i, obj_id in enumerate(ids):
        GLOBAL_STATE.objects[obj_id].state = propagated[i]

    GLOBAL_STATE.sim_time_s += step_seconds

    # Re-check distances in the propagated state so maneuvers that successfully
    # moved objects apart are not counted as collisions.
    propagated_positions = propagated[:, 0:3]
    from ..spatial.neighbor_search import close_pairs_kdtree
    actual_collision_pairs = close_pairs_kdtree(
        propagated_positions, threshold_km=COLLISION_THRESHOLD_KM
    )
    collisions = len(actual_collision_pairs)

    # Build orbit paths for controllable satellites — batched for speed.
    # All satellite states propagated together in one RK4 batch per step.
    orbit_paths: dict[str, list[dict]] = {}
    if sat_ids_only:
        sat_states = np.stack(
            [GLOBAL_STATE.objects[oid].state for oid in sat_ids_only], axis=0
        )
        ORBIT_STEPS = 60
        ORBIT_DT    = 90.0
        step_paths: list[list[dict]] = [[] for _ in sat_ids_only]
        for _ in range(ORBIT_STEPS):
            sat_states = rk4_step_batch(sat_states, ORBIT_DT, eci_derivative_batch)
            for k, oid in enumerate(sat_ids_only):
                lat, lon, alt = _eci_to_latlon(sat_states[k, 0:3])
                step_paths[k].append({"lat": round(lat, 3), "lon": round(lon, 3), "alt": round(alt, 1)})
        for k, oid in enumerate(sat_ids_only):
            orbit_paths[oid] = step_paths[k]

    # Persist state after every step so a restart can resume cleanly
    GLOBAL_STATE.save()

    return {
        "objects":     {obj_id: propagated[i] for i, obj_id in enumerate(ids)},
        "collisions":  collisions,
        "maneuvers":   maneuvers,
        "reasoning":   maneuver_reasoning,
        "orbit_paths": orbit_paths,
    }
