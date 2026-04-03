const mongoose = require("mongoose");

const { Schema } = mongoose;

const SatelliteSchema = new Schema(
  {
    // External/system identifier used by ACM APIs
    objectId: { type: String, required: true, trim: true, index: true },

    noradId: { type: Number, index: true, sparse: true },
    internationalDesignator: { type: String, trim: true, index: true },
    name: { type: String, trim: true, index: true },

    operator: {
      name: { type: String, trim: true, index: true },
      country: { type: String, trim: true, index: true },
      orgId: { type: String, trim: true, index: true },
    },

    status: {
      type: String,
      enum: ["active", "inactive", "lost", "deorbited", "graveyard"],
      default: "active",
      index: true,
    },

    physical: {
      massKg: { type: Number, min: 0 },
      areaM2: { type: Number, min: 0 },
      dragCoeff: { type: Number, min: 0 },
      reflectivity: { type: Number, min: 0 },
    },

    constraints: {
      maxDvMs: { type: Number, default: 15, min: 0 },
      maneuverCooldownSec: { type: Number, default: 600, min: 0 },
    },

    tags: [{ type: String, trim: true, index: true }],

    lastTelemetryAt: { type: Date, index: true },

    fuel_kg: { type: Number, min: 0, default: 50.0, index: true },  // doc §5.1: initial propellant 50 kg

    latestEci: {
      timestamp: { type: Date, index: true },
      runId: { type: String, trim: true, index: true },
      r: {
        x: { type: Number, required: true },
        y: { type: Number, required: true },
        z: { type: Number, required: true },
      },
      v: {
        x: { type: Number, required: true },
        y: { type: Number, required: true },
        z: { type: Number, required: true },
      },
    },

    latestState: {
      runId: { type: String, trim: true, index: true },
      epoch: { type: Date, index: true },
      simulationStateId: { type: Schema.Types.ObjectId, ref: "SimulationState" },
      chunkIndex: { type: Number, min: 0 },
    },

    deletedAt: { type: Date, index: true },
  },
  {
    timestamps: true,
    versionKey: false,
    strict: "throw",
  },
);

SatelliteSchema.index(
  { objectId: 1 },
  { unique: true, name: "uniq_satellite_objectId" },
);
SatelliteSchema.index(
  { noradId: 1 },
  { unique: true, sparse: true, name: "uniq_satellite_noradId" },
);
SatelliteSchema.index(
  { status: 1, lastTelemetryAt: -1 },
  { name: "satellite_status_lastTelemetryAt" },
);

module.exports = mongoose.model("Satellite", SatelliteSchema);
