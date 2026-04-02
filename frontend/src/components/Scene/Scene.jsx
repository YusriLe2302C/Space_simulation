import { useRef, Suspense } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Stars } from "@react-three/drei";

import Earth, { EarthFallback } from "./Earth";
import Satellites from "./Satellites";
import Debris from "./Debris";
import OrbitPath from "./OrbitPath";
import EncounterMarkers from "./EncounterMarkers";
import { useSimulationData } from "../../hooks/useSimulationData";
import { useSocket } from "../../hooks/useSocket";

// ── Scene ─────────────────────────────────────────────────────────────────────
//
// Render-loop contract (zero setState in the loop):
//
//   Satellites  — reads satellitesRef in useFrame, dirty-flag guards all work
//   Debris      — reads debrisRef in useFrame, dirty-flag guards all work
//   OrbitPath   — reads maneuversRef in useFrame, imperative Three.js mutations
//
// None of the above components call setState or trigger React reconciliation
// from inside useFrame. The only React re-renders that happen are:
//   • Once on snapshot load (Zustand, Dashboard subtree only)
//   • On fuel/alert/event changes (Zustand, Dashboard subtree only)
//
// The Canvas is ALWAYS mounted — never conditionally rendered.
// The loading overlay in App.jsx handles the pre-snapshot state as a CSS
// opacity veil so the WebGL context is created once and kept alive.
export default function Scene() {
  // Stable refs — mutated by hooks, read by Three.js components in useFrame.
  // Mutating a ref NEVER causes a React re-render.
  const satellitesRef = useRef([]);
  const debrisRef     = useRef([]);
  const maneuversRef  = useRef([]);

  // useSimulationData: GET /snapshot → populates refs + Zustand once on mount.
  // useSocket: opens WS → on every event mutates refs (fast) + Zustand (slow).
  // Both hooks are called unconditionally — no early returns above this line.
  useSimulationData({ satellitesRef, debrisRef });
  useSocket({ satellitesRef, debrisRef, maneuversRef });

  return (
    <div style={{ width: "100%", height: "100vh" }}>
      <Canvas
        camera={{
          position: [0, 0, 22],
          fov:      45,
          near:     0.1,
          far:      1000,
        }}
        gl={{
          antialias:       true,
          powerPreference: "high-performance",
          alpha:           false,   // solid background — no compositing cost
          stencil:         false,   // not needed
          depth:           true,
        }}
        dpr={[1, 1.5]}      // cap pixel ratio: full quality on 1x, capped on HiDPI
        frameloop="always"  // keep the loop running — OrbitControls needs it for damping
        flat                // disable tone-mapping — we control colors explicitly
      >
        {/* ── Lighting ── */}
        <ambientLight intensity={0.12} />
        <directionalLight position={[50, 30, 50]}   intensity={1.5} castShadow={false} />
        <directionalLight position={[-40, -20, -40]} intensity={0.08} color={0x2244aa} castShadow={false} />

        {/* ── Background — static, rendered once ── */}
        <Stars radius={300} depth={60} count={5000} factor={4} saturation={0} fade />

        {/* ── Earth — textures load async ── */}
        <Suspense fallback={<EarthFallback />}>
          <Earth />
        </Suspense>

        {/* ── Dynamic objects ──────────────────────────────────────────────
            All three read their data from refs inside their own useFrame.
            They NEVER call setState. They NEVER trigger React reconciliation.
            React renders each of these components exactly ONCE after mount.
        ── */}

        {/* InstancedMesh — 1 draw call for all satellites */}
        <Satellites satellitesRef={satellitesRef} />

        {/* Points — 1 draw call for all debris */}
        <Debris debrisRef={debrisRef} />

        {/* Imperative line management — reads maneuversRef, mutates group directly */}
        <OrbitPath maneuversRef={maneuversRef} />

        {/* Pulsing red spheres at predicted conjunction points */}
        <EncounterMarkers />

        {/* ── Camera controls ── */}
        <OrbitControls
          enablePan={false}
          minDistance={7.5}
          maxDistance={80}
          rotateSpeed={0.4}
          zoomSpeed={0.6}
          dampingFactor={0.08}
          enableDamping
          makeDefault
        />
      </Canvas>
    </div>
  );
}
