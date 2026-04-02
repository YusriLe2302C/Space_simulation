import { useRef, useEffect, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import * as THREE from "three";

import {
  MAX_SATELLITE_COUNT,
  YELLOW_THRESHOLD_KM,
  RED_THRESHOLD_KM,
  EARTH_RADIUS_UNITS,
} from "../../utils/constants";

const DEG2RAD = Math.PI / 180;

// ── Satellite icon texture (canvas-drawn once) ────────────────────────────────
function makeSatTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 32;
  const ctx = c.getContext("2d");
  const cx = 16, cy = 16;

  // Glow
  const g = ctx.createRadialGradient(cx, cy, 2, cx, cy, 14);
  g.addColorStop(0, "rgba(100,200,255,0.45)");
  g.addColorStop(1, "rgba(100,200,255,0)");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, 14, 0, Math.PI * 2);
  ctx.fill();

  // Solar panels — horizontal bar
  ctx.fillStyle = "#88ccff";
  ctx.fillRect(3, cy - 2, 26, 4);

  // Body — rotated square
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(Math.PI / 4);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(-4, -4, 8, 8);
  ctx.restore();

  return new THREE.CanvasTexture(c);
}

const SAT_TEXTURE   = makeSatTexture();
const COLOR_NOMINAL  = new THREE.Color(0x00aaff);
const COLOR_WARN     = new THREE.Color(0xffcc00);
const COLOR_CRITICAL = new THREE.Color(0xff2200);

function riskColor(sat) {
  const d = sat.miss_distance_km;
  if (d != null) {
    if (d < RED_THRESHOLD_KM)    return COLOR_CRITICAL;
    if (d < YELLOW_THRESHOLD_KM) return COLOR_WARN;
  }
  if (sat.status === "CRITICAL") return COLOR_CRITICAL;
  if (sat.status === "WARNING")  return COLOR_WARN;
  return COLOR_NOMINAL;
}

// ── Scratch objects — allocated once ─────────────────────────────────────────
const _matrix  = new THREE.Matrix4();
const _pos     = new THREE.Vector3();
const _quat    = new THREE.Quaternion();
const _scaleOn = new THREE.Vector3(1, 1, 1);
const _scaleOff= new THREE.Vector3(0, 0, 0);
const _origin  = new THREE.Vector3(0, 0, 0);

// ── Name label rendered as HTML overlay ──────────────────────────────────────
function SatLabel({ sat }) {
  const isCrit = sat.status === "CRITICAL";
  const isWarn = sat.status === "WARNING";
  const color  = isCrit ? "#ff4422" : isWarn ? "#ffcc00" : "#88ccff";
  return (
    <div style={{
      color,
      fontSize:      "9px",
      fontFamily:    "monospace",
      whiteSpace:    "nowrap",
      pointerEvents: "none",
      textShadow:    "0 0 4px rgba(0,0,0,0.95)",
      marginLeft:    "10px",
      marginTop:     "-4px",
      letterSpacing: "0.04em",
    }}>
      {sat.name ?? sat.id}
    </div>
  );
}

export default function Satellites({ satellitesRef }) {
  const meshRef     = useRef();
  const countRef    = useRef(0);
  const lastSatsRef = useRef(null);
  const [labels, setLabels] = useState([]);

  // ── Imperative mesh setup ─────────────────────────────────────────────────
  useEffect(() => {
    const geometry = new THREE.PlaneGeometry(0.2, 0.2);
    const material = new THREE.MeshBasicMaterial({
      map:         SAT_TEXTURE,
      transparent: true,
      depthWrite:  false,
      side:        THREE.DoubleSide,
    });

    const mesh = new THREE.InstancedMesh(geometry, material, MAX_SATELLITE_COUNT);
    mesh.frustumCulled = false;
    mesh.count = 0;

    _matrix.compose(_origin, _quat, _scaleOff);
    for (let i = 0; i < MAX_SATELLITE_COUNT; i++) mesh.setMatrixAt(i, _matrix);
    mesh.instanceMatrix.needsUpdate = true;

    const placeholder = meshRef.current;
    placeholder.parent.add(mesh);
    meshRef.current = mesh;

    return () => {
      geometry.dispose();
      material.dispose();
      placeholder?.parent?.remove(mesh);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Render loop ───────────────────────────────────────────────────────────
  useFrame(({ camera }) => {
    const mesh = meshRef.current;
    const sats = satellitesRef?.current;
    if (!mesh || !sats) return;

    if (sats === lastSatsRef.current) return;
    lastSatsRef.current = sats;

    const prev = countRef.current;
    const len  = Math.min(sats.length, MAX_SATELLITE_COUNT);
    const nextLabels = [];

    for (let i = 0; i < len; i++) {
      const sat = sats[i];
      const r   = EARTH_RADIUS_UNITS + (sat.alt ?? 400) / 1000;
      const phi   = (90 - sat.lat) * DEG2RAD;
      const theta = (sat.lon + 180) * DEG2RAD;
      const sinP  = Math.sin(phi);

      _pos.set(
         r * sinP * Math.cos(theta),
         r * Math.cos(phi),
        -r * sinP * Math.sin(theta),
      );

      // Billboard: always face the camera
      _quat.copy(camera.quaternion);

      _matrix.compose(_pos, _quat, _scaleOn);
      mesh.setMatrixAt(i, _matrix);
      mesh.setColorAt(i, riskColor(sat));

      nextLabels.push({ id: sat.id, pos: _pos.clone(), sat });
    }

    if (len < prev) {
      _matrix.compose(_origin, _quat, _scaleOff);
      for (let i = len; i < prev; i++) mesh.setMatrixAt(i, _matrix);
    }

    countRef.current = len;
    mesh.count = len;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

    setLabels(nextLabels);
  });

  return (
    <>
      <group ref={meshRef} />
      {labels.map((l) => (
        <Html key={l.id} position={[l.pos.x, l.pos.y, l.pos.z]} zIndexRange={[0, 10]}>
          <SatLabel sat={l.sat} />
        </Html>
      ))}
    </>
  );
}
