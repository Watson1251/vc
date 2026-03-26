const express = require("express");
const checkAuth = require("../middleware/check-auth");
const uploadMiddleware = require("../middleware/upload-middleware");
const FileUploadController = require("../controllers/file-upload.controller");

const router = express.Router();

// Inject override parameters into req
const overrideUploadConfig = (req, res, next) => {
    const userId = req.userData?.userId;

    if (!userId) {
        return res.status(400).json({ message: "Missing userId for upload path" });
    }

    req._uploadOptions = {
        uploadSubdir: `${userId}/`,  // ✅ Use userId as the subdir
        mimeTypeMap: {
            // VIDEO …
            "video/mp4": "mp4",
            "video/x-matroska": "mkv",
            "video/quicktime": "mov",
            "video/x-msvideo": "avi",
            "video/webm": "webm",

            // AUDIO …
            "audio/mpeg": "mp3",
            "audio/wav": "wav",
            "audio/x-wav": "wav",   // ⬅ add alias
            "audio/ogg": "ogg",
            "audio/webm": "webm",
            "audio/flac": "flac",
            "audio/aac": "aac",

            // more useful aliases if you need them:
            // "audio/x-m4a": "m4a",
            // "audio/mp4": "m4a"
        },
    };

    next();
};

// CRUD routes
router.get("/", checkAuth, FileUploadController.getFiles);

router.post(
    "/",
    checkAuth,
    overrideUploadConfig,
    uploadMiddleware,
    FileUploadController.createFile
);

router.put("/:id", checkAuth, FileUploadController.updateFile);
router.get("/:id", checkAuth, FileUploadController.retrieveFile);
router.get("/:id/meta", checkAuth, FileUploadController.getFile);
router.delete("/:id", checkAuth, FileUploadController.deleteFile);

module.exports = router;
