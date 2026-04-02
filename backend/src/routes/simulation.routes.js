const express = require("express");

const { stepSimulation } = require("../controllers/simulation.controller");
const { validateBody, validateSimulateStep } = require("../middleware/validation.middleware");

const router = express.Router();

router.post("/simulate/step", validateBody(validateSimulateStep), stepSimulation);

module.exports = router;

