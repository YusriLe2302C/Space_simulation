# ACM System (README2)

This document is the **developer-facing** reference for the repository in `c:\Users\Lenovo\Desktop\Space_simulation`. It complements `README.md` by going deeper on **system architecture**, **runtime workflows**, and **API + event definitions** (backend + simulation engine + frontend call-sites).

---

## 1) System Architecture (High-Level)

### Components

- **Frontend** (`frontend/`): React + Three.js dashboard (Vite dev server on `:5173`).
- **Backend API** (`backend/`): Node.js (Express) + Socket.IO + MongoDB (API on `:8000`).
- **Simulation Engine** (`simulation_engine/`): Python FastAPI engine (internal service on `:9000`).
- **Database**: MongoDB (`:27017`) holding latest states + maneuvers + simulation timestamp.

### Data/Control Flow (ASCII)

```
Browser (5173)
  |
  | REST (JWT + x-run-id)        WebSocket (Socket.IO)
  |------------------------->    <---------------------
  |
Node Backend (8000)  -----------------------------------> MongoDB (27017)
  |
  | Internal HTTP (x-engine-key)
  v
Python Engine (9000)
```

### “Run ID” (multi-run isolation)

Most state in MongoDB is partitioned by a `runId` string:

- Backend validates `runId` via `x-run-id` header or `?runId=...`.
- WebSocket clients join a `runId` room during handshake.
- Engine is **not** runId-aware; the backend provides runId isolation at the API + storage layer.

Implementation:
- Backend `runId` validation: `backend/src/middleware/runId.middleware.js`
- WebSocket handshake room join: `backend/server.js`

### Units + coordinate conventions

- Telemetry + engine state vectors are **ECI** in **km** and **km/s**: `[x, y, z, vx, vy, vz]`.
- UI snapshot/plotting uses **geographic** coordinates: `lat`/`lon` in **degrees**, `alt` in **km**.
- Backend converts ECI → `lat/lon/alt` for visualization in:
  - `backend/src/controllers/visualization.controller.js` (snapshot)
  - `backend/server.js` and `backend/src/controllers/simulation.controller.js` (socket payloads)

---

## 2) Runtime Workflows

### 2.1 Local “one-click” start (Windows)

Launcher: `start.bat`

It starts:
1. Python engine (`uvicorn app.main:app --port 9000 --reload`)
2. Node backend (`node server.js` on port `8000`)
3. Seeder (`node backend/src/scripts/seed.js`)
4. Frontend (`npm run dev` in `frontend/`)

Prereq: MongoDB must be running locally.

### 2.2 Seeding workflow (real orbital objects)

Seeder: `backend/src/scripts/seed.js`

Flow:
1. Calls `POST /auth/token` with `ACM_API_KEY` to obtain an operator JWT.
2. Fetches real TLEs (external free API) and converts them into ECI state vectors.
3. Pushes telemetry in batches: `POST /api/telemetry`
4. Triggers the first sim step: `POST /api/simulate/step`

Notes:
- The seed script uses `process.env.ACM_RUN_ID` to set `x-run-id`.
- Telemetry objects are capped at `500` per request (backend guard).

### 2.3 Backend simulation loop (automatic ticking)

Entry point: `backend/server.js`

The backend runs an internal loop:
- Every ~8 seconds (wall clock), it advances simulation time by **60 seconds** (`STEP_SECONDS=60`).
- It fetches current objects from MongoDB (satellites + debris for the current runId).
- It calls the Python engine: `POST {PYTHON_ENGINE_URL}/simulate` (with `x-engine-key`).
- It writes results back to MongoDB and broadcasts a `state_update` event.

Why this exists:
- The UI stays live without requiring a user to call `/api/simulate/step`.

### 2.4 Manual stepping (API-triggered tick)

Endpoint: `POST /api/simulate/step` (backend)

This path does a single engine step using a caller-provided `step_seconds`, updates MongoDB, executes any due maneuvers, and broadcasts a `state_update`.

### 2.5 Maneuver scheduling

Endpoint: `POST /api/maneuver/schedule`

What it does:
- Validates burn schedule constraints (cooldown, comm delay).
- Validates delta-V magnitude (`<= 15 m/s`).
- Stores planned burns in MongoDB as `Maneuver` docs with status `scheduled`.
- Returns a 202 response with “validation” metadata (fuel estimate + LOS heuristic).

Important: burns are marked `executed` when simulation time reaches them (`executeDueManeuvers()`), not when scheduled.

---

## 3) API Reference (Backend: Node / Express)

### 3.1 Base URL + common requirements

Default local base:
- Backend: `http://localhost:8000`

Common headers for `/api/*` routes:
- `Authorization: Bearer <jwt>`
- `x-run-id: <runId>` (4–64 chars, `[a-zA-Z0-9_-]`)
- `Content-Type: application/json` (for POSTs)

`x-run-id` fallback:
- If `x-run-id` is missing, the backend can fall back to `ACM_RUN_ID` (server-configured default). In practice, clients should still send `x-run-id` explicitly.

Auth model:
- Backend issues JWTs signed with `JWT_SECRET`.
- `/api/*` routes require JWT (`backend/src/middleware/auth.middleware.js`).
  - The JWT `role` (`viewer` vs `operator`) is **not currently enforced** by backend authorization logic (no RBAC yet).

Error shape:
```json
{ "error": "..." }
```
For `5xx`, the backend returns `"Internal Server Error"` regardless of internal message.

### 3.2 Public endpoints (no JWT)

#### GET `/health`

Response:
```json
{ "status": "ok" }
```

#### POST `/auth/token` (server-to-server)

Purpose: exchange `ACM_API_KEY` for an operator JWT (used by `seed.js` and other trusted clients).

Request:
```json
{ "api_key": "<ACM_API_KEY>" }
```

Response:
```json
{ "token": "<jwt>", "expires_in": "8h" }
```

Failure:
- `401` invalid key
- `500` missing `ACM_API_KEY` in backend env

#### POST `/auth/frontend-token` (BFF)

Purpose: **frontend** gets a short-lived **read-only** viewer JWT without embedding a secret in the browser bundle.

Request body: empty OK (backend ignores it)

Response:
```json
{ "token": "<jwt>", "expires_in": "4h" }
```

### 3.3 Protected API endpoints (JWT + x-run-id)

#### POST `/api/telemetry`

Purpose: ingest telemetry and upsert objects.

Constraints:
- `objects.length` must be `1..500`

Request:
```json
{
  "timestamp": "2026-04-02T12:00:00.000Z",
  "objects": [
    {
      "id": "SAT-001",
      "name": "Optional satellite name",
      "type": "SATELLITE",
      "r": { "x": 7000, "y": 0, "z": 0 },
      "v": { "x": 0, "y": 7.5, "z": 0 }
    },
    {
      "id": "DEB-001",
      "type": "DEBRIS",
      "r": { "x": 7000.05, "y": 0, "z": 0 },
      "v": { "x": 0, "y": 7.49, "z": 0 }
    }
  ]
}
```

Response:
```json
{
  "status": "ACK",
  "processed_count": 2,
  "active_cdm_warnings": 0
}
```

#### POST `/api/simulate/step`

Purpose: run one simulation step in the Python engine, write results to MongoDB, broadcast WebSocket update.

Request:
```json
{ "step_seconds": 60 }
```

Response:
```json
{
  "status": "STEP_COMPLETE",
  "new_timestamp": "2026-04-02T12:01:00.000Z",
  "collisions_detected": 0,
  "maneuvers_executed": 0
}
```

Side effects:
- Updates `SimulationState.timestamp` for the runId.
- Updates `Satellite.latestEci` and `Debris.latestEci`.
- Emits WebSocket `state_update`.

#### POST `/api/maneuver/schedule`

Purpose: schedule one or more burns for a satellite.

Request:
```json
{
  "satelliteId": "SAT-001",
  "maneuver_sequence": [
    {
      "burn_id": "BURN-001",
      "burnTime": "2026-04-02T12:10:00.000Z",
      "deltaV_vector": { "x": 0.0, "y": 5.0, "z": 0.0 }
    }
  ]
}
```

Constraints (enforced):
- `burnTime >= now + 10s` (comm delay)
- burns in the sequence must be `>= 600s` apart (cooldown)
- `|deltaV_vector| <= 15 m/s`

Response (HTTP `202 Accepted`):
```json
{
  "status": "SCHEDULED",
  "validation": {
    "ground_station_los": true,
    "sufficient_fuel": true,
    "projected_mass_remaining_kg": 548.9
  }
}
```

#### GET `/api/visualization/snapshot`

Purpose: frontend-friendly snapshot using geographic coordinates.

Response:
```json
{
  "timestamp": "2026-04-02T12:00:00.000Z",
  "satellites": [
    {
      "id": "SAT-001",
      "name": "SAT-001",
      "lat": 12.34,
      "lon": 56.78,
      "alt": 420.1,
      "fuel_kg": 49.7,
      "status": "NOMINAL"
    }
  ],
  "debris_cloud": [
    ["DEB-001", 12.3, 56.7, 420.0]
  ]
}
```

#### GET `/api/predict` (proxy to engine)

Purpose: fetch conjunction predictions from the engine’s `/predict` endpoint.

Response: whatever the engine returns (see engine API below).

---

## 4) Realtime Events (Socket.IO)

### 4.1 Connection

Client uses Socket.IO and must provide `runId` during handshake:

- Frontend sets `auth: { runId: VITE_ACM_RUN_ID ?? "default" }` in `frontend/src/services/socket.js`
- Backend joins socket to room `runId` in `backend/server.js`

### 4.2 Events

#### Event: `state_update`

Emitted by the backend:
- from the automatic loop (`backend/server.js`), and
- from the manual step endpoint (`backend/src/controllers/simulation.controller.js`).

Payload (common fields):
- `timestamp` (ISO string)
- `collisions_detected` (number)
- `maneuvers_executed` (number)
- `dv_total_ms` (number, approximate fleet-wide)
- `fuel_consumed_kg` (number, approximate fleet-wide)
- `objects` (array)
  - in the **server loop**, each object is `{ id, name, lat, lon, alt, hasLOS }`
  - in the **manual step**, objects are `{ id, name, lat, lon, alt, orbit_path }`
- `orbit_paths` (object map of satelliteId -> list of `{lat,lon,alt}`) (sometimes omitted by server loop to save bandwidth)

Frontend consumption:
- Socket wiring: `frontend/src/hooks/useSocket.js`
- Fast-path store: `frontend/src/store/simulationStore.js`

---

## 5) API Reference (Simulation Engine: Python / FastAPI)

Base URL (default local):
- `http://localhost:9000`

Auth header (required on all engine routes):
- `x-engine-key: <ENGINE_SECRET>`

### POST `/simulate`

Request:
```json
{
  "objects": [
    { "id": "SAT-001", "state": [7000, 0, 0, 0, 7.5, 0] }
  ],
  "step_seconds": 60
}
```

Response:
```json
{
  "objects": [
    {
      "id": "SAT-001",
      "state": [7000.1, 0.2, 0.3, 0.01, 7.5, 0.0],
      "current_mass_kg": 549.9,
      "sat_status": "NOMINAL"
    }
  ],
  "collisions": 0,
  "maneuvers": 0,
  "reasoning": { "SAT-001": "..." },
  "orbit_paths": {
    "SAT-001": [ { "lat": 0.0, "lon": 0.0, "alt": 400.0 } ]
  }
}
```

### GET `/predict?horizon_s=86400&dt_s=60`

Response:
```json
{
  "conjunctions": [
    {
      "a": "SAT-001",
      "b": "DEB-001",
      "tca_s": 1234.0,
      "miss_distance_km": 0.42,
      "time_to_event_s": 1234.0
    }
  ],
  "horizon_s": 86400.0,
  "dt_s": 60.0
}
```

Concurrency note:
- The engine uses a lock for `/simulate` and only snapshots state under lock for `/predict` (prediction work runs outside the lock).

State persistence:
- Engine persists to `simulation_engine/data/acm_global_state.json` periodically.

---

## 6) Data Model (MongoDB)

Collections (Mongoose models in `backend/src/models/`):

- `Satellite`
  - `objectId` (unique), `name`, `status`, `fuel_kg`
  - `latestEci`: `{ timestamp, runId, r:{x,y,z}, v:{x,y,z} }`
- `Debris`
  - `objectId` (unique), `status`
  - `latestEci` similar to `Satellite`
- `SimulationState`
  - `runId` (unique), `timestamp` (authoritative sim time in backend)
- `Maneuver`
  - `requestId` (unique), `satelliteObjectId`, `runId`
  - `dvMs` + `dvMagMs`, `burnTime`, `status`
- `CollisionEvent`
  - used for warning counts and future CDM workflows (`telemetry.controller` counts active warnings)

Important: Backend queries simulation objects by `latestEci.runId == <runId>`.

---

## 7) Configuration

### 7.1 Backend (`backend/.env`)

Template: `backend/.env.example`

Required by backend code:
- `MONGODB_URI`
- `CORS_ORIGIN` (comma-separated allowed origins)
- `JWT_SECRET`
- `ACM_API_KEY` (for `/auth/token`)
- `ENGINE_SECRET` (for engine HTTP calls)

Optional:
- `PORT` (default `8000`)
- `PYTHON_ENGINE_URL` (default `http://localhost:9000`)
- `ACM_RUN_ID` (default `default`)

Note: `REDIS_URL` and `FRONTEND_TOKEN_SECRET` appear in `.env.example` but are not used by current code.

### 7.2 Simulation engine (`simulation_engine/.env`)

Template: `simulation_engine/.env.example`

Required:
- `ENGINE_SECRET` (must match backend `ENGINE_SECRET`)

### 7.3 Frontend (`frontend/.env` via Vite)

Used variables:
- `VITE_BACKEND_URL` (default `http://localhost:8000`)
- `VITE_ACM_RUN_ID` (default `default`)

---

## 8) Limits, Timeouts, and Rate-Limits (Important)

Backend HTTP:
- Hard request deadline middleware: ~15 seconds.
- `/auth/*` rate limit: 10 requests/min/IP.
- `/api/*` rate limit: 120 requests/min/IP (+ per-runId 200/min).
- `/api/telemetry`: additional 30 requests/min/IP and `objects.length <= 500`.

Backend → Engine:
- `/simulate` timeout ~25s (with retries) in `backend/src/services/pythonBridge.js`.

WebSocket:
- Backend disconnects a client that sends >20 events/sec (simple flood protection).

---

## 9) Testing

Backend tests live in `backend/tests/api.test.js`.

Run (from `backend/`):
```bash
npm test
```

Requirement:
- Set `MONGODB_URI` to a reachable MongoDB. Tests reset collections.

---

## 10) Developer Notes / Where to Change Things

- Add/modify REST endpoints: `backend/src/routes/*` + `backend/src/controllers/*`
- Validation rules: `backend/src/middleware/validation.middleware.js`
- Engine HTTP client: `backend/src/services/pythonBridge.js`
- Automatic simulation loop: `backend/server.js`
- Engine behavior: `simulation_engine/app/state/state_updater.py`
- Frontend REST usage: `frontend/src/services/api.js`
- Frontend realtime wiring: `frontend/src/services/socket.js` + `frontend/src/hooks/useSocket.js`

---

## Docker (Quick Start)

Docker files included:
- `Dockerfile` (root), `docker-compose.yml`
- `simulation_engine/Dockerfile`
- `frontend/Dockerfile`

Steps:
```bash
cp backend/.env.example backend/.env
cp simulation_engine/.env.example simulation_engine/.env
docker compose up --build
docker compose exec backend node src/scripts/seed.js
```
