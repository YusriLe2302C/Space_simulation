import { memo, useState, useCallback, useMemo } from "react";
import useSimulationStore from "../../store/simulationStore";
import { panel, sectionLabel, TOKEN } from "./Dashboard";

// ── Event type config ─────────────────────────────────────────────────────────
const EVENT_TYPE = {
  cola:            { label: "COLA",  color: "#ff9922", bg: "rgba(255,140,0,0.12)"  },
  station_keeping: { label: "SK",    color: "#44aaff", bg: "rgba(40,140,255,0.1)"  },
  graveyard:       { label: "GY",    color: "#cc2200", bg: "rgba(180,20,0,0.15)"   },
  manual:          { label: "MAN",   color: "#cc88ff", bg: "rgba(160,80,255,0.1)"  },
  collision:       { label: "COLL",  color: "#ff3322", bg: "rgba(255,40,20,0.12)"  },
};

const ALL_FILTER = "ALL";

function typeConfig(type) {
  return EVENT_TYPE[type] ?? { label: (type ?? "EVT").toUpperCase().slice(0, 4), color: "#778899", bg: "rgba(100,120,140,0.1)" };
}

// ── Filter tab button ─────────────────────────────────────────────────────────
const FilterTab = memo(function FilterTab({ label, active, color, count, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        background:   active ? `rgba(${hexToRgb(color)},0.18)` : "transparent",
        border:       active ? `1px solid ${color}44` : "1px solid transparent",
        borderRadius: "3px",
        color:        active ? color : TOKEN.textDim,
        cursor:       "pointer",
        fontSize:     "9px",
        fontWeight:   "700",
        fontFamily:   TOKEN.fontMono,
        padding:      "2px 6px",
        letterSpacing: "0.05em",
        transition:   "all 0.15s",
      }}
    >
      {label}{count != null ? ` (${count})` : ""}
    </button>
  );
});

// Minimal hex→rgb for rgba() usage in filter tabs
function hexToRgb(hex) {
  const n = parseInt(hex.replace("#", ""), 16);
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
}

// ── Single event row ──────────────────────────────────────────────────────────
const EventRow = memo(function EventRow({ event }) {
  const cfg  = typeConfig(event.type);
  const time = event.timestamp
    ? new Date(event.timestamp).toISOString().slice(11, 19)
    : null;

  return (
    <div style={{
      padding:      "5px 6px",
      borderRadius: "3px",
      background:   cfg.bg,
      marginBottom: "4px",
    }}>
      {/* Top row: badge + satellite + time */}
      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
        <span style={{
          color:        cfg.color,
          fontSize:     "8px",
          fontWeight:   "700",
          minWidth:     "30px",
          letterSpacing: "0.04em",
          flexShrink:   0,
        }}>
          {cfg.label}
        </span>
        <span style={{
          color:        TOKEN.text,
          fontSize:     "10px",
          flex:         1,
          overflow:     "hidden",
          textOverflow: "ellipsis",
          whiteSpace:   "nowrap",
        }}>
          {event.satelliteId ?? "—"}
        </span>
        {time && (
          <span style={{
            color:              TOKEN.textDim,
            fontSize:           "9px",
            flexShrink:         0,
            fontVariantNumeric: "tabular-nums",
          }}>
            {time}
          </span>
        )}
      </div>

      {/* Reasoning row — only shown when backend provides it */}
      {event.reasoning && (
        <div style={{
          marginTop:  "3px",
          fontSize:   "9px",
          color:      TOKEN.textDim,
          wordBreak:  "break-all",
          lineHeight: "1.4",
        }}>
          {event.reasoning}
        </div>
      )}
    </div>
  );
});

// ── Selectors ─────────────────────────────────────────────────────────────────
const selectEvents = (s) => s.events;

// ── Timeline ──────────────────────────────────────────────────────────────────
const Timeline = memo(function Timeline() {
  const events = useSimulationStore(selectEvents);
  const [filter, setFilter] = useState(ALL_FILTER);

  // Derive available types and counts from current events
  const typeCounts = useMemo(() => {
    const counts = {};
    for (const e of events) {
      counts[e.type] = (counts[e.type] ?? 0) + 1;
    }
    return counts;
  }, [events]);

  const filtered = useMemo(
    () => filter === ALL_FILTER ? events : events.filter((e) => e.type === filter),
    [events, filter],
  );

  const onFilter = useCallback((type) => setFilter(type), []);

  const availableTypes = Object.keys(typeCounts);

  return (
    <div style={panel({ height: "220px", display: "flex", flexDirection: "column" })}>
      {/* Header */}
      <div style={{ ...sectionLabel(), flexShrink: 0, marginBottom: "6px" }}>
        <span>📋</span>
        <span>EVENT LOG</span>
        <span style={{ marginLeft: "auto", color: TOKEN.textDim, fontSize: "9px", fontWeight: "400" }}>
          {events.length} events
        </span>
      </div>

      {/* Filter tabs — only shown when there are multiple event types */}
      {availableTypes.length > 1 && (
        <div style={{ display: "flex", gap: "4px", flexWrap: "wrap", marginBottom: "6px", flexShrink: 0 }}>
          <FilterTab
            label="ALL"
            active={filter === ALL_FILTER}
            color={TOKEN.accent}
            count={events.length}
            onClick={() => onFilter(ALL_FILTER)}
          />
          {availableTypes.map((type) => {
            const cfg = typeConfig(type);
            return (
              <FilterTab
                key={type}
                label={cfg.label}
                active={filter === type}
                color={cfg.color}
                count={typeCounts[type]}
                onClick={() => onFilter(type)}
              />
            );
          })}
        </div>
      )}

      {/* Event list */}
      <div style={{ overflowY: "auto", flex: 1 }}>
        {filtered.length === 0 ? (
          <div style={{ color: TOKEN.textMuted, fontSize: "10px", padding: "2px 0" }}>
            {events.length === 0 ? "Awaiting events…" : "No events match filter"}
          </div>
        ) : (
          filtered.map((e, i) => <EventRow key={e.id ?? i} event={e} />)
        )}
      </div>
    </div>
  );
});

export default Timeline;
