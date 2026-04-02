const { upsertTelemetryObjects } = require("../services/state.service");

async function postTelemetry(req, res, next) {
  try {
    const { timestamp, objects } = req.body;
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

