import { memo, useState, useMemo } from "react";
import { positionStore } from "../../store/simulationStore";
import useSimulationStore from "../../store/simulationStore";
import { panel, sectionLabel, TOKEN } from "./Dashboard";
import { YELLOW_THRESHOLD_KM, RED_THRESHOLD_KM } from "../../utils/constants";

const SIZE           = 180;
const CENTER         = SIZE / 2;
const MAX_TCA_S      = 7200;   // 2-hour window — radial axis in seconds
const MAX_OBJECTS    = 30;
const EARTH_RADIUS_KM = 6378.1363;

// Convert geodetic lat/lon/alt to ECI Cartesian (km).
// Uses spherical Earth — sufficient for approach vector direction.
function toECI(lat, lon, alt) {
  const toRad = (d) => (d * Math.PI) / 180;
  const r = EARTH_RADIUS_KM + (alt ?? 400);
  const latR = toRad(lat ?? 0);
  const lonR = toRad(lon ?? 0);
  return [
    r * Math.cos(latR) * Math.cos(lonR),
    r * Math.cos(latR) * Math.sin(lonR),
    r * Math.sin(latR),
  ];
}

// Dot product of two 3-vectors.
function dot3(a, b) { return a[0]*b[0] + a[1]*b[1] + a[2]*b[2]; }

// Cross product of two 3-vectors.
function cross3(a, b) {
  return [
    a[1]*b[2] - a[2]*b[1],
    a[2]*b[0] - a[0]*b[2],
    a[0]*b[1] - a[1]*b[0],
  ];
}

// Normalise a 3-vector, returns zero vector if near-zero magnitude.
function norm3(v) {
  const m = Math.sqrt(dot3(v, v));
  return m > 1e-9 ? [v[0]/m, v[1]/m, v[2]/m] : [0, 0, 0];
}

/**
 * Compute the approach angle of `threat` relative to `sat` in the
 * satellite's RTN (Radial-Transverse-Normal) frame.
 *
 * The relative position vector dr = r_threat - r_sat is projected onto
 * the RT plane (dropping the Normal component) and the angle is measured
 * from the Radial axis toward the Transverse axis.
 *
 * This gives the true geometric approach direction in the orbital plane,
 * which is what the spec means by "angle = relative approach vector".
 *
 * Returns angle in radians, suitable for Math.sin/cos placement on the plot.
 */
function approachAngleRTN(sat, threat) {
  const rSat    = toECI(sat.lat,    sat.lon,    sat.alt);
  const rThreat = toECI(threat.lat, threat.lon, threat.alt);

  // Relative position vector (threat relative to sat)
  const dr = [rThreat[0]-rSat[0], rThreat[1]-rSat[1], rThreat[2]-rSat[2]];

  // RTN frame axes derived from sat position
  // R = radial (position unit vector)
  const R = norm3(rSat);
  // Approximate velocity direction: prograde = cross(Z_hat, R) for LEO
  // Use a stable reference: if R is near Z, use X instead
  const ref = Math.abs(R[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  // N = normal to orbital plane = R × ref (approximate h direction)
  const N = norm3(cross3(R, ref));
  // T = transverse (along-track) = N × R
  const T = norm3(cross3(N, R));

  // Project dr onto R and T axes
  const dr_R = dot3(dr, R);
  const dr_T = dot3(dr, T);

  // Angle from Radial toward Transverse — this is the approach direction
  return Math.atan2(dr_T, dr_R);
}

function dist3d(a, b) {
  const [ax, ay, az] = toECI(a.lat, a.lon, a.alt);
  const [bx, by, bz] = toECI(b.lat, b.lon, b.alt);
  return Math.sqrt((ax-bx)**2 + (ay-by)**2 + (az-bz)**2);
}

const selectSatMeta      = (s) => s.satelliteMetaMap;
const selectConjunctions = (s) => s.conjunctions;

const BullseyePlot = memo(function BullseyePlot() {
  const metaMap      = useSimulationStore(selectSatMeta);
  const conjunctions = useSimulationStore(selectConjunctions);
  const [selectedId, setSelectedId] = useState(null);

  const satIds   = [...metaMap.keys()];
  const activeId = selectedId ?? satIds[0] ?? null;
  const selected = positionStore.satellites.find((s) => s.id === activeId);

  const nearby = useMemo(() => {
    if (!selected) return [];

    // Build TCA map from conjunctions: other_id -> { tca_s, miss_distance_km }
    // Radial axis = TCA in seconds (doc §6.2 spec)
    const tcaMap = new Map();
    for (const c of conjunctions) {
      const other = c.a === activeId ? c.b : c.b === activeId ? c.a : null;
      if (other) tcaMap.set(other, { tca_s: c.tca_s ?? c.time_to_event_s ?? 0, miss_distance_km: c.miss_distance_km });
    }

    const result = [];

    for (const s of positionStore.satellites) {
      if (s.id === activeId) continue;
      const conj = tcaMap.get(s.id);
      // Only plot objects that have a known conjunction TCA within the window
      const tca_s = conj ? conj.tca_s : null;
      if (tca_s === null) {
        // No conjunction data — use spatial distance as fallback, plot at edge
        const d = dist3d(selected, s);
        if (d > 500) continue; // skip very distant objects
        result.push({ id: s.id, lat: s.lat, lon: s.lon, alt: s.alt, tca_s: MAX_TCA_S, dist: d, risk: null, type: "sat" });
      } else if (tca_s <= MAX_TCA_S) {
        const d = dist3d(selected, s);
        result.push({ id: s.id, lat: s.lat, lon: s.lon, alt: s.alt, tca_s, dist: d, risk: conj.miss_distance_km, type: "sat" });
      }
    }

    return result.sort((a, b) => a.tca_s - b.tca_s).slice(0, MAX_OBJECTS);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, conjunctions, positionStore.satellites.length, positionStore.debrisCloud.length]);

  const scale = CENTER / MAX_TCA_S;

  return (
    <div style={panel({ padding: "8px 10px", width: "400px" })}>
      <div style={{ ...sectionLabel(), marginBottom: "6px" }}>
        <span>🎯</span>
        <span>BULLSEYE — TCA VIEW</span>
        <span style={{ marginLeft: "auto", color: TOKEN.textDim, fontSize: "9px" }}>radial = TCA (s) · angle = RTN approach</span>
      </div>

      {satIds.length > 1 && (
        <select
          value={activeId ?? ""}
          onChange={(e) => setSelectedId(e.target.value)}
          style={{
            background: "rgba(0,0,0,0.4)", border: `1px solid ${TOKEN.border}`,
            color: TOKEN.text, fontFamily: TOKEN.fontMono, fontSize: "9px",
            padding: "2px 6px", borderRadius: "3px", marginBottom: "8px",
            width: "100%", pointerEvents: "auto",
          }}
        >
          {satIds.map((id) => <option key={id} value={id}>{id}</option>)}
        </select>
      )}

      <svg width={SIZE} height={SIZE} style={{ display: "block", margin: "0 auto" }}>
        {/* Rings at 30min, 1h, 1.5h, 2h — labelled in seconds */}
        {[7200, 5400, 3600, 1800].map((r) => (
          <circle key={r} cx={CENTER} cy={CENTER}
            r={Math.min(r * scale, CENTER)} fill="none"
            stroke={
              r <= 1800 ? "rgba(255,50,30,0.7)"
              : r <= 3600 ? "rgba(255,160,0,0.4)"
              : "rgba(0,200,80,0.2)"
            }
            strokeWidth={r <= 1800 ? 2 : r <= 3600 ? 1.5 : 0.8}
            strokeDasharray={r <= 3600 ? "3,3" : "none"}
          />
        ))}
        {[1800, 3600, 5400, 7200].map((r) => (
          <text key={r} x={CENTER + Math.min(r * scale, CENTER) + 2} y={CENTER - 2}
            fill={r <= 1800 ? "#ff4422" : r <= 3600 ? "#ffaa22" : "#22cc66"}
            fontSize="7" fontFamily="monospace">{r}s</text>
        ))}
        <line x1={CENTER} y1={0}      x2={CENTER} y2={SIZE}   stroke="rgba(0,170,255,0.1)" strokeWidth={0.5} />
        <line x1={0}      y1={CENTER} x2={SIZE}   y2={CENTER} stroke="rgba(0,170,255,0.1)" strokeWidth={0.5} />

        {nearby.map((obj, i) => {
          // Angle = approach vector in RTN frame (Radial-Transverse plane)
          // Computed from ECI relative position of threat w.r.t. selected sat
          const angle = selected ? approachAngleRTN(selected, obj) : 0;
          // Radial = TCA in seconds (spec §6.2)
          const r     = Math.min(obj.tca_s, MAX_TCA_S);
          const px    = CENTER + Math.sin(angle) * r * scale;
          const py    = CENTER - Math.cos(angle) * r * scale;
          // Green/Yellow/Red per spec §6.2: Red < 1km, Yellow < 5km, Green = safe
          const miss = obj.risk;  // miss_distance_km from conjunction data
          const color = miss != null
            ? (miss < RED_THRESHOLD_KM    ? "#ff3322"
              : miss < YELLOW_THRESHOLD_KM ? "#ffcc00"
              : "#22cc66")
            : "#22cc66";  // no miss data — default safe
          return (
            <g key={i}>
              <circle cx={px} cy={py} r={obj.type === "sat" ? 3.5 : 2} fill={color} opacity={0.85} />
              {obj.risk != null && (
                <text x={px + 4} y={py - 2} fill={color} fontSize="7" fontFamily="monospace">
                  {obj.tca_s.toFixed(0)}s
                </text>
              )}
            </g>
          );
        })}

        <circle cx={CENTER} cy={CENTER} r={5} fill="#2299ee" />
        <circle cx={CENTER} cy={CENTER} r={5} fill="none" stroke="#2299ee" strokeWidth={1.5} opacity={0.5} />
        <text x={CENTER + 8} y={CENTER + 4} fill={TOKEN.text} fontSize="8" fontFamily="monospace">
          {activeId?.slice(-8) ?? "—"}
        </text>
      </svg>

      <div style={{ color: TOKEN.textDim, fontSize: "9px", textAlign: "center", marginTop: "4px" }}>
        {nearby.length} conjunctions within {MAX_TCA_S}s
        {nearby.filter(o => o.risk != null && o.risk < RED_THRESHOLD_KM).length > 0 && (
          <span style={{ color: "#ff4422", marginLeft: "6px" }}>
            · {nearby.filter(o => o.risk != null && o.risk < RED_THRESHOLD_KM).length} critical (&lt;{RED_THRESHOLD_KM}km)
          </span>
        )}
      </div>
    </div>
  );
});

export default BullseyePlot;
