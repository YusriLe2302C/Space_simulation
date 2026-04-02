const { upsertTelemetryObjects } = require("../services/state.service");

const MAX_OBJECTS = 5000;

async function postTelemetry(req, res, next) {
  try {
    const { timestamp, objects } = req.body;

    if (!Array.isArray(objects) || objects.length === 0) {
      return res.status(400).json({ error: "objects[] is required" });
    }
    if (objects.length > MAX_OBJECTS) {
      return res.status(413).json({ error: `Exceeds max ${MAX_OBJECTS} objects per request` });
    }

    const runId = req.app.locals.runId;
    await upsertTelemetryObjects({ timestamp, objects, runId });

    res.json({
      status: "ACK",
      processed_count: objects.length,
      active_cdm_warnings: 0,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { postTelemetry };

