function badRequest(message, details) {
  const err = new Error(message);
  err.statusCode = 400;
  if (details) err.details = details;
  return err;
}

function validateBody(validator) {
  return (req, res, next) => {
    try {
      validator(req.body);
      next();
    } catch (err) {
      next(err.statusCode ? err : badRequest(err.message));
    }
  };
}

function isIsoString(value) {
  if (typeof value !== "string") return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && value.includes("T");
}

function isNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function validateVector(vec, name) {
  if (!vec || typeof vec !== "object") throw badRequest(`${name} must be an object`);
  if (!isNumber(vec.x) || !isNumber(vec.y) || !isNumber(vec.z)) {
    throw badRequest(`${name} must have numeric x,y,z`);
  }
}

function validateTelemetry(body) {
  if (!body || typeof body !== "object") throw badRequest("Body must be an object");
  if (!isIsoString(body.timestamp)) throw badRequest("timestamp must be an ISO string");
  if (!Array.isArray(body.objects)) throw badRequest("objects must be an array");

  for (const obj of body.objects) {
    if (!obj || typeof obj !== "object") throw badRequest("objects[] must be an object");
    if (typeof obj.id !== "string" || obj.id.trim() === "") {
      throw badRequest("objects[].id must be a non-empty string");
    }
    if (obj.type !== "DEBRIS" && obj.type !== "SATELLITE") {
      throw badRequest("objects[].type must be DEBRIS or SATELLITE");
    }
    validateVector(obj.r, "objects[].r");
    validateVector(obj.v, "objects[].v");
  }
}

function validateManeuverSchedule(body) {
  if (!body || typeof body !== "object") throw badRequest("Body must be an object");
  if (typeof body.satelliteId !== "string" || body.satelliteId.trim() === "") {
    throw badRequest("satelliteId must be a non-empty string");
  }
  if (!Array.isArray(body.maneuver_sequence) || body.maneuver_sequence.length === 0) {
    throw badRequest("maneuver_sequence must be a non-empty array");
  }
  for (const burn of body.maneuver_sequence) {
    if (!burn || typeof burn !== "object") throw badRequest("maneuver_sequence[] must be an object");
    if (typeof burn.burn_id !== "string" || burn.burn_id.trim() === "") {
      throw badRequest("maneuver_sequence[].burn_id must be a non-empty string");
    }
    if (!isIsoString(burn.burnTime)) throw badRequest("maneuver_sequence[].burnTime must be ISO string");
    validateVector(burn.deltaV_vector, "maneuver_sequence[].deltaV_vector");
  }
}

function validateSimulateStep(body) {
  if (!body || typeof body !== "object") throw badRequest("Body must be an object");
  if (!isNumber(body.step_seconds) || body.step_seconds <= 0) {
    throw badRequest("step_seconds must be a positive number");
  }
}

module.exports = {
  validateBody,
  validateTelemetry,
  validateManeuverSchedule,
  validateSimulateStep,
  badRequest,
};

