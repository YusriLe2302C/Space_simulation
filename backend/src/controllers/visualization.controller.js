const { getSnapshot } = require("../services/state.service");

const EARTH_RADIUS_KM = 6378.1363;
const RAD2DEG = 180 / Math.PI;

/**
 * Convert ECI Cartesian (km) to geodetic lat / lon / alt.
 * Uses a spherical Earth model — sufficient for visualization.
 */
function eciToLatLonAlt(r) {
  if (!r || r.x == null) return { lat: 0, lon: 0, alt: 400 };
  const { x, y, z } = r;
  const rMag = Math.sqrt(x * x + y * y + z * z);
  if (!rMag) return { lat: 0, lon: 0, alt: 400 };
  const lat = Math.asin(z / rMag) * RAD2DEG;
  const lon = Math.atan2(y, x) * RAD2DEG;
  const alt = rMag - EARTH_RADIUS_KM;
  return { lat, lon, alt };
}

async function getVisualizationSnapshot(req, res, next) {
  try {
    const runId = req.app.locals.runId;
    const { timestamp, satellites, debris } = await getSnapshot({ runId });

    res.json({
      timestamp,
      satellites: satellites.map((s) => {
        const { lat, lon, alt } = eciToLatLonAlt(s.latestEci?.r);
        return {
          id:      s.objectId,
          name:    s.name ?? s.objectId,
          lat,
          lon,
          alt,
          fuel_kg: s.fuel_kg ?? null,
          status:  s.status  ?? "NOMINAL",
        };
      }),
      debris_cloud: debris.map((d) => {
        const { lat, lon, alt } = eciToLatLonAlt(d.latestEci?.r);
        return [d.objectId, lat, lon, alt];
      }),
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { getVisualizationSnapshot };

