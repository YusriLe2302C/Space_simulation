const jwt = require("jsonwebtoken");

function getSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET env var is not set");
  return secret;
}

/**
 * Express middleware — validates a Bearer JWT on every request.
 * Attaches decoded payload to req.user on success.
 * Returns 401 on missing/invalid token, 403 on expired token.
 */
function requireAuth(req, res, next) {
  const header = req.headers["authorization"] ?? "";
  if (!header.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing or malformed Authorization header" });
  }

  const token = header.slice(7);
  try {
    req.user = jwt.verify(token, getSecret());
    return next();
  } catch (err) {
    const status = err.name === "TokenExpiredError" ? 403 : 401;
    return res.status(status).json({ error: err.message });
  }
}

/**
 * Sign a JWT for a given payload.
 * Used by the /auth/token endpoint.
 */
function signToken(payload, expiresIn = "8h") {
  return jwt.sign(payload, getSecret(), { expiresIn });
}

module.exports = { requireAuth, signToken };
