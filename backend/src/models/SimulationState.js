const mongoose = require("mongoose");

const { Schema } = mongoose;

const SimulationStateSchema = new Schema(
  {
    runId: { type: String, required: true, trim: true, index: true },

    // Latest simulation timestamp tracked by the API layer.
    // Authoritative detailed state snapshots are stored separately if needed.
    timestamp: { type: Date, required: true, index: true },

    engineVersion: { type: String, trim: true },
    metadata: { type: Schema.Types.Mixed },
  },
  {
    timestamps: true,
    versionKey: false,
    strict: "throw",
  },
);

SimulationStateSchema.index(
  { runId: 1 },
  { unique: true, name: "uniq_simState_runId" },
);
SimulationStateSchema.index(
  { timestamp: -1 },
  { name: "simState_timestamp_desc" },
);

module.exports = mongoose.model("SimulationState", SimulationStateSchema);
