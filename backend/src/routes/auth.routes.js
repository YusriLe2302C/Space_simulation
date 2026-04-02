const express = require("express");
const { signToken } = require("../middleware/auth.middleware");

const router = express.Router();

/**
 * POST /auth/token
 * Body: { "api_key": "<ACM_API_KEY value>" }
 * Returns: { "token": "<JWT>", "expires_in": "8h" }
 *
 * Machine-to-machine auth: the caller presents the shared API key
 * and receives a short-lived JWT to use on all other endpoints.
 */
router.post("/token", (req, res) => {
  const { api_key } = req.body ?? {};
  const expected = process.env.ACM_API_KEY;

  if (!expected) {
    return res.status(500).json({ error: "ACM_API_KEY env var is not configured" });
  }
  if (!api_key || api_key !== expected) {
    return res.status(401).json({ error: "Invalid API key" });
  }

  const token = signToken({ sub: "acm-client", role: "operator" });
  return res.json({ token, expires_in: "8h" });
});

module.exports = router;
