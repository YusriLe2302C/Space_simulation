import { API_BASE_URL } from "../utils/constants";

const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_RETRIES    = 2;

// ── Token store ───────────────────────────────────────────────────────────────
// JWT held in memory only — never localStorage (avoids XSS token theft).
// Fetched once on first API call, reused until the page reloads or a
// 401/403 response forces a refresh.
let _token      = null;
let _tokenFetch = null;   // in-flight promise — prevents duplicate /auth/token calls

async function getToken() {
  if (_token) return _token;

  // If a fetch is already in flight, wait for it instead of firing another
  if (_tokenFetch) return _tokenFetch;

  _tokenFetch = fetch(`${API_BASE_URL}/auth/token`, {
    method:  "POST",
    headers: { "content-type": "application/json" },
    body:    JSON.stringify({
      api_key: import.meta.env.VITE_ACM_API_KEY ?? "",
    }),
  })
    .then((res) => {
      if (!res.ok) throw new Error(`Auth failed: HTTP ${res.status}`);
      return res.json();
    })
    .then((data) => {
      _token      = data.token;
      _tokenFetch = null;
      return _token;
    })
    .catch((err) => {
      _tokenFetch = null;
      throw err;
    });

  return _tokenFetch;
}

// ── Base fetch ────────────────────────────────────────────────────────────────
async function apiFetch(
  path,
  options = {},
  { timeoutMs = DEFAULT_TIMEOUT_MS, retries = DEFAULT_RETRIES } = {},
) {
  const url          = `${API_BASE_URL}${path}`;
  const callerSignal = options.signal ?? null;
  const { signal: _ignored, ...fetchOptions } = options;

  // Ensure we have a token before the first attempt
  let token = await getToken();

  let attempt = 0;
  while (true) {
    attempt++;

    if (callerSignal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }

    const timeoutController = new AbortController();
    const timer = setTimeout(() => timeoutController.abort(), timeoutMs);

    const combinedSignal =
      callerSignal && typeof AbortSignal.any === "function"
        ? AbortSignal.any([timeoutController.signal, callerSignal])
        : timeoutController.signal;

    try {
      const res = await fetch(url, {
        ...fetchOptions,
        signal:  combinedSignal,
        headers: {
          "content-type":  "application/json",
          "authorization": `Bearer ${token}`,
          "x-run-id":      import.meta.env.VITE_ACM_RUN_ID ?? "default",
          ...(fetchOptions.headers ?? {}),
        },
      });

      if (!res.ok) {
        // Token expired or invalid — clear cache, fetch fresh, retry once
        if ((res.status === 401 || res.status === 403) && attempt === 1) {
          _token = null;
          token  = await getToken();
          attempt = 0;   // reset counter so the retry is treated as attempt 1
          continue;
        }

        // Retry on 5xx only
        if (attempt <= retries && res.status >= 500) {
          await _sleep(300 * attempt);
          continue;
        }

        const err = new Error(`API error: HTTP ${res.status} ${path}`);
        err.status = res.status;
        throw err;
      }

      return await res.json();
    } catch (err) {
      if (callerSignal?.aborted) throw err;

      const isAbort = err?.name === "AbortError";
      if (attempt <= retries && (isAbort || !err.status)) {
        await _sleep(300 * attempt);
        continue;
      }
      const wrapped = new Error(isAbort ? `Request timeout: ${path}` : err.message);
      wrapped.status = err.status ?? 0;
      wrapped.cause  = err;
      throw wrapped;
    } finally {
      clearTimeout(timer);
    }
  }
}

function _sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Public API ────────────────────────────────────────────────────────────────

export { apiFetch };

/**
 * GET /api/visualization/snapshot
 */
export async function fetchSnapshot(signal) {
  return apiFetch("/api/visualization/snapshot", { signal }, { retries: 3 });
}

/**
 * POST /api/simulate/step
 */
export async function stepSimulation(stepSeconds) {
  return apiFetch("/api/simulate/step", {
    method: "POST",
    body:   JSON.stringify({ step_seconds: stepSeconds }),
  });
}
