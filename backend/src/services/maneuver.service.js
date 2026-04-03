const Maneuver = require("../models/Maneuver");
const Satellite = require("../models/Satellite");
const { ACM } = require("../utils/constants");
const { badRequest } = require("../middleware/validation.middleware");
const { asDate, validateDeltaV } = require("./validation.service");
const { predictHttp } = require("./pythonBridge");

// Check LOS by querying the Python engine's /predict endpoint.
// If the satellite appears in any conjunction within 0s (i.e. engine is reachable
// and knows the satellite), we consider it tracked. For LOS we use a lightweight
// heuristic: if the engine can be reached and the satellite has a known ECI state,
// we delegate to the comm layer. Since the Node layer has no direct access to the
// Python comm layer, we check whether the satellite's last telemetry is recent
// (within 5 minutes) as a proxy for ground-station contact.
function checkGroundStationLos(satellite) {
  if (!satellite.lastTelemetryAt) return false;
  const ageMs = Date.now() - new Date(satellite.lastTelemetryAt).getTime();
  return ageMs < 5 * 60 * 1000; // within last 5 minutes = in contact
}

async function scheduleManeuverSequence({ runId, satelliteObjectId, sequence }) {
  const satellite = await Satellite.findOne({ objectId: satelliteObjectId });
  if (!satellite) throw badRequest("satelliteId not found");

  const burnTimes = sequence.map((b) => asDate(b.burnTime, "burnTime")).sort((a, b) => a - b);

  // doc §5.4: burn cannot be scheduled earlier than now + 10s (comm delay)
  const minBurnTime = new Date(Date.now() + ACM.COMM_DELAY_SEC * 1000);
  if (burnTimes[0] < minBurnTime) {
    throw badRequest(`burnTime must be at least ${ACM.COMM_DELAY_SEC}s in the future (comm delay)`);
  }

  for (let i = 1; i < burnTimes.length; i += 1) {
    if (burnTimes[i].getTime() - burnTimes[i - 1].getTime() < ACM.MANEUVER_COOLDOWN_SEC * 1000) {
      throw badRequest(`Cooldown violation: burns must be >= ${ACM.MANEUVER_COOLDOWN_SEC} sec apart`);
    }
  }

  const earliest = burnTimes[0];
  const cooldownWindowStart = new Date(earliest.getTime() - ACM.MANEUVER_COOLDOWN_SEC * 1000);
  const recent = await Maneuver.findOne({
    satellite: satellite._id,
    status: { $in: ["scheduled", "sent", "executed"] },
    burnTime: { $gte: cooldownWindowStart, $lte: earliest },
  }).lean();
  if (recent) throw badRequest("Cooldown violation: satellite recently maneuvered");

  const docs = sequence.map((burn) => {
    const dvMagMs = validateDeltaV(burn.deltaV_vector);
    return {
      requestId: burn.burn_id,
      runId,
      satellite: satellite._id,
      satelliteObjectId,
      type: "manual",
      status: "scheduled",
      frame: "ECI",
      burnTime: asDate(burn.burnTime, "burnTime"),
      dvMs: burn.deltaV_vector,
      dvMagMs,
      cooldownUntil: new Date(asDate(burn.burnTime, "burnTime").getTime() + ACM.MANEUVER_COOLDOWN_SEC * 1000),
    };
  });

  await Maneuver.insertMany(docs, { ordered: false });

  // Tsiolkovsky rocket equation — constants from doc §5.1
  const isp         = satellite.physical?.ispS    ?? ACM.ISP_S;
  const initialMass = satellite.physical?.massKg  ?? ACM.WET_MASS_KG;
  const dryMass     = satellite.physical?.dryMass ?? ACM.DRY_MASS_KG;

  const totalDvMs = docs.reduce((sum, d) => sum + (d.dvMagMs ?? 0), 0);
  const projectedMass = initialMass * Math.exp(-totalDvMs / (isp * ACM.G0_M_S2));
  const projectedMassRemainingKg = Math.max(dryMass, Math.round(projectedMass * 10) / 10);

  return { projectedMassRemainingKg, groundStationLos: checkGroundStationLos(satellite) };
}

async function executeDueManeuvers({ runId, newTimestampIso }) {
  const ts = new Date(newTimestampIso);
  const result = await Maneuver.updateMany(
    { runId, status: "scheduled", burnTime: { $lte: ts } },
    { $set: { status: "executed", executedAt: ts } },
  );
  return result.modifiedCount ?? 0;
}

module.exports = { scheduleManeuverSequence, executeDueManeuvers };

