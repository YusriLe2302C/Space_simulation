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
  // Always run timingSafeEqual regardless of whether api_key is present
  // — prevents timing attacks that distinguish "no key" from "wrong key"
  const a = Buffer.alloc(Buffer.byteLength(expected), api_key ?? "");
  const b = Buffer.from(expected);
  if (!crypto.timingSafeEqual(a, b)) {
    return res.status(401).json({ error: "Invalid API key" });
  }

  const token = signToken({ sub: "acm-client", role: "operator" });
  return res.json({ token, expires_in: "8h" });
});

/**
 * POST /auth/frontend-token  (BFF pattern)
 * Browser-facing endpoint — no client secret required.
 * Issues a restricted read-only viewer JWT.
 * The authLimiter (10/min/IP) is the only guard needed here since
 * the token only grants read-only access and VITE_ACM_API_KEY is
 * no longer bundled into the frontend.
 */
router.post("/frontend-token", (req, res) => {
  const expected = process.env.ACM_API_KEY;
  if (!expected) {
    return res.status(500).json({ error: "Server misconfigured" });
  }
  // Read-only viewer token — no operator role, shorter expiry
  const token = signToken({ sub: "acm-viewer", role: "viewer" }, "4h");
  return res.json({ token, expires_in: "4h" });
});

module.exports = router;
