// models/clone-action.model.js
const mongoose = require("mongoose");

const STATUS = [
    "NOT_SCHEDULED",
    "SCHEDULED",     // queued but not started
    "RUNNING",       // engine picked it
    "DONE",          // completed
    "FAILED",        // completed with error
    "CANCELLED",     // stopped by user
];

const cloneActionSchema = new mongoose.Schema(
    {
        scenario: { type: String, trim: true, default: "" },

        contentAudio: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "FileUpload",
            required: true,
            index: true,
        },

        target: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Target",
            required: true,
            index: true,
        },

        referenceAudio: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "FileUpload",
            required: true,
            index: true,
        },

        modelPath: { type: String, default: "" },
        configPath: { type: String, default: "" },

        soundEffect: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "SoundEffect",
            required: false,
            index: true,
        },

        diffusion: { type: Number, default: 25.0 },
        length: { type: Number, default: 1.0 },
        inference_rate: { type: Number, default: 0.7 },

        owner: { type: String, required: true, index: true },

        // ✅ NEW
        status: {
            type: String,
            enum: STATUS,
            default: "NOT_SCHEDULED",
            index: true,
        },

        outputPath: { type: mongoose.Schema.Types.ObjectId, ref: 'FileUpload', default: null }
    },
    { timestamps: true }
);

cloneActionSchema.index({ owner: 1, target: 1, createdAt: -1 }, { name: "idx_owner_target_created" });

module.exports = mongoose.model("CloneAction", cloneActionSchema);
module.exports.STATUS = STATUS;
