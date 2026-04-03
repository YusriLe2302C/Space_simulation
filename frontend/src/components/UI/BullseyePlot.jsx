import { memo, useState, useMemo } from "react";
import { positionStore } from "../../store/simulationStore";
import useSimulationStore from "../../store/simulationStore";
import { panel, sectionLabel, TOKEN } from "./Dashboard";

const SIZE           = 180;
const CENTER         = SIZE / 2;
const MAX_TCA_S      = 7200;   // 2-hour window — radial axis in seconds
const MAX_OBJECTS    = 30;
const EARTH_RADIUS_KM = 6378.1363;

function dist3d(a, b) {
  const toRad = (d) => (d * Math.PI) / 180;
  const rA = EARTH_RADIUS_KM + (a.alt ?? 400);
  const rB = EARTH_RADIUS_KM + (b.alt ?? 400);
  const ax = rA * Math.cos(toRad(a.lat)) * Math.cos(toRad(a.lon));
  const ay = rA * Math.cos(toRad(a.lat)) * Math.sin(toRad(a.lon));
  const az = rA * Math.sin(toRad(a.lat));
  const bx = rB * Math.cos(toRad(b.lat)) * Math.cos(toRad(b.lon));
  const by = rB * Math.cos(toRad(b.lat)) * Math.sin(toRad(b.lon));
  const bz = rB * Math.sin(toRad(b.lat));
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
        <span style={{ marginLeft: "auto", color: TOKEN.textDim, fontSize: "9px" }}>radial = TCA (s) · ±{MAX_TCA_S}s</span>
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
          const dlat  = (obj.lat ?? 0) - (selected?.lat ?? 0);
          const dlon  = (obj.lon ?? 0) - (selected?.lon ?? 0);
          const angle = Math.atan2(dlon, dlat);
          // Radial = TCA in seconds (spec §6.2)
          const r     = Math.min(obj.tca_s, MAX_TCA_S);
          const px    = CENTER + Math.sin(angle) * r * scale;
          const py    = CENTER - Math.cos(angle) * r * scale;
          // Green/Yellow/Red per spec §6.2
          const color = obj.tca_s <= 1800 ? "#ff3322"
                      : obj.tca_s <= 3600 ? "#ffcc00"
                      : "#22cc66";
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
        {nearby.filter(o => o.tca_s <= 1800).length > 0 && (
          <span style={{ color: "#ff4422", marginLeft: "6px" }}>
            · {nearby.filter(o => o.tca_s <= 1800).length} critical (&lt;30min)
          </span>
        )}
      </div>
    </div>
  );
});

export default BullseyePlot;
