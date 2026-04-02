const jwt = require("jsonwebtoken");

function getSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET env var is not set");
  return secret;
}

function requireAuth(req, res, next) {
  const header = req.headers["authorization"] ?? "";
  if (!header.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing or malformed Authorization header" });
  }

  const token = header.slice(7);
  try {
    req.user = jwt.verify(token, getSecret(), {
      issuer:   "acm-system",
      audience: "acm-users",
    });
    return next();
  } catch (err) {
    const status = err.name === "TokenExpiredError" ? 403 : 401;
    return res.status(status).json({ error: err.message });
  }
}

function signToken(payload, expiresIn = "8h") {
  return jwt.sign(payload, getSecret(), {
    expiresIn,
    issuer:   "acm-system",
    audience: "acm-users",
  });
}

module.exports = { requireAuth, signToken };
