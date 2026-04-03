const { upsertTelemetryObjects } = require("../services/state.service");
const CollisionEvent = require("../models/CollisionEvent");

const MAX_OBJECTS = 500;

async function postTelemetry(req, res, next) {
  try {
    const { timestamp, objects } = req.body;

    if (!Array.isArray(objects) || objects.length === 0) {
      return res.status(400).json({ error: "objects[] is required" });
    }
    if (objects.length > MAX_OBJECTS) {
      return res.status(413).json({ error: `Exceeds max ${MAX_OBJECTS} objects per request` });
    }

    const runId = req.runId;
    await upsertTelemetryObjects({ timestamp, objects, runId });

    // Count active CDM warnings: detected conjunctions not yet mitigated
    const active_cdm_warnings = await CollisionEvent.countDocuments({
      runId,
      status: { $in: ["detected", "acknowledged"] },
    });

    res.json({
      status: "ACK",
      processed_count: objects.length,
      active_cdm_warnings,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { postTelemetry };
