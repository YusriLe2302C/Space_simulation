function requireEnv(name) {
  const value = process.env[name];
  if (!value || String(value).trim() === "") {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function numberEnv(name, fallback) {
  const raw = process.env[name] ?? fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid number env var: ${name}`);
  }
  return parsed;
}

function loadEnv() {
  return {
    nodeEnv:          process.env.NODE_ENV ?? "development",
    port:             numberEnv("PORT", 8000),
    mongoUri:         requireEnv("MONGODB_URI"),
    corsOrigin:       requireEnv("CORS_ORIGIN"),
    pythonEngineUrl:  process.env.PYTHON_ENGINE_URL ?? "http://localhost:9000",
    engineSecret:     requireEnv("ENGINE_SECRET"),
    runId:            process.env.ACM_RUN_ID ?? "default",
  };
}

module.exports = { loadEnv };

