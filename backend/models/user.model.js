// models/user.model.js
const mongoose = require("mongoose");
const uniqueValidator = require("mongoose-unique-validator");

const userSchema = new mongoose.Schema({
    userId: { type: String, required: true, unique: true },
    username: { type: String, required: true, unique: true },
    password: { type: String, default: null },
    name: { type: String, required: true },
    roleIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "Role" }],

}, {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
});

userSchema.plugin(uniqueValidator);

userSchema.virtual("roles", {
    ref: "Role",
    localField: "roleIds",
    foreignField: "_id",
    justOne: false,
});

userSchema.index({ username: 1 });
userSchema.index({ userId: 1 });

module.exports = mongoose.model("User", userSchema);
