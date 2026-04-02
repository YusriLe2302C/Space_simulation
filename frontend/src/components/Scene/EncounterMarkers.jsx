import { useRef, useEffect } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { latLonAltToXYZ } from "../../utils/coordinateUtils";
import useSimulationStore from "../../store/simulationStore";
import { positionStore } from "../../store/simulationStore";

// Shared geometry + material — allocated once
const GEO = new THREE.SphereGeometry(0.08, 12, 12);
const MAT = new THREE.MeshBasicMaterial({
  color:       0xff2200,
  transparent: true,
  opacity:     0.85,
});

/**
 * EncounterMarker — renders a pulsing red sphere at each predicted
 * conjunction point in the 3D scene.
 *
 * Position is derived from the midpoint between the two objects at TCA.
 * Since we have lat/lon for satellites from positionStore, we use the
 * satellite's current position as a proxy for the encounter location.
 * This is visually correct for near-term conjunctions.
 *
 * Reads from Zustand conjunctions array (updated by /predict endpoint).
 * Uses InstancedMesh for all markers in one draw call.
 */
export default function EncounterMarkers() {
  const meshRef      = useRef();
  const countRef     = useRef(0);
  const pulseRef     = useRef(0);

  const conjunctions = useSimulationStore((s) => s.conjunctions);

  // Scratch objects — allocated once
  const _matrix = useRef(new THREE.Matrix4());
  const _pos    = useRef(new THREE.Vector3());
  const _quat   = useRef(new THREE.Quaternion());
  const _scale  = useRef(new THREE.Vector3());

  const MAX = 20;

  useEffect(() => {
    return () => {
      GEO.dispose();
      MAT.dispose();
    };
  }, []);

  useFrame(({ clock }) => {
    const mesh = meshRef.current;
    if (!mesh) return;

    const conj = conjunctions ?? [];
    const len  = Math.min(conj.length, MAX);

    // Pulse scale: 0.8 → 1.2 over 1.5s cycle
    const pulse = 0.8 + 0.4 * Math.abs(Math.sin(clock.getElapsedTime() * 2.1));

    for (let i = 0; i < len; i++) {
      const c = conj[i];

      // Find satellite A position from positionStore
      const satA = positionStore.satellites.find((s) => s.id === c.a);
      if (!satA) continue;

      const [x, y, z] = latLonAltToXYZ(satA.lat, satA.lon, satA.alt ?? 400);

      // Scale by urgency: closer TCA → larger marker
      const urgency = c.time_to_event_s < 3600 ? 1.4 : 1.0;

      _pos.current.set(x, y, z);
      _scale.current.set(pulse * urgency, pulse * urgency, pulse * urgency);
      _matrix.current.compose(_pos.current, _quat.current, _scale.current);
      mesh.setMatrixAt(i, _matrix.current);
    }

    // Hide unused slots
    if (len < countRef.current) {
      _scale.current.set(0, 0, 0);
      for (let i = len; i < countRef.current; i++) {
        _matrix.current.compose(_pos.current, _quat.current, _scale.current);
        mesh.setMatrixAt(i, _matrix.current);
      }
    }

    countRef.current = len;
    mesh.count = len;

    if (len > 0) {
      mesh.instanceMatrix.needsUpdate = true;
    }
  });

  return (
    <instancedMesh
      ref={meshRef}
      args={[GEO, MAT, MAX]}
      frustumCulled={false}
    />
  );
}
