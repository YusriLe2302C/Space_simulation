const express = require("express");

const { postTelemetry } = require("../controllers/telemetry.controller");
const { validateBody, validateTelemetry } = require("../middleware/validation.middleware");

const router = express.Router();

router.post("/telemetry", validateBody(validateTelemetry), postTelemetry);

module.exports = router;

