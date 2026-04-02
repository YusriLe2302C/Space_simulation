import { memo } from "react";
import useSimulationStore from "../../store/simulationStore";
import Alerts from "./Alerts";
import FuelPanel from "./FuelPanel";
import Timeline from "./Timeline";

// ── Shared design tokens ──────────────────────────────────────────────────────
export const TOKEN = {
  bg:          "rgba(4, 12, 26, 0.92)",
  bgAlert:     "rgba(4, 12, 26, 0.96)",
  border:      "rgba(0, 170, 255, 0.18)",
  borderAlert: "rgba(255, 80, 60, 0.35)",
  text:        "#c8e0f4",
  textDim:     "#4a6a88",
  textMuted:   "#2a4a62",
  accent:      "#2299ee",
  fontMono:    "'JetBrains Mono', 'Fira Mono', 'Consolas', monospace",
  radius:      "5px",
};

export const panel = (overrides = {}) => ({
  background:   TOKEN.bg,
  border:       `1px solid ${TOKEN.border}`,
  borderRadius: TOKEN.radius,
  padding:      "10px 13px",
  color:        TOKEN.text,
  fontFamily:   TOKEN.fontMono,
  fontSize:     "11px",
  pointerEvents: "auto",
  ...overrides,
});

export const sectionLabel = (color = TOKEN.accent) => ({
  color,
  fontSize:      "10px",
  fontWeight:    "700",
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  marginBottom:  "8px",
  display:       "flex",
  alignItems:    "center",
  gap:           "6px",
});

// ── Stat card ─────────────────────────────────────────────────────────────────
function StatCard({ label, value, color = TOKEN.text, glow = false }) {
  return (
    <div style={{
      flex:          1,
      display:       "flex",
      flexDirection: "column",
      alignItems:    "center",
      padding:       "8px 4px",
      borderRadius:  "6px",
      background:    `${color}12`,
      border:        `1px solid ${color}33`,
      boxShadow:     glow ? `0 0 12px ${color}66` : "none",
      transition:    "all 0.3s ease",
    }}>
      <span style={{
        fontSize:           "18px",
        fontWeight:         "700",
        color,
        lineHeight:         1,
        fontVariantNumeric: "tabular-nums",
      }}>
        {value ?? "—"}
      </span>
      <span style={{
        fontSize:      "8px",
        color:         TOKEN.textDim,
        marginTop:     "4px",
        letterSpacing: "0.08em",
        textTransform: "uppercase",
      }}>
        {label}
      </span>
    </div>
  );
}

// ── Connection badge ──────────────────────────────────────────────────────────
function ConnectionBadge({ connected }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
      <span style={{
        width: "7px", height: "7px", borderRadius: "50%",
        background:  connected ? "#22dd66" : "#ee3322",
        boxShadow:   connected ? "0 0 6px #22dd66aa" : "none",
        flexShrink:  0,
      }} />
      <span style={{ color: connected ? "#22dd66" : "#ee3322", fontWeight: "700", fontSize: "10px", letterSpacing: "0.08em" }}>
        {connected ? "LIVE" : "OFFLINE"}
      </span>
    </div>
  );
}

// ── Error banner ──────────────────────────────────────────────────────────────
function ErrorBanner({ error }) {
  if (!error) return null;
  return (
    <div style={panel({
      border:     `1px solid rgba(255,60,40,0.5)`,
      background: "rgba(40,5,5,0.95)",
      color:      "#ff7755",
    })}>
      <div style={sectionLabel("#ff5533")}>⚠ Error</div>
      <div style={{ fontSize: "10px", wordBreak: "break-word" }}>
        {error?.message ?? String(error)}
      </div>
    </div>
  );
}

// ── Selectors ─────────────────────────────────────────────────────────────────
const selectConnected       = (s) => s.connected;
const selectTimestamp       = (s) => s.timestamp;
const selectLoading         = (s) => s.loading;
const selectError           = (s) => s.error;
const selectSatCount        = (s) => s.satelliteMetaMap.size;
const selectCollisionsTotal = (s) => s.collisionsTotal;
const selectManeuversTotal  = (s) => s.maneuversTotal;
const selectAlertCount      = (s) => s.alerts.length;
const selectConjunctions    = (s) => s.conjunctions;

// ── TTC Panel ─────────────────────────────────────────────────────────────────
function fmtTTC(seconds) {
  if (seconds < 60)   return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${(seconds / 3600).toFixed(1)}h`;
}

const TTCPanel = memo(function TTCPanel({ conjunctions }) {
  if (!conjunctions?.length) return null;
  const top = conjunctions.slice(0, 3);
  return (
    <div style={panel({ border: `1px solid rgba(255,80,60,0.35)` })}>
      <div style={{ ...sectionLabel("#ff4422"), marginBottom: "6px" }}>
        <span>⚠️</span>
        <span>PREDICTED CONJUNCTIONS</span>
        <span style={{ marginLeft: "auto", color: TOKEN.textDim, fontSize: "9px" }}>
          {conjunctions.length} total
        </span>
      </div>
      {top.map((c, i) => (
        <div key={i} style={{
          display:      "flex",
          alignItems:   "center",
          gap:          "6px",
          padding:      "3px 0",
          borderBottom: i < top.length - 1 ? `1px solid rgba(255,255,255,0.05)` : "none",
        }}>
          <span style={{
            background:         c.time_to_event_s < 3600 ? "rgba(255,50,30,0.2)" : "rgba(255,160,0,0.15)",
            color:              c.time_to_event_s < 3600 ? "#ff4422" : "#ffaa22",
            borderRadius:       "3px",
            padding:            "1px 5px",
            fontSize:           "9px",
            fontWeight:         "700",
            flexShrink:         0,
            fontVariantNumeric: "tabular-nums",
          }}>
            T−{fmtTTC(c.time_to_event_s)}
          </span>
          <span style={{ color: TOKEN.text, fontSize: "9px", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {c.a} ↔ {c.b}
          </span>
          <span style={{ color: TOKEN.textDim, fontSize: "9px", flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>
            {c.miss_distance_km.toFixed(3)} km
          </span>
        </div>
      ))}
    </div>
  );
});

// ── Dashboard ─────────────────────────────────────────────────────────────────
const Dashboard = memo(function Dashboard() {
  const connected       = useSimulationStore(selectConnected);
  const timestamp       = useSimulationStore(selectTimestamp);
  const loading         = useSimulationStore(selectLoading);
  const error           = useSimulationStore(selectError);
  const satCount        = useSimulationStore(selectSatCount);
  const collisionsTotal = useSimulationStore(selectCollisionsTotal);
  const maneuversTotal  = useSimulationStore(selectManeuversTotal);
  const alertCount      = useSimulationStore(selectAlertCount);
  const conjunctions    = useSimulationStore(selectConjunctions);

  return (
    <div style={{
      position:       "absolute",
      top:            0,
      right:          0,
      width:          "300px",
      height:         "100vh",
      display:        "flex",
      flexDirection:  "column",
      gap:            "6px",
      padding:        "10px",
      pointerEvents:  "none",
      zIndex:         10,
      overflowY:      "auto",
      scrollbarWidth: "none",
    }}>

      {/* ── Header ── */}
      <div style={panel()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
          <span style={{ fontSize: "11px", fontWeight: "700", color: TOKEN.accent, letterSpacing: "0.08em" }}>
            ACM DASHBOARD
          </span>
          <ConnectionBadge connected={connected} />
        </div>

        <div style={{ color: TOKEN.textDim, fontSize: "10px", marginBottom: "10px", fontVariantNumeric: "tabular-nums" }}>
          {loading
            ? "Initialising…"
            : timestamp
              ? new Date(timestamp).toISOString().replace("T", "  ").slice(0, 22) + "Z"
              : "No timestamp"}
        </div>

        {/* ── Stat cards ── */}
        <div style={{ display: "flex", gap: "6px", paddingTop: "8px", borderTop: `1px solid ${TOKEN.border}` }}>
          <StatCard label="SATS"       value={satCount}        color={TOKEN.accent}                                     />
          <StatCard label="COLLISIONS" value={collisionsTotal} color={collisionsTotal > 0 ? "#ff4422" : TOKEN.textDim} glow={collisionsTotal > 0} />
          <StatCard label="MANEUVERS"  value={maneuversTotal}  color={maneuversTotal  > 0 ? "#ffaa22" : TOKEN.textDim} glow={maneuversTotal  > 0} />
          <StatCard label="ALERTS"     value={alertCount}      color={alertCount      > 0 ? "#ffcc00" : TOKEN.textDim} glow={alertCount      > 0} />
        </div>
      </div>

      <ErrorBanner error={error} />
      <TTCPanel conjunctions={conjunctions} />
      <Alerts />
      <FuelPanel />
      <Timeline />
    </div>
  );
});

export default Dashboard;
