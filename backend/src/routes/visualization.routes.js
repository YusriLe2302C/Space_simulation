const express = require("express");

const { getVisualizationSnapshot } = require("../controllers/visualization.controller");
const { predictHttp } = require("../services/pythonBridge");

const router = express.Router();

router.get("/visualization/snapshot", getVisualizationSnapshot);

router.get("/predict", async (req, res, next) => {
  try {
    const pythonEngineUrl = req.app.locals.pythonEngineUrl;
    const data = await predictHttp({ pythonEngineUrl });
    res.json(data);
  } catch (err) {
    next(err);
  }
});

module.exports = router;

