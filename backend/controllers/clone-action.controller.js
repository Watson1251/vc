'use strict';

const mongoose = require('mongoose');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const axios = require('axios');

const CloneAction = require('../models/clone-action.model');
const Target = require('../models/target.model');
const FileUpload = require('../models/file-upload.model');

const logger = require('/logger/logger');
const rabbit = require('/rabbitmq/rabbitmq');

const CLONE_QUEUE = process.env.CLONE_QUEUE || 'clone_queue';
const CLONE_CANCEL_QUEUE = process.env.CLONE_CANCEL_QUEUE || 'clone_cancel_queue';
const MEDIA_ROOT = (process.env.MEDIA_ROOT || '/db/media').replace(/\/+$/, '');

const AR = {
    // Generic CRUD
    CREATED: 'تم إنشاء عملية الاستنساخ بنجاح.',
    CREATE_FAILED: 'فشل إنشاء عملية الاستنساخ.',
    FETCH_FAILED_ALL: 'فشل جلب عمليات الاستنساخ.',
    NOT_FOUND: 'لم يتم العثور على عملية الاستنساخ.',
    FETCH_FAILED_ONE: 'فشل جلب عملية الاستنساخ.',
    UPDATED: 'تم تحديث عملية الاستنساخ بنجاح.',
    UPDATE_FAILED: 'فشل تحديث عملية الاستنساخ.',
    DELETED: 'تم حذف عملية الاستنساخ بنجاح.',
    DELETE_FAILED: 'فشل حذف عملية الاستنساخ.',
    UNAUTHORIZED: 'غير مصرح لك!',
    FILE_REQUIRED: 'يجب تزويد ملفات صالحة.',
    FILE_NOT_FOUND: 'ملف واحد أو أكثر غير موجود أو غير مملوك للمستخدم.',
    VALIDATION_FAILED: 'بيانات الإدخال غير صالحة.',
    REF_NOT_IN_TARGET: 'يجب أن يكون المرجع ضمن قائمة مراجع الهدف.',

    // Domain-specific
    TARGET_NOT_OWNED: 'الهدف غير موجود أو غير مملوك للمستخدم.',
    MODEL_TRAIN_FIRST: 'ملف النموذج/الإعداد غير متاح لهذا الهدف. يرجى تدريب الهدف أولًا.',
    CONTENT_MISSING: 'ملف الصوت للمحتوى غير موجود على القرص.',
    REF_MISSING: 'ملف الصوت المرجعي غير موجود على القرص.',
    MODEL_PATH_MISSING: 'مسار النموذج/الإعداد غير موجود على القرص.',
    CONTENT_UNREADABLE: 'مسار ملف الصوت للمحتوى غير قابل للقراءة.',
    REF_UNREADABLE: 'مسار ملف الصوت المرجعي غير قابل للقراءة.',
    MODEL_UNREADABLE: 'مسار النموذج/الإعداد غير موجود.',
    CLONE_NOT_FOUND_AFTER_CREATE: 'لم يتم العثور على عملية الاستنساخ بعد الإنشاء.',

    // Queueing / scheduling
    ALREADY_QUEUED: 'تمت الجدولة مسبقًا للاستنساخ.',
    CLONE_SCHEDULED: 'تم جدولة الاستنساخ.',
    ENQUEUE_FAILED: 'فشل إدراج مهمة الاستنساخ في قائمة الانتظار.',
    SCHEDULE_CANCELLED_REMOVED: 'تم إلغاء الجدولة وإزالتها من قائمة الانتظار.',
    SCHEDULE_CANCELLED_NOT_FOUND: 'تم إلغاء الجدولة (لم يتم العثور على المهمة في قائمة الانتظار).',
};

// ────────────────────────────────────────────────────────────
// Utilities
// ────────────────────────────────────────────────────────────

/** Return both username (string) and oid (ObjectId as string) if present. Sends 401 if missing. */
function requireOwner(req, res) {
    const username = req.userId || null; // e.g., "admin"
    const oid = req.ownerId || null;     // e.g., ObjectId("...")
    if (!username && !oid) {
        res.status(401).json({ message: AR.UNAUTHORIZED });
        return null;
    }
    return { username, oid };
}

function handleMongoError(err, res, fallback) {
    if (err?.name === 'ValidationError') {
        return res.status(400).json({ message: AR.VALIDATION_FAILED });
    }
    if (err?.code === 11000) {
        return res.status(400).json({ message: AR.VALIDATION_FAILED });
    }
    return res.status(500).json({ message: fallback });
}

/** Build an $or ownership filter for FileUpload to cover schema variations. */
function buildFileOwnerFilter(ownerCtx) {
    const ors = [];

    if (FileUpload.schema.paths.owner) {
        const inst = FileUpload.schema.paths.owner.instance;
        if (inst === 'ObjectId' && ownerCtx.oid) ors.push({ owner: ownerCtx.oid });
        if (inst === 'String' && ownerCtx.username) ors.push({ owner: ownerCtx.username });
    }
    if (FileUpload.schema.paths.userId && ownerCtx.username) {
        const inst = FileUpload.schema.paths.userId.instance;
        if (inst === 'String') ors.push({ userId: ownerCtx.username });
    }
    if (FileUpload.schema.paths.username && ownerCtx.username) {
        const inst = FileUpload.schema.paths.username.instance;
        if (inst === 'String') ors.push({ username: ownerCtx.username });
    }

    return ors.length ? { $or: ors } : {};
}

/** Validate a FileUpload id belongs to owner. Returns string id or null (and responds). */
async function assertFileOwned(id, ownerCtx, res, label = 'file') {
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
        res.status(400).json({ message: AR.FILE_REQUIRED });
        return null;
    }
    const ownerFilter = buildFileOwnerFilter(ownerCtx);
    const q = { _id: id, ...(Object.keys(ownerFilter).length ? ownerFilter : {}) };

    const found = await FileUpload.findOne(q).select('_id').lean();
    if (!found) {
        res.status(400).json({ message: `${AR.FILE_NOT_FOUND} (${label})` });
        return null;
    }
    return found._id.toString();
}

async function setStatus(id, status) {
    try {
        await CloneAction.updateOne({ _id: id }, { $set: { status } }).lean();
    } catch (e) {
        logger.warn(`⚠️ setStatus(${id}, ${status}) failed: ${e?.message || e}`);
    }
}

/** Pick an on-disk path from a FileUpload doc (enhancedPath preferred). */
function pickDiskPath(fileDoc) {
    return (fileDoc?.enhancedPath || fileDoc?.filepath || '').toString();
}

async function existsReadable(p) {
    try {
        await fsp.access(p, fs.constants.R_OK);
        return true;
    } catch {
        return false;
    }
}

/** Training status uses "-" placeholders; those must not be treated as real paths. */
function hasTrainableModelPaths(modelPath, configPath) {
    const m = String(modelPath || '').trim();
    const c = String(configPath || '').trim();
    if (!m || !c) return false;
    if (m === '-' || c === '-') return false;
    return true;
}

function ownerSlugOf(ownerCtx) {
    return ownerCtx.username || String(ownerCtx.oid || '');
}

async function enqueueCloneByDoc(cloneActionDoc, ownerCtx, reqBody = {}) {
    // Re-load with the fields we need for paths
    const ca = await CloneAction.findOne({
        _id: cloneActionDoc._id,
        owner: ownerSlugOf(ownerCtx),
    })
        .populate({ path: 'contentAudio', select: 'filename filepath enhancedPath mimetype userId' })
        .populate({ path: 'referenceAudio', select: 'filename filepath enhancedPath mimetype userId' })
        .populate({ path: 'target', select: 'name modelPath configPath owner' })
        .populate({ path: 'soundEffect', select: 'fileId start end' })
        .lean();

    if (!ca) throw new Error(AR.CLONE_NOT_FOUND_AFTER_CREATE);

    const modelPath = String(ca.target?.modelPath || ca.modelPath || '');
    const configPath = String(ca.target?.configPath || ca.configPath || '');
    if (!hasTrainableModelPaths(modelPath, configPath)) throw new Error(AR.MODEL_TRAIN_FIRST);

    const contentPath = pickDiskPath(ca.contentAudio);
    const refPath = pickDiskPath(ca.referenceAudio);
    if (!contentPath || !(await existsReadable(contentPath))) throw new Error(AR.CONTENT_UNREADABLE);
    if (!refPath || !(await existsReadable(refPath))) throw new Error(AR.REF_UNREADABLE);
    if (!(await existsReadable(modelPath)) || !(await existsReadable(configPath))) {
        throw new Error(AR.MODEL_UNREADABLE);
    }

    const owner = ownerSlugOf(ownerCtx);
    // derive ../<targetRoot>/cloned from .../<targetId>/model/ft_model.pth
    const targetRoot = path.dirname(path.dirname(modelPath));
    const outputDir = path.join(targetRoot, 'cloned');
    await fsp.mkdir(outputDir, { recursive: true });

    // Bounded dedupe on queue head (best-effort)
    try {
        const peeked = await rabbit.peek(CLONE_QUEUE, 1000);
        const dup = Array.isArray(peeked) && peeked.some(
            m => m && (m.id === String(ca._id) || m.cloneActionId === String(ca._id))
        );
        if (dup) {
            logger.warn(`🟨 CloneAction ${ca._id} already in first 1000 messages of "${CLONE_QUEUE}"`);
            await setStatus(ca._id, 'SCHEDULED');
            return { enqueued: false, dedup: true, queue: CLONE_QUEUE, status: 'SCHEDULED' };
        }
    } catch (e) {
        logger.warn(`⚠️ peek(${CLONE_QUEUE}) failed; proceeding without dedupe: ${e?.message || e}`);
    }

    const payload = {
        id: String(ca._id),        // cloneActionId
        owner,

        contentPath,               // encrypted; engine will decrypt_to_temp
        referencePath: refPath,    // encrypted; engine will decrypt_to_temp
        modelPath,
        configPath,

        diffusion: Number(ca.diffusion ?? 25.0),
        length: Number(ca.length ?? 1.0),
        inference_rate: Number(ca.inference_rate ?? 0.7),

        outputDir,

        addSoundEffect: !!(reqBody?.addSoundEffect ?? (ca.soundEffect != null)),
    };

    if (payload.addSoundEffect && ca.soundEffect?.fileId) {
        try {
            const sfx = await FileUpload.findOne({ _id: ca.soundEffect.fileId, userId: owner })
                .select('filepath enhancedPath')
                .lean();
            const sfxPath = pickDiskPath(sfx);
            if (sfxPath && (await existsReadable(sfxPath))) {
                payload.soundEffectPath = sfxPath; // encrypted; engine decrypts
                payload.soundEffectTrim = { start: ca.soundEffect.start ?? null, end: ca.soundEffect.end ?? null };
            } else {
                logger.warn(`⚠️ soundEffect file not readable, skipping: ${ca.soundEffect.fileId}`);
            }
        } catch (e) {
            logger.warn(`⚠️ soundEffect lookup failed (${ca.soundEffect.fileId}): ${e?.message || e}`);
        }
    }

    await rabbit.publish(CLONE_QUEUE, payload, { messageId: String(ca._id) });
    await setStatus(ca._id, 'SCHEDULED');
    logger.info(`📥 Auto-enqueued clone job for cloneAction ${ca._id} on "${CLONE_QUEUE}"`);

    return { enqueued: true, dedup: false, queue: CLONE_QUEUE, status: 'SCHEDULED' };
}

// ────────────────────────────────────────────────────────────
/** POST /clone-actions/:id/clone */
exports.cloneNow = async (req, res) => {
    const ownerCtx = requireOwner(req, res);
    if (!ownerCtx) return;

    try {
        const id = req.params.id;
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ message: AR.VALIDATION_FAILED });
        }

        const ca = await CloneAction.findOne({
            _id: id,
            owner: ownerSlugOf(ownerCtx),
        })
            .populate({ path: 'contentAudio', select: 'filename filepath enhancedPath mimetype userId' })
            .populate({ path: 'referenceAudio', select: 'filename filepath enhancedPath mimetype userId' })
            .populate({ path: 'target', select: 'name modelPath configPath owner' })
            .populate({ path: 'soundEffect', select: 'fileId start end' })
            .lean();

        if (!ca) return res.status(404).json({ message: AR.NOT_FOUND });

        const modelPath = String(ca.target?.modelPath || ca.modelPath || '');
        const configPath = String(ca.target?.configPath || ca.configPath || '');
        if (!hasTrainableModelPaths(modelPath, configPath)) {
            return res.status(400).json({ message: AR.MODEL_TRAIN_FIRST });
        }

        const contentPath = pickDiskPath(ca.contentAudio);
        const refPath = pickDiskPath(ca.referenceAudio);

        if (!contentPath || !(await existsReadable(contentPath))) {
            return res.status(400).json({ message: AR.CONTENT_MISSING });
        }
        if (!refPath || !(await existsReadable(refPath))) {
            return res.status(400).json({ message: AR.REF_MISSING });
        }
        if (!(await existsReadable(modelPath)) || !(await existsReadable(configPath))) {
            return res.status(400).json({ message: AR.MODEL_PATH_MISSING });
        }

        const owner = ownerSlugOf(ownerCtx);
        const targetRoot = path.dirname(path.dirname(modelPath));
        const outputDir = path.join(targetRoot, 'cloned');
        await fsp.mkdir(outputDir, { recursive: true });

        // Cheap, bounded dedupe on first N queue items
        try {
            const peeked = await rabbit.peek(CLONE_QUEUE, 1000);
            const alreadyQueued = Array.isArray(peeked) && peeked.some(m => m && (m.id === id || m.cloneActionId === id));
            if (alreadyQueued) {
                logger.warn(`🟨 CloneAction ${id} already in first 1000 messages of "${CLONE_QUEUE}"`);
                await setStatus(id, 'SCHEDULED');
                return res.status(200).json({
                    message: AR.ALREADY_QUEUED,
                    enqueued: false,
                    dedup: true,
                    status: 'SCHEDULED',
                });
            }
        } catch (e) {
            logger.warn(`⚠️ peek(${CLONE_QUEUE}) failed, proceeding without dedupe: ${e?.message || e}`);
        }

        const payload = {
            id,                 // cloneActionId
            owner,

            contentPath,        // encrypted; engine decrypts
            referencePath: refPath,
            modelPath,
            configPath,

            diffusion: Number(ca.diffusion ?? 25.0) * 2,
            length: Number(ca.length ?? 1.0),
            inference_rate: Number(ca.inference_rate ?? 0.7),

            outputDir,

            addSoundEffect: !!(req.body?.addSoundEffect ?? (ca.soundEffect != null)),
        };

        if (payload.addSoundEffect && ca.soundEffect?.fileId) {
            try {
                const sfx = await FileUpload.findOne({ _id: ca.soundEffect.fileId, userId: owner })
                    .select('filepath enhancedPath')
                    .lean();
                const sfxPath = pickDiskPath(sfx);
                if (sfxPath && (await existsReadable(sfxPath))) {
                    payload.soundEffectPath = sfxPath; // encrypted; engine decrypts
                    payload.soundEffectTrim = { start: ca.soundEffect.start ?? null, end: ca.soundEffect.end ?? null };
                } else {
                    logger.warn(`⚠️ soundEffect file not readable, skipping: ${ca.soundEffect.fileId}`);
                }
            } catch (e) {
                logger.warn(`⚠️ soundEffect lookup failed (${ca.soundEffect.fileId}): ${e?.message || e}`);
            }
        }

        await rabbit.publish(CLONE_QUEUE, payload, { messageId: id });
        await setStatus(id, 'SCHEDULED');
        logger.info(`📥 Enqueued clone job for cloneAction ${id} on "${CLONE_QUEUE}"`);

        return res.status(200).json({
            message: AR.CLONE_SCHEDULED,
            enqueued: true,
            queue: CLONE_QUEUE,
            cloneActionId: id,
            status: 'SCHEDULED',
        });
    } catch (err) {
        logger.error(`❌ cloneNow enqueue: ${err?.message || err}`);
        return res.status(500).json({ message: AR.ENQUEUE_FAILED });
    }
};

/** POST /clone-actions/:id/cancel */
exports.cancelClone = async (req, res) => {
    const ownerCtx = requireOwner(req, res);
    if (!ownerCtx) return;

    try {
        const id = req.params.id;
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ message: AR.VALIDATION_FAILED });
        }

        const ca = await CloneAction.findOne({
            _id: id,
            owner: ownerSlugOf(ownerCtx),
        })
            .select('_id status')
            .lean();

        if (!ca) return res.status(404).json({ message: AR.NOT_FOUND });

        // 1) Best-effort dequeue (bounded head window)
        let removed = false;
        try {
            removed = await rabbit.removeOneById(CLONE_QUEUE, id, { limit: 1000 });
            if (removed) {
                logger.info(`🧹 Removed pending clone job from "${CLONE_QUEUE}" for ${id}`);
            }
        } catch (e) {
            logger.warn(`⚠️ removeOneById(${CLONE_QUEUE}) failed for ${id}: ${e?.message || e}`);
        }

        // 2) ALWAYS set status -> NOT_SCHEDULED
        const updated = await CloneAction.findOneAndUpdate(
            { _id: id, owner: ownerSlugOf(ownerCtx) },
            { $set: { status: 'NOT_SCHEDULED' } },
            { new: true }
        ).select('-__v');

        // 3) Publish cancel token (works for running tasks and deeper-queued items)
        try {
            await rabbit.publish(CLONE_CANCEL_QUEUE, { id: String(id) });
            logger.info(`📨 Cancel token published to "${CLONE_CANCEL_QUEUE}" for ${id}`);
        } catch (e) {
            logger.warn(`⚠️ publish cancel failed for ${id}: ${e?.message || e}`);
        }

        // Optional: engine HTTP cancel ping
        try {
            const ENGINE_URL = (process.env.VC_ENGINE_URL || 'http://vc:8000').replace(/\/+$/, '');
            await axios.post(`${ENGINE_URL}/cancel-clone/${id}`, {}, { timeout: 2000 });
            logger.info(`🛑 Engine HTTP clone cancel requested for ${id}`);
        } catch (e) {
            logger.warn(`🟨 Engine HTTP clone cancel failed for ${id}: ${e.message}`);
        }

        const msg = removed ? AR.SCHEDULE_CANCELLED_REMOVED : AR.SCHEDULE_CANCELLED_NOT_FOUND;

        return res.status(200).json({
            message: msg,
            removed,
            cloneAction: updated,
            status: 'NOT_SCHEDULED',
        });
    } catch (err) {
        logger.error(`❌ cancelClone: ${err?.message || err}`);
        return res.status(500).json({ message: AR.UPDATE_FAILED });
    }
};

/**
 * POST /clone-actions
 * Body:
 *   scenario?: string
 *   contentAudio: ObjectId(FileUpload)
 *   target: ObjectId(Target)
 *   referenceAudio: ObjectId(FileUpload)   // must exist in target.referenceAudio
 *   soundEffect?: ObjectId(SoundEffect)
 *   diffusion?: number
 *   length?: number
 *   inference_rate?: number
 * modelPath/configPath copied from target.
 */
exports.create = async (req, res) => {
    const ownerCtx = requireOwner(req, res);
    if (!ownerCtx) return;

    try {
        const {
            scenario,
            contentAudio,
            target,
            referenceAudio,
            soundEffect,
            diffusion,
            length,
            inference_rate,
        } = req.body || {};

        // Validate target belongs to owner
        if (!target || !mongoose.Types.ObjectId.isValid(target)) {
            return res.status(400).json({ message: AR.VALIDATION_FAILED });
        }
        const t = await Target.findOne({
            _id: target,
            owner: ownerSlugOf(ownerCtx),
        })
            .select('_id owner referenceAudio modelPath configPath name')
            .lean();

        if (!t) return res.status(404).json({ message: AR.TARGET_NOT_OWNED });

        // Validate files belong to owner
        const contentAudioId = await assertFileOwned(contentAudio, ownerCtx, res, 'contentAudio');
        if (contentAudioId === null) return;

        const referenceAudioId = await assertFileOwned(referenceAudio, ownerCtx, res, 'referenceAudio');
        if (referenceAudioId === null) return;

        // Ensure referenceAudio is in target.referenceAudio list
        const refSet = new Set((t.referenceAudio || []).map(x => x.toString()));
        if (!refSet.has(referenceAudioId)) {
            return res.status(400).json({ message: AR.REF_NOT_IN_TARGET });
        }

        // Create the document
        const doc = await CloneAction.create({
            scenario: String(scenario || '').trim(),
            contentAudio: contentAudioId,
            target: t._id,
            referenceAudio: referenceAudioId,
            modelPath: String(t.modelPath || ''),
            configPath: String(t.configPath || ''),
            soundEffect: soundEffect && mongoose.Types.ObjectId.isValid(soundEffect) ? soundEffect : undefined,
            diffusion: typeof diffusion === 'number' ? diffusion : undefined,
            length: typeof length === 'number' ? length : undefined,
            inference_rate: typeof inference_rate === 'number' ? inference_rate : undefined,
            owner: ownerSlugOf(ownerCtx),
        });

        logger.info(`🎬 [${ownerSlugOf(ownerCtx)}] Created clone action for target "${t.name}"`);

        // Auto-enqueue clone job (best-effort; returns enqueue info)
        let enqueueInfo = { enqueued: false, dedup: false, queue: CLONE_QUEUE };
        try {
            enqueueInfo = await enqueueCloneByDoc(doc, ownerCtx, req.body || {});
            if (enqueueInfo?.status === 'SCHEDULED' || enqueueInfo?.enqueued || enqueueInfo?.dedup) {
                await setStatus(doc._id, 'SCHEDULED'); // idempotent
            }
        } catch (e) {
            logger.warn(`⚠️ Auto-enqueue failed for ${doc._id}: ${e?.message || e}`);
            // keep as NOT_SCHEDULED
        }

        return res.status(201).json({
            message: AR.CREATED,
            cloneAction: doc,
            autoEnqueue: enqueueInfo,
        });
    } catch (err) {
        logger.error(`❌ create cloneAction: ${err?.message || err}`);
        return handleMongoError(err, res, AR.CREATE_FAILED);
    }
};

/** GET /clone-actions?target= */
exports.getAll = async (req, res) => {
    const ownerCtx = requireOwner(req, res);
    if (!ownerCtx) return;

    try {
        const { target } = req.query || {};
        const q = { owner: ownerSlugOf(ownerCtx) };
        if (target && mongoose.Types.ObjectId.isValid(target)) q.target = target;

        const items = await CloneAction.find(q)
            .select('-__v')
            .populate({ path: 'contentAudio', select: 'filename filepath enhancedPath mimetype' })
            .populate({ path: 'referenceAudio', select: 'filename filepath enhancedPath mimetype' })
            .populate({ path: 'target', select: 'name modelPath configPath status' })
            .populate({ path: 'soundEffect', select: 'name filepath' })
            .populate({ path: 'outputPath', select: 'filename mimetype' }) // cloned file as FileUpload
            .lean();

        return res.status(200).json({ cloneActions: items });
    } catch (err) {
        logger.error(`❌ getAll cloneActions: ${err?.message || err}`);
        return res.status(500).json({ message: AR.FETCH_FAILED_ALL });
    }
};

/** GET /clone-actions/:id */
exports.getOne = async (req, res) => {
    const ownerCtx = requireOwner(req, res);
    if (!ownerCtx) return;

    try {
        const item = await CloneAction.findOne({
            _id: req.params.id,
            owner: ownerSlugOf(ownerCtx),
        })
            .select('-__v')
            .populate({ path: 'contentAudio', select: 'filename filepath enhancedPath mimetype' })
            .populate({ path: 'referenceAudio', select: 'filename filepath enhancedPath mimetype' })
            .populate({ path: 'target', select: 'name modelPath configPath status' })
            .populate({ path: 'soundEffect', select: 'name filepath' })
            .populate({ path: 'outputPath', select: 'filename mimetype' }) // cloned file as FileUpload
            .lean();

        if (!item) return res.status(404).json({ message: AR.NOT_FOUND });
        return res.status(200).json(item);
    } catch (err) {
        logger.error(`❌ getOne cloneAction: ${err?.message || err}`);
        return res.status(500).json({ message: AR.FETCH_FAILED_ONE });
    }
};

/**
 * PUT /clone-actions/:id
 * Body: scenario?, contentAudio?, target?, referenceAudio?,
 *       soundEffect?, diffusion?, length?, inference_rate?
 */
exports.update = async (req, res) => {
    const ownerCtx = requireOwner(req, res);
    if (!ownerCtx) return;

    try {
        const {
            scenario, contentAudio, target, referenceAudio,
            soundEffect, diffusion, length, inference_rate,
        } = req.body || {};

        const existing = await CloneAction.findOne({
            _id: req.params.id,
            owner: ownerSlugOf(ownerCtx),
        }).select('_id target referenceAudio').lean();

        if (!existing) return res.status(404).json({ message: AR.NOT_FOUND });

        let targetIdToUse = existing.target;
        if (target !== undefined) {
            if (!target || !mongoose.Types.ObjectId.isValid(target)) {
                return res.status(400).json({ message: AR.VALIDATION_FAILED });
            }
            targetIdToUse = target;
        }

        const targetDoc = await Target.findOne({
            _id: targetIdToUse,
            owner: ownerSlugOf(ownerCtx),
        }).select('_id referenceAudio modelPath configPath').lean();

        if (!targetDoc) return res.status(404).json({ message: AR.TARGET_NOT_OWNED });

        const updates = {};

        if (contentAudio !== undefined) {
            const ca = await assertFileOwned(contentAudio, ownerCtx, res, 'contentAudio');
            if (ca === null) return;
            updates.contentAudio = ca;
        }

        if (referenceAudio !== undefined) {
            const ra = await assertFileOwned(referenceAudio, ownerCtx, res, 'referenceAudio');
            if (ra === null) return;

            const refSet = new Set((targetDoc.referenceAudio || []).map(x => x.toString()));
            if (!refSet.has(ra)) {
                return res.status(400).json({ message: AR.REF_NOT_IN_TARGET });
            }
            updates.referenceAudio = ra;
        } else if (target !== undefined) {
            const refSet = new Set((targetDoc.referenceAudio || []).map(x => x.toString()));
            if (!refSet.has(String(existing.referenceAudio))) {
                return res.status(400).json({ message: AR.REF_NOT_IN_TARGET });
            }
        }

        if (target !== undefined) {
            updates.target = targetDoc._id;
            updates.modelPath = String(targetDoc.modelPath || '');
            updates.configPath = String(targetDoc.configPath || '');
        }

        if (scenario !== undefined) updates.scenario = String(scenario || '').trim();
        if (soundEffect !== undefined) {
            if (soundEffect && !mongoose.Types.ObjectId.isValid(soundEffect)) {
                return res.status(400).json({ message: AR.VALIDATION_FAILED });
            }
            updates.soundEffect = soundEffect || undefined;
        }
        if (diffusion !== undefined) updates.diffusion = Number(diffusion);
        if (length !== undefined) updates.length = Number(length);
        if (inference_rate !== undefined) updates.inference_rate = Number(inference_rate);

        const updated = await CloneAction.findOneAndUpdate(
            { _id: req.params.id, owner: ownerSlugOf(ownerCtx) },
            updates,
            { new: true, runValidators: true, context: 'query' }
        )
            .populate({ path: 'contentAudio', select: 'filename filepath enhancedPath mimetype' })
            .populate({ path: 'referenceAudio', select: 'filename filepath enhancedPath mimetype' })
            .populate({ path: 'target', select: 'name modelPath configPath status' })
            .populate({ path: 'soundEffect', select: 'name filepath' });

        if (!updated) return res.status(404).json({ message: AR.NOT_FOUND });
        return res.status(200).json({ message: AR.UPDATED, cloneAction: updated });
    } catch (err) {
        logger.error(`❌ update cloneAction: ${err?.message || err}`);
        return handleMongoError(err, res, AR.UPDATE_FAILED);
    }
};

/** DELETE /clone-actions/:id */
exports.remove = async (req, res) => {
    const ownerCtx = requireOwner(req, res);
    if (!ownerCtx) return;

    try {
        const deleted = await CloneAction.findOneAndDelete({
            _id: req.params.id,
            owner: ownerSlugOf(ownerCtx),
        }).lean();

        if (!deleted) return res.status(404).json({ message: AR.NOT_FOUND });
        logger.info(`🗑️ Deleted clone action ${deleted._id}`);
        return res.status(200).json({ message: AR.DELETED });
    } catch (err) {
        logger.error(`❌ delete cloneAction: ${err?.message || err}`);
        return res.status(500).json({ message: AR.DELETE_FAILED });
    }
};
