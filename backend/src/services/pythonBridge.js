function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shouldRetry({ err, status }) {
  if (err) return true;
  return status === 502 || status === 503 || status === 504;
}

function normalizeEngineResponse(payload) {
  if (!payload || typeof payload !== "object") {
    const err = new Error("Invalid engine response");
    err.statusCode = 502;
    throw err;
  }
  if (!Array.isArray(payload.objects)) {
    const err = new Error("Engine response missing objects[]");
    err.statusCode = 502;
    throw err;
  }
  if (typeof payload.collisions !== "number" || typeof payload.maneuvers !== "number") {
    const err = new Error("Engine response missing collisions/maneuvers");
    err.statusCode = 502;
    throw err;
  }

  const objects = [];
  for (const obj of payload.objects) {
    if (!obj || typeof obj !== "object") continue;
    if (typeof obj.id !== "string" || obj.id.trim() === "") continue;
    if (!Array.isArray(obj.state) || obj.state.length !== 6) continue;
    objects.push({ id: obj.id, state: obj.state.map((n) => Number(n)) });
  }

  return {
    objects,
    collisions:  payload.collisions,
    maneuvers:   payload.maneuvers,
    orbit_paths: payload.orbit_paths ?? {},
    reasoning:   payload.reasoning   ?? {},
  };
}

async function simulateStepHttp({
  pythonEngineUrl,
  objects,
  stepSeconds,
  timeoutMs = 6000,
  retries = 2,
  logger,
}) {
  const url = `${pythonEngineUrl.replace(/\/+$/, "")}/simulate`;
  const body = JSON.stringify({ objects, step_seconds: stepSeconds });

  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    attempt += 1;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
        signal: controller.signal,
      });

      if (!res.ok) {
        const status = res.status;
        if (attempt <= retries + 1 && shouldRetry({ status })) {
          logger?.warn("python_engine_retry_status", { status, attempt });
          await sleep(200 * attempt);
          continue;
        }
        const err = new Error(`Python engine error: HTTP ${status}`);
        err.statusCode = 502;
        throw err;
      }

      const payload = await res.json();
      return normalizeEngineResponse(payload);
    } catch (err) {
      const isAbort = err?.name === "AbortError";
      if (attempt <= retries + 1 && shouldRetry({ err })) {
        logger?.warn("python_engine_retry_error", { isAbort, attempt, message: err?.message });
        await sleep(200 * attempt);
        continue;
      }
      const e = new Error(isAbort ? "Python engine timeout" : "Python engine request failed");
      e.statusCode = 504;
      throw e;
    } finally {
      clearTimeout(timeout);
    }
  }
}

module.exports = { simulateStepHttp, predictHttp };

async function predictHttp({ pythonEngineUrl, horizonS = 86400, dtS = 60, timeoutMs = 15000 }) {
  const url = `${pythonEngineUrl.replace(/\/+$/, "")}/predict?horizon_s=${horizonS}&dt_s=${dtS}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`Predict failed: ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timeout);
  }
}
