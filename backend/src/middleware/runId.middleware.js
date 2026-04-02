const RUN_ID_RE = /^[a-zA-Z0-9_-]{4,64}$/;

function validateRunId(req, res, next) {
  const runId = req.headers["x-run-id"] || req.query.runId || req.app.locals.runId;

  if (!runId || !RUN_ID_RE.test(runId)) {
    return res.status(400).json({ error: "Invalid or missing runId" });
  }

  req.runId = runId;
  next();
}

module.exports = { validateRunId };
