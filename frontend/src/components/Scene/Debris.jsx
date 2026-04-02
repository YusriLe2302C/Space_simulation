import { useRef, useEffect } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

import {
  MAX_DEBRIS_COUNT,
  COLOR_DEBRIS_NOMINAL,
  COLOR_DEBRIS_WARN,
  COLOR_DEBRIS_CRITICAL,
  YELLOW_THRESHOLD_KM,
  RED_THRESHOLD_KM,
} from "../../utils/constants";
import { writeXYZToBuffer } from "../../utils/coordinateUtils";

const OFF_SCREEN = 2000;

// Pre-extract RGB floats for each risk level — done once, not per frame
function hexToRgb(hex) {
  return [
    ((hex >> 16) & 0xff) / 255,
    ((hex >>  8) & 0xff) / 255,
    ( hex        & 0xff) / 255,
  ];
}
const RGB_NOMINAL   = hexToRgb(COLOR_DEBRIS_NOMINAL);
const RGB_WARN      = hexToRgb(COLOR_DEBRIS_WARN);
const RGB_CRITICAL  = hexToRgb(COLOR_DEBRIS_CRITICAL);

function riskRgb(miss_distance_km) {
  if (miss_distance_km == null)              return RGB_NOMINAL;
  if (miss_distance_km < RED_THRESHOLD_KM)   return RGB_CRITICAL;
  if (miss_distance_km < YELLOW_THRESHOLD_KM) return RGB_WARN;
  return RGB_NOMINAL;
}

const DEBRIS_MATERIAL = new THREE.PointsMaterial({
  size:            0.015,
  vertexColors:    true,
  sizeAttenuation: true,
  transparent:     true,
  opacity:         0.75,
  depthWrite:      false,
});

/**
 * Debris — renders up to MAX_DEBRIS_COUNT points in ONE draw call.
 *
 * GPU contract:
 *  - BufferGeometry + both BufferAttributes created imperatively once.
 *    JSX reconciliation never touches the geometry after mount.
 *  - posArray / colorArray are Float32Arrays allocated once, never reallocated.
 *  - useFrame only runs the write loop when debrisRef.current reference changes
 *    (i.e. when the backend sends new data, ~1 Hz). Between ticks: zero CPU,
 *    zero GPU uploads.
 *  - Color buffer uploaded to GPU exactly once (initial grey fill).
 *    needsUpdate on color is never set again unless risk coloring is added.
 *  - Stale slots are moved to OFF_SCREEN, not (0,0,0), to avoid a visible
 *    cluster inside the Earth mesh.
 *  - Geometry disposed on unmount — no GPU VBO leak.
 */
export default function Debris({ debrisRef }) {
  const pointsRef    = useRef();
  const posAttrRef   = useRef();
  const colorAttrRef = useRef();   // THREE.BufferAttribute for colors
  const countRef     = useRef(0);
  const lastCloudRef = useRef(null);

  // ── Typed arrays — allocated once, never reallocated ─────────────────────
  // Defined outside useEffect so they are available synchronously in useFrame
  // from the very first tick, before any effect has run.
  const posArray   = useRef(null);
  const colorArray = useRef(null);

  if (!posArray.current) {
    // Initialise on first render — synchronous, no async gap
    posArray.current   = new Float32Array(MAX_DEBRIS_COUNT * 3);
    colorArray.current = new Float32Array(MAX_DEBRIS_COUNT * 3);

    // Pre-fill positions with OFF_SCREEN so unwritten slots are invisible
    for (let i = 0; i < MAX_DEBRIS_COUNT; i++) {
      posArray.current[i * 3]     = OFF_SCREEN;
      posArray.current[i * 3 + 1] = OFF_SCREEN;
      posArray.current[i * 3 + 2] = OFF_SCREEN;
    }

    // Pre-fill colors with nominal grey
    for (let i = 0; i < MAX_DEBRIS_COUNT; i++) {
      colorArray.current[i * 3]     = RGB_NOMINAL[0];
      colorArray.current[i * 3 + 1] = RGB_NOMINAL[1];
      colorArray.current[i * 3 + 2] = RGB_NOMINAL[2];
    }
  }

  // ── Imperative geometry setup ─────────────────────────────────────────────
  // Created once after mount. Bypasses JSX reconciliation entirely —
  // R3F never needs to diff or patch these attributes.
  useEffect(() => {
    const geo = new THREE.BufferGeometry();

    const posAttr   = new THREE.BufferAttribute(posArray.current,   3);
    const colorAttr = new THREE.BufferAttribute(colorArray.current, 3);

    // Both position and color update on every WS tick now
    posAttr.usage   = THREE.DynamicDrawUsage;
    colorAttr.usage = THREE.DynamicDrawUsage;

    geo.setAttribute("position", posAttr);
    geo.setAttribute("color",    colorAttr);

    // Draw range starts at 0 — no points visible until first data tick
    geo.setDrawRange(0, 0);

    // Attach geometry and material to the Points object imperatively
    const points = pointsRef.current;
    points.geometry = geo;
    points.material = DEBRIS_MATERIAL;

    // Store refs for useFrame
    posAttrRef.current   = posAttr;
    colorAttrRef.current = colorAttr;

    // Initial grey upload
    colorAttr.needsUpdate = true;

    return () => {
      // Dispose GPU VBO on unmount — prevents memory leak
      geo.dispose();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Render loop ───────────────────────────────────────────────────────────
  useFrame(() => {
    const cloud    = debrisRef?.current;
    const posAttr  = posAttrRef.current;
    const colorAttr = colorAttrRef.current;
    if (!cloud || !posAttr || !colorAttr) return;

    if (cloud === lastCloudRef.current) return;
    lastCloudRef.current = cloud;

    const prev = countRef.current;
    const len  = Math.min(cloud.length, MAX_DEBRIS_COUNT);

    for (let i = 0; i < len; i++) {
      // debris_cloud format: [id, lat, lon, alt, miss_distance_km?]
      const item = cloud[i];
      writeXYZToBuffer(posArray.current, i * 3, item[1], item[2], item[3] ?? 400);

      // Risk coloring: item[4] is optional miss_distance_km from backend
      const rgb = riskRgb(item[4]);
      const c   = i * 3;
      colorArray.current[c]     = rgb[0];
      colorArray.current[c + 1] = rgb[1];
      colorArray.current[c + 2] = rgb[2];
    }

    if (len < prev) {
      for (let i = len; i < prev; i++) {
        const o = i * 3;
        posArray.current[o]     = OFF_SCREEN;
        posArray.current[o + 1] = OFF_SCREEN;
        posArray.current[o + 2] = OFF_SCREEN;
        colorArray.current[o]     = RGB_NOMINAL[0];
        colorArray.current[o + 1] = RGB_NOMINAL[1];
        colorArray.current[o + 2] = RGB_NOMINAL[2];
      }
    }

    countRef.current = len;

    posAttr.needsUpdate   = true;
    colorAttr.needsUpdate = true;

    pointsRef.current.geometry.setDrawRange(0, len);
  });

  // Render a bare primitive — geometry and material are attached imperatively
  // in useEffect above. React never reconciles the geometry children.
  return <points ref={pointsRef} frustumCulled={false} />;
}
