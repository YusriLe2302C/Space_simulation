import { memo, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import useSimulationStore from "../../store/simulationStore";
import { FUEL_WARNING_PCT } from "../../utils/constants";
import { panel, sectionLabel, TOKEN } from "./Dashboard";

// Max propellant matches doc §5.1 DEFAULT_PROPELLANT_KG = 50 kg
const MAX_FUEL_KG = 50;

// ── Fuel thresholds ───────────────────────────────────────────────────────────
function fuelColor(pct) {
  if (pct <= 5)               return "#cc2200";   // graveyard threshold
  if (pct < FUEL_WARNING_PCT) return "#ff4422";   // critical
  if (pct < 30)               return "#ffaa22";   // warning
  return "#22cc66";                               // nominal
}

function fuelPct(fuel_kg) {
  if (fuel_kg == null) return null;
  return Math.min(100, Math.max(0, (fuel_kg / MAX_FUEL_KG) * 100));
}

// ── Status badge ──────────────────────────────────────────────────────────────
const STATUS_BADGE = {
  GRAVEYARD: { label: "GY",      color: "#cc2200", bg: "rgba(180,20,0,0.2)"   },
  CRITICAL:  { label: "CRIT",    color: "#ff4422", bg: "rgba(255,50,20,0.15)" },
  WARNING:   { label: "WARN",    color: "#ffaa22", bg: "rgba(255,160,0,0.15)" },
  NOMINAL:   { label: "NOM",     color: "#22cc66", bg: "rgba(20,180,80,0.1)"  },
};

function statusBadge(status) {
  return STATUS_BADGE[status] ?? STATUS_BADGE.NOMINAL;
}

// ── Single fuel bar row ───────────────────────────────────────────────────────
const FuelBar = memo(function FuelBar({ id, fuel_kg, status }) {
  const pct   = fuelPct(fuel_kg);
  const color = pct != null ? fuelColor(pct) : TOKEN.textDim;
  const badge = statusBadge(status);

  return (
    <div style={{ marginBottom: "7px" }}>
      {/* Label row */}
      <div style={{ display: "flex", alignItems: "center", gap: "5px", marginBottom: "3px" }}>
        <span style={{
          flex: 1, color: TOKEN.text, fontSize: "10px",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {id}
        </span>

        {/* Status badge */}
        <span style={{
          fontSize: "8px", fontWeight: "700", padding: "1px 5px",
          borderRadius: "3px", color: badge.color, background: badge.bg,
          flexShrink: 0,
        }}>
          {badge.label}
        </span>

        {/* Fuel value */}
        <span style={{ color, fontSize: "10px", fontVariantNumeric: "tabular-nums", flexShrink: 0, minWidth: "46px", textAlign: "right" }}>
          {fuel_kg != null ? `${fuel_kg.toFixed(1)} kg` : "—"}
        </span>
      </div>

      {/* Bar */}
      <div style={{ background: "rgba(255,255,255,0.07)", borderRadius: "2px", height: "3px" }}>
        {pct != null && (
          <div style={{
            width:        `${pct}%`,
            height:       "100%",
            background:   color,
            borderRadius: "2px",
            transition:   "width 0.4s ease, background 0.4s ease",
          }} />
        )}
      </div>
    </div>
  );
});

// ── Selector — uses useShallow to avoid re-render when Map reference changes
//    but contents are identical ─────────────────────────────────────────────
function selectMetaEntries(s) {
  return s.satelliteMetaMap;
}

// ── FuelPanel ─────────────────────────────────────────────────────────────────
const FuelPanel = memo(function FuelPanel() {
  // useShallow does a shallow comparison on the Map itself.
  // Because applyStateUpdate only creates a new Map when an entry actually
  // changed, this selector only triggers a re-render when fuel/status changed.
  const metaMap = useSimulationStore(selectMetaEntries);

  // Sort: graveyard first, then by ascending fuel_kg (lowest = most urgent)
  const sorted = useMemo(() => {
    const entries = [...metaMap.values()];
    return entries.sort((a, b) => {
      if (a.status === "GRAVEYARD" && b.status !== "GRAVEYARD") return -1;
      if (b.status === "GRAVEYARD" && a.status !== "GRAVEYARD") return  1;
      return (a.fuel_kg ?? Infinity) - (b.fuel_kg ?? Infinity);
    });
  }, [metaMap]);

  const criticalCount = useMemo(
    () => sorted.reduce((n, s) => {
      const p = fuelPct(s.fuel_kg); // compute once per satellite
      return n + (p != null && p < FUEL_WARNING_PCT ? 1 : 0);
    }, 0),
    [sorted],
  );

  return (
    <div style={panel({ maxHeight: "230px", display: "flex", flexDirection: "column" })}>
      {/* Header */}
      <div style={{ ...sectionLabel(criticalCount > 0 ? "#ff4422" : TOKEN.accent), flexShrink: 0 }}>
        <span>⛽</span>
        <span>FUEL LEVELS</span>
        {criticalCount > 0 && (
          <span style={{
            marginLeft: "auto", background: "rgba(255,50,20,0.2)",
            color: "#ff4422", borderRadius: "10px", padding: "1px 7px",
            fontSize: "9px", fontWeight: "700",
          }}>
            {criticalCount} LOW
          </span>
        )}
      </div>

      {/* Scrollable list */}
      <div style={{ overflowY: "auto", flex: 1 }}>
        {sorted.length === 0 ? (
          <div style={{ color: TOKEN.textMuted, fontSize: "10px" }}>No satellite data</div>
        ) : (
          sorted.map((s) => <FuelBar key={s.id} {...s} />)
        )}
      </div>
    </div>
  );
});

export default FuelPanel;
