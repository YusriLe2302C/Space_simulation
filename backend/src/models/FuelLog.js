const mongoose = require("mongoose");

const { Schema } = mongoose;

const FuelLogSchema = new Schema(
  {
    satellite: {
      type: Schema.Types.ObjectId,
      ref: "Satellite",
      required: true,
      index: true,
    },

    runId: { type: String, trim: true, index: true },

    epoch: { type: Date, required: true, index: true },

    model: {
      type: { type: String, enum: ["exponential"], default: "exponential" },
      params: { type: Schema.Types.Mixed },
    },

    remainingKg: { type: Number, min: 0 },
    remainingPct: { type: Number, min: 0, max: 100, required: true },
    consumedKg: { type: Number, min: 0 },

    event: {
      type: String,
      enum: ["update", "burn", "threshold", "graveyard"],
      default: "update",
      index: true,
    },

    source: {
      type: String,
      enum: ["telemetry", "simulation", "estimate"],
      default: "simulation",
      index: true,
    },

    maneuver: { type: Schema.Types.ObjectId, ref: "Maneuver", index: true },
    notes: { type: String, trim: true },
  },
  {
    timestamps: true,
    versionKey: false,
    strict: "throw",
  },
);

FuelLogSchema.index(
  { satellite: 1, epoch: -1 },
  { name: "fuelLog_satellite_epoch" },
);
FuelLogSchema.index(
  { event: 1, epoch: -1 },
  { name: "fuelLog_event_epoch" },
);

module.exports = mongoose.model("FuelLog", FuelLogSchema);

