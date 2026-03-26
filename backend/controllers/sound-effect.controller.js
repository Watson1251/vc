// controllers/sound-effect.controller.js
const mongoose = require("mongoose");
const SoundEffect = require("../models/sound-effect.model");
const SoundEffectType = require("../models/sound-effect-type.model");
const FileUpload = require("../models/file-upload.model");
const logger = require("/logger/logger");
const fs = require("fs");
const path = require("path");

const MEDIA_ROOT = (process.env.MEDIA_ROOT || "/db/media").replace(/\/+$/, "");

function ensureDirSync(dir) {
    try {
        fs.mkdirSync(dir, { recursive: true });
    } catch { }
}

function moveFileSafe(src, dst) {
    if (!src || !dst || path.resolve(src) === path.resolve(dst)) return;
    try {
        fs.renameSync(src, dst);
    } catch {
        fs.copyFileSync(src, dst);
        try { fs.unlinkSync(src); } catch { }
    }
}

async function moveUploadToSfx(fileId, userId) {
    if (!fileId || !userId) return;

    const fileDoc = await FileUpload.findById(fileId).lean();
    if (!fileDoc) return;

    if (fileDoc.userId && fileDoc.userId !== userId) {
        throw new Error("File does not belong to current user");
    }

    const sfxDir = path.join(MEDIA_ROOT, String(userId), "sfx");
    ensureDirSync(sfxDir);

    const baseName = (fileDoc.filename || `sfx_${fileDoc._id}`).replace(/\.enc$/i, "");
    let dest = path.join(sfxDir, `${baseName}.enc`);
    if (fs.existsSync(dest) && path.resolve(dest) !== path.resolve(fileDoc.filepath || "")) {
        dest = path.join(sfxDir, `${fileDoc._id}_${baseName}.enc`);
    }

    if (fileDoc.filepath && fs.existsSync(fileDoc.filepath)) {
        moveFileSafe(fileDoc.filepath, dest);
    }

    let enhancedDest = fileDoc.enhancedPath || null;
    if (fileDoc.enhancedPath && fs.existsSync(fileDoc.enhancedPath)) {
        const ext = path.extname(dest);
        const base = path.basename(dest, ext);
        enhancedDest = path.join(sfxDir, `${base}_enhanced${ext}`);
        moveFileSafe(fileDoc.enhancedPath, enhancedDest);
    }

    await FileUpload.updateOne(
        { _id: fileDoc._id },
        { $set: { filepath: dest, enhancedPath: enhancedDest } }
    );
}

const AR = {
    CREATED: "تم إنشاء المؤثر الصوتي بنجاح.",
    CREATE_FAILED: "فشل في إنشاء المؤثر الصوتي.",
    FETCH_FAILED_ALL: "فشل في جلب المؤثرات الصوتية.",
    NOT_FOUND: "المؤثر الصوتي غير موجود.",
    FETCH_FAILED_ONE: "فشل في جلب بيانات المؤثر الصوتي.",
    UPDATED: "تم تحديث المؤثر الصوتي بنجاح.",
    UPDATE_FAILED: "فشل في تحديث المؤثر الصوتي.",
    DELETED: "تم حذف المؤثر الصوتي بنجاح.",
    DELETE_FAILED: "فشل في حذف المؤثر الصوتي.",
    TYPE_REQUIRED: "يجب تحديد نوع مؤثر صوتي صالح.",
    TYPE_NOT_FOUND: "نوع المؤثر الصوتي المحدد غير موجود.",
    FILE_REQUIRED: "يجب تحديد ملف صالح.",
    FILE_NOT_FOUND: "الملف المحدد غير موجود.",
    VALIDATION_FAILED: "البيانات المدخلة غير صحيحة.",
    UNAUTHORIZED: "أنت غير مصرح لك بالوصول!",
};

// --- add near top (reuse your prior pattern) ---
function requireOwnerCtx(req, res) {
    const username = req.userData?.userId || req.userId || null; // e.g. "admin"
    const oid = req.ownerId || null;                              // e.g. ObjectId("...")
    if (!username && !oid) {
        res.status(401).json({ message: AR.UNAUTHORIZED });
        return null;
    }
    return { username, oid };
}

// Can the given model (SoundEffectType, FileUpload) express ownership as owner/userId/username?
function buildOwnerFilterForModel(Model, ownerCtx) {
    const ors = [];
    const p = Model.schema.paths;

    if (p.owner) {
        const inst = p.owner.instance;
        if (inst === 'ObjectId' && ownerCtx.oid) ors.push({ owner: ownerCtx.oid });
        if (inst === 'String' && ownerCtx.username) ors.push({ owner: ownerCtx.username });
    }
    if (p.userId && ownerCtx.username) {
        const inst = p.userId.instance;
        if (inst === 'String') ors.push({ userId: ownerCtx.username });
    }
    if (p.username && ownerCtx.username) {
        const inst = p.username.instance;
        if (inst === 'String') ors.push({ username: ownerCtx.username });
    }

    return ors.length ? { $or: ors } : {};
}

async function assertTypeOwned(soundEffectTypeId, ownerCtx, res) {
    if (!soundEffectTypeId || !mongoose.Types.ObjectId.isValid(soundEffectTypeId)) {
        res.status(400).json({ message: AR.TYPE_REQUIRED });
        return null;
    }
    const ownerFilter = buildOwnerFilterForModel(SoundEffectType, ownerCtx);
    const type = await SoundEffectType.findOne({ _id: soundEffectTypeId, ...ownerFilter }).lean();
    if (!type) {
        res.status(400).json({ message: AR.TYPE_NOT_FOUND });
        return null;
    }
    return type;
}

async function assertFileOwned(fileId, ownerCtx, res) {
    if (!fileId || !mongoose.Types.ObjectId.isValid(fileId)) {
        res.status(400).json({ message: AR.FILE_REQUIRED });
        return null;
    }
    const ownerFilter = buildOwnerFilterForModel(FileUpload, ownerCtx);
    const f = await FileUpload.findOne({ _id: fileId, ...ownerFilter }).lean();
    if (!f) {
        res.status(400).json({ message: AR.FILE_NOT_FOUND });
        return null;
    }
    return f;
}

function requireOwner(req, res) {
    if (!req.ownerId) {
        res.status(401).json({ message: AR.UNAUTHORIZED });
        return null;
    }
    return req.ownerId;
}

function handleMongoError(err, res, fallback) {
    if (err?.name === "ValidationError") {
        return res.status(400).json({ message: AR.VALIDATION_FAILED });
    }
    if (err?.code === 11000) {
        // covers unique indexes like (owner, soundEffectTypeId, name)
        return res.status(400).json({ message: AR.VALIDATION_FAILED });
    }
    return res.status(500).json({ message: fallback });
}

async function assertTypeOwned(soundEffectTypeId, owner, res) {
    if (!soundEffectTypeId || !mongoose.Types.ObjectId.isValid(soundEffectTypeId)) {
        res.status(400).json({ message: AR.TYPE_REQUIRED });
        return null;
    }
    const type = await SoundEffectType.findOne({ _id: soundEffectTypeId, owner }).lean();
    if (!type) {
        res.status(400).json({ message: AR.TYPE_NOT_FOUND });
        return null;
    }
    return type;
}

async function assertFileOwned(fileId, owner, res) {
    if (!fileId || !mongoose.Types.ObjectId.isValid(fileId)) {
        res.status(400).json({ message: AR.FILE_REQUIRED });
        return null;
    }
    const q = { _id: fileId };
    // If FileUpload schema has an `owner` field, enforce same owner:
    if (FileUpload.schema.paths.owner) q.owner = owner;

    const f = await FileUpload.findOne(q).lean();
    if (!f) {
        res.status(400).json({ message: AR.FILE_NOT_FOUND });
        return null;
    }
    return f;
}


// ---- tiny helper to coerce optional numbers ----
function coerceOptionalNumber(v) {
    if (v === null) return null;                   // explicit null clears it
    if (v === undefined || v === "") return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;     // ignore invalid
}

/**
 * POST /sound-effects
 * Body: { name, fileId, soundEffectTypeId }
 * Scope: current user only
 */
exports.createSoundEffect = async (req, res) => {
    const owner = requireOwner(req, res);
    if (!owner) return;

    try {
        const { name, fileId, soundEffectTypeId } = req.body || {};
        const start = coerceOptionalNumber(req.body?.start);
        const end = coerceOptionalNumber(req.body?.end);

        const [type, file] = await Promise.all([
            assertTypeOwned(soundEffectTypeId, owner, res),
            assertFileOwned(fileId, owner, res),
        ]);
        if (!type || !file) return;



        try {
            await moveUploadToSfx(fileId, req.userId);
        } catch (e) {
            logger.warn(`⚠️ moveUploadToSfx failed: ${e.message}`);
            return res.status(500).json({ message: AR.CREATE_FAILED });
        }

        const doc = await SoundEffect.create({
            name,
            fileId,
            soundEffectTypeId,
            owner,
            ...(start !== undefined ? { start } : {}),
            ...(end !== undefined ? { end } : {}),
        });

        logger.info(`🆕 [${owner}] Created soundEffect "${doc.name}" in type "${type.soundEffectType}"`);
        return res.status(201).json({ message: AR.CREATED, soundEffect: doc });
    } catch (err) {
        logger.error(`❌ createSoundEffect: ${err.message}`);
        return handleMongoError(err, res, AR.CREATE_FAILED);
    }
};

/**
 * GET /sound-effects?soundEffectTypeId=&name=
 * Returns ONLY caller's effects (optionally filtered).
 */
exports.getAllSoundEffects = async (req, res) => {
    const owner = requireOwner(req, res);
    if (!owner) return;

    try {
        const { soundEffectTypeId, name } = req.query || {};
        const q = { owner };

        if (soundEffectTypeId) {
            if (!mongoose.Types.ObjectId.isValid(soundEffectTypeId)) {
                return res.status(400).json({ message: AR.TYPE_REQUIRED });
            }
            // make sure that type is owned by the same user
            const ownedType = await SoundEffectType.exists({ _id: soundEffectTypeId, owner });
            if (!ownedType) return res.status(400).json({ message: AR.TYPE_NOT_FOUND });
            q.soundEffectTypeId = soundEffectTypeId;
        }

        if (typeof name === "string" && name.trim()) {
            q.name = { $regex: name.trim(), $options: "i" };
        }

        const items = await SoundEffect.find(q)
            .populate({ path: "soundEffectTypeId", select: "soundEffectType" })
            .populate({ path: "fileId", select: "filename filepath mimetype enhancedPath" })
            .lean();

        return res.status(200).json({ soundEffects: items });
    } catch (err) {
        return res.status(500).json({ message: AR.FETCH_FAILED_ALL });
    }
};

/**
 * GET /sound-effects/:id
 * Returns one effect if owned by caller
 */
exports.getSoundEffect = async (req, res) => {
    const owner = requireOwner(req, res);
    if (!owner) return;

    try {
        const item = await SoundEffect.findOne({ _id: req.params.id, owner })
            .populate({ path: "soundEffectTypeId", select: "soundEffectType" })
            .populate({ path: "fileId", select: "filename filepath mimetype enhancedPath" })
            .lean();

        if (!item) return res.status(404).json({ message: AR.NOT_FOUND });
        return res.status(200).json(item);
    } catch (err) {
        return res.status(500).json({ message: AR.FETCH_FAILED_ONE });
    }
};

/**
 * PUT /sound-effects/:id
 * Body: { name?, soundEffectTypeId?, fileId? }
 * Updates only caller's effect; validates ownership for refs.
 */
exports.updateSoundEffect = async (req, res) => {
    const owner = requireOwner(req, res);
    if (!owner) return;

    try {
        const { name, soundEffectTypeId, fileId } = req.body || {};
        const start = coerceOptionalNumber(req.body?.start);
        const end = coerceOptionalNumber(req.body?.end);

        const updates = {};

        if (name !== undefined) updates.name = String(name);

        if (soundEffectTypeId !== undefined) {
            const type = await assertTypeOwned(soundEffectTypeId, owner, res);
            if (!type) return;
            updates.soundEffectTypeId = soundEffectTypeId;
        }

        if (fileId !== undefined) {
            const file = await assertFileOwned(fileId, owner, res);
            if (!file) return;
            try {
                await moveUploadToSfx(fileId, req.userId);
            } catch (e) {
                logger.warn(`⚠️ moveUploadToSfx failed: ${e.message}`);
                return res.status(500).json({ message: AR.UPDATE_FAILED });
            }
            updates.fileId = fileId;
        }

        // ⬇️ Apply start/end when provided
        if (start !== undefined) updates.start = start; // number or null
        if (end !== undefined) updates.end = end;   // number or null

        const updated = await SoundEffect.findOneAndUpdate(
            { _id: req.params.id, owner },
            updates,
            { new: true, runValidators: true, context: "query" }
        )
            .populate({ path: "soundEffectTypeId", select: "soundEffectType" })
            .populate({ path: "fileId", select: "filename filepath mimetype enhancedPath" });

        if (!updated) return res.status(404).json({ message: AR.NOT_FOUND });
        return res.status(200).json({ message: AR.UPDATED, soundEffect: updated });
    } catch (err) {
        logger.error(`❌ updateSoundEffect: ${err.message}`);
        return handleMongoError(err, res, AR.UPDATE_FAILED);
    }
};


/**
 * DELETE /sound-effects/:id
 * Order: delete file(s) on disk -> delete FileUpload doc -> delete SoundEffect doc
 */
exports.deleteSoundEffect = async (req, res) => {
    const owner = requireOwner(req, res);
    if (!owner) return;

    try {
        // 0) Load the SFX first (DON’T delete it yet)
        const sfx = await SoundEffect.findOne({ _id: req.params.id, owner }).lean();
        if (!sfx) return res.status(404).json({ message: AR.NOT_FOUND });

        const fileId = sfx.fileId;

        // 1) Find the FileUpload doc BEFORE touching the SFX
        let q = { _id: fileId };
        if (FileUpload.schema.paths.owner) q.owner = owner;
        else if (FileUpload.schema.paths.userId) q.userId = owner;

        const fileDoc = await FileUpload.findOne({ _id: fileId }).lean();
        if (!fileDoc) {
            logger.warn(
                `⚠️ FileUpload doc not found (fileId=${fileId}) while deleting SFX; will still delete SFX`
            );
        } else {
            // (Optional safety) If you want to keep shared files, uncomment this block:
            // const refs = await SoundEffect.countDocuments({ fileId, owner });
            // if (refs > 1) {
            //   logger.info(`ℹ️ FileId=${fileId} still referenced by ${refs} SFX; skipping file+doc delete`);
            // } else {

            // 2) Delete physical file(s) from disk first
            const pathsToDelete = [fileDoc.filepath].filter(Boolean);
            if (fileDoc.enhancedPath) pathsToDelete.push(fileDoc.enhancedPath);

            for (const p of pathsToDelete) {
                try {
                    if (p && fs.existsSync(p)) {
                        fs.unlinkSync(p);
                        logger.info(`🗑️ Deleted file from disk: ${p}`);
                    } else {
                        logger.info(`ℹ️ File path not found on disk (skipping): ${p}`);
                    }
                } catch (e) {
                    logger.warn(`⚠️ Could not delete file "${p}": ${e.message}`);
                }
            }

            // 3) Delete the FileUpload doc
            try {
                await FileUpload.deleteOne({ _id: fileDoc._id });
                logger.info(`🗑️ Deleted FileUpload doc: ${fileDoc._id}`);
            } catch (e) {
                logger.warn(`⚠️ Could not delete FileUpload doc ${fileDoc._id}: ${e.message}`);
            }
            // } // end optional safety
        }

        // 4) Finally, delete the SoundEffect doc
        await SoundEffect.deleteOne({ _id: sfx._id, owner });
        logger.info(`✅ Deleted soundEffect ${sfx._id} (owner=${owner})`);

        return res.status(200).json({ message: AR.DELETED });
    } catch (err) {
        logger.error(`❌ deleteSoundEffect: ${err.message}`);
        return res.status(500).json({ message: AR.DELETE_FAILED });
    }
};
