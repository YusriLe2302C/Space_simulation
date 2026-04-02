const { scheduleManeuverSequence } = require("../services/maneuver.service");

async function scheduleManeuver(req, res, next) {
  try {
    const runId = req.app.locals.runId;
    const { satelliteId, maneuver_sequence } = req.body;

    const result = await scheduleManeuverSequence({
      runId,
      satelliteObjectId: satelliteId,
      sequence: maneuver_sequence,
    });

    res.json({
      status: "SCHEDULED",
      validation: {
        ground_station_los: true,
        sufficient_fuel: true,
        projected_mass_remaining_kg: result.projectedMassRemainingKg,
      },
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { scheduleManeuver };

