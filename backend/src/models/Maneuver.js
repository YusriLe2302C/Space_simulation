const mongoose = require("mongoose");

const { Schema } = mongoose;

const DvVectorSchema = new Schema(
  {
    x: { type: Number, required: true },
    y: { type: Number, required: true },
    z: { type: Number, required: true },
  },
  { _id: false, strict: "throw" },
);

const ManeuverSchema = new Schema(
  {
    requestId: { type: String, required: true, trim: true },

    satellite: {
      type: Schema.Types.ObjectId,
      ref: "Satellite",
      required: true,
      index: true,
    },

    satelliteObjectId: { type: String, required: true, trim: true, index: true },

    runId: { type: String, trim: true, index: true },

    type: {
      type: String,
      enum: ["cola", "station_keeping", "graveyard", "manual"],
      required: true,
      index: true,
    },

    status: {
      type: String,
      enum: [
        "proposed",
        "approved",
        "scheduled",
        "sent",
        "executed",
        "canceled",
        "failed",
      ],
      default: "proposed",
      index: true,
    },

    frame: { type: String, enum: ["ECI"], default: "ECI" },

    dvMs: { type: DvVectorSchema, required: true },
    dvMagMs: { type: Number, required: true, min: 0, max: 15 },

    burnTime: { type: Date, required: true, index: true },
    scheduledFor: { type: Date, index: true },
    sentAt: { type: Date, index: true },
    executedAt: { type: Date, index: true },

    cooldownUntil: { type: Date, index: true },

    reason: {
      code: { type: String, trim: true, index: true },
      message: { type: String, trim: true },
      collisionEvent: { type: Schema.Types.ObjectId, ref: "CollisionEvent" },
    },

    createdBy: { type: String, trim: true, index: true },
    metadata: { type: Schema.Types.Mixed },
  },
  {
    timestamps: true,
    versionKey: false,
    strict: "throw",
  },
);

ManeuverSchema.index(
  { requestId: 1 },
  { unique: true, name: "uniq_maneuver_requestId" },
);
ManeuverSchema.index(
  { satellite: 1, createdAt: -1 },
  { name: "maneuver_satellite_createdAt" },
);
ManeuverSchema.index(
  { status: 1, scheduledFor: 1 },
  { name: "maneuver_status_scheduledFor" },
);
ManeuverSchema.index(
  { runId: 1, status: 1, burnTime: 1 },
  { name: "maneuver_run_status_burnTime" },
);
ManeuverSchema.index(
  { satellite: 1, cooldownUntil: 1 },
  { name: "maneuver_satellite_cooldownUntil" },
);

module.exports = mongoose.model("Maneuver", ManeuverSchema);
