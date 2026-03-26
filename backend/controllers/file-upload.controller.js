// controllers/file-upload.controller.js

const mongoose = require("mongoose");
const CloneAction = require("../models/clone-action.model");
const SoundEffect = require("../models/sound-effect.model");
const Target = require("../models/target.model");
const FileUpload = require("../models/file-upload.model");
const UserSfx = require("../models/user-sfx.model");
const mime = require("mime-types");

// const User = require("../models/user.model"); // ⬅️ uncomment if you can resolve username→_id

const logger = require("/logger/logger");
const path = require("path");
const fs = require("fs");
const HybridFileSecurity = require("/secure");
const axios = require("axios").create({
    timeout: 30_000,
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
});

const VC_ENGINE_URL = (process.env.VC_ENGINE_URL || "http://vc:8000/").replace(/\/+$/, "");
const PREPROCESS_ENDPOINT = `${VC_ENGINE_URL}/preprocess-audio`;
const MEDIA_ROOT = (process.env.MEDIA_ROOT || "/db/media").replace(/\/+$/, "");

function isSfxPath(p, userId) {
    if (!p || !userId) return false;
    const normalized = path.normalize(p);
    const sfxRoot = path.normalize(path.join(MEDIA_ROOT, String(userId), "sfx")) + path.sep;
    return normalized.startsWith(sfxRoot);
}

function isUnderUserRoot(p, userId) {
    if (!p || !userId) return false;
    const normalized = path.normalize(p);
    const root = path.normalize(path.join(MEDIA_ROOT, String(userId))) + path.sep;
    return normalized.startsWith(root);
}

async function listFilesRecursive(dir, out = []) {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
            await listFilesRecursive(full, out);
        } else if (e.isFile()) {
            out.push(full);
        }
    }
    return out;
}

/** Call engine to decrypt→check→convert→duration (returns { wavPath, duration }) */
async function callEnginePreprocess(encryptedPath) {
    try {
        const { data, status } = await axios.post(PREPROCESS_ENDPOINT, {
            path: encryptedPath,
            overwrite: true,
            auto_delete_seconds: 0,
        });

        if (status !== 200) {
            const msg = (data && (data.message || data.error)) || `Engine returned status ${status}`;
            throw new Error(msg);
        }

        return {
            wavPath: data.wav_path,
            duration: data.duration_seconds,
        };
    } catch (err) {
        const msg =
            err?.response?.data?.message ||
            err?.response?.data?.error ||
            err?.message ||
            "Engine preprocessing failed";
        throw new Error(msg);
    }
}

/**
 * GC: Delete FileUploads (and disk files) owned by `userId` that are:
 *  - NOT referenced by Target.referenceAudio/trainingAudio, CloneAction.contentAudio/referenceAudio,
 *    or SoundEffect.fileId (note: SoundEffect.owner is ObjectId(User))
 *  - uploadTime >= 5 minutes ago
 */
async function garbageCollectUnlinkedFiles(userId) {
    const FIVE_MIN_MS = 5 * 60 * 1000;
    const now = Date.now();

    let ownerObjectId = null;
    try {
        const sfxOwner = await UserSfx.findOne({
            $or: [{ userId }, { username: userId }],
        }).select("_id").lean();
        if (sfxOwner?._id) ownerObjectId = sfxOwner._id;
    } catch (e) {
        logger.warn(`⚠️ GC: failed to resolve UserSfx owner for ${userId}: ${e.message}`);
    }

    try {
        const uploads = await FileUpload.find({ userId })
            .select("_id filepath enhancedPath uploadTime")
            .lean();

        const [targets, actions, sfx] = await Promise.all([
            Target.find({ owner: userId }).select("referenceAudio trainingAudio").lean(),
            CloneAction.find({ owner: userId }).select("contentAudio referenceAudio outputPath modelPath configPath").lean(),
            ownerObjectId ? SoundEffect.find({ owner: ownerObjectId }).select("fileId").lean() : Promise.resolve([]),
        ]);

        const protectedIds = new Set();
        for (const t of targets) {
            (t.referenceAudio || []).forEach((id) => id && protectedIds.add(String(id)));
            (t.trainingAudio || []).forEach((id) => id && protectedIds.add(String(id)));
        }
        for (const a of actions) {
            if (a.contentAudio) protectedIds.add(String(a.contentAudio));
            if (a.referenceAudio) protectedIds.add(String(a.referenceAudio));
            if (a.outputPath) protectedIds.add(String(a.outputPath));
        }
        for (const se of sfx) {
            if (se.fileId) protectedIds.add(String(se.fileId));
        }

        // Protect model/config paths stored on records
        const protectedPaths = new Set();
        for (const t of targets) {
            if (t.modelPath && isUnderUserRoot(t.modelPath, userId)) protectedPaths.add(path.normalize(t.modelPath));
            if (t.configPath && isUnderUserRoot(t.configPath, userId)) protectedPaths.add(path.normalize(t.configPath));
        }
        for (const a of actions) {
            if (a.modelPath && isUnderUserRoot(a.modelPath, userId)) protectedPaths.add(path.normalize(a.modelPath));
            if (a.configPath && isUnderUserRoot(a.configPath, userId)) protectedPaths.add(path.normalize(a.configPath));
        }

        let deleted = 0;
        let errors = 0;
        let protectedCount = 0;

        for (const u of uploads) {
            const idStr = String(u._id);
            const oldEnough =
                typeof u.uploadTime === "number" ? now - u.uploadTime >= FIVE_MIN_MS : false;

            if (protectedIds.has(idStr) || isSfxPath(u.filepath, userId) || isSfxPath(u.enhancedPath, userId)) {
                protectedCount++;
                if (u.filepath) protectedPaths.add(path.normalize(u.filepath));
                if (u.enhancedPath) protectedPaths.add(path.normalize(u.enhancedPath));
                continue;
            }
            if (!oldEnough) continue;

            try {
                for (const p of [u.filepath, u.enhancedPath].filter(Boolean)) {
                    try {
                        if (fs.existsSync(p)) {
                            fs.unlinkSync(p);
                            logger.info(`🗑️ GC: deleted file ${p}`);
                        }
                    } catch (delErr) {
                        errors++;
                        logger.warn(`⚠️ GC: failed to delete ${p}: ${delErr.message}`);
                    }
                }

                await FileUpload.deleteOne({ _id: u._id });
                deleted++;
                logger.info(`✅ GC: removed unlinked FileUpload ${idStr}`);
            } catch (e) {
                errors++;
                logger.error(`❌ GC: failed to remove FileUpload ${idStr}: ${e.message}`);
            }
        }

        // Sweep filesystem under user's media root (excluding /sfx)
        const userRoot = path.join(MEDIA_ROOT, String(userId));
        if (fs.existsSync(userRoot)) {
            try {
                const files = await listFilesRecursive(userRoot);
                for (const f of files) {
                    if (isSfxPath(f, userId)) continue;
                    const norm = path.normalize(f);
                    if (protectedPaths.has(norm)) continue;

                    try {
                        const stat = await fs.promises.stat(f);
                        const oldEnough = now - stat.mtimeMs >= FIVE_MIN_MS;
                        if (!oldEnough) continue;
                        await fs.promises.unlink(f);
                        deleted++;
                        logger.info(`🗑️ GC: deleted unlinked file ${f}`);
                    } catch (e) {
                        errors++;
                        logger.warn(`⚠️ GC: failed to delete ${f}: ${e.message}`);
                    }
                }
            } catch (e) {
                errors++;
                logger.warn(`⚠️ GC: failed to scan user root ${userRoot}: ${e.message}`);
            }
        }

        const result = { scanned: uploads.length, protected: protectedCount, deleted, errors };
        logger.info(
            `🧹 GC summary (userId=${userId}): scanned=${result.scanned}, protected=${result.protected}, deleted=${result.deleted}, errors=${result.errors}`
        );
        return result;
    } catch (e) {
        logger.error(`❌ GC fatal error (userId=${userId}): ${e.message}`);
        return { scanned: 0, protected: 0, deleted: 0, errors: 1 };
    }
}

/** Minimal shape your frontend expects under result / results / file / files */
function toClientMinimal(raw) {
    const _id = String(raw._id || raw.fileId || raw.id || "");
    const filename = raw.filename || raw.name || "";
    return {
        _id,
        id: _id,
        fileId: _id,
        filename,
        name: filename,
    };
}

// ---------- Basic endpoints ----------

exports.getFiles = async (req, res) => {
    const userId = req.userData.userId;
    try {
        const fetched = await FileUpload.find({ userId }).sort({ createdAt: -1 }).lean();
        logger.info(`📂 Retrieved ${fetched.length} files for userId=${userId}`);
        const files = fetched.map(f => toClientMinimal({ _id: f._id, filename: f.filename }));
        return res.status(200).json({
            message: "Files fetched successfully!",
            files,      // minimal array
            raw: fetched,
        });
    } catch (error) {
        logger.error(`❌ Failed to fetch files for userId=${userId}: ${error.message}`);
        return res.status(500).json({ message: "Fetching files failed!" });
    }
};

// Single helper to process one file
async function processOneUpload(file, userId) {
    const security = new HybridFileSecurity();
    const originalName = Buffer.from(file.originalname || "", "latin1").toString("utf8");
    const originalPath = file.path;
    const mimetype = file.mimetype || "application/octet-stream";

    let encryptedPath = null;

    try {
        encryptedPath = security.encryptFile(originalPath);
        logger.info(`🔐 Encrypted file saved: ${encryptedPath}`);
    } catch (e) {
        try { if (fs.existsSync(originalPath)) fs.unlinkSync(originalPath); } catch { }
        throw new Error(`Encryption failed: ${e.message}`);
    } finally {
        try {
            if (fs.existsSync(originalPath)) {
                fs.unlinkSync(originalPath);
                logger.info(`🗑️ Removed plaintext upload: ${originalPath}`);
            }
        } catch (delErr) {
            logger.warn(`⚠️ Failed to delete plaintext ${originalPath}: ${delErr.message}`);
        }
    }

    // Engine preprocess
    let preprocess;
    try {
        logger.info(`🎧 Calling engine preprocess for ${encryptedPath}`);
        preprocess = await callEnginePreprocess(encryptedPath);
        logger.info(`✅ Engine OK (duration=${preprocess.duration}s) for ${encryptedPath}`);
    } catch (e) {
        try {
            if (encryptedPath && fs.existsSync(encryptedPath)) {
                fs.unlinkSync(encryptedPath);
                logger.info(`🗑️ Deleted encrypted after engine failure: ${encryptedPath}`);
            }
        } catch { }
        throw new Error(e.message || "Engine preprocessing failed");
    }

    // Save DB row after success
    const saved = await new FileUpload({
        filename: originalName,
        filepath: encryptedPath,
        enhancedPath: null,
        mimetype,
        userId,
    }).save();

    return {
        file: {
            _id: saved._id,
            filename: saved.filename,
            filepath: saved.filepath,
            mimetype: saved.mimetype,
            uploadTime: saved.createdAt,
            userId: saved.userId,
        },
        duration: preprocess.duration,
        wavPath: preprocess.wavPath,
    };
}

// --- createFile with file/files + result/results/raw ---
exports.createFile = async (req, res) => {
    const userId = req.userData?.userId;

    const filesIn = [];
    if (req.file) filesIn.push(req.file);
    if (Array.isArray(req.files) && req.files.length) filesIn.push(...req.files);

    if (!filesIn.length) {
        logger.warn(`⚠️ No files uploaded by userId=${userId}`);
        return res.status(400).json({ error: "No files uploaded" });
    }

    const toSuccessPayload = ({ file, duration, wavPath }) => ({
        _id: String(file._id),
        id: String(file._id),
        fileId: String(file._id),
        filename: file.filename,
        name: file.filename,

        filepath: file.filepath,
        mimetype: file.mimetype,
        uploadTime: file.uploadTime || file.createdAt,
        duration,
        wavPath,
        userId: file.userId
    });

    const successes = [];
    const errors = [];

    for (const f of filesIn) {
        try {
            const result = await processOneUpload(f, userId);
            successes.push(toSuccessPayload(result));
        } catch (err) {
            const fname = Buffer.from(f.originalname || "", "latin1").toString("utf8");
            logger.error(`❌ Upload processing failed for ${fname}: ${err.message}`);
            errors.push({ filename: fname, error: err.message });
            try { if (f.path && fs.existsSync(f.path)) fs.unlinkSync(f.path); } catch { }
        }
    }

    const minimalFiles = successes.map(toClientMinimal);

    // All failed
    if (errors.length && !successes.length) {
        return res.status(502).json({
            message: "One or more files failed during preprocessing.",
            file: null,
            files: [],
            result: null,
            results: [],
            raw: [],
            errors
        });
    }

    // Partial success
    if (errors.length) {
        setTimeout(() => {
            garbageCollectUnlinkedFiles(userId).catch(e =>
                logger.warn(`⚠️ GC background error: ${e.message}`)
            );
        }, 5000);

        return res.status(207).json({
            message: "Some files uploaded successfully, some failed during preprocessing.",
            // what your frontend expects:
            file: minimalFiles[0] || null,
            files: minimalFiles,

            // back-compat:
            result: minimalFiles[0] || null,
            results: minimalFiles,
            raw: successes,

            errors,
            gc: { triggered: true }
        });
    }

    // All good
    logger.info(`✅ Uploaded, encrypted & preprocessed ${successes.length} file(s) for userId: ${userId}`);

    setTimeout(() => {
        garbageCollectUnlinkedFiles(userId)
            .then(gc =>
                logger.info(
                    `🧹 GC done (userId=${userId}): scanned=${gc.scanned}, protected=${gc.protected}, deleted=${gc.deleted}, errors=${gc.errors}`
                )
            )
            .catch(e => logger.warn(`⚠️ GC background error: ${e.message}`));
    }, 5000);

    // Single-file success
    if (successes.length === 1) {
        return res.status(201).json({
            message: "Files uploaded, encrypted, and preprocessed successfully",
            file: minimalFiles[0],
            files: minimalFiles,
            result: minimalFiles[0],
            results: minimalFiles,
            raw: successes,
            gc: { triggered: true }
        });
    }

    // Multi-file success
    return res.status(201).json({
        message: "Files uploaded, encrypted, and preprocessed successfully",
        file: minimalFiles[0],
        files: minimalFiles,
        result: minimalFiles[0],
        results: minimalFiles,
        raw: successes,
        gc: { triggered: true }
    });
};


function isMagicHeaderError(err) {
    const msg = String(err?.message || "");
    return /missing magic header|invalid file format/i.test(msg);
}

exports.retrieveFile = async (req, res) => {
    const fileId = req.params.id;
    const isEnhanced = req.query.enhanced === "true";
    const userId = req.userData.userId;

    logger.info(`📥 Retrieve fileId=${fileId} (enhanced=${isEnhanced}) userId=${userId}`);

    try {
        const file = await FileUpload.findOne({ _id: fileId, userId });
        if (!file) {
            logger.warn(`⚠️ File not found or access denied: ${fileId}`);
            return res.status(404).json({ error: "File not found or access denied" });
        }

        // Choose encrypted/enhanced path
        let encryptedPath = file.filepath;
        if (isEnhanced) {
            const dir = path.dirname(encryptedPath);
            const ext = path.extname(encryptedPath);
            const base = path.basename(encryptedPath, ext);
            const enhancedPath = path.join(dir, `${base}_enhanced${ext}`);
            logger.info(`🔍 Check enhanced path: ${enhancedPath}`);
            if (!fs.existsSync(enhancedPath)) {
                return res.status(404).json({ error: "Enhanced file not found" });
            }
            encryptedPath = enhancedPath;
        }

        if (!fs.existsSync(encryptedPath)) {
            logger.warn(`⚠️ Missing on disk: ${encryptedPath}`);
            return res.status(404).json({ error: "File not found on server" });
        }

        const security = new HybridFileSecurity();

        // Try decrypt → if it's a plain file (no magic), serve as-is
        let finalPath = null;
        let isTemp = false;

        try {
            finalPath = security.decryptToTemp(encryptedPath);
            isTemp = true;
            logger.info(`🔓 Decrypted to temp: ${finalPath}`);
        } catch (e) {
            if (isMagicHeaderError(e)) {
                // Not encrypted: fall back to raw
                finalPath = encryptedPath;
                isTemp = false;
                logger.info(`ℹ️ Not encrypted (no magic header). Serving raw: ${finalPath}`);
            } else {
                throw e;
            }
        }

        // Set the content type based on actual file we’re serving
        const type = mime.lookup(finalPath) || "application/octet-stream";
        res.setHeader("Content-Type", type);

        res.sendFile(finalPath, (err) => {
            if (err) {
                logger.error(`❌ sendFile error: ${err.message}`);
            }
            if (isTemp) {
                fs.unlink(finalPath, (delErr) => {
                    if (delErr) logger.warn(`⚠️ Failed to delete temp: ${finalPath}: ${delErr.message}`);
                    else logger.info(`🗑️ Temp deleted: ${finalPath}`);
                });
            }
        });
    } catch (err) {
        logger.error(`❌ retrieveFile error: ${err.message}`);
        return res.status(500).json({ error: "Failed to retrieve file" });
    }
};

exports.getFile = async (req, res) => {
    const fileId = req.params.id;
    const userId = req.userData.userId;

    try {
        logger.info(`🔍 Get meta fileId=${fileId} userId=${userId}`);
        const file = await FileUpload.findOne({ _id: fileId, userId }).lean();
        if (!file) {
            return res.status(404).json({ error: "File not found or access denied" });
        }
        const minimal = toClientMinimal({ _id: file._id, filename: file.filename });
        return res.status(200).json({
            file: minimal, // minimal (keeps frontend expectations consistent)
            raw: {
                _id: file._id,
                filename: file.filename,
                mimetype: file.mimetype,
                uploadTime: file.createdAt,
            },
        });
    } catch (err) {
        logger.error(`❌ getFile error: ${err.message}`);
        return res.status(500).json({ error: "Failed to get file metadata" });
    }
};

exports.updateFile = async (req, res) => {
    const fileId = req.params.id;
    const userId = req.userData.userId;
    const { filename, filepath } = req.body;

    try {
        const file = await FileUpload.findOne({ _id: fileId, userId });
        if (!file) {
            return res.status(404).json({ error: "File not found or access denied" });
        }
        if (filename) file.filename = filename;
        if (filepath) file.filepath = filepath;

        const updated = await file.save();
        const minimal = toClientMinimal({ _id: updated._id, filename: updated.filename });

        logger.info(`✏️ Updated file meta: ${fileId}`);
        res.status(200).json({
            message: "File metadata updated",
            file: minimal,
            raw: updated
        });
    } catch (err) {
        logger.error(`❌ updateFile error: ${err.message}`);
        res.status(500).json({ error: "Failed to update file metadata" });
    }
};

exports.deleteFile = async (req, res) => {
    const fileId = req.params.id;
    const userId = req.userData.userId;

    try {
        const file = await FileUpload.findOne({ _id: fileId, userId });
        if (!file) {
            return res.status(404).json({ error: "File not found or access denied" });
        }

        const filePath = file.filepath;
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            logger.info(`🗑️ Deleted from disk: ${filePath}`);
        }

        await file.deleteOne();
        logger.info(`✅ Deleted file meta: ${fileId}`);
        res.status(200).json({ message: "File deleted successfully" });
    } catch (err) {
        logger.error(`❌ deleteFile error: ${err.message}`);
        res.status(500).json({ error: "Failed to delete file" });
    }
};
