/**
 * seed.js — Seeds MongoDB with REAL satellite + debris data from Celestrak TLEs.
 *
 * Sources:
 *   Satellites : https://celestrak.org/SOCRATES/query.php (active LEO)
 *   Debris     : https://celestrak.org/pub/TLE/catalog.txt (DEBRIS objects)
 *
 * Run: node src/scripts/seed.js
 */

require("dotenv").config({ path: require("path").join(__dirname, "../../.env") });

const BACKEND_URL = `http://localhost:${process.env.PORT ?? 3000}`;
const API_KEY     = process.env.ACM_API_KEY;

if (!API_KEY) {
  console.error("[seed] ACM_API_KEY not set in backend/.env");
  process.exit(1);
}

// ── TLE API (tle.ivanstanojevic.me — free, no auth required) ─────────────────
const TLE_API = "https://tle.ivanstanojevic.me/api/tle";


// ── SGP4 constants ────────────────────────────────────────────────────────────
const MU        = 398600.4418;   // km³/s²
const RE        = 6378.137;      // km
const TWOPI     = 2 * Math.PI;
const DEG2RAD   = Math.PI / 180;
const MIN2SEC   = 60;
const DAY2MIN   = 1440;

// ── TLE parser ────────────────────────────────────────────────────────────────
function parseTLEBlock(lines) {
  // lines = [name, line1, line2]
  const name  = lines[0].trim();
  const line1 = lines[1];
  const line2 = lines[2];

  if (!line1?.startsWith("1 ") || !line2?.startsWith("2 ")) return null;

  try {
    const inc    = parseFloat(line2.slice(8,  16))  * DEG2RAD;
    const raan   = parseFloat(line2.slice(17, 25))  * DEG2RAD;
    const ecc    = parseFloat("0." + line2.slice(26, 33).trim());
    const argp   = parseFloat(line2.slice(34, 42))  * DEG2RAD;
    const ma     = parseFloat(line2.slice(43, 51))  * DEG2RAD;
    const mm     = parseFloat(line2.slice(52, 63));  // rev/day
    const norad  = line2.slice(2, 7).trim();

    // Mean motion → semi-major axis
    const n  = mm * TWOPI / DAY2MIN / MIN2SEC;  // rad/s
    const a  = Math.cbrt(MU / (n * n));          // km

    // Solve Kepler's equation for eccentric anomaly
    let E = ma;
    for (let i = 0; i < 10; i++) {
      E = E - (E - ecc * Math.sin(E) - ma) / (1 - ecc * Math.cos(E));
    }

    // True anomaly
    const nu = 2 * Math.atan2(
      Math.sqrt(1 + ecc) * Math.sin(E / 2),
      Math.sqrt(1 - ecc) * Math.cos(E / 2),
    );

    // Distance
    const r = a * (1 - ecc * Math.cos(E));

    // Position in orbital plane
    const rx_o = r * Math.cos(nu);
    const ry_o = r * Math.sin(nu);

    // Velocity in orbital plane
    const h  = Math.sqrt(MU * a * (1 - ecc * ecc));
    const vx_o = -(MU / h) * Math.sin(nu);
    const vy_o =  (MU / h) * (ecc + Math.cos(nu));

    // Rotate to ECI
    const cosR = Math.cos(raan), sinR = Math.sin(raan);
    const cosI = Math.cos(inc),  sinI = Math.sin(inc);
    const cosW = Math.cos(argp), sinW = Math.sin(argp);

    // Rotation matrix columns
    const Px = cosR * cosW - sinR * sinW * cosI;
    const Py = sinR * cosW + cosR * sinW * cosI;
    const Pz = sinW * sinI;
    const Qx = -cosR * sinW - sinR * cosW * cosI;
    const Qy = -sinR * sinW + cosR * cosW * cosI;
    const Qz =  cosW * sinI;

    const x  = Px * rx_o + Qx * ry_o;
    const y  = Py * rx_o + Qy * ry_o;
    const z  = Pz * rx_o + Qz * ry_o;
    const vx = Px * vx_o + Qx * vy_o;
    const vy = Py * vx_o + Qy * vy_o;
    const vz = Pz * vx_o + Qz * vy_o;

    const alt = r - RE;
    // Only keep LEO objects (< 2000 km alt) with valid state
    if (alt < 100 || alt > 2000) return null;
    if (!isFinite(x) || !isFinite(vx)) return null;

    return {
      id:    norad,
      name,
      state: [
        +x.toFixed(4), +y.toFixed(4), +z.toFixed(4),
        +vx.toFixed(6), +vy.toFixed(6), +vz.toFixed(6),
      ],
    };
  } catch {
    return null;
  }
}

// ── Fetch one page from TLE API ───────────────────────────────────────────────
async function fetchTLEPage(page, pageSize = 100) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(`${TLE_API}/?page=${page}&page-size=${pageSize}`, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchAllTLEs(limit) {
  const pageSize = 100;
  const results = [];
  let page = 1;
  while (results.length < limit) {
    const data = await fetchTLEPage(page, pageSize);
    for (const m of data.member) {
      const parsed = parseTLEBlock([m.name, m.line1, m.line2]);
      if (parsed) results.push({ ...parsed, type: "SATELLITE" });
      if (results.length >= limit) break;
    }
    if (data.member.length < pageSize) break;
    page++;
  }
  return results;
}

// ── Backend helpers ───────────────────────────────────────────────────────────
async function getToken() {
  const res = await fetch(`${BACKEND_URL}/auth/token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ api_key: API_KEY }),
  });
  if (!res.ok) throw new Error(`Auth failed: ${res.status}`);
  return (await res.json()).token;
}

async function postTelemetry(token, objects) {
  const res = await fetch(`${BACKEND_URL}/api/telemetry`, {
    method: "POST",
    headers: { "content-type": "application/json", "authorization": `Bearer ${token}` },
    body: JSON.stringify({
      timestamp: new Date().toISOString(),
      objects: objects.map((o) => ({
        id:   o.id,
        name: o.name ?? o.id,
        type: o.type,
        r:    { x: o.state[0], y: o.state[1], z: o.state[2] },
        v:    { x: o.state[3], y: o.state[4], z: o.state[5] },
      })),
    }),
  });
  if (!res.ok) throw new Error(`Telemetry failed: ${res.status} — ${await res.text()}`);
}

async function triggerSimStep(token) {
  const res = await fetch(`${BACKEND_URL}/api/simulate/step`, {
    method: "POST",
    headers: { "content-type": "application/json", "authorization": `Bearer ${token}` },
    body: JSON.stringify({ step_seconds: 60 }),
  });
  if (!res.ok) console.warn(`[seed] simulate/step non-fatal: ${res.status}`);
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log("[seed] Waiting for backend at", BACKEND_URL);

  let token;
  for (let i = 1; i <= 20; i++) {
    try { token = await getToken(); break; } catch {
      if (i === 20) { console.error("[seed] Backend unreachable after 20s"); process.exit(1); }
      console.log(`[seed] Retry ${i}/20...`);
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  // ── Fetch real TLE data ───────────────────────────────────────────────────
  let all = [];

  console.log("[seed] Fetching real satellite TLEs from tle.ivanstanojevic.me...");
  all = await fetchAllTLEs(100);
  console.log(`[seed] Fetched ${all.length} real satellites`);

  if (all.length === 0) throw new Error("No objects fetched — check network connection");

  // ── Post to backend ───────────────────────────────────────────────────────
  console.log(`[seed] Posting ${all.length} objects to backend...`);
  for (let i = 0; i < all.length; i += 50) {
    await postTelemetry(token, all.slice(i, i + 50));
    console.log(`[seed] Batch ${Math.floor(i / 50) + 1}/${Math.ceil(all.length / 50)} posted`);
  }

  console.log("[seed] Triggering initial simulate step...");
  await triggerSimStep(token);
  console.log(`[seed] ✅ Done — seeded ${all.length} real objects from Celestrak`);
}

main().catch((err) => { console.error("[seed]", err.message); process.exit(1); });
