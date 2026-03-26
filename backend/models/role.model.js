const mongoose = require("mongoose");
const uniqueValidator = require("mongoose-unique-validator");

const roleSchema = new mongoose.Schema({
    name: { type: String, required: true, unique: true },      // e.g., "admin", "viewer"
    adGroups: [{ type: String }],                               // optional AD sync
    isAdmin: { type: Boolean, default: false },                 // admin marker
    permissionHashes: [{ type: String, index: true }],          // store ONLY SHA256 hashes
}, { timestamps: true });

roleSchema.plugin(uniqueValidator);

// Useful composite index for lookups
roleSchema.index({ isAdmin: 1 });

module.exports = mongoose.model("Role", roleSchema);
