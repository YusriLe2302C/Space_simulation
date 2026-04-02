import { EARTH_RADIUS_UNITS } from "./constants";

const DEG2RAD = Math.PI / 180;

/**
 * Convert geographic coordinates to Three.js scene XYZ.
 * Returns a NEW [x,y,z] array — safe for one-off use (e.g. OrbitArc on mount).
 * DO NOT call this in a per-frame hot path with many objects; use
 * writeXYZToBuffer or inlineXYZ instead to avoid heap allocations.
 */
export function latLonAltToXYZ(lat, lon, alt = 400) {
  const r     = EARTH_RADIUS_UNITS + alt / 1000;
  const phi   = (90 - lat) * DEG2RAD;
  const theta = (lon + 180) * DEG2RAD;
  const sinP  = Math.sin(phi);
  return [
     r * sinP * Math.cos(theta),
     r * Math.cos(phi),
    -r * sinP * Math.sin(theta),
  ];
}

/**
 * Write XYZ directly into a Float32Array at a given index offset.
 *
 * P0 fix: math is fully inlined — zero heap allocations per call.
 * Previously delegated to latLonAltToXYZ which returned a [x,y,z] array,
 * causing 600k short-lived allocations/sec at 10k debris × 60 FPS.
 */
export function writeXYZToBuffer(buf, offset, lat, lon, alt = 400) {
  const r     = EARTH_RADIUS_UNITS + alt / 1000;
  const phi   = (90 - lat) * DEG2RAD;
  const theta = (lon + 180) * DEG2RAD;
  const sinP  = Math.sin(phi);
  buf[offset]     =  r * sinP * Math.cos(theta);
  buf[offset + 1] =  r * Math.cos(phi);
  buf[offset + 2] = -r * sinP * Math.sin(theta);
}
