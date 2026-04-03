const { scheduleManeuverSequence } = require("../services/maneuver.service");
const { ACM } = require("../utils/constants");

async function scheduleManeuver(req, res, next) {
  try {
    const runId = req.runId;
    const { satelliteId, maneuver_sequence } = req.body;

    const result = await scheduleManeuverSequence({
      runId,
      satelliteObjectId: satelliteId,
      sequence: maneuver_sequence,
    });

    // Compute sufficient_fuel: projected remaining > dry mass
    const sufficient_fuel = result.projectedMassRemainingKg > ACM.DRY_MASS_KG;

    // doc §4.2: response code 202 Accepted
    res.status(202).json({
      status: "SCHEDULED",
      validation: {
        ground_station_los: result.groundStationLos ?? true,
        sufficient_fuel,
        projected_mass_remaining_kg: result.projectedMassRemainingKg,
      },
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { scheduleManeuver };
