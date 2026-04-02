const Satellite = require("../models/Satellite");
const Debris = require("../models/Debris");
const SimulationState = require("../models/SimulationState");

async function upsertTelemetryObjects({ timestamp, objects, runId }) {
  const ts = new Date(timestamp);

  const satelliteOps = [];
  const debrisOps = [];

  for (const obj of objects) {
    const update = {
      $set: {
        objectId: obj.id,
        lastTelemetryAt: ts,
        latestEci: {
          timestamp: ts,
          r: obj.r,
          v: obj.v,
          runId,
        },
        ...(obj.type === "SATELLITE" && obj.name ? { name: obj.name } : {}),
      },
      $setOnInsert: {
        ...(obj.type === "SATELLITE" ? { status: "active" } : {}),
      },
    };

    if (obj.type === "SATELLITE") {
      satelliteOps.push({
        updateOne: { filter: { objectId: obj.id }, update, upsert: true },
      });
    } else {
      debrisOps.push({
        updateOne: { filter: { objectId: obj.id }, update, upsert: true },
      });
    }
  }

  const results = await Promise.all([
    satelliteOps.length ? Satellite.bulkWrite(satelliteOps, { ordered: false }) : null,
    debrisOps.length ? Debris.bulkWrite(debrisOps, { ordered: false }) : null,
  ]);

  await SimulationState.updateOne(
    { runId },
    { $set: { runId, timestamp: ts } },
    { upsert: true },
  );

  return {
    satellitesUpserted:
      (results[0]?.upsertedCount ?? 0) + (results[0]?.modifiedCount ?? 0) + (results[0]?.matchedCount ?? 0),
    debrisUpserted:
      (results[1]?.upsertedCount ?? 0) + (results[1]?.modifiedCount ?? 0) + (results[1]?.matchedCount ?? 0),
  };
}

async function getObjectsForSimulation({ runId, limit = 20000 }) {
  // Fix: filter by runId so multi-run simulations are isolated.
  // Without this all satellites/debris from all runs are mixed together.
  const [satellites, debris] = await Promise.all([
    Satellite.find({
      deletedAt: { $exists: false },
      "latestEci.r.x": { $exists: true },
      "latestEci.runId": runId,
    })
      .select({ objectId: 1, latestEci: 1 })
      .limit(limit)
      .lean(),
    Debris.find({
      deletedAt: { $exists: false },
      "latestEci.r.x": { $exists: true },
      "latestEci.runId": runId,
    })
      .select({ objectId: 1, latestEci: 1 })
      .limit(limit)
      .lean(),
  ]);

  const objects = [];
  const typeById = new Map();
  const nameById = new Map();

  for (const s of satellites) {
    const r = s.latestEci?.r;
    const v = s.latestEci?.v;
    if (!r || !v) continue;
    objects.push({
      id: s.objectId,
      state: [r.x, r.y, r.z, v.x, v.y, v.z],
    });
    typeById.set(s.objectId, "SATELLITE");
    nameById.set(s.objectId, s.name ?? s.objectId);
  }

  for (const d of debris) {
    const r = d.latestEci?.r;
    const v = d.latestEci?.v;
    if (!r || !v) continue;
    objects.push({
      id: d.objectId,
      state: [r.x, r.y, r.z, v.x, v.y, v.z],
    });
    typeById.set(d.objectId, "DEBRIS");
  }

  return { objects, typeById, nameById, runId };
}

async function applySimulationResults({ timestampIso, runId, objects, typeById }) {
  const ts = new Date(timestampIso);

  const satOps = [];
  const debrisOps = [];

  for (const obj of objects) {
    const state = obj.state;
    if (!Array.isArray(state) || state.length !== 6) continue;
    const r = { x: state[0], y: state[1], z: state[2] };
    const v = { x: state[3], y: state[4], z: state[5] };

    const update = {
      $set: {
        lastTelemetryAt: ts,
        latestEci: { timestamp: ts, runId, r, v },
      },
    };

    const type = typeById?.get(obj.id);
    if (type === "SATELLITE") {
      satOps.push({ updateOne: { filter: { objectId: obj.id }, update } });
    } else if (type === "DEBRIS") {
      debrisOps.push({ updateOne: { filter: { objectId: obj.id }, update } });
    }
  }

  await Promise.all([
    satOps.length ? Satellite.bulkWrite(satOps, { ordered: false }) : null,
    debrisOps.length ? Debris.bulkWrite(debrisOps, { ordered: false }) : null,
  ]);

  await SimulationState.updateOne(
    { runId },
    { $set: { runId, timestamp: ts } },
    { upsert: true },
  );

  return { updatedSatellites: satOps.length, updatedDebris: debrisOps.length };
}

async function getSnapshot({ runId, satelliteLimit = 10000, debrisLimit = 10000 }) {
  const sim = await SimulationState.findOne({ runId }).lean();
  const timestamp = sim?.timestamp ? new Date(sim.timestamp).toISOString() : new Date().toISOString();

  const [satellites, debris] = await Promise.all([
    Satellite.find({ deletedAt: { $exists: false } })
      .sort({ lastTelemetryAt: -1 })
      .limit(satelliteLimit)
      .lean(),
    Debris.find({ deletedAt: { $exists: false } })
      .sort({ lastTelemetryAt: -1 })
      .limit(debrisLimit)
      .lean(),
  ]);

  return { timestamp, satellites, debris };
}

async function advanceSimulationTimestamp({ runId, stepSeconds }) {
  const sim = await SimulationState.findOne({ runId });
  const current = sim?.timestamp ? new Date(sim.timestamp) : new Date();
  const next = new Date(current.getTime() + stepSeconds * 1000);

  await SimulationState.updateOne(
    { runId },
    { $set: { runId, timestamp: next } },
    { upsert: true },
  );

  return { newTimestamp: next.toISOString() };
}

module.exports = {
  upsertTelemetryObjects,
  getObjectsForSimulation,
  applySimulationResults,
  getSnapshot,
  advanceSimulationTimestamp,
};
