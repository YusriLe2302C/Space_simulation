import { useRef, useEffect } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { latLonAltToXYZ } from "../../utils/coordinateUtils";

// ── Color constants — allocated once ─────────────────────────────────────────
const COLOR_ACTIVE   = new THREE.Color(0xffaa00); // executing maneuver
const COLOR_PLANNED  = new THREE.Color(0x00ffcc); // scheduled maneuver

// ── Material pool ─────────────────────────────────────────────────────────────
// Two shared materials — one per status. Reused across all arcs so we never
// allocate a new material per maneuver.
const MAT_ACTIVE  = new THREE.LineBasicMaterial({ color: COLOR_ACTIVE,  transparent: true, opacity: 0.7 });
const MAT_PLANNED = new THREE.LineBasicMaterial({ color: COLOR_PLANNED, transparent: true, opacity: 0.6 });

/**
 * Build a BufferGeometry from an array of {lat, lon, alt} waypoints.
 * Returns null if fewer than 2 waypoints (can't draw a line).
 */
function buildArcGeometry(waypoints) {
  if (!waypoints || waypoints.length < 2) return null;
  const positions = new Float32Array(waypoints.length * 3);
  for (let i = 0; i < waypoints.length; i++) {
    const [x, y, z] = latLonAltToXYZ(
      waypoints[i].lat,
      waypoints[i].lon,
      waypoints[i].alt ?? 400,
    );
    positions[i * 3]     = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  return geo;
}

/**
 * OrbitPath — fully imperative, zero React state.
 *
 * Receives maneuversRef (a plain ref) instead of a maneuvers array prop.
 * Reads the ref inside useFrame and syncs the Three.js scene graph directly:
 *   - Adds THREE.Line objects for new maneuvers
 *   - Removes THREE.Line objects for completed/removed maneuvers
 *   - Disposes geometries on removal to prevent GPU VBO leaks
 *
 * No setState. No React re-renders. No reconciliation pass mid-frame.
 * The group node is mutated imperatively — React never sees the children.
 */
export default function OrbitPath({ maneuversRef }) {
  const groupRef = useRef();

  // Map<maneuver.id, THREE.Line> — tracks which lines are currently in the scene
  const linesRef = useRef(new Map());

  // Track the last maneuvers array reference to skip work when unchanged
  const lastManeuversRef = useRef(null);

  // Dispose all lines and clear the map on unmount
  useEffect(() => {
    return () => {
      for (const line of linesRef.current.values()) {
        line.geometry.dispose();
        groupRef.current?.remove(line);
      }
      linesRef.current.clear();
    };
  }, []);

  useFrame(() => {
    const group     = groupRef.current;
    const maneuvers = maneuversRef?.current;

    // Guard 1: group not yet mounted
    if (!group) return;

    // Guard 2: maneuvers array reference unchanged — nothing to do
    if (maneuvers === lastManeuversRef.current) return;
    lastManeuversRef.current = maneuvers;

    const lines    = linesRef.current;
    const incoming = maneuvers ?? [];

    // Build a set of IDs present in the new payload for O(1) lookup below
    const incomingIds = new Set(incoming.map((m) => m.id));

    // ── Remove lines that are no longer in the payload ────────────────────
    for (const [id, line] of lines) {
      if (!incomingIds.has(id)) {
        line.geometry.dispose();   // free GPU VBO immediately
        group.remove(line);
        lines.delete(id);
      }
    }

    // ── Add lines for new maneuvers; update material for status changes ───
    for (const maneuver of incoming) {
      if (!maneuver.id || !maneuver.waypoints?.length) continue;

      const existing = lines.get(maneuver.id);
      const mat = maneuver.status === "executing" ? MAT_ACTIVE : MAT_PLANNED;

      if (!existing) {
        // New maneuver — build geometry and add to scene
        const geo = buildArcGeometry(maneuver.waypoints);
        if (!geo) continue;

        const line = new THREE.Line(geo, mat);
        line.frustumCulled = false;
        group.add(line);
        lines.set(maneuver.id, line);
      } else {
        // Existing maneuver — only update material if status changed
        if (existing.material !== mat) {
          existing.material = mat;
        }
        // Waypoints don't change mid-maneuver in this system, so geometry
        // is not rebuilt. If that assumption changes, compare waypoints here.
      }
    }
  });

  // Render an empty group — all children are managed imperatively above
  return <group ref={groupRef} name="orbit-paths" />;
}
