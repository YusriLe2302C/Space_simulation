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

    broadcast("state_update", {
      timestamp:           sim.newTimestamp,
      collisions_detected: engine.collisions,
      maneuvers_executed:  engine.maneuvers,
      objects:             satObjects,
      orbit_paths:         engine.orbit_paths,
    }, runId);
    res.json(payload);
  } catch (err) {
    next(err);
  }
}

module.exports = { stepSimulation };
