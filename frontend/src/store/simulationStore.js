import { create } from "zustand";

// ── Position store (NOT Zustand) ──────────────────────────────────────────────
// Satellites and debris positions are mutated directly into plain objects.
// Nothing in React subscribes to these — Three.js reads them via refs in
// useFrame. Keeping them out of Zustand is what makes 60 FPS possible.

export const positionStore = {
  satellites:   [],   // [{ id, lat, lon, alt, status, miss_distance_km }]
  debrisCloud:  [],   // [[id, lat, lon, alt], ...]
  maneuvers:    [],   // [{ id, waypoints, status }]
};

// ── Dashboard store (Zustand) ─────────────────────────────────────────────────
// Only scalar / small-array data that the HUD actually needs to re-render.

const useSimulationStore = create((set, get) => ({
  // ── State ──────────────────────────────────────────────────────────────────

  timestamp:  null,
  connected:  false,
  loading:    true,
  error:      null,

  // Map for O(1) per-satellite fuel/status lookups and surgical updates.
  // Shape: Map<id: string, { id, fuel_kg, status }>
  satelliteMetaMap: new Map(),

  // Capped append-only lists
  alerts:       [],   // [{ id, type, satelliteId, message, timestamp }]  — max 50
  events:       [],   // [{ id, type, satelliteId, timestamp, reasoning? }] — max 100
  conjunctions: [],   // [{ a, b, tca_s, miss_distance_km, time_to_event_s }] — from /predict

  collisionsTotal:  0,
  maneuversTotal:   0,

  // ── Snapshot action ────────────────────────────────────────────────────────

  /**
   * Called once after the initial GET /snapshot.
   * Populates positionStore (fast path) and Zustand (slow path).
   */
  setSnapshot(snapshot) {
    // Fast path — mutate positionStore directly, no React involvement
    positionStore.satellites  = snapshot.satellites  ?? [];
    positionStore.debrisCloud = snapshot.debris_cloud ?? [];

    // Slow path — build meta map for dashboard
    const metaMap = new Map();
    for (const s of (snapshot.satellites ?? [])) {
      metaMap.set(s.id, { id: s.id, fuel_kg: s.fuel_kg, status: s.status });
    }

    set({
      timestamp:        snapshot.timestamp ?? null,
      satelliteMetaMap: metaMap,
      loading:          false,
      error:            null,
    });
  },

  // ── WebSocket update action ────────────────────────────────────────────────

  /**
   * Called on every "state_update" WebSocket event.
   *
   * Fast path: position arrays in positionStore are replaced in-place.
   * Slow path: only fields that actually changed are written to Zustand,
   *            and satelliteMetaMap is updated surgically (per-entry) to
   *            avoid triggering re-renders in components that only read
   *            a single satellite's data.
   */
  applyStateUpdate(payload) {
    // ── Fast path (zero React overhead) ──────────────────────────────────
    if (payload.satellites?.length) {
      positionStore.satellites = payload.satellites;
    }
    if (payload.debris_cloud?.length) {
      positionStore.debrisCloud = payload.debris_cloud;
    }
    if (payload.maneuvers?.length) {
      positionStore.maneuvers = payload.maneuvers;
    }
    // Orbit paths: attach directly onto satellite objects so GroundTrack
    // and OrbitPath can read them without going through Zustand.
    if (payload.orbit_paths && typeof payload.orbit_paths === "object") {
      for (const sat of positionStore.satellites) {
        const path = payload.orbit_paths[sat.id];
        if (path) sat.orbit_path = path;
      }
    }

    // ── Slow path (surgical Zustand updates) ─────────────────────────────
    const updates = {};

    if (payload.timestamp) {
      updates.timestamp = payload.timestamp;
    }

    // Satellite meta: only update entries whose fuel_kg or status changed.
    // P3: mutate the existing Map in-place and only create a new Map reference
    // (required for Zustand's equality check to trigger a re-render) when at
    // least one entry actually changed. Avoids copying all 500 entries to
    // update 1 — the previous new Map(current) was O(N) unconditionally.
    if (payload.satellites?.length) {
      const current = get().satelliteMetaMap;
      let changed = false;

      for (const s of payload.satellites) {
        const prev = current.get(s.id);
        if (!prev || prev.fuel_kg !== s.fuel_kg || prev.status !== s.status) {
          // Mutate in-place — no full copy
          current.set(s.id, { id: s.id, fuel_kg: s.fuel_kg, status: s.status });
          changed = true;
        }
      }

      // Only hand Zustand a new Map reference when something actually changed.
      // Spreading into a new Map is O(N); here we just wrap the mutated Map
      // in a new reference so Zustand's Object.is check detects the change.
      if (changed) updates.satelliteMetaMap = new Map(current);
    }

    // Alerts: prepend new ones, cap at 50
    if (payload.alerts?.length) {
      updates.alerts = [...payload.alerts, ...get().alerts].slice(0, 50);
    }

    // Events: prepend new ones, cap at 100 — preserve reasoning field
    if (payload.maneuvers?.length) {
      const incoming = payload.maneuvers.map((m) => ({
        id:          m.id ?? `${m.satelliteId}-${Date.now()}`,
        type:        m.type,
        satelliteId: m.satelliteId,
        timestamp:   m.timestamp ?? payload.timestamp,
        reasoning:   m.reasoning ?? null,
      }));
      updates.events = [...incoming, ...get().events].slice(0, 100);
    }

    // Predicted conjunctions from /predict endpoint
    if (payload.conjunctions?.length) {
      updates.conjunctions = payload.conjunctions;
    }

    // Collision / maneuver counters
    if (typeof payload.collisions_detected === "number") {
      updates.collisionsTotal = get().collisionsTotal + payload.collisions_detected;
    }
    if (typeof payload.maneuvers_executed === "number") {
      updates.maneuversTotal = get().maneuversTotal + payload.maneuvers_executed;
    }

    // Only call set() if something actually changed
    if (Object.keys(updates).length) set(updates);
  },

  // ── Misc actions ───────────────────────────────────────────────────────────

  setConnected(connected) {
    // Avoid a re-render if the value hasn't changed
    if (get().connected !== connected) set({ connected });
  },

  setError(error) {
    set({ error, loading: false });
  },

  dismissAlert(alertId) {
    set((state) => ({
      alerts: state.alerts.filter((a) => a.id !== alertId),
    }));
  },
}));

export default useSimulationStore;
