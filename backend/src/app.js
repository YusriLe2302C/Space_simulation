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

function createApp({ logger, corsOrigin, runId }) {
  const app = express();
  app.locals.runId  = runId;
  app.locals.logger = logger;

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

  app.set("trust proxy", 1);  // correct IP behind reverse proxy
  app.disable("x-powered-by");

  // Hard request deadline — prevents slow-client resource exhaustion
  app.use((req, res, next) => {
    const timer = setTimeout(() => {
      if (!res.headersSent) res.status(503).json({ error: "Request timeout" });
    }, 15000);
    res.on("finish", () => clearTimeout(timer));
    res.on("close",  () => clearTimeout(timer));
    next();
  });

  // Build dynamic connectSrc from corsOrigin so non-localhost deployments work
  const wsSources = corsOrigin.split(",").map((o) =>
    o.trim().replace(/^http:/, "ws:").replace(/^https:/, "wss:")
  );

  app.use(helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
    crossOriginOpenerPolicy:   { policy: "unsafe-none" },
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc:  ["'self'"],
        connectSrc: ["'self'", ...wsSources],
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
  // Per-runId rate limit — layered on top of IP limit
  api.use(rateLimit({
    windowMs:        60 * 1000,
    max:             200,
    standardHeaders: true,
    legacyHeaders:   false,
    keyGenerator:    (req) => req.headers["x-run-id"] ?? req.ip,
    message:         { error: "Per-run rate limit exceeded" },
  }));
  api.use(requireAuth);
  // Telemetry: extra per-IP object-count guard (30 req × 500 obj = 15k upserts/min)
  api.use("/telemetry", telemetryLimiter, (req, _res, next) => {
    const count = Array.isArray(req.body?.objects) ? req.body.objects.length : 0;
    if (count > 500) {
      return next(Object.assign(new Error("objects[] exceeds 500 per request on this endpoint"), { statusCode: 429 }));
    }
    next();
  }, telemetryRoutes);
  api.use(simulationRoutes);
  api.use(maneuverRoutes);
  api.use(visualizationRoutes);
  app.use("/api", api);

  app.use(errorMiddleware(logger));
  return app;
}

module.exports = { createApp };
