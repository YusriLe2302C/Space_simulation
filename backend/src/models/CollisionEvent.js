const mongoose = require("mongoose");

const { Schema } = mongoose;

const CollisionEventSchema = new Schema(
  {
    runId: { type: String, trim: true, index: true },

    epoch: { type: Date, required: true, index: true },
    timeOfClosestApproach: { type: Date, required: true, index: true },

    thresholdKm: { type: Number, default: 0.1, min: 0 },
    missDistanceKm: { type: Number, required: true, min: 0, index: true },
    relativeSpeedKms: { type: Number, min: 0 },

    primarySatellite: {
      type: Schema.Types.ObjectId,
      ref: "Satellite",
      required: true,
      index: true,
    },

    secondaryType: {
      type: String,
      enum: ["Satellite", "Debris"],
      required: true,
      index: true,
    },
    secondaryObject: {
      type: Schema.Types.ObjectId,
      required: true,
      refPath: "secondaryType",
      index: true,
    },

    risk: {
      probability: { type: Number, min: 0, max: 1 },
      score: { type: Number, min: 0, index: true },
      classification: {
        type: String,
        enum: ["low", "medium", "high", "critical"],
        default: "low",
        index: true,
      },
    },

    status: {
      type: String,
      enum: ["detected", "acknowledged", "mitigated", "false_positive", "closed"],
      default: "detected",
      index: true,
    },

    decision: {
      action: {
        type: String,
        enum: ["none", "recommend", "scheduled", "executed"],
        default: "none",
        index: true,
      },
      maneuver: { type: Schema.Types.ObjectId, ref: "Maneuver", index: true },
      notes: { type: String, trim: true },
    },

    metadata: { type: Schema.Types.Mixed },
  },
  {
    timestamps: true,
    versionKey: false,
    strict: "throw",
  },
);

CollisionEventSchema.index(
  { timeOfClosestApproach: 1, missDistanceKm: 1 },
  { name: "collisionEvent_tca_missDistance" },
);
CollisionEventSchema.index(
  { primarySatellite: 1, timeOfClosestApproach: 1 },
  { name: "collisionEvent_primary_tca" },
);
CollisionEventSchema.index(
  { secondaryType: 1, secondaryObject: 1, timeOfClosestApproach: 1 },
  { name: "collisionEvent_secondary_tca" },
);
CollisionEventSchema.index(
  { status: 1, timeOfClosestApproach: 1 },
  { name: "collisionEvent_status_tca" },
);

module.exports = mongoose.model("CollisionEvent", CollisionEventSchema);

