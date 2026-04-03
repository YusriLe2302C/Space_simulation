import { memo, useState, useCallback, useMemo } from "react";
import useSimulationStore from "../../store/simulationStore";
import { panel, sectionLabel, TOKEN } from "./Dashboard";

const COOLDOWN_S    = 600;
const GANTT_W       = 260;
const ROW_H         = 18;
const LABEL_W       = 60;
const INNER_W       = GANTT_W - LABEL_W;
const WINDOW_S      = 7200;   // 2-hour view window

const EVENT_COLOR = {
  cola:            "#ff9922",
  station_keeping: "#44aaff",
  graveyard:       "#cc2200",
  manual:          "#cc88ff",
};

function typeColor(type) {
  return EVENT_COLOR[type] ?? "#778899";
}

const selectEvents    = (s) => s.events;
const selectTimestamp = (s) => s.timestamp;

const GanttTimeline = memo(function GanttTimeline() {
  const events    = useSimulationStore(selectEvents);
  const timestamp = useSimulationStore(selectTimestamp);
  const [filter, setFilter] = useState(null);

  const nowMs = timestamp ? new Date(timestamp).getTime() : Date.now();
  const windowStartMs = nowMs - WINDOW_S * 500;   // center now in window
  const windowEndMs   = windowStartMs + WINDOW_S * 1000;

  // Group events by satelliteId
  const bySat = useMemo(() => {
    const map = new Map();
    const src = filter ? events.filter((e) => e.type === filter) : events;
    for (const e of src) {
      const sid = e.satelliteId ?? "unknown";
      if (!map.has(sid)) map.set(sid, []);
      map.get(sid).push(e);
    }
    return map;
  }, [events, filter]);

  const satIds = [...bySat.keys()].slice(0, 8);  // max 8 rows

  const toX = (ms) =>
    LABEL_W + ((ms - windowStartMs) / (windowEndMs - windowStartMs)) * INNER_W;

  const svgH = Math.max(40, satIds.length * ROW_H + 20);

  // Tick marks every 30 min
  const ticks = [];
  for (let t = windowStartMs; t <= windowEndMs; t += 1800_000) {
    ticks.push(t);
  }

  const types = [...new Set(events.map((e) => e.type))];

  return (
    <div style={panel({ padding: "8px 10px" })}>
      <div style={{ ...sectionLabel(), marginBottom: "4px" }}>
        <span>📅</span>
        <span>MANEUVER GANTT</span>
        <span style={{ marginLeft: "auto", color: TOKEN.textDim, fontSize: "9px" }}>±1h window</span>
      </div>

      {/* Filter tabs */}
      {types.length > 1 && (
        <div style={{ display: "flex", gap: "4px", flexWrap: "wrap", marginBottom: "5px" }}>
          <button onClick={() => setFilter(null)} style={tabStyle(filter === null, TOKEN.accent)}>ALL</button>
          {types.map((t) => (
            <button key={t} onClick={() => setFilter(t)} style={tabStyle(filter === t, typeColor(t))}>
              {t.toUpperCase().slice(0, 4)}
            </button>
          ))}
        </div>
      )}

      <svg width={GANTT_W} height={svgH} style={{ display: "block", overflow: "visible" }}>
        {/* Time axis ticks */}
        {ticks.map((t) => {
          const x = toX(t);
          if (x < LABEL_W || x > GANTT_W) return null;
          const label = new Date(t).toISOString().slice(11, 16);
          return (
            <g key={t}>
              <line x1={x} y1={0} x2={x} y2={svgH - 12}
                stroke="rgba(0,170,255,0.1)" strokeWidth={0.5} />
              <text x={x} y={svgH - 2} fill={TOKEN.textDim}
                fontSize="6" textAnchor="middle" fontFamily="monospace">{label}</text>
            </g>
          );
        })}

        {/* NOW line */}
        {(() => {
          const nx = toX(nowMs);
          return nx >= LABEL_W && nx <= GANTT_W ? (
            <line x1={nx} y1={0} x2={nx} y2={svgH - 12}
              stroke="rgba(34,153,238,0.6)" strokeWidth={1} strokeDasharray="3,2" />
          ) : null;
        })()}

        {/* Rows */}
        {satIds.map((sid, rowIdx) => {
          const y = rowIdx * ROW_H + 4;
          const rowEvents = bySat.get(sid) ?? [];

          return (
            <g key={sid}>
              {/* Row background */}
              <rect x={0} y={y} width={GANTT_W} height={ROW_H - 2}
                fill={rowIdx % 2 === 0 ? "rgba(255,255,255,0.02)" : "transparent"} />

              {/* Satellite label */}
              <text x={2} y={y + ROW_H - 6} fill={TOKEN.textDim}
                fontSize="7" fontFamily="monospace"
                style={{ overflow: "hidden" }}>
                {sid.slice(-8)}
              </text>

              {rowEvents.map((ev, i) => {
                const evMs  = ev.timestamp ? new Date(ev.timestamp).getTime() : nowMs;
                const x1    = Math.max(LABEL_W, toX(evMs));
                const burnW = Math.max(2, (30_000 / (windowEndMs - windowStartMs)) * INNER_W); // 30s burn
                const coolW = (COOLDOWN_S * 1000 / (windowEndMs - windowStartMs)) * INNER_W;
                const color = typeColor(ev.type);
                const x2cool = x1 + burnW;
                // hasLOS=false means the burn was queued during a blackout window
                const noLos = ev.hasLOS === false;

                if (x1 > GANTT_W) return null;

                return (
                  <g key={i}>
                    {/* Blackout zone flag — red hatched rect behind burn block */}
                    {noLos && (
                      <>
                        <rect x={x1 - 2} y={y + 1} width={burnW + 4} height={ROW_H - 4}
                          fill="rgba(255,30,30,0.18)" stroke="#ff3322" strokeWidth={0.8}
                          strokeDasharray="2,2" rx={1} />
                        <text x={x1 + burnW + 3} y={y + ROW_H - 7}
                          fill="#ff3322" fontSize="6" fontFamily="monospace">NO LOS</text>
                      </>
                    )}
                    {/* Burn block */}
                    <rect x={x1} y={y + 2} width={Math.min(burnW, GANTT_W - x1)}
                      height={ROW_H - 6} fill={color} opacity={0.85} rx={1} />
                    {/* Cooldown block */}
                    {x2cool < GANTT_W && (
                      <rect x={x2cool} y={y + 4}
                        width={Math.min(coolW, GANTT_W - x2cool)}
                        height={ROW_H - 10}
                        fill={color} opacity={0.2} rx={1} />
                    )}
                    {/* Cooldown label */}
                    {coolW > 20 && x2cool < GANTT_W - 10 && (
                      <text x={x2cool + 3} y={y + ROW_H - 7}
                        fill={color} fontSize="6" fontFamily="monospace" opacity={0.7}>
                        600s
                      </text>
                    )}
                  </g>
                );
              })}
            </g>
          );
        })}

        {satIds.length === 0 && (
          <text x={GANTT_W / 2} y={svgH / 2} fill={TOKEN.textMuted}
            fontSize="9" textAnchor="middle" fontFamily="monospace">
            Awaiting maneuver events…
          </text>
        )}
      </svg>

      {/* Legend */}
      <div style={{ display: "flex", gap: "8px", marginTop: "4px", flexWrap: "wrap" }}>
        {Object.entries(EVENT_COLOR).map(([type, color]) => (
          <span key={type} style={{ fontSize: "8px", color, fontFamily: TOKEN.fontMono }}>
            ■ {type.toUpperCase().slice(0, 4)}
          </span>
        ))}
        <span style={{ fontSize: "8px", color: "rgba(255,255,255,0.2)", fontFamily: TOKEN.fontMono }}>
          ░ 600s cooldown
        </span>
        <span style={{ fontSize: "8px", color: "#ff3322", fontFamily: TOKEN.fontMono }}>
          ▨ NO LOS
        </span>
      </div>
    </div>
  );
});

function tabStyle(active, color) {
  return {
    background:   active ? `rgba(255,255,255,0.08)` : "transparent",
    border:       `1px solid ${active ? color + "66" : "transparent"}`,
    borderRadius: "3px",
    color:        active ? color : TOKEN.textDim,
    cursor:       "pointer",
    fontSize:     "8px",
    fontWeight:   "700",
    fontFamily:   TOKEN.fontMono,
    padding:      "1px 5px",
  };
}

export default GanttTimeline;
