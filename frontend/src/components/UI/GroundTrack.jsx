import { useEffect, useRef, memo } from "react";
import { positionStore } from "../../store/simulationStore";
import useSimulationStore from "../../store/simulationStore";
import { panel, sectionLabel, TOKEN } from "./Dashboard";

const W = 400;
const H = 200;
const TRAIL_MAX = 60; // store up to 60 historical positions per satellite (~90 min at 1 pos/90s)

// Historical trail store — plain object, not React state (no re-render overhead)
const _trailStore = {}; // { [satId]: [{lon, lat}] }

function updateTrails(sats) {
  for (const sat of sats) {
    if (sat.lon == null || sat.lat == null) continue;
    if (!_trailStore[sat.id]) _trailStore[sat.id] = [];
    const trail = _trailStore[sat.id];
    const last = trail[trail.length - 1];
    // Only append if position changed meaningfully
    if (!last || Math.abs(last.lon - sat.lon) > 0.01 || Math.abs(last.lat - sat.lat) > 0.01) {
      trail.push({ lon: sat.lon, lat: sat.lat });
      if (trail.length > TRAIL_MAX) trail.shift();
    }
  }
}

// True Web Mercator projection (EPSG:3857)
// Latitude is clamped to ±85.051129° (standard Mercator limit)
const MERC_LAT_MAX = 85.051129;

function mercatorY(lat) {
  const phi = Math.max(-MERC_LAT_MAX, Math.min(MERC_LAT_MAX, lat)) * (Math.PI / 180);
  return Math.log(Math.tan(Math.PI / 4 + phi / 2));
}

const _MERC_TOP = mercatorY(MERC_LAT_MAX);
const _MERC_BOT = mercatorY(-MERC_LAT_MAX);
const _MERC_RNG = _MERC_TOP - _MERC_BOT;

function lonLatToXY(lon, lat) {
  const x = ((lon + 180) / 360) * W;
  const y = (1 - (mercatorY(lat) - _MERC_BOT) / _MERC_RNG) * H;
  return [x, y];
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

      // Grid — longitude lines evenly spaced, latitude lines via Mercator y
      ctx.strokeStyle = "rgba(0,170,255,0.08)";
      ctx.lineWidth = 0.5;
      for (let lon = -180; lon <= 180; lon += 30) {
        const x = ((lon + 180) / 360) * W;
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
      }
      for (let lat = -60; lat <= 60; lat += 30) {
        const [, y] = lonLatToXY(0, lat);
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
      }

      // Equator label — use Mercator y for lat=0
      const [, equatorY] = lonLatToXY(0, 0);
      ctx.fillStyle = "rgba(0,170,255,0.3)";
      ctx.font = "8px monospace";
      ctx.fillText("0°", 2, equatorY - 2);

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

      // Update historical trails
      updateTrails(sats);

      // Historical trails (solid dim line)
      for (const sat of sats) {
        const trail = _trailStore[sat.id];
        if (!trail || trail.length < 2) continue;
        ctx.strokeStyle = "rgba(0,170,255,0.35)";
        ctx.lineWidth = 1;
        ctx.setLineDash([]);
        ctx.beginPath();
        let prevX = null;
        for (const pt of trail) {
          const [x, y] = lonLatToXY(pt.lon, pt.lat);
          if (prevX !== null && Math.abs(x - prevX) > W * 0.4) {
            ctx.stroke(); ctx.beginPath();
          }
          prevX === null ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
          prevX = x;
        }
        ctx.stroke();
      }

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
          Mercator · trail + predicted
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
