const mongoose = require("mongoose");
const uniqueValidator = require("mongoose-unique-validator");

const fileUploadSchema = mongoose.Schema({
    filename: {
        type: String,
        required: true,
    },
    filepath: {
        type: String,
        required: true,
    },
    enhancedPath: {
        type: String,
        default: null,
    },
    mimetype: {
        type: String,
        required: true,
    },
    uploadTime: { type: Number, default: () => Date.now() },
    userId: { type: String, required: true }, // Not encrypted as per your last example
}, {
    toJSON: { getters: true },
    toObject: { getters: true },
});

fileUploadSchema.plugin(uniqueValidator);

module.exports = mongoose.model("FileUpload", fileUploadSchema);