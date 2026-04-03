const crypto  = require("crypto");
const express = require("express");
const { signToken } = require("../middleware/auth.middleware");

const router = express.Router();

/**
 * POST /auth/token
 * Machine-to-machine: caller presents ACM_API_KEY, receives JWT.
 * Used by seed.js and server-side callers only.
 */
router.post("/token", (req, res) => {
  const { api_key } = req.body ?? {};
  const expected = process.env.ACM_API_KEY;

  if (!expected) {
    return res.status(500).json({ error: "ACM_API_KEY env var is not configured" });
  }
  if (!api_key) {
    return res.status(401).json({ error: "Invalid API key" });
  }
  const a = Buffer.from(api_key);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(401).json({ error: "Invalid API key" });
  }

  const token = signToken({ sub: "acm-client", role: "operator" });
  return res.json({ token, expires_in: "8h" });
});

/**
 * POST /auth/frontend-token  (BFF pattern)
 * Browser-facing endpoint — no API key required from the client.
 * The secret stays server-side. Issues a restricted read-only JWT.
 * Rate-limited by the authLimiter in app.js (10/min/IP).
 */
router.post("/frontend-token", (req, res) => {
  const expected = process.env.ACM_API_KEY;
  if (!expected) {
    return res.status(500).json({ error: "Server misconfigured" });
  }
  // Issue a read-only viewer token — no operator role
  const token = signToken({ sub: "acm-viewer", role: "viewer" }, "8h");
  return res.json({ token, expires_in: "8h" });
});

module.exports = router;
