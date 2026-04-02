import { Component, memo } from "react";
import Scene from "./components/Scene/Scene";
import Dashboard from "./components/UI/Dashboard";
import GroundTrack from "./components/UI/GroundTrack";
import BullseyePlot from "./components/UI/BullseyePlot";
import useSimulationStore from "./store/simulationStore";

// ── Error boundary ────────────────────────────────────────────────────────────
// Catches unhandled errors from the Three.js canvas or any child.
// Class component required — no hook equivalent for componentDidCatch.
class SceneErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("[ACM] Scene error:", error, info?.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{
          position:       "absolute", inset: 0,
          display:        "flex", flexDirection: "column",
          alignItems:     "center", justifyContent: "center",
          background:     "#000008",
          color:          "#ff4422",
          fontFamily:     "monospace",
          fontSize:       "13px",
          gap:            "12px",
          padding:        "24px",
          textAlign:      "center",
        }}>
          <span style={{ fontSize: "28px" }}>⚠</span>
          <span style={{ fontWeight: "700", letterSpacing: "0.08em" }}>RENDER ERROR</span>
          <span style={{ color: "#884433", fontSize: "11px", maxWidth: "400px", wordBreak: "break-word" }}>
            {this.state.error?.message ?? String(this.state.error)}
          </span>
          <button
            onClick={() => this.setState({ error: null })}
            style={{
              marginTop:    "8px",
              background:   "rgba(255,60,30,0.15)",
              border:       "1px solid rgba(255,60,30,0.4)",
              borderRadius: "4px",
              color:        "#ff6644",
              fontFamily:   "monospace",
              fontSize:     "11px",
              padding:      "5px 16px",
              cursor:       "pointer",
            }}
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ── Loading overlay ───────────────────────────────────────────────────────────
// Sits on top of the canvas (position:absolute) so the Canvas mounts once
// and stays mounted. Avoids destroying/recreating the WebGL context.
const LoadingOverlay = memo(function LoadingOverlay() {
  const loading = useSimulationStore((s) => s.loading);
  const error   = useSimulationStore((s) => s.error);

  // Fade out once loaded — CSS transition handles the animation
  const visible = loading && !error;

  return (
    <div style={{
      position:       "absolute", inset: 0,
      display:        "flex", flexDirection: "column",
      alignItems:     "center", justifyContent: "center",
      background:     "#000008",
      zIndex:         20,
      pointerEvents:  visible ? "auto" : "none",
      opacity:        visible ? 1 : 0,
      transition:     "opacity 0.5s ease",
    }}>
      <Spinner />
      <span style={{
        color:         "#2299ee",
        fontFamily:    "monospace",
        fontSize:      "12px",
        marginTop:     "16px",
        letterSpacing: "0.12em",
      }}>
        INITIALISING ACM
      </span>
      <span style={{ color: "#1a3a55", fontFamily: "monospace", fontSize: "10px", marginTop: "6px" }}>
        Fetching constellation snapshot…
      </span>
    </div>
  );
});

function Spinner() {
  return (
    <div style={{
      width:        "32px",
      height:       "32px",
      border:       "2px solid rgba(0,150,255,0.15)",
      borderTop:    "2px solid #2299ee",
      borderRadius: "50%",
      animation:    "acm-spin 0.9s linear infinite",
    }} />
  );
}

// ── App ───────────────────────────────────────────────────────────────────────
// Two completely independent render trees:
//
//   <Scene>     → R3F Canvas. Position updates flow through refs + useFrame.
//                 Never re-renders due to position changes.
//
//   <Dashboard> → HTML overlay. Updates flow through Zustand.
//                 Re-renders only when fuel/alerts/events change.
//
// They share data through:
//   - positionStore (plain object, mutated directly — zero React overhead)
//   - useSimulationStore (Zustand — only dashboard fields)
//
// The LoadingOverlay sits above both as a transparent layer that fades out
// once the snapshot arrives, without unmounting the Canvas.
export default function App() {
  return (
    <>
      {/* Keyframe for spinner — injected once */}
      <style>{`@keyframes acm-spin { to { transform: rotate(360deg); } }`}</style>

      <div style={{ position: "relative", width: "100vw", height: "100vh", overflow: "hidden", background: "#000008" }}>

        {/* 3D layer — always mounted, never unmounted */}
        <SceneErrorBoundary>
          <Scene />
        </SceneErrorBoundary>

        {/* 2D HUD — absolute overlay, independent React tree */}
        <Dashboard />

        {/* Left panel — Ground Track + Bullseye, pinned bottom-left, no overlap with Dashboard */}
        <div style={{
          position:      "absolute",
          bottom:        "10px",
          left:          "10px",
          display:       "flex",
          flexDirection: "column",
          gap:           "6px",
          pointerEvents: "none",
          zIndex:        10,
          maxWidth:      "calc(100vw - 330px)",
        }}>
          <GroundTrack />
          <BullseyePlot />
        </div>

        {/* Loading veil — fades out after snapshot, does not unmount canvas */}
        <LoadingOverlay />

      </div>
    </>
  );
}
