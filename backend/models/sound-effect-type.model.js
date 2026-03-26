// models/sound-effect-type.model.js
const mongoose = require("mongoose");
const uniqueValidator = require("mongoose-unique-validator");

const soundEffectTypeSchema = new mongoose.Schema(
    {
        soundEffectType: { type: String, required: true, trim: true }, // no global unique here
        owner: { type: mongoose.Schema.Types.ObjectId, ref: "UserSfx", required: true, index: true },
    },
    { timestamps: true }
);

// ✅ Unique per user (owner + name). Allows same name across different users.
soundEffectTypeSchema.index(
    { owner: 1, soundEffectType: 1 },
    {
        unique: true,
        name: "uniq_owner_category",
        collation: { locale: "ar", strength: 1 } // strength 1 = ignore case & diacritics
    }
);


soundEffectTypeSchema.plugin(uniqueValidator);

module.exports = mongoose.model("SoundEffectType", soundEffectTypeSchema);
