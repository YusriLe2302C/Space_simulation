import { useEffect, useRef, memo } from "react";
import { positionStore } from "../../store/simulationStore";
import useSimulationStore from "../../store/simulationStore";
import { panel, sectionLabel, TOKEN } from "./Dashboard";

const W = 400;
const H = 200;

function lonLatToXY(lon, lat) {
  return [
    ((lon + 180) / 360) * W,
    ((90 - lat) / 180) * H,
  ];
}

// Approximate sun longitude: moves 360° per 86400 seconds
function sunLon(simTimestamp) {
  if (!simTimestamp) return 0;
  const t = new Date(simTimestamp).getTime() / 1000;
  return ((t / 86400) * 360) % 360;
}

const selectTimestamp    = (s) => s.timestamp;
const selectConjunctions = (s) => s.conjunctions;

const GroundTrack = memo(function GroundTrack() {
  const canvasRef    = useRef();
  const animRef      = useRef();
  const timestamp    = useSimulationStore(selectTimestamp);
  const conjunctions = useSimulationStore(selectConjunctions);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");

    function draw() {
      ctx.clearRect(0, 0, W, H);

      // Background
      ctx.fillStyle = "#050f1a";
      ctx.fillRect(0, 0, W, H);

      // Grid
      ctx.strokeStyle = "rgba(0,170,255,0.08)";
      ctx.lineWidth = 0.5;
      for (let lon = -180; lon <= 180; lon += 30) {
        const x = ((lon + 180) / 360) * W;
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
      }
      for (let lat = -90; lat <= 90; lat += 30) {
        const y = ((90 - lat) / 180) * H;
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
      }

      // Equator label
      ctx.fillStyle = "rgba(0,170,255,0.3)";
      ctx.font = "8px monospace";
      ctx.fillText("0°", 2, H / 2 - 2);

      // Terminator (approximate day/night gradient)
      const sLon  = sunLon(timestamp);
      const nightX = (((sLon + 270) % 360) / 360) * W;
      const grad = ctx.createLinearGradient(nightX, 0, (nightX + W / 2) % W, 0);
      grad.addColorStop(0,   "rgba(0,0,0,0)");
      grad.addColorStop(0.4, "rgba(0,0,0,0.3)");
      grad.addColorStop(0.6, "rgba(0,0,0,0.3)");
      grad.addColorStop(1,   "rgba(0,0,0,0)");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, H);

      const sats = positionStore.satellites ?? [];

      // Orbit paths
      for (const sat of sats) {
        if (!sat.orbit_path?.length) continue;
        ctx.strokeStyle = "rgba(0,170,255,0.2)";
        ctx.lineWidth = 0.8;
        ctx.setLineDash([]);
        ctx.beginPath();
        let prevX = null;
        for (const wp of sat.orbit_path) {
          const [x, y] = lonLatToXY(wp.lon, wp.lat);
          // Break line at antimeridian wrap-around
          if (prevX !== null && Math.abs(x - prevX) > W * 0.4) {
            ctx.stroke();
            ctx.beginPath();
          }
          prevX === null ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
          prevX = x;
        }
        ctx.stroke();
      }

      // Conjunction lines between at-risk pairs
      ctx.setLineDash([3, 3]);
      for (const c of (conjunctions ?? [])) {
        const satA = sats.find((s) => s.id === c.a);
        const satB = sats.find((s) => s.id === c.b);
        if (!satA || !satB) continue;
        const [ax, ay] = lonLatToXY(satA.lon ?? 0, satA.lat ?? 0);
        const [bx, by] = lonLatToXY(satB.lon ?? 0, satB.lat ?? 0);
        ctx.strokeStyle = c.time_to_event_s < 3600
          ? "rgba(255,50,30,0.7)"
          : "rgba(255,160,0,0.5)";
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
      }
      ctx.setLineDash([]);

      // Satellite dots + labels
      const riskIds   = new Set((conjunctions ?? []).filter(c => c.time_to_event_s < 3600).flatMap(c => [c.a, c.b]));
      const warnIds   = new Set((conjunctions ?? []).filter(c => c.time_to_event_s < 86400).flatMap(c => [c.a, c.b]));
      for (const sat of sats) {
        const [x, y] = lonLatToXY(sat.lon ?? 0, sat.lat ?? 0);
        const isCrit = riskIds.has(sat.id);
        const isWarn = warnIds.has(sat.id);
        ctx.fillStyle = isCrit ? "#ff3322" : isWarn ? "#ffcc00" : "#2299ee";
        ctx.beginPath();
        ctx.arc(x, y, isCrit ? 5 : isWarn ? 4 : 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = TOKEN.text;
        ctx.font = "8px monospace";
        ctx.fillText(sat.name ?? sat.id ?? "", x + 5, y - 3);
      }

      animRef.current = requestAnimationFrame(draw);
    }

    draw();
    return () => cancelAnimationFrame(animRef.current);
  // Re-run when timestamp or conjunctions change so terminator + lines update
  }, [timestamp, conjunctions]);

  return (
    <div style={panel({ padding: "8px 10px" })}>
      <div style={{ ...sectionLabel(), marginBottom: "6px" }}>
        <span>🌍</span>
        <span>GROUND TRACK</span>
        <span style={{ marginLeft: "auto", color: TOKEN.textDim, fontSize: "9px" }}>
          equirectangular · 90 min orbit
        </span>
      </div>
      <canvas
        ref={canvasRef}
        width={W}
        height={H}
        style={{ width: "100%", borderRadius: "3px", display: "block" }}
      />
    </div>
  );
});

export default GroundTrack;
