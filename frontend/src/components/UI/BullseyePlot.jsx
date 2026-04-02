import { memo, useState, useMemo } from "react";
import { positionStore } from "../../store/simulationStore";
import useSimulationStore from "../../store/simulationStore";
import { panel, sectionLabel, TOKEN } from "./Dashboard";

const SIZE          = 180;
const CENTER        = SIZE / 2;
const MAX_RADIUS_KM = 100;
const MAX_OBJECTS   = 30;
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

    // conjunction risk map for colour coding
    const riskMap = new Map();
    for (const c of conjunctions) {
      const other = c.a === activeId ? c.b : c.b === activeId ? c.a : null;
      if (other) riskMap.set(other, c.miss_distance_km);
    }

    const result = [];

    for (const s of positionStore.satellites) {
      if (s.id === activeId) continue;
      const d = dist3d(selected, s);
      if (d > MAX_RADIUS_KM) continue;
      result.push({ id: s.id, lat: s.lat, lon: s.lon, alt: s.alt, dist: d, risk: riskMap.get(s.id) ?? null, type: "sat" });
    }

    for (const d of positionStore.debrisCloud) {
      const obj = { lat: d[1], lon: d[2], alt: d[3] ?? 400 };
      const distance = dist3d(selected, obj);
      if (distance > MAX_RADIUS_KM) continue;
      result.push({ id: d[0], lat: d[1], lon: d[2], alt: d[3], dist: distance, risk: null, type: "debris" });
    }

    return result.sort((a, b) => a.dist - b.dist).slice(0, MAX_OBJECTS);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, conjunctions, positionStore.satellites.length, positionStore.debrisCloud.length]);

  const scale = CENTER / MAX_RADIUS_KM;

  return (
    <div style={panel({ padding: "8px 10px", width: "400px" })}>
      <div style={{ ...sectionLabel(), marginBottom: "6px" }}>
        <span>🎯</span>
        <span>BULLSEYE — PROXIMITY VIEW</span>
        <span style={{ marginLeft: "auto", color: TOKEN.textDim, fontSize: "9px" }}>±{MAX_RADIUS_KM} km</span>
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
        {[100, 50, 10, 1].map((r) => (
          <circle key={r} cx={CENTER} cy={CENTER}
            r={Math.min(r * scale, CENTER)} fill="none"
            stroke={r <= 1 ? "rgba(255,50,30,0.7)" : r <= 10 ? "rgba(255,50,30,0.4)" : r <= 50 ? "rgba(255,160,0,0.3)" : "rgba(0,170,255,0.12)"}
            strokeWidth={r <= 1 ? 2 : r <= 10 ? 1.5 : 0.8}
            strokeDasharray={r <= 10 ? "3,3" : "none"}
          />
        ))}
        {[1, 10, 50, 100].map((r) => (
          <text key={r} x={CENTER + Math.min(r * scale, CENTER) + 2} y={CENTER - 2}
            fill={r <= 1 ? "#ff4422" : r <= 10 ? "#ff4422" : r <= 50 ? "#ffaa22" : TOKEN.textDim}
            fontSize="7" fontFamily="monospace">{r}km</text>
        ))}
        <line x1={CENTER} y1={0}      x2={CENTER} y2={SIZE}   stroke="rgba(0,170,255,0.1)" strokeWidth={0.5} />
        <line x1={0}      y1={CENTER} x2={SIZE}   y2={CENTER} stroke="rgba(0,170,255,0.1)" strokeWidth={0.5} />

        {nearby.map((obj, i) => {
          const dlat  = (obj.lat ?? 0) - (selected?.lat ?? 0);
          const dlon  = (obj.lon ?? 0) - (selected?.lon ?? 0);
          const angle = Math.atan2(dlon, dlat);
          const r     = Math.min(obj.dist, MAX_RADIUS_KM);
          const px    = CENTER + Math.sin(angle) * r * scale;
          const py    = CENTER - Math.cos(angle) * r * scale;
          const color = obj.risk != null ? "#ff3322" : obj.dist < 50 ? "#ffcc00" : "#44aaff";
          return (
            <g key={i}>
              <circle cx={px} cy={py} r={obj.type === "sat" ? 3.5 : 2} fill={color} opacity={0.85} />
              {obj.risk != null && (
                <text x={px + 4} y={py - 2} fill={color} fontSize="7" fontFamily="monospace">{obj.dist.toFixed(0)}km</text>
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
        {nearby.length} objects within {MAX_RADIUS_KM} km
        {nearby.filter(o => o.risk != null).length > 0 && (
          <span style={{ color: "#ff4422", marginLeft: "6px" }}>
            · {nearby.filter(o => o.risk != null).length} conjunction risk
          </span>
        )}
      </div>
    </div>
  );
});

export default BullseyePlot;
