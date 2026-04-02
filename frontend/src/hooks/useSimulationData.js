import { useState, useEffect } from "react";
import { fetchSnapshot, apiFetch } from "../services/api";
import useSimulationStore, { positionStore } from "../store/simulationStore";

async function fetchPredictions() {
  try {
    const data = await apiFetch("/api/predict");
    return data.conjunctions ?? [];
  } catch {
    return [];
  }
}

async function fetchOrbitPaths() {
  try {
    await apiFetch("/api/simulate/step", {
      method: "POST",
      body:   JSON.stringify({ step_seconds: 60 }),
    });
  } catch {
    // non-fatal — orbit_paths arrive via WebSocket from this step
  }
}

/**
 * useSimulationData — fetches the initial snapshot once on mount.
 *
 * Responsibilities:
 *  1. Calls GET /api/visualization/snapshot (with abort on unmount).
 *  2. Writes position arrays into positionStore (fast path — no React).
 *  3. Writes dashboard metadata into Zustand (slow path — one re-render).
 *
 * The satellitesRef / debrisRef params are optional: when provided (Scene.jsx),
 * the hook also points those refs at the positionStore arrays so Three.js
 * components can read them inside useFrame without any store import.
 */
export function useSimulationData({ satellitesRef, debrisRef } = {}) {
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);

  const setSnapshot  = useSimulationStore((s) => s.setSnapshot);
  const setStoreError = useSimulationStore((s) => s.setError);

  useEffect(() => {
    const controller = new AbortController();

    fetchSnapshot(controller.signal)
      .then((snapshot) => {
        setSnapshot(snapshot);
        if (satellitesRef) satellitesRef.current = snapshot.satellites  ?? [];
        if (debrisRef)     debrisRef.current     = snapshot.debris_cloud ?? [];
        setLoading(false);

        // Fetch 24h predictions after snapshot loads (non-blocking)
        fetchPredictions().then((conjunctions) => {
          if (conjunctions.length) {
            useSimulationStore.getState().applyStateUpdate({ conjunctions });
          }
        });

        // Trigger a simulate step so the backend broadcasts orbit_paths via WebSocket
        fetchOrbitPaths();
      })
      .catch((err) => {
        if (err?.name === "AbortError") return; // unmounted — ignore
        console.error("[ACM] Snapshot fetch failed:", err);
        setError(err);
        setStoreError(err);
        setLoading(false);
      });

    return () => controller.abort();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally empty — run once on mount

  return { loading, error };
}

// Backward-compatible alias used by Scene.jsx
export { useSimulationData as useSimulationRefs };
