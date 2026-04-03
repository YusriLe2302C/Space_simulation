require("dotenv").config();
const http = require("http");
const { Server } = require("socket.io");

const { loadEnv }      = require("./src/config/env");
const { connectDb }    = require("./src/config/db");
const { createLogger } = require("./src/utils/logger");
const { createApp }    = require("./src/app");
const { initSocket }   = require("./src/services/socket.service");

const EARTH_RADIUS_KM   = 6378.137;
const RAD2DEG           = 180 / Math.PI;
const STEP_SECONDS      = 60;
const STEP_INTERVAL_MS  = 8000;
const PYTHON_TIMEOUT_MS = 25000;
const MAX_BROADCAST_SATS = 500;  // cap satellite objects per broadcast to bound payload size

function eciToGeo([x, y, z]) {
  const rMag = Math.hypot(x, y, z);
  if (!rMag) return { lat: 0, lon: 0, alt: 400 };
  return {
    lat: Math.asin(Math.max(-1, Math.min(1, z / rMag))) * RAD2DEG,
    lon: Math.atan2(y, x) * RAD2DEG,
    alt: rMag - EARTH_RADIUS_KM,
  };
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Python engine timeout after ${ms}ms`)), ms)
    ),
  ]);
}

async function main() {
  const env    = loadEnv();
  const logger = createLogger();

  await connectDb(env.mongoUri, logger);

  const app = createApp({ logger, corsOrigin: env.corsOrigin, runId: env.runId });
  app.locals.pythonEngineUrl = env.pythonEngineUrl;
  const server = http.createServer(app);

  const io = new Server(server, {
    cors: {
      origin:  env.corsOrigin.split(",").map((o) => o.trim()),
      methods: ["GET", "POST"],
    },
  });
  initSocket(io);

  io.on("connection", (socket) => {
    const runId = socket.handshake.auth?.runId;
    if (!runId) {
      socket.disconnect();
      return;
    }
    socket.join(runId);
    logger.info("socket_connected", { id: socket.id, runId });
    socket.on("disconnect", () => logger.info("socket_disconnected", { id: socket.id }));
  });

  // ── Simulation dependencies ─────────────────────────────────────────────────
  const {
    getObjectsForSimulation,
    advanceSimulationTimestamp,
    applySimulationResults,
  } = require("./src/services/state.service");
  const { simulateStepHttp } = require("./src/services/pythonBridge");
  const { broadcast }        = require("./src/services/socket.service");

  // ── Orbit path cache — only rebroadcast when paths actually change ──────
  // Orbit paths are stable for ~90 min. Sending 60-point paths every 8s
  // wastes ~95% of WebSocket bandwidth. Recompute only every ORBIT_REFRESH ticks.
  const ORBIT_REFRESH_TICKS = 60;  // ~8 min at 8s/tick
  let _orbitTick   = 0;
  let _orbitCache  = {};

  // ── Single simulation tick ──────────────────────────────────────────────────
  async function runSimStep() {
    const { objects, typeById, nameById } = await getObjectsForSimulation({ runId: env.runId });
    if (!objects.length) return;

    const engine = await withTimeout(
      simulateStepHttp({
        pythonEngineUrl: env.pythonEngineUrl,
        objects,
        stepSeconds:     STEP_SECONDS,
        timeoutMs:       PYTHON_TIMEOUT_MS,
        logger,
      }),
      PYTHON_TIMEOUT_MS + 2000,
    );

    const sim = await advanceSimulationTimestamp({ runId: env.runId, stepSeconds: STEP_SECONDS });
    await applySimulationResults({
      timestampIso: sim.newTimestamp,
      runId:        env.runId,
      objects:      engine.objects,
      typeById,
    });

    const satObjects = engine.objects
      .filter((o) => typeById.get(o.id) === "SATELLITE" && o.state?.length >= 3)
      .slice(0, MAX_BROADCAST_SATS)
      .map((o) => {
        const { lat, lon, alt } = eciToGeo(o.state);
        // hasLOS: check if this satellite's maneuver was flagged as no-LOS
        // The engine returns reasoning per object; "pre_upload" in reasoning = no LOS at schedule time
        const reasoning = engine.reasoning?.[o.id] ?? "";
        const hasLOS = !reasoning.includes("pre_upload");
        return { id: o.id, name: nameById?.get(o.id) ?? o.id, lat, lon, alt, hasLOS };
      });

    // Only include orbit_paths every ORBIT_REFRESH_TICKS ticks
    _orbitTick++;
    const shouldRefreshOrbits = _orbitTick % ORBIT_REFRESH_TICKS === 1;
    if (shouldRefreshOrbits && Object.keys(engine.orbit_paths).length) {
      _orbitCache = engine.orbit_paths;
    }

    broadcast("state_update", {
      timestamp:           sim.newTimestamp,
      collisions_detected: engine.collisions,
      maneuvers_executed:  engine.maneuvers,
      objects:             satObjects,
      orbit_paths:         shouldRefreshOrbits ? _orbitCache : undefined,
    }, env.runId);
  }

  // ── Safe async loop — no overlap, backpressure-aware ───────────────────────
  // Uses a while(true) + timed wait instead of setInterval so the next tick
  // never starts before the previous one finishes. If a tick takes longer
  // than STEP_INTERVAL_MS the next tick starts immediately (no queuing).
  async function simulationLoop() {
    logger.info("sim_loop_started", { interval_ms: STEP_INTERVAL_MS, step_s: STEP_SECONDS });

    while (true) {
      const start = Date.now();

      try {
        await runSimStep();
      } catch (err) {
        logger.warn("sim_loop_error", { message: err?.message });
        // Brief pause on error to avoid hammering a broken Python engine
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }

      const elapsed  = Date.now() - start;
      const waitTime = Math.max(0, STEP_INTERVAL_MS - elapsed);
      await new Promise((r) => setTimeout(r, waitTime));
    }
  }

  // Delay first tick by 8 s — gives the seeder time to populate the DB
  setTimeout(simulationLoop, 8000);

  server.listen(env.port, () => {
    logger.info("server_listening", { port: env.port, runId: env.runId });
  });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
