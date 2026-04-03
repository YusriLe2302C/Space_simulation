import { memo, useMemo } from "react";
import useSimulationStore from "../../store/simulationStore";
import { panel, sectionLabel, TOKEN } from "./Dashboard";

const W = 260;
const H = 80;
const PAD = { top: 8, right: 8, bottom: 18, left: 28 };

const selectDvHistory      = (s) => s.dvHistory;
const selectManeuversTotal = (s) => s.maneuversTotal;
const selectCollisions     = (s) => s.collisionsTotal;

const DvGraph = memo(function DvGraph() {
  const history         = useSimulationStore(selectDvHistory);
  const maneuversTotal  = useSimulationStore(selectManeuversTotal);
  const collisionsTotal = useSimulationStore(selectCollisions);

  const points = useMemo(() => {
    if (!history.length) return [];
    let cumManeuvers = 0;
    let cumCollisions = 0;
    return history.map((h) => {
      cumManeuvers  += h.maneuvers ?? 0;
      cumCollisions += h.collisionsAvoided ?? 0;
      return { x: cumManeuvers, y: cumCollisions };
    });
  }, [history]);

  const maxX = Math.max(1, points.length ? points[points.length - 1].x : 1);
  const maxY = Math.max(1, ...points.map((p) => p.y));

  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top  - PAD.bottom;

  const toSvg = (x, y) => [
    PAD.left + (x / maxX) * innerW,
    PAD.top  + innerH - (y / maxY) * innerH,
  ];

  const pathD = points.length < 2 ? "" : points.map((p, i) => {
    const [sx, sy] = toSvg(p.x, p.y);
    return `${i === 0 ? "M" : "L"}${sx.toFixed(1)},${sy.toFixed(1)}`;
  }).join(" ");

  return (
    <div style={panel({ padding: "8px 10px" })}>
      <div style={{ ...sectionLabel(), marginBottom: "4px" }}>
        <span>📈</span>
        <span>ΔV COST vs COLLISIONS AVOIDED</span>
      </div>

      <svg width={W} height={H} style={{ display: "block", overflow: "visible" }}>
        {/* Axes */}
        <line x1={PAD.left} y1={PAD.top} x2={PAD.left} y2={PAD.top + innerH}
          stroke="rgba(0,170,255,0.3)" strokeWidth={0.8} />
        <line x1={PAD.left} y1={PAD.top + innerH} x2={PAD.left + innerW} y2={PAD.top + innerH}
          stroke="rgba(0,170,255,0.3)" strokeWidth={0.8} />

        {/* Axis labels */}
        <text x={PAD.left + innerW / 2} y={H - 2} fill={TOKEN.textDim}
          fontSize="7" textAnchor="middle" fontFamily="monospace">Maneuvers Executed</text>
        <text x={6} y={PAD.top + innerH / 2} fill={TOKEN.textDim}
          fontSize="7" textAnchor="middle" fontFamily="monospace"
          transform={`rotate(-90,6,${PAD.top + innerH / 2})`}>Avoided</text>

        {/* Grid lines */}
        {[0.25, 0.5, 0.75, 1.0].map((f) => {
          const y = PAD.top + innerH - f * innerH;
          return (
            <g key={f}>
              <line x1={PAD.left} y1={y} x2={PAD.left + innerW} y2={y}
                stroke="rgba(255,255,255,0.04)" strokeWidth={0.5} />
              <text x={PAD.left - 3} y={y + 3} fill={TOKEN.textDim}
                fontSize="6" textAnchor="end" fontFamily="monospace">
                {Math.round(f * maxY)}
              </text>
            </g>
          );
        })}

        {/* Data line */}
        {pathD && (
          <path d={pathD} fill="none" stroke="#22cc66" strokeWidth={1.5}
            strokeLinejoin="round" strokeLinecap="round" />
        )}

        {/* Latest point dot */}
        {points.length > 0 && (() => {
          const last = points[points.length - 1];
          const [lx, ly] = toSvg(last.x, last.y);
          return <circle cx={lx} cy={ly} r={3} fill="#22cc66" />;
        })()}

        {/* No data label */}
        {points.length === 0 && (
          <text x={W / 2} y={H / 2} fill={TOKEN.textMuted}
            fontSize="9" textAnchor="middle" fontFamily="monospace">
            Awaiting maneuver data…
          </text>
        )}
      </svg>

      {/* Summary row */}
      <div style={{ display: "flex", gap: "12px", marginTop: "4px", fontSize: "9px", color: TOKEN.textDim }}>
        <span>Burns: <span style={{ color: "#ffaa22" }}>{maneuversTotal}</span></span>
        <span>Collisions avoided: <span style={{ color: "#22cc66" }}>{collisionsTotal}</span></span>
        {maneuversTotal > 0 && (
          <span>Efficiency: <span style={{ color: TOKEN.accent }}>
            {(collisionsTotal / maneuversTotal).toFixed(2)}
          </span></span>
        )}
      </div>
    </div>
  );
});

export default DvGraph;
