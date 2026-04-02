const mongoose = require("mongoose");

const { Schema } = mongoose;

const DebrisSchema = new Schema(
  {
    // External/system identifier used by ACM APIs
    objectId: { type: String, required: true, trim: true, index: true },

    noradId: { type: Number, index: true, sparse: true },
    catalogId: { type: String, trim: true, index: true },
    name: { type: String, trim: true, index: true },

    source: {
      type: String,
      trim: true,
      index: true,
    },

    sizeClass: {
      type: String,
      enum: ["unknown", "small", "medium", "large"],
      default: "unknown",
      index: true,
    },

    status: {
      type: String,
      enum: ["tracked", "untracked", "decayed"],
      default: "tracked",
      index: true,
    },

    lastTelemetryAt: { type: Date, index: true },

    latestState: {
      runId: { type: String, trim: true, index: true },
      epoch: { type: Date, index: true },
      simulationStateId: { type: Schema.Types.ObjectId, ref: "SimulationState" },
      chunkIndex: { type: Number, min: 0 },
    },

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

    deletedAt: { type: Date, index: true },
  },
  {
    timestamps: true,
    versionKey: false,
    strict: "throw",
  },
);

DebrisSchema.index(
  { objectId: 1 },
  { unique: true, name: "uniq_debris_objectId" },
);
DebrisSchema.index(
  { noradId: 1 },
  { unique: true, sparse: true, name: "uniq_debris_noradId" },
);
DebrisSchema.index(
  { catalogId: 1 },
  { unique: true, sparse: true, name: "uniq_debris_catalogId" },
);
DebrisSchema.index(
  { status: 1, "latestState.epoch": -1 },
  { name: "debris_status_latestEpoch" },
);
DebrisSchema.index(
  { status: 1, lastTelemetryAt: -1 },
  { name: "debris_status_lastTelemetryAt" },
);

module.exports = mongoose.model("Debris", DebrisSchema);
