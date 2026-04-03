const express = require("express");

const { postTelemetry } = require("../controllers/telemetry.controller");
const { validateBody, validateTelemetry } = require("../middleware/validation.middleware");

const router = express.Router();

// Mounted at /api/telemetry in app.js, so "/" maps to POST /api/telemetry.
router.post("/", validateBody(validateTelemetry), postTelemetry);

// Backwards compatibility: also accept POST /api/telemetry/telemetry.
router.post("/telemetry", validateBody(validateTelemetry), postTelemetry);

module.exports = router;

