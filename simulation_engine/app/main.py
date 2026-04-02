from __future__ import annotations

import os
from pathlib import Path

# Load .env from simulation_engine root before anything else
try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).parent.parent / ".env")
except ImportError:
    pass

from fastapi import FastAPI, Query, Header, HTTPException
from pydantic import BaseModel, Field

from .state.global_state import GLOBAL_STATE
from .state.state_updater import predict_conjunctions, simulate_step

app = FastAPI(title="ACM Simulation Engine", version="2.0.0")

ENGINE_SECRET = os.environ.get("ENGINE_SECRET")


def _verify(x_engine_key: str = Header(default=None)):
    if not ENGINE_SECRET:
        raise HTTPException(status_code=500, detail="Engine misconfigured — ENGINE_SECRET not set")
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
def post_simulate(
    payload: SimulateIn,
    x_engine_key: str = Header(default=None),
) -> SimulateOut:
    _verify(x_engine_key)

    for obj in payload.objects:
        GLOBAL_STATE.upsert_object(obj_id=obj.id, state=obj.state)

    result = simulate_step(step_seconds=float(payload.step_seconds))

    return SimulateOut(
        objects=[
            ObjectOut(id=obj_id, state=state.tolist())
            for obj_id, state in result["objects"].items()
        ],
        collisions=int(result["collisions"]),
        maneuvers=int(result["maneuvers"]),
        reasoning=result.get("reasoning", {}),
        orbit_paths=result.get("orbit_paths", {}),
    )


@app.get("/predict", response_model=PredictOut)
def get_predict(
    horizon_s:    float = Query(default=86_400, gt=0, le=86_400 * 7),
    dt_s:         float = Query(default=60.0,   gt=0, le=3600),
    x_engine_key: str   = Header(default=None),
) -> PredictOut:
    _verify(x_engine_key)

    conjunctions = predict_conjunctions(horizon_s=horizon_s, dt_s=dt_s)
    return PredictOut(
        conjunctions=[ConjunctionOut(**c) for c in conjunctions],
        horizon_s=horizon_s,
        dt_s=dt_s,
    )
