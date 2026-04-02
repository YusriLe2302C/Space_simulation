const express = require("express");

const { scheduleManeuver } = require("../controllers/maneuver.controller");
const {
  validateBody,
  validateManeuverSchedule,
} = require("../middleware/validation.middleware");

const router = express.Router();

router.post("/maneuver/schedule", validateBody(validateManeuverSchedule), scheduleManeuver);

module.exports = router;

