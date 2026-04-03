const {
  advanceSimulationTimestamp,
  applySimulationResults,
  getObjectsForSimulation,
} = require("../services/state.service");
const { simulateStepHttp } = require("../services/pythonBridge");
const { executeDueManeuvers } = require("../services/maneuver.service");
const { broadcast } = require("../services/socket.service");

const EARTH_RADIUS_KM = 6378.137;  // doc §3.2
const RAD2DEG = 180 / Math.PI;

function eciToLatLonAlt(state) {
  const [x, y, z] = state;
  const rMag = Math.sqrt(x * x + y * y + z * z);
  if (!rMag) return { lat: 0, lon: 0, alt: 400 };
  return {
    lat: Math.asin(z / rMag) * RAD2DEG,
    lon: Math.atan2(y, x) * RAD2DEG,
    alt: rMag - EARTH_RADIUS_KM,
  };
}

async function stepSimulation(req, res, next) {
  try {
    const runId           = req.runId;
    const pythonEngineUrl = req.app.locals.pythonEngineUrl;
    const logger          = req.app.locals.logger;
    const { step_seconds } = req.body;

    const { objects, typeById, nameById } = await getObjectsForSimulation({ runId });
    const engine = await simulateStepHttp({
      pythonEngineUrl,
      objects,
      stepSeconds: step_seconds,
      logger,
    });

    const sim = await advanceSimulationTimestamp({ runId, stepSeconds: step_seconds });
    await applySimulationResults({
      timestampIso: sim.newTimestamp,
      runId,
      objects: engine.objects,
      typeById,
    });

    await executeDueManeuvers({ runId, newTimestampIso: sim.newTimestamp });

    // Build geographic satellite objects with orbit_path attached
    const satObjects = engine.objects
      .filter((o) => typeById.get(o.id) === "SATELLITE")
      .map((o) => {
        const { lat, lon, alt } = eciToLatLonAlt(o.state);
        return {
          id:         o.id,
          name:       nameById?.get(o.id) ?? o.id,
          lat,
          lon,
          alt,
          orbit_path: engine.orbit_paths[o.id] ?? [],
        };
      });

    const payload = {
      status: "STEP_COMPLETE",
      new_timestamp: sim.newTimestamp,
      collisions_detected: engine.collisions,
      maneuvers_executed: engine.maneuvers,
    };

    // Compute fleet-wide dv_total_ms and fuel_consumed_kg from mass changes
    // Engine returns current_mass_kg per satellite; fuel burned = initial - current
    const DRY_MASS_KG = 500.0;
    const INITIAL_FUEL_KG = 50.0;
    let dvTotalMs = 0;
    let fuelConsumedKg = 0;
    for (const o of engine.objects) {
      if (typeById.get(o.id) !== "SATELLITE") continue;
      if (typeof o.current_mass_kg === "number") {
        const fuelRemaining = Math.max(0, o.current_mass_kg - DRY_MASS_KG);
        const burned = INITIAL_FUEL_KG - fuelRemaining;
        if (burned > 0) fuelConsumedKg += burned;
      }
    }
    // Approximate dv_total_ms from maneuver count × avg burn (used for graph scaling)
    // Real per-burn dv is tracked in the Python engine reasoning strings
    dvTotalMs = engine.maneuvers > 0
      ? engine.objects
          .filter((o) => typeById.get(o.id) === "SATELLITE" && typeof o.current_mass_kg === "number")
          .reduce((sum, o) => {
            const ISP = 300.0; const G0 = 9.80665;
            const m0 = o.current_mass_kg + fuelConsumedKg / Math.max(1, engine.maneuvers);
            const m1 = o.current_mass_kg;
            return sum + (m0 > m1 && m1 > 0 ? ISP * G0 * Math.log(m0 / m1) : 0);
          }, 0)
      : 0;

    broadcast("state_update", {
      timestamp:           sim.newTimestamp,
      collisions_detected: engine.collisions,
      maneuvers_executed:  engine.maneuvers,
      dv_total_ms:         dvTotalMs,
      fuel_consumed_kg:    fuelConsumedKg,
      objects:             satObjects,
      orbit_paths:         engine.orbit_paths,
    }, runId);
    res.json(payload);
  } catch (err) {
    next(err);
  }
}

module.exports = { stepSimulation };
