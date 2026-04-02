const { ACM } = require("../utils/constants");
const { badRequest } = require("../middleware/validation.middleware");

function dvMagnitudeMs(vec) {
  return Math.sqrt(vec.x * vec.x + vec.y * vec.y + vec.z * vec.z);
}

function validateDeltaV(vec) {
  const mag = dvMagnitudeMs(vec);
  if (mag > ACM.MAX_DV_MS) {
    throw badRequest(`deltaV_vector magnitude exceeds ${ACM.MAX_DV_MS} m/s`);
  }
  return mag;
}

function asDate(isoString, fieldName) {
  const date = new Date(isoString);
  if (!Number.isFinite(date.getTime())) throw badRequest(`${fieldName} must be a valid ISO string`);
  return date;
}

module.exports = { validateDeltaV, dvMagnitudeMs, asDate };

