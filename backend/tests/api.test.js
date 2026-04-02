const test = require("node:test");
const assert = require("node:assert/strict");

const request = require("supertest");
const nock = require("nock");

const { connectDb } = require("../src/config/db");
const { createApp } = require("../src/app");
const { initSocket } = require("../src/services/socket.service");

const Satellite = require("../src/models/Satellite");
const Debris = require("../src/models/Debris");
const SimulationState = require("../src/models/SimulationState");
const Maneuver = require("../src/models/Maneuver");

const logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
};

const RUN_ID = "test";
const PY_URL = "http://python-engine.test";

async function resetDb() {
  await Promise.all([
    Satellite.deleteMany({}),
    Debris.deleteMany({}),
    Maneuver.deleteMany({}),
    SimulationState.deleteMany({}),
  ]);
}

test.before(async () => {
  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) {
    throw new Error("Set MONGODB_URI to run tests (use a local/dev MongoDB).");
  }
  await connectDb(mongoUri, logger);
});

test.beforeEach(async () => {
  await resetDb();
});

test("POST /api/telemetry stores satellites+debris and returns ACK", async () => {
  const app = createApp({ logger, corsOrigin: "*", runId: RUN_ID });
  app.locals.pythonEngineUrl = PY_URL;

  const res = await request(app)
    .post("/api/telemetry")
    .send({
      timestamp: "2026-04-02T12:00:00.000Z",
      objects: [
        {
          id: "SAT-001",
          type: "SATELLITE",
          r: { x: 7000, y: 0, z: 0 },
          v: { x: 0, y: 7.5, z: 0 },
        },
        {
          id: "DEB-001",
          type: "DEBRIS",
          r: { x: 7000.05, y: 0, z: 0 },
          v: { x: 0, y: 7.49, z: 0 },
        },
      ],
    })
    .expect(200);

  assert.equal(res.body.status, "ACK");
  assert.equal(res.body.processed_count, 2);
  assert.equal(res.body.active_cdm_warnings, 0);

  const sat = await Satellite.findOne({ objectId: "SAT-001" }).lean();
  const deb = await Debris.findOne({ objectId: "DEB-001" }).lean();
  assert.ok(sat);
  assert.ok(deb);
  assert.equal(sat.latestEci.r.x, 7000);
  assert.equal(deb.latestEci.v.y, 7.49);
});

test("POST /api/maneuver/schedule validates dv magnitude and cooldown", async () => {
  const app = createApp({ logger, corsOrigin: "*", runId: RUN_ID });
  app.locals.pythonEngineUrl = PY_URL;

  await request(app).post("/api/telemetry").send({
    timestamp: "2026-04-02T12:00:00.000Z",
    objects: [
      {
        id: "SAT-001",
        type: "SATELLITE",
        r: { x: 7000, y: 0, z: 0 },
        v: { x: 0, y: 7.5, z: 0 },
      },
    ],
  });

  await request(app)
    .post("/api/maneuver/schedule")
    .send({
      satelliteId: "SAT-001",
      maneuver_sequence: [
        {
          burn_id: "BURN-001",
          burnTime: "2026-04-02T12:10:00.000Z",
          deltaV_vector: { x: 0, y: 5, z: 0 },
        },
      ],
    })
    .expect(200);

  const docs = await Maneuver.find({ satelliteObjectId: "SAT-001" }).lean();
  assert.equal(docs.length, 1);
  assert.equal(docs[0].status, "scheduled");

  // dv violation
  await request(app)
    .post("/api/maneuver/schedule")
    .send({
      satelliteId: "SAT-001",
      maneuver_sequence: [
        {
          burn_id: "BURN-002",
          burnTime: "2026-04-02T12:30:00.000Z",
          deltaV_vector: { x: 0, y: 16, z: 0 },
        },
      ],
    })
    .expect(400);

  // cooldown violation inside sequence (burns too close)
  await request(app)
    .post("/api/maneuver/schedule")
    .send({
      satelliteId: "SAT-001",
      maneuver_sequence: [
        {
          burn_id: "BURN-003",
          burnTime: "2026-04-02T13:00:00.000Z",
          deltaV_vector: { x: 0, y: 1, z: 0 },
        },
        {
          burn_id: "BURN-004",
          burnTime: "2026-04-02T13:05:00.000Z",
          deltaV_vector: { x: 0, y: 1, z: 0 },
        },
      ],
    })
    .expect(400);
});

test("POST /api/simulate/step calls Python, updates Mongo, emits state_update", async () => {
  const events = [];
  initSocket({
    emit: (event, payload) => events.push({ event, payload }),
  });

  const app = createApp({ logger, corsOrigin: "*", runId: RUN_ID });
  app.locals.pythonEngineUrl = PY_URL;

  await request(app).post("/api/telemetry").send({
    timestamp: "2026-04-02T12:00:00.000Z",
    objects: [
      {
        id: "SAT-001",
        type: "SATELLITE",
        r: { x: 7000, y: 0, z: 0 },
        v: { x: 0, y: 7.5, z: 0 },
      },
    ],
  });

  const scope = nock(PY_URL)
    .post("/simulate")
    .reply(200, {
      objects: [{ id: "SAT-001", state: [7000.1, 0.2, 0.3, 0.01, 7.5, 0] }],
      collisions: 0,
      maneuvers: 0,
    });

  const res = await request(app).post("/api/simulate/step").send({ step_seconds: 10 }).expect(200);
  assert.equal(res.body.status, "STEP_COMPLETE");
  assert.equal(res.body.collisions_detected, 0);
  assert.equal(res.body.maneuvers_executed, 0);

  const sat = await Satellite.findOne({ objectId: "SAT-001" }).lean();
  assert.equal(sat.latestEci.r.x, 7000.1);
  assert.equal(sat.latestEci.v.x, 0.01);

  assert.ok(events.find((e) => e.event === "state_update"));
  scope.done();
});

test("GET /api/visualization/snapshot format matches spec", async () => {
  const app = createApp({ logger, corsOrigin: "*", runId: RUN_ID });
  app.locals.pythonEngineUrl = PY_URL;

  await request(app).post("/api/telemetry").send({
    timestamp: "2026-04-02T12:00:00.000Z",
    objects: [
      {
        id: "SAT-001",
        type: "SATELLITE",
        r: { x: 7000, y: 0, z: 0 },
        v: { x: 0, y: 7.5, z: 0 },
      },
      {
        id: "DEB-001",
        type: "DEBRIS",
        r: { x: 7000.05, y: 0, z: 0 },
        v: { x: 0, y: 7.49, z: 0 },
      },
    ],
  });

  const res = await request(app).get("/api/visualization/snapshot").expect(200);
  assert.equal(typeof res.body.timestamp, "string");
  assert.ok(Array.isArray(res.body.satellites));
  assert.ok(Array.isArray(res.body.debris_cloud));

  const sat = res.body.satellites[0];
  assert.ok(sat && typeof sat.id === "string");
  assert.equal(typeof sat.lat, "number");
  assert.equal(typeof sat.lon, "number");
  assert.equal(typeof sat.fuel_kg, "number");
  assert.equal(typeof sat.status, "string");

  const row = res.body.debris_cloud[0];
  assert.ok(Array.isArray(row) && row.length === 4);
});

