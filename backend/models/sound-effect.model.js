const mongoose = require("mongoose");
// const uniqueValidator = require("mongoose-unique-validator"); // ⬅️ not needed anymore

const soundEffectSchema = new mongoose.Schema(
    {
        name: { type: String, required: true, trim: true },
        fileId: { type: mongoose.Schema.Types.ObjectId, ref: "FileUpload", required: true },
        soundEffectTypeId: { type: mongoose.Schema.Types.ObjectId, ref: "SoundEffectType", required: true },
        owner: { type: mongoose.Schema.Types.ObjectId, ref: "UserSfx", required: true, index: true },

        // ⬇️ Optional cropping positions (in seconds)
        start: {
            type: Number,
            min: [0, "Start must be ≥ 0"],
            default: null,
        },
        end: {
            type: Number,
            min: [0, "End must be ≥ 0"],
            default: null,
            validate: {
                validator: function (v) {
                    if (v == null) return true;
                    const s = this.start == null ? null : Number(this.start);
                    return s == null || Number(v) > s;
                },
                message: "End must be greater than Start",
            },
        },
    },
    { timestamps: true }
);

// ❌ REMOVE the unique index
// soundEffectSchema.index({ owner: 1, soundEffectTypeId: 1, name: 1 }, { unique: true, name: "uniq_owner_type_name" });

// (Optional) keep a non-unique index for faster lookups if you still filter by these fields
soundEffectSchema.index({ owner: 1, soundEffectTypeId: 1, name: 1 }, { name: "idx_owner_type_name" });

// soundEffectSchema.plugin(uniqueValidator); // ⬅️ remove
const SoundEffect = mongoose.model("SoundEffect", soundEffectSchema);
module.exports = SoundEffect;
