const express   = require("express");
const cors      = require("cors");
const helmet    = require("helmet");
const rateLimit = require("express-rate-limit");

const telemetryRoutes     = require("./routes/telemetry.routes");
const simulationRoutes    = require("./routes/simulation.routes");
const maneuverRoutes      = require("./routes/maneuver.routes");
const visualizationRoutes = require("./routes/visualization.routes");
const authRoutes          = require("./routes/auth.routes");
const { requireAuth }     = require("./middleware/auth.middleware");
const { validateRunId }   = require("./middleware/runId.middleware");
const { errorMiddleware } = require("./middleware/error.middleware");

const authLimiter = rateLimit({
  windowMs:        60 * 1000,
  max:             10,
  standardHeaders: true,
  legacyHeaders:   false,
  message:         { error: "Too many auth attempts, try again later" },
});

const apiLimiter = rateLimit({
  windowMs:        60 * 1000,
  max:             120,
  standardHeaders: true,
  legacyHeaders:   false,
  message:         { error: "Too many requests, slow down" },
});

const telemetryLimiter = rateLimit({
  windowMs:        60 * 1000,
  max:             30,
  standardHeaders: true,
  legacyHeaders:   false,
  message:         { error: "Telemetry rate limit exceeded" },
});

function createApp({ logger, corsOrigin, runId }) {
  const app = express();
  app.locals.runId  = runId;
  app.locals.logger = logger;

  app.set("trust proxy", 1);  // correct IP behind reverse proxy
  app.disable("x-powered-by");

  // Request timeout — prevents resource exhaustion
  app.use((req, res, next) => {
    res.setTimeout(15000, () => {
      res.status(503).json({ error: "Request timeout" });
    });
    next();
  });

  app.use(helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
    crossOriginOpenerPolicy:   { policy: "unsafe-none" },
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc:  ["'self'"],
        connectSrc: ["'self'", "ws://localhost:3000", "wss://localhost:3000"],
        imgSrc:     ["'self'", "data:"],
      },
    },
  }));

  // Strict CORS — no wildcard fallback
  const allowedOrigins = corsOrigin.split(",").map((o) => o.trim());
  app.use(cors({ origin: allowedOrigins, credentials: true }));

  app.use(express.json({ limit: "1mb" }));

  // Public endpoints
  app.get("/health", (req, res) => res.json({ status: "ok" }));
  app.use("/auth", authLimiter, authRoutes);

  // All /api routes: rate limited + runId validated + JWT required
  const api = express.Router();
  api.use(apiLimiter);
  api.use(validateRunId);
  api.use(requireAuth);
  api.use("/telemetry", telemetryLimiter, telemetryRoutes);
  api.use(simulationRoutes);
  api.use(maneuverRoutes);
  api.use(visualizationRoutes);
  app.use("/api", api);

  app.use(errorMiddleware(logger));
  return app;
}

module.exports = { createApp };
