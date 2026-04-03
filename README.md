# Autonomous Constellation Manager (ACM)

A full-stack orbital debris avoidance and constellation management system built for the **National Space Hackathon 2026** at IIT Delhi.

The system autonomously ingests high-frequency satellite telemetry, predicts conjunctions up to 24 hours ahead using RK4+J2 propagation and KD-tree spatial indexing, executes RTN-frame collision avoidance maneuvers, and visualizes the entire fleet in real-time.

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Browser (port 5173)                  │
│          React + Three.js  "Orbital Insight" UI         │
└────────────────────────┬────────────────────────────────┘
                         │  REST + WebSocket
┌────────────────────────▼────────────────────────────────┐
│              Node.js Backend  (port 8000)               │
│   Express API · Socket.IO · MongoDB · JWT auth          │
└────────────────────────┬────────────────────────────────┘
                         │  HTTP (internal)
┌────────────────────────▼────────────────────────────────┐
│           Python Simulation Engine  (port 9000)         │
│   FastAPI · RK4+J2 · KD-tree · COLA · Hohmann          │
└─────────────────────────────────────────────────────────┘
                         │
              ┌──────────▼──────────┐
              │   MongoDB  :27017   │
              └─────────────────────┘
```

---

## Prerequisites

| Tool | Minimum Version |
|---|---|
| Node.js | 18.x |
| Python | 3.11+ |
| MongoDB | 6.x (running locally) |
| npm | 9.x |

---

## Quick Start (Windows)

If you are on Windows, a single launcher script starts everything:

```bat
start.bat
```

This will:
1. Install Python dependencies and start the simulation engine on port 9000
2. Install Node dependencies and start the backend on port 8000
3. Seed the database with real TLE data from Celestrak
4. Install frontend dependencies and start the dev server on port 5173

> MongoDB must already be running before you launch. See [Start MongoDB](#start-mongodb) below.

---

## Manual Setup

### 1. Clone the repository

```bash
git clone <your-repo-url>
cd acm-system
```

### 2. Start MongoDB

```bash
# Create a data directory if it doesn't exist
mkdir -p ~/mongo-data

# Start MongoDB
mongod --dbpath ~/mongo-data
```

On Windows:
```bat
mongod --dbpath C:\data\db
```

---

### 3. Simulation Engine (Python — port 9000)

```bash
cd simulation_engine

# Create and activate a virtual environment (recommended)
python -m venv .venv

# Linux / macOS
source .venv/bin/activate

# Windows
.venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Copy and configure environment
cp .env.example .env
# Edit .env — set ENGINE_SECRET (must match backend ENGINE_SECRET)
```

Generate a secret:
```bash
node -e "console.log(require('crypto').randomBytes(16).toString('hex'))"
```

Start the engine:
```bash
python -m uvicorn app.main:app --host 0.0.0.0 --port 9000 --reload
```

---

### 4. Backend (Node.js — port 8000)

```bash
cd backend

npm install

# Copy and configure environment
cp .env.example .env
```

Edit `backend/.env`:

```env
PORT=8000
MONGODB_URI=mongodb://127.0.0.1:27017/acm
CORS_ORIGIN=http://localhost:5173
PYTHON_ENGINE_URL=http://localhost:9000
ACM_RUN_ID=default

# Generate each with:
# node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
JWT_SECRET=<your-jwt-secret>

# node -e "console.log(require('crypto').randomBytes(16).toString('hex'))"
ACM_API_KEY=<your-api-key>
ENGINE_SECRET=<your-engine-secret>          # must match simulation_engine/.env
FRONTEND_TOKEN_SECRET=<your-frontend-token-secret>
```

Start the backend:
```bash
node server.js
```

---

### 5. Seed the Database

The seeder fetches real TLE data from Celestrak and posts it to the backend. Run it **after** the backend is up:

```bash
cd backend
node src/scripts/seed.js
```

This seeds ~100 real LEO satellites. The seeder retries automatically until the backend is ready.

---

### 6. Frontend (React — port 5173)

```bash
cd frontend

npm install

# Copy and configure environment
cp .env.example .env
```

Edit `frontend/.env`:

```env
VITE_BACKEND_URL=http://localhost:8000
VITE_ACM_RUN_ID=default
```

Start the dev server:
```bash
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

---

## Environment Variables Reference

### Generating Secrets

All secrets must be generated before first run. Run these commands once and paste the output into the respective `.env` files:

```bash
# JWT_SECRET — 32-byte hex (backend only)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# ACM_API_KEY — 16-byte hex (backend only)
node -e "console.log(require('crypto').randomBytes(16).toString('hex'))"

# ENGINE_SECRET — 16-byte hex (SAME value in both backend/.env and simulation_engine/.env)
node -e "console.log(require('crypto').randomBytes(16).toString('hex'))"

# FRONTEND_TOKEN_SECRET — 16-byte hex (backend only)
node -e "console.log(require('crypto').randomBytes(16).toString('hex'))"
```

> **Critical:** `ENGINE_SECRET` must be identical in `backend/.env` and `simulation_engine/.env`. If they differ the backend gets 403 errors from the engine on every simulation tick.

---

### Complete `.env` Files

#### `backend/.env`

```env
PORT=8000
MONGODB_URI=mongodb://127.0.0.1:27017/acm
CORS_ORIGIN=http://localhost:5173
PYTHON_ENGINE_URL=http://localhost:9000
ACM_RUN_ID=default
JWT_SECRET=<output of 32-byte command above>
ACM_API_KEY=<output of 16-byte command above>
ENGINE_SECRET=<shared secret — same in both .env files>
FRONTEND_TOKEN_SECRET=<output of 16-byte command above>
```

#### `simulation_engine/.env`

```env
ENGINE_SECRET=<same value as ENGINE_SECRET in backend/.env>
```

#### `frontend/.env`

```env
VITE_BACKEND_URL=http://localhost:8000
VITE_ACM_RUN_ID=default
```

---

### Variable Reference

#### `backend/.env`

| Variable | Description |
|---|---|
| `PORT` | Backend HTTP port (default: 8000) |
| `MONGODB_URI` | MongoDB connection string |
| `CORS_ORIGIN` | Allowed frontend origin |
| `PYTHON_ENGINE_URL` | Internal URL of the simulation engine |
| `ACM_RUN_ID` | Simulation run identifier |
| `JWT_SECRET` | Secret for signing JWTs — 32-byte hex |
| `ACM_API_KEY` | API key for machine-to-machine auth — 16-byte hex |
| `ENGINE_SECRET` | Shared secret with simulation engine — 16-byte hex |
| `FRONTEND_TOKEN_SECRET` | Secret for frontend viewer tokens — 16-byte hex |

#### `simulation_engine/.env`

| Variable | Description |
|---|---|
| `ENGINE_SECRET` | Must be identical to `ENGINE_SECRET` in `backend/.env` |

#### `frontend/.env`

| Variable | Description |
|---|---|
| `VITE_BACKEND_URL` | Backend base URL (default: http://localhost:8000) |
| `VITE_ACM_RUN_ID` | Run ID sent in `x-run-id` header |

---

## Service URLs

| Service | URL |
|---|---|
| Frontend Dashboard | http://localhost:5173 |
| Backend API | http://localhost:8000 |
| Backend Health | http://localhost:8000/health |
| Simulation Engine | http://localhost:9000 (internal only) |
| Engine API Docs | http://localhost:9000/docs |

---

## API Overview

All `/api/*` endpoints require a Bearer JWT. Obtain one first:

```bash
# Get a token
curl -X POST http://localhost:8000/auth/token \
  -H "Content-Type: application/json" \
  -d '{"api_key": "<your-ACM_API_KEY>"}'
```

Use the returned token in subsequent requests:

```bash
# Post telemetry
curl -X POST http://localhost:8000/api/telemetry \
  -H "Authorization: Bearer <token>" \
  -H "x-run-id: default" \
  -H "Content-Type: application/json" \
  -d '{
    "timestamp": "2026-03-12T08:00:00.000Z",
    "objects": [{
      "id": "SAT-001", "type": "SATELLITE",
      "r": {"x": 4500.2, "y": -2100.5, "z": 4800.1},
      "v": {"x": -1.25,  "y": 6.84,    "z": 3.12}
    }]
  }'

# Advance simulation by 3600 seconds
curl -X POST http://localhost:8000/api/simulate/step \
  -H "Authorization: Bearer <token>" \
  -H "x-run-id: default" \
  -H "Content-Type: application/json" \
  -d '{"step_seconds": 3600}'

# Schedule a maneuver
curl -X POST http://localhost:8000/api/maneuver/schedule \
  -H "Authorization: Bearer <token>" \
  -H "x-run-id: default" \
  -H "Content-Type: application/json" \
  -d '{
    "satelliteId": "SAT-001",
    "maneuver_sequence": [{
      "burn_id": "EVASION_1",
      "burnTime": "2026-03-12T14:15:30.000Z",
      "deltaV_vector": {"x": 0.002, "y": 0.015, "z": -0.001}
    }]
  }'

# Get visualization snapshot
curl http://localhost:8000/api/visualization/snapshot \
  -H "Authorization: Bearer <token>" \
  -H "x-run-id: default"
```

---

## Project Structure

```
acm-system/
├── backend/                    # Node.js API server
│   ├── src/
│   │   ├── config/             # env.js, db.js
│   │   ├── controllers/        # telemetry, simulation, maneuver, visualization
│   │   ├── middleware/         # auth, runId, error, validation
│   │   ├── models/             # Mongoose schemas
│   │   ├── routes/             # Express routers
│   │   ├── scripts/seed.js     # Database seeder (real TLE data)
│   │   ├── services/           # state, maneuver, pythonBridge, socket
│   │   ├── utils/              # constants, logger
│   │   └── app.js              # Express app factory
│   └── server.js               # Entry point + simulation loop
│
├── simulation_engine/          # Python physics engine
│   └── app/
│       ├── collision/          # KD-tree predictor, Pc (Foster method)
│       ├── communication/      # Ground station LOS + GMST + blackout
│       ├── decision/           # RTN COLA, Hohmann station-keeping, optimizer
│       ├── fuel/               # Tsiolkovsky rocket equation
│       ├── physics/            # RK4, J2 perturbation, propagator
│       ├── spatial/            # scipy KD-tree wrapper
│       ├── state/              # Global state, simulate_step
│       ├── utils/              # constants, math_utils
│       └── main.py             # FastAPI app (/simulate, /predict)
│
├── frontend/                   # React + Three.js dashboard
│   └── src/
│       ├── components/
│       │   ├── Scene/          # Three.js 3D scene (Earth, satellites, debris)
│       │   └── UI/             # GroundTrack, BullseyePlot, FuelPanel,
│       │                       # DvGraph, Timeline, Dashboard, Alerts
│       ├── hooks/              # useSocket, useSimulationData
│       ├── services/           # api.js, socket.js
│       ├── store/              # simulationStore.js (Zustand)
│       └── utils/              # constants, coordinateUtils
│
├── start.bat                   # Windows one-click launcher
└── README.md
```

---

## Key Physics Constants

| Constant | Value | Source |
|---|---|---|
| µ (Earth gravitational parameter) | 398600.4418 km³/s² | §3.2 |
| RE (Earth radius) | 6378.137 km | §3.2 |
| J2 | 1.08263 × 10⁻³ | §3.2 |
| Collision threshold | 0.100 km (100 m) | §3.3 |
| Dry mass | 500.0 kg | §5.1 |
| Initial propellant | 50.0 kg | §5.1 |
| Isp | 300.0 s | §5.1 |
| Max ΔV per burn | 15.0 m/s | §5.1 |
| Thruster cooldown | 600 s | §5.1 |
| Station-keeping box | 10 km spherical | §5.2 |
| Comm delay | 10 s | §5.4 |
| Graveyard threshold | 5% fuel remaining | §5 |

---

## Troubleshooting

**MongoDB connection refused**
Make sure `mongod` is running before starting the backend. Check with:
```bash
mongosh --eval "db.runCommand({ping:1})"
```

**ENGINE_SECRET mismatch**
`backend/.env` and `simulation_engine/.env` must have the same `ENGINE_SECRET` value. The engine will refuse to start if it is missing, and the backend will get 403 errors from the engine if they differ.

**Seeder fails with "Backend unreachable"**
The seeder retries for 20 seconds. Make sure the backend is fully started (you should see `server_listening` in its console) before the seeder times out.

**Port already in use**
```bash
# Find and kill the process on a port (Linux/macOS)
lsof -ti:8000 | xargs kill

# Windows
netstat -ano | findstr :8000
taskkill /PID <pid> /F
```

**Frontend shows no data**
1. Check the backend is on port 8000 (`VITE_BACKEND_URL=http://localhost:8000`)
2. Check `VITE_ACM_RUN_ID` matches `ACM_RUN_ID` in `backend/.env`
3. Run the seeder if the database is empty
