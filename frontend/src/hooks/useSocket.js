import { useEffect } from "react";
import {
  connectSocket,
  onStateUpdate,
  onConnectionChange,
  isConnected,
} from "../services/socket";
import useSimulationStore, { positionStore } from "../store/simulationStore";

/**
 * useSocket — opens the WebSocket connection and wires all events.
 *
 * Called once in Scene.jsx. Refs are optional — when provided, the hook
 * also keeps them in sync with positionStore so Three.js components can
 * read positions inside useFrame without importing the store.
 *
 * Update split:
 *  FAST PATH — mutate positionStore + refs directly (zero React overhead)
 *  SLOW PATH — call store.applyStateUpdate() for dashboard fields only
 *              when something actually changed
 */
export function useSocket({ satellitesRef, debrisRef, maneuversRef } = {}) {
  const applyStateUpdate = useSimulationStore((s) => s.applyStateUpdate);
  const setConnected     = useSimulationStore((s) => s.setConnected);

  useEffect(() => {
    // ── Connection lifecycle ──────────────────────────────────────────────
    const unsubConn = onConnectionChange({
      onConnect:    () => setConnected(true),
      onDisconnect: () => setConnected(false),
      onError:      (err) => console.warn("[ACM] Socket error:", err?.message),
    });

    // Sync initial state in case socket was already connected before mount
    setConnected(isConnected());

    // ── state_update handler ──────────────────────────────────────────────
    const unsubUpdate = onStateUpdate((payload) => {
      if (!payload || typeof payload !== "object") return;

      // ── FAST PATH ───────────────────────────────────────────────────────
      // The "state_update" event from simulation.controller.js sends:
      //   { timestamp, collisions, maneuvers, objects: [{id, state:[x,y,z,vx,vy,vz]}] }
      //
      // The visualization snapshot uses lat/lon/alt. We normalise here:
      //   - If objects have .lat → already geographic, use directly
      //   - If objects have .state (ECI) → backend should convert; we pass
      //     them through as-is and let the backend's next snapshot carry
      //     the geographic form. We do NOT do ECI→lat/lon in the frontend.

      if (Array.isArray(payload.objects) && payload.objects.length) {
        // P3: compute withGeo once and reuse for both fast and slow paths.
        // Previously filtered twice — two O(N) passes over the same array.
        const withGeo = payload.objects.filter((o) => o.lat != null);
        if (withGeo.length) {
          // Attach orbit_path from orbit_paths map if present
          if (payload.orbit_paths && typeof payload.orbit_paths === "object") {
            for (const sat of withGeo) {
              const path = payload.orbit_paths[sat.id];
              if (path) sat.orbit_path = path;
            }
          }
          positionStore.satellites = withGeo;
          if (satellitesRef) satellitesRef.current = withGeo;
        }
        // ECI-only objects are intentionally not rendered until the backend
        // provides geographic coordinates via the snapshot or a future
        // visualization-specific update event.
      }

      if (Array.isArray(payload.debris_cloud) && payload.debris_cloud.length) {
        positionStore.debrisCloud = payload.debris_cloud;
        if (debrisRef) debrisRef.current = payload.debris_cloud;
      }

      if (Array.isArray(payload.maneuvers) && payload.maneuvers.length) {
        positionStore.maneuvers = payload.maneuvers;
        if (maneuversRef) maneuversRef.current = payload.maneuvers;
      }

      // ── SLOW PATH ───────────────────────────────────────────────────────
      const withGeoSlow = Array.isArray(payload.objects)
        ? payload.objects.filter((o) => o.lat != null)
        : [];

      const normalised = {
        timestamp:            payload.timestamp,
        satellites:           withGeoSlow,
        debris_cloud:         payload.debris_cloud,
        maneuvers:            payload.maneuvers,
        alerts:               payload.alerts,
        collisions_detected:  payload.collisions   ?? payload.collisions_detected,
        maneuvers_executed:   payload.maneuvers_executed,
      };

      applyStateUpdate(normalised);
    });

    // Open the connection after all listeners are registered
    connectSocket();

    return () => {
      unsubConn();
      unsubUpdate();
      // Do NOT disconnect on unmount — the socket is a singleton and other
      // parts of the app may still need it. Call disconnectSocket() explicitly
      // at app teardown if needed.
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // stable — refs and store actions never change identity
}
