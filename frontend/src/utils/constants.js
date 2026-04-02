// Scene scale: 1 unit = 1000 km
export const EARTH_RADIUS_UNITS = 6.378137;     // 6378.137 km (doc §3.2)
export const SCENE_SCALE = 1 / 1000;            // km → scene units

// Risk thresholds — doc §6.2 Bullseye Plot
export const YELLOW_THRESHOLD_KM = 5;           // km — Warning
export const RED_THRESHOLD_KM    = 1;           // km — Critical
export const COLLISION_THRESHOLD_KM = 0.1;      // km = 100 m (doc §3.3)

// Propulsion — doc §5.1
export const DRY_MASS_KG       = 500.0;         // kg
export const PROPELLANT_KG     =  50.0;         // kg
export const WET_MASS_KG       = 550.0;         // kg
export const ISP_S             = 300.0;         // s
export const MAX_DV_MS         =  15.0;         // m/s per burn
export const MANEUVER_COOLDOWN_SEC = 600;       // s (doc §5.1)
export const STATION_BOX_KM    =  10.0;         // km spherical box (doc §5.2)
export const COMM_DELAY_SEC    =  10;           // s signal latency (doc §5.4)

// Fuel warning (%)
export const FUEL_WARNING_PCT = 15;

// Pre-allocate buffers for max expected counts
export const MAX_DEBRIS_COUNT = 15000;
export const MAX_SATELLITE_COUNT = 500;

// Debris risk colors (RGB floats for Three.js vertexColors)
export const COLOR_DEBRIS_NOMINAL   = 0x888888;  // grey   — > 5 km
export const COLOR_DEBRIS_WARN      = 0xffcc00;  // yellow — < 5 km
export const COLOR_DEBRIS_CRITICAL  = 0xff2200;  // red    — < 1 km
export const COLOR_SAT_NOMINAL = 0x00aaff;
export const COLOR_SAT_WARN = 0xffcc00;
export const COLOR_SAT_CRITICAL = 0xff2200;
export const COLOR_EARTH_ATMOSPHERE = 0x1a3a5c;

// API
export const API_BASE_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3000";
export const SOCKET_URL   = import.meta.env.VITE_SOCKET_URL ?? "http://localhost:3000";

// Socket events
export const EVT_STATE_UPDATE = "state_update";
