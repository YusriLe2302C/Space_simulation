import { memo, useCallback } from "react";
import useSimulationStore from "../../store/simulationStore";
import { panel, sectionLabel, TOKEN } from "./Dashboard";

// ── Severity config ───────────────────────────────────────────────────────────
const SEVERITY = {
  CRITICAL: { color: "#ff3322", bg: "rgba(255,40,20,0.08)", icon: "🔴", label: "CRITICAL" },
  WARNING:  { color: "#ffcc00", bg: "rgba(255,200,0,0.07)",  icon: "🟡", label: "WARNING"  },
  INFO:     { color: "#44aaff", bg: "rgba(40,140,255,0.07)", icon: "🔵", label: "INFO"     },
};

function severityOf(alert) {
  // Guard miss_distance_km before any numeric comparison.
  // In JavaScript: null < 1 → true, undefined < 1 → false.
  // Using != null catches both null and undefined, preventing false CRITICAL
  // classification for every alert the backend sends without a distance field.
  const d = alert.miss_distance_km;
  const isCriticalDist = d != null && Number.isFinite(d) && d < 1;
  const isWarningDist  = d != null && Number.isFinite(d) && d < 5;
  if (alert.type === "CRITICAL" || isCriticalDist) return SEVERITY.CRITICAL;
  if (alert.type === "WARNING"  || isWarningDist)  return SEVERITY.WARNING;
  return SEVERITY.INFO;
}

// ── Single alert row ──────────────────────────────────────────────────────────
const AlertRow = memo(function AlertRow({ alert, onDismiss }) {
  const sev = severityOf(alert);
  const time = alert.timestamp
    ? new Date(alert.timestamp).toISOString().slice(11, 19)
    : null;

  return (
    <div style={{
      display:      "flex",
      alignItems:   "flex-start",
      gap:          "7px",
      padding:      "5px 6px",
      borderRadius: "3px",
      background:   sev.bg,
      marginBottom: "4px",
    }}>
      {/* Severity icon */}
      <span style={{ fontSize: "9px", marginTop: "1px", flexShrink: 0 }}>{sev.icon}</span>

      {/* Body */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ color: sev.color, fontWeight: "700", fontSize: "10px" }}>
            {alert.satelliteId ?? "UNKNOWN"}
          </span>
          {time && (
            <span style={{ color: TOKEN.textDim, fontSize: "9px", fontVariantNumeric: "tabular-nums" }}>
              {time}
            </span>
          )}
        </div>
        <div style={{ color: TOKEN.text, fontSize: "10px", marginTop: "2px", wordBreak: "break-word" }}>
          {alert.message ?? sev.label}
        </div>
        {alert.miss_distance_km != null && (
          <div style={{ color: sev.color, fontSize: "9px", marginTop: "2px" }}>
            Miss distance: {alert.miss_distance_km.toFixed(2)} km
          </div>
        )}
      </div>

      {/* Dismiss */}
      <button
        onClick={() => onDismiss(alert.id)}
        aria-label="Dismiss alert"
        style={{
          background: "none", border: "none", color: TOKEN.textDim,
          cursor: "pointer", fontSize: "11px", padding: "0 2px",
          flexShrink: 0, lineHeight: 1,
        }}
      >
        ✕
      </button>
    </div>
  );
});

// ── Selectors ─────────────────────────────────────────────────────────────────
const selectAlerts       = (s) => s.alerts;
const selectDismissAlert = (s) => s.dismissAlert;

// ── Alerts panel ─────────────────────────────────────────────────────────────
const Alerts = memo(function Alerts() {
  const alerts       = useSimulationStore(selectAlerts);
  const dismissAlert = useSimulationStore(selectDismissAlert);

  const onDismiss = useCallback((id) => dismissAlert(id), [dismissAlert]);

  const criticalCount = alerts.filter((a) => severityOf(a) === SEVERITY.CRITICAL).length;
  const hasAlerts     = alerts.length > 0;

  return (
    <div style={panel({
      border:    hasAlerts ? `1px solid ${criticalCount > 0 ? "rgba(255,60,40,0.45)" : "rgba(255,200,0,0.3)"}` : `1px solid ${TOKEN.border}`,
      maxHeight: "210px",
      display:   "flex",
      flexDirection: "column",
    })}>
      {/* Header — always visible */}
      <div style={{ ...sectionLabel(hasAlerts ? (criticalCount > 0 ? "#ff4422" : "#ffcc00") : TOKEN.accent), marginBottom: "6px", flexShrink: 0 }}>
        <span>⚠</span>
        <span>COLLISION ALERTS</span>
        {hasAlerts && (
          <span style={{
            marginLeft:   "auto",
            background:   criticalCount > 0 ? "rgba(255,50,30,0.25)" : "rgba(255,200,0,0.2)",
            color:        criticalCount > 0 ? "#ff5533" : "#ffcc00",
            borderRadius: "10px",
            padding:      "1px 7px",
            fontSize:     "9px",
            fontWeight:   "700",
          }}>
            {alerts.length}
          </span>
        )}
      </div>

      {/* Body */}
      <div style={{ overflowY: "auto", flex: 1 }}>
        {!hasAlerts ? (
          <div style={{ color: TOKEN.textMuted, fontSize: "10px", padding: "2px 0" }}>
            No active alerts
          </div>
        ) : (
          alerts.map((a) => (
            <AlertRow key={a.id} alert={a} onDismiss={onDismiss} />
          ))
        )}
      </div>
    </div>
  );
});

export default Alerts;
