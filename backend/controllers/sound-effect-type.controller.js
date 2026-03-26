// controllers/sound-effect-type.controller.js
const mongoose = require("mongoose");
const SoundEffectType = require("../models/sound-effect-type.model");
const logger = require("/logger/logger");

const AR = {
    CREATED: "تم إنشاء نوع المؤثر الصوتي بنجاح.",
    CREATE_FAILED: "فشل في إنشاء نوع المؤثر الصوتي.",
    FETCH_FAILED_ALL: "فشل في جلب أنواع المؤثرات الصوتية.",
    NOT_FOUND: "نوع المؤثر الصوتي غير موجود.",
    FETCH_FAILED_ONE: "فشل في جلب بيانات نوع المؤثر الصوتي.",
    UPDATED: "تم تحديث نوع المؤثر الصوتي بنجاح.",
    UPDATE_FAILED: "فشل في تحديث نوع المؤثر الصوتي.",
    DELETED: "تم حذف نوع المؤثر الصوتي بنجاح.",
    DELETE_FAILED: "فشل في حذف نوع المؤثر الصوتي.",
    DUP: "اسم النوع مستخدم من قبل.",
    VALIDATION_FAILED: "البيانات المدخلة غير صحيحة.",
    UNAUTHORIZED: "أنت غير مصرح لك بالوصول!",
};

function handleMongoError(err, res, fallback) {
    // Validation errors
    if (err?.name === "ValidationError") {
        return res.status(400).json({ message: AR.VALIDATION_FAILED });
    }
    // Duplicate key (covers compound index: { owner, soundEffectType })
    if (err?.code === 11000) {
        return res.status(400).json({ message: AR.DUP });
    }
    return res.status(500).json({ message: fallback });
}

function requireOwner(req, res) {
    if (!req.ownerId) {
        res.status(401).json({ message: AR.UNAUTHORIZED });
        return null;
    }
    return req.ownerId;
}

/**
 * POST /sound-effect-types
 * Body: { soundEffectType }
 * Scope: current user only
 */
exports.createSoundEffectType = async (req, res) => {
    const owner = requireOwner(req, res);
    if (!owner) return;

    try {
        const { soundEffectType } = req.body || {};
        const doc = await SoundEffectType.create({ soundEffectType, owner });
        logger.info(`🆕 [${owner}] Created soundEffectType "${doc.soundEffectType}"`);
        return res.status(201).json({ message: AR.CREATED, soundEffectType: doc });
    } catch (err) {
        logger.error(`❌ createSoundEffectType: ${err.message}`);
        return handleMongoError(err, res, AR.CREATE_FAILED);
    }
};

/**
 * GET /sound-effect-types
 * Returns only the caller's categories
 */
exports.getAllSoundEffectTypes = async (req, res) => {
    const owner = requireOwner(req, res);
    if (!owner) return;

    try {
        const items = await SoundEffectType.find({ owner }).lean();
        return res.status(200).json({ soundEffectTypes: items });
    } catch (err) {
        return res.status(500).json({ message: AR.FETCH_FAILED_ALL });
    }
};

/**
 * GET /sound-effect-types/:id
 * Returns one category if owned by the caller
 */
exports.getSoundEffectType = async (req, res) => {
    const owner = requireOwner(req, res);
    if (!owner) return;

    try {
        const item = await SoundEffectType.findOne({ _id: req.params.id, owner }).lean();
        if (!item) return res.status(404).json({ message: AR.NOT_FOUND });
        return res.status(200).json(item);
    } catch (err) {
        return res.status(500).json({ message: AR.FETCH_FAILED_ONE });
    }
};

/**
 * PUT /sound-effect-types/:id
 * Body: { soundEffectType }
 * Only updates the caller's own category
 */
exports.updateSoundEffectType = async (req, res) => {
    const owner = requireOwner(req, res);
    if (!owner) return;

    try {
        const { soundEffectType } = req.body || {};
        const updated = await SoundEffectType.findOneAndUpdate(
            { _id: req.params.id, owner },
            { soundEffectType },
            { new: true, runValidators: true, context: "query" }
        );
        if (!updated) return res.status(404).json({ message: AR.NOT_FOUND });
        logger.info(`✏️  [${owner}] Updated soundEffectType "${updated.soundEffectType}"`);
        return res.status(200).json({ message: AR.UPDATED, soundEffectType: updated });
    } catch (err) {
        logger.error(`❌ updateSoundEffectType: ${err.message}`);
        return handleMongoError(err, res, AR.UPDATE_FAILED);
    }
};

/**
 * DELETE /sound-effect-types/:id
 * Also deletes ONLY the caller's sound effects under this category
 */
exports.deleteSoundEffectType = async (req, res) => {
    const owner = requireOwner(req, res);
    if (!owner) return;

    const SoundEffect = require("../models/sound-effect.model");

    const doCascadeDelete = async (typeId, ownerId, session = null) => {
        const delEffects = await SoundEffect.deleteMany({ soundEffectTypeId: typeId, owner: ownerId }).session(session);
        const delType = await SoundEffectType.deleteOne({ _id: typeId, owner: ownerId }).session(session);
        return { deletedEffects: delEffects.deletedCount || 0, deletedTypes: delType.deletedCount || 0 };
    };

    let session;
    try {
        const type = await SoundEffectType.findOne({ _id: req.params.id, owner });
        if (!type) return res.status(404).json({ message: AR.NOT_FOUND });

        try {
            session = await mongoose.startSession();
            session.startTransaction();

            const { deletedEffects } = await doCascadeDelete(type._id, owner, session);

            await session.commitTransaction();
            session.endSession();

            logger.info(`🗑️  [${owner}] Deleted type "${type.soundEffectType}" and ${deletedEffects} effect(s).`);
            return res.status(200).json({ message: AR.DELETED, deletedEffects });
        } catch (txErr) {
            if (session) {
                try { await session.abortTransaction(); } catch { }
                session.endSession();
            }

            // Fallback (non-transactional) — still scoped to owner
            const { deletedEffects, deletedTypes } = await doCascadeDelete(type._id, owner, null);
            if (deletedTypes === 0) {
                logger.error(`❌ deleteSoundEffectType fallback failed for ${type._id} [owner=${owner}]`);
                return res.status(500).json({ message: AR.DELETE_FAILED });
            }

            logger.warn(`⚠️ Tx fallback: deleted type "${type.soundEffectType}" and ${deletedEffects} effect(s) without txn.`);
            return res.status(200).json({ message: AR.DELETED, deletedEffects });
        }
    } catch (err) {
        logger.error(`❌ deleteSoundEffectType: ${err.message}`);
        return res.status(500).json({ message: AR.DELETE_FAILED });
    }
};
