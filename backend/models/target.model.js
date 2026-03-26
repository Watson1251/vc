// models/target.model.js
const mongoose = require("mongoose");

const STATUS = ["NOT_SCHEDULED", "SCHEDULED", "STARTED_TRAINING", "DONE", "FAILED"];

const targetSchema = new mongoose.Schema(
    {
        name: { type: String, required: true, trim: true },
        description: { type: String, trim: true, default: "" },

        owner: { type: String, required: true, index: true },

        status: {
            type: String,
            enum: STATUS,
            default: "NOT_SCHEDULED",
            index: true,
        },
        modelPath: { type: String, default: "" },
        configPath: { type: String, default: "" },

        referenceAudio: [{ type: mongoose.Schema.Types.ObjectId, ref: "FileUpload", index: true }],
        trainingAudio: [{ type: mongoose.Schema.Types.ObjectId, ref: "FileUpload", index: true }],
    },
    { timestamps: true }
);

targetSchema.index({ owner: 1, name: 1 }, { name: "idx_owner_name" });

module.exports = mongoose.model("Target", targetSchema);
module.exports.STATUS = STATUS;
