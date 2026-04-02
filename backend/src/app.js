const express = require("express");
const cors = require("cors");
const helmet = require("helmet");

const telemetryRoutes     = require("./routes/telemetry.routes");
const simulationRoutes    = require("./routes/simulation.routes");
const maneuverRoutes      = require("./routes/maneuver.routes");
const visualizationRoutes = require("./routes/visualization.routes");
const authRoutes          = require("./routes/auth.routes");
const { requireAuth }     = require("./middleware/auth.middleware");
const { errorMiddleware } = require("./middleware/error.middleware");

function createApp({ logger, corsOrigin, runId }) {
  const app = express();
  app.locals.runId = runId;
  app.locals.logger = logger;

  app.use(helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
    crossOriginOpenerPolicy:   { policy: "unsafe-none" },
  }));
  app.use(cors({ origin: corsOrigin === "*" ? true : corsOrigin, credentials: true }));
  app.use(express.json({ limit: "2mb" }));

  // Public endpoints
  app.get("/health", (req, res) => res.json({ status: "ok" }));
  app.use("/auth", authRoutes);

  // All /api routes require a valid JWT
  const api = express.Router();
  api.use(requireAuth);
  api.use(telemetryRoutes);
  api.use(simulationRoutes);
  api.use(maneuverRoutes);
  api.use(visualizationRoutes);
  app.use("/api", api);

  app.use(errorMiddleware(logger));
  return app;
}

module.exports = { createApp };
