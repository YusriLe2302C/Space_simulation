from __future__ import annotations

import asyncio
import os
import sys
from contextlib import asynccontextmanager
from pathlib import Path

# Allow running this file directly (python app/main.py) by ensuring the
# simulation_engine root is on sys.path so `import app...` works.
if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

# Load .env from simulation_engine root before anything else
try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).parent.parent / ".env")
except ImportError:
    pass

from fastapi import FastAPI, Query, Header, HTTPException
from pydantic import BaseModel, Field

from app.state.global_state import GLOBAL_STATE
from app.state.state_updater import predict_conjunctions, simulate_step

ENGINE_SECRET = os.environ.get("ENGINE_SECRET")
_SIM_LOCK     = asyncio.Lock()


@asynccontextmanager
async def lifespan(app: FastAPI):
    if not ENGINE_SECRET:
        raise RuntimeError("ENGINE_SECRET env var is not set — refusing to start")
    yield


app = FastAPI(title="ACM Simulation Engine", version="2.0.0", lifespan=lifespan)


def _verify(x_engine_key: str = Header(default=None)):
    if x_engine_key is None or x_engine_key != ENGINE_SECRET:
        raise HTTPException(status_code=403, detail="Forbidden")


class ObjectIn(BaseModel):
    id: str = Field(min_length=1)
    state: list[float] = Field(min_length=6, max_length=6)


class SimulateIn(BaseModel):
    objects: list[ObjectIn]
    step_seconds: float = Field(gt=0)


class ObjectOut(BaseModel):
    id: str
    state: list[float] = Field(min_length=6, max_length=6)
    current_mass_kg: float = Field(default=550.0, ge=0.0)
    sat_status: str = Field(default="NOMINAL")


class SimulateOut(BaseModel):
    objects:     list[ObjectOut]
    collisions:  int
    maneuvers:   int
    reasoning:   dict[str, str]        = Field(default_factory=dict)
    orbit_paths: dict[str, list[dict]] = Field(default_factory=dict)


class ConjunctionOut(BaseModel):
    a:                str
    b:                str
    tca_s:            float
    miss_distance_km: float
    time_to_event_s:  float


class PredictOut(BaseModel):
    conjunctions: list[ConjunctionOut]
    horizon_s:    float
    dt_s:         float


@app.post("/simulate", response_model=SimulateOut)
async def post_simulate(
    payload: SimulateIn,
    x_engine_key: str = Header(default=None),
) -> SimulateOut:
    _verify(x_engine_key)

    async with _SIM_LOCK:
        for obj in payload.objects:
            GLOBAL_STATE.upsert_object(obj_id=obj.id, state=obj.state)
        result = simulate_step(step_seconds=float(payload.step_seconds))

    mass_by_id   = result.get("mass_by_id", {})
    status_by_id = result.get("status_by_id", {})
    return SimulateOut(
        objects=[
            ObjectOut(
                id=obj_id,
                state=state.tolist(),
                current_mass_kg=mass_by_id.get(obj_id, 550.0),
                sat_status=status_by_id.get(obj_id, "NOMINAL"),
            )
            for obj_id, state in result["objects"].items()
        ],
        collisions=int(result["collisions"]),
        maneuvers=int(result["maneuvers"]),
        reasoning=result.get("reasoning", {}),
        orbit_paths=result.get("orbit_paths", {}),
    )


@app.get("/predict", response_model=PredictOut)
async def get_predict(
    horizon_s:    float = Query(default=86_400, gt=0, le=86_400 * 7),
    dt_s:         float = Query(default=60.0,   gt=0, le=3600),
    x_engine_key: str   = Header(default=None),
) -> PredictOut:
    _verify(x_engine_key)

    # Take a snapshot of current state under the lock, then release.
    # The prediction itself runs outside the lock so /simulate is never blocked.
    async with _SIM_LOCK:
        ids, states = GLOBAL_STATE.get_ids_and_states()
        states_copy = states.copy() if states.size else states

    from app.state.state_updater import predict_conjunctions_24h_from_snapshot
    conjunctions = predict_conjunctions_24h_from_snapshot(
        ids=ids, states=states_copy, horizon_s=horizon_s, dt_s=dt_s
    )
    return PredictOut(
        conjunctions=[ConjunctionOut(**c) for c in conjunctions],
        horizon_s=horizon_s,
        dt_s=dt_s,
    )


if __name__ == "__main__":
    # Convenience entrypoint for local runs (equivalent to:
    #   python -m uvicorn app.main:app --host 0.0.0.0 --port 9000 --reload
    # )
    import uvicorn

    port = int(os.environ.get("PORT", "9000"))
    uvicorn.run("app.main:app", host="0.0.0.0", port=port, reload=True)
