const Maneuver = require("../models/Maneuver");
const Satellite = require("../models/Satellite");
const { ACM } = require("../utils/constants");
const { badRequest } = require("../middleware/validation.middleware");
const { asDate, validateDeltaV } = require("./validation.service");

async function scheduleManeuverSequence({ runId, satelliteObjectId, sequence }) {
  const satellite = await Satellite.findOne({ objectId: satelliteObjectId });
  if (!satellite) throw badRequest("satelliteId not found");

  const burnTimes = sequence.map((b) => asDate(b.burnTime, "burnTime")).sort((a, b) => a - b);
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

  // Compute projected remaining mass using the Tsiolkovsky rocket equation.
  // Sum all burns in the sequence to get total ΔV, then apply to current mass.
  const G0 = 9.80665;  // m/s²
  const ISP_S = 220;   // matches Python engine DEFAULT_ISP_S
  const DRY_MASS_KG = 800;
  const INITIAL_MASS_KG = 1000; // dry + default propellant

  const totalDvMs = docs.reduce((sum, d) => sum + (d.dvMagMs ?? 0), 0);
  const projectedMass = INITIAL_MASS_KG * Math.exp(-totalDvMs / (ISP_S * G0));
  const projectedMassRemainingKg = Math.max(DRY_MASS_KG, Math.round(projectedMass * 10) / 10);

  return { projectedMassRemainingKg };
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

