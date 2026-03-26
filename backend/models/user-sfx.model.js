// models/user-sfx.model.js
const mongoose = require("mongoose");
const uniqueValidator = require("mongoose-unique-validator");

const userSfxSchema = new mongoose.Schema(
    {
        userId: { type: String, required: true, unique: true, index: true },
        username: { type: String, default: null },
        name: { type: String, default: null },
        isLdap: { type: Boolean, default: false },

        sfxSeededAt: { type: Date, default: null },
        sfxSeedingLock: { type: Boolean, default: false },
        sfxSeedVersion: { type: Number, default: 0 },
        firstTimeSfx: { type: Boolean, default: false },
    },
    { timestamps: true }
);

userSfxSchema.plugin(uniqueValidator);

module.exports = mongoose.model("UserSfx", userSfxSchema);
