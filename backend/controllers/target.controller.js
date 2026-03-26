const mongoose = require("mongoose");
const Target = require("../models/target.model");
const FileUpload = require("../models/file-upload.model");
const logger = require("/logger/logger");
const fs = require("fs");
const rabbit = require("/rabbitmq/rabbitmq"); // 👈 use your class
const TARGET_TRAIN_QUEUE = process.env.TARGET_TRAIN_QUEUE || "target_train_queue";

const STATUS = ["NOT_SCHEDULED", "SCHEDULED", "STARTED_TRAINING", "DONE", "FAILED"];

const AR = {
    CREATED: "Target created successfully.",
    CREATE_FAILED: "Failed to create target.",
    FETCH_FAILED_ALL: "Failed to fetch targets.",
    NOT_FOUND: "Target not found.",
    FETCH_FAILED_ONE: "Failed to fetch target data.",
    UPDATED: "Target updated successfully.",
    UPDATE_FAILED: "Failed to update target.",
    DELETED: "Target deleted successfully.",
    DELETE_FAILED: "Failed to delete target.",
    UNAUTHORIZED: "You are not authorized!",
    FILE_REQUIRED: "Valid files must be provided.",
    FILE_NOT_FOUND: "One or more files were not found or not owned by the user.",
    VALIDATION_FAILED: "Invalid input data.",
    SCHEDULED: "Target scheduled for training.",
};

// Return BOTH so we can match either style on FileUpload
function requireOwner(req, res) {
    const username = req.userId || null;   // e.g. "admin"
    const oid = req.ownerId || null;       // e.g. ObjectId("...")
    if (!username && !oid) {
        res.status(401).json({ message: AR.UNAUTHORIZED });
        return null;
    }
    return { username, oid };
}

function handleMongoError(err, res, fallback) {
    if (err?.name === "ValidationError") {
        return res.status(400).json({ message: AR.VALIDATION_FAILED });
    }
    if (err?.code === 11000) {
        return res.status(400).json({ message: AR.VALIDATION_FAILED });
    }
    return res.status(500).json({ message: fallback });
}

// Build an $or ownership filter against FileUpload depending on its schema
function buildFileOwnerFilter(ownerCtx) {
    const ors = [];

    if (FileUpload.schema.paths.owner) {
        const inst = FileUpload.schema.paths.owner.instance; // 'ObjectId' | 'String' | ...
        if (inst === "ObjectId" && ownerCtx.oid) ors.push({ owner: ownerCtx.oid });
        if (inst === "String" && ownerCtx.username) ors.push({ owner: ownerCtx.username });
    }
    if (FileUpload.schema.paths.userId && ownerCtx.username) {
        const inst = FileUpload.schema.paths.userId.instance;
        if (inst === "String") ors.push({ userId: ownerCtx.username });
    }
    if (FileUpload.schema.paths.username && ownerCtx.username) {
        const inst = FileUpload.schema.paths.username.instance;
        if (inst === "String") ors.push({ username: ownerCtx.username });
    }

    return ors.length ? { $or: ors } : {};
}

/**
 * Ensure provided file ids exist and belong to current user (FileUpload.userId === username).
 * Returns unique ObjectId[] or null (and sends response).
 */
async function assertFilesOwned(ids, ownerCtx, res) {
    if (ids == null) return [];
    if (!Array.isArray(ids)) {
        res.status(400).json({ message: AR.FILE_REQUIRED });
        return null;
    }

    const uniq = [...new Set(ids.filter(mongoose.Types.ObjectId.isValid))];
    if (uniq.length === 0 && ids.length > 0) {
        res.status(400).json({ message: AR.FILE_REQUIRED });
        return null;
    }

    // FileUpload ownership is tracked as userId (string username)
    const q = { _id: { $in: uniq }, userId: ownerCtx.username };
    const found = await FileUpload.find(q).select("_id").lean();

    if (found.length !== uniq.length) {
        res.status(400).json({ message: AR.FILE_NOT_FOUND });
        return null;
    }
    return uniq;
}

/**
 * Internal helper: schedule training for a target and notify VC engine.
 * - Owner filter uses string username (Target.owner).
 * - Paths: prefer enhancedPath; fallback to filepath+filename.
 * - Resolve + fs.existsSync checks with detailed logs.
 * - POST to `${VC_ENGINE_URL}/train` via axios.
 */
async function scheduleTrainingById(ownerCtx, targetId) {
    const t = await Target.findOne({
        _id: targetId,
        owner: ownerCtx.username,
    }).select("_id name referenceAudio trainingAudio status");

    if (!t) return { error: 404 };

    if (!t.trainingAudio?.length) {
        logger.warn(`⚠️ Target ${targetId} has no training audio files.`);
        return { error: 400, message: "No training files available." };
    }

    const toIds = (arr) => (Array.isArray(arr) ? arr.map(String) : []);
    const refIds = toIds(t.referenceAudio);
    const trainIds = toIds(t.trainingAudio);

    const [refFiles, trainFiles] = await Promise.all([
        refIds.length
            ? FileUpload.find({ _id: { $in: refIds }, userId: ownerCtx.username })
                .select("filepath enhancedPath")
                .lean()
            : [],
        FileUpload.find({ _id: { $in: trainIds }, userId: ownerCtx.username })
            .select("filepath enhancedPath")
            .lean(),
    ]);

    const pickExactPath = (f) => (f?.enhancedPath || f?.filepath || "").toString();

    const referencePaths = refFiles.map(pickExactPath).filter(Boolean);
    const trainingPaths = trainFiles.map(pickExactPath).filter(Boolean);

    logger.info(`🔍 Resolving files for target ${t._id} — refs: ${referencePaths.length}, training: ${trainingPaths.length}`);

    if (!trainingPaths.length) {
        logger.warn(`⚠️ Target ${t._id}: Resolved training paths are empty.`);
        return { error: 400, message: "Resolved training paths are empty." };
    }

    const missing = [];
    for (const p of [...referencePaths, ...trainingPaths]) {
        if (fs.existsSync(p)) {
            logger.info(`✅ File exists: ${p}`);
        } else {
            logger.warn(`❌ File missing: ${p}`);
            missing.push(p);
        }
    }
    if (missing.length) {
        logger.warn(`⚠️ Missing files for target ${t._id}: ${missing.length}`);
        missing.forEach((m) => logger.warn(`   └─ ${m}`));
        return { error: 404, message: "One or more files do not exist on disk.", missing };
    }

    // ——— Dedup by peeking first 1000 messages ———
    const peeked = await rabbit.peek(TARGET_TRAIN_QUEUE, 1000);
    const alreadyQueued = peeked.some((m) => m && m.id === String(t._id));
    if (alreadyQueued) {
        logger.warn(`🟨 Target ${t._id} is already present in the first 1000 messages of "${TARGET_TRAIN_QUEUE}". Skipping enqueue.`);
        return { target: t, dedup: true };
    }

    // Minimal payload only: id, referenceAudio, trainingAudio
    const payload = {
        id: String(t._id),
        referenceAudio: referencePaths,
        trainingAudio: trainingPaths,
    };

    await rabbit.publish(TARGET_TRAIN_QUEUE, payload, { messageId: String(t._id) });

    t.status = "SCHEDULED";
    await t.save();

    logger.info(`📥 Enqueued training job for "${t.name}" (${t._id}) on "${TARGET_TRAIN_QUEUE}"`);
    return { target: t, enqueued: true };
}

/**
 * POST /targets/:id/train
 * Resets status/output and (re)schedules a target by enqueuing a job.
 */
exports.trainTarget = async (req, res) => {
    const ownerCtx = requireOwner(req, res);
    if (!ownerCtx) return;

    try {
        const reset = await Target.findOneAndUpdate(
            { _id: req.params.id, owner: ownerCtx.username },
            { $set: { status: "NOT_SCHEDULED", modelPath: "", configPath: "" } },
            { new: true }
        ).select("_id name status owner");

        if (!reset) return res.status(404).json({ message: AR.NOT_FOUND });

        logger.info(`🔁 Reset target "${reset.name}" (${reset._id}) -> status=NOT_SCHEDULED, outputs cleared`);

        const { target, error, message, enqueued, dedup, missing } =
            await scheduleTrainingById(ownerCtx, req.params.id);

        if (error === 404) return res.status(404).json({ message: AR.NOT_FOUND, missing });
        if (error) return res.status(error).json({ message: message || AR.UPDATE_FAILED });

        return res.status(200).json({
            message: dedup ? "Already queued for training" : AR.SCHEDULED,
            target,
            queue: TARGET_TRAIN_QUEUE,
            enqueued: !!enqueued,
            dedup: !!dedup,
        });
    } catch (err) {
        logger.error(`❌ trainTarget: ${err.message}`);
        return res.status(500).json({ message: AR.UPDATE_FAILED });
    }
};

// controller
exports.cancelTraining = async (req, res) => {
    const ownerCtx = requireOwner(req, res);
    if (!ownerCtx) return;

    try {
        const t = await Target.findOne({ _id: req.params.id, owner: ownerCtx.username })
            .select("_id name status")
            .lean();
        if (!t) return res.status(404).json({ message: AR.NOT_FOUND });

        // 1) remove from queue if pending
        const removed = await rabbit.removeOneById(TARGET_TRAIN_QUEUE, t._id, { limit: 1000 });

        // 2) mark NOT_SCHEDULED in DB
        const updated = await Target.findOneAndUpdate(
            { _id: t._id, owner: ownerCtx.username },
            { $set: { status: "NOT_SCHEDULED" } },
            { new: true }
        ).select("-__v");

        // 3) ALWAYS publish cancel token to cancel queue (works even if engine HTTP is unreachable)
        await rabbit.publish(process.env.TARGET_CANCEL_QUEUE || "target_cancel_queue", { id: String(t._id) });
        logger.info(`📨 Cancel token published for ${t._id}`);

        // 4) BEST-EFFORT HTTP ping (won’t block success if it fails)
        try {
            const ENGINE_URL = (process.env.VC_ENGINE_URL || "http://vc:8000").replace(/\/+$/, "");
            await axios.post(`${ENGINE_URL}/cancel/${t._id}`, {}, { timeout: 2000 });
            logger.info(`🛑 Engine HTTP cancel requested for ${t._id}`);
        } catch (e) {
            logger.warn(`🟨 Engine HTTP cancel failed for ${t._id}: ${e.message}`);
        }

        const msg = removed
            ? "Schedule cancelled and removed from queue."
            : "Schedule cancelled (nothing found in queue).";
        return res.status(200).json({ message: msg, removed, target: updated });

    } catch (err) {
        logger.error(`❌ cancelTraining: ${err.message}`);
        return res.status(500).json({ message: AR.UPDATE_FAILED });
    }
};


/**
 * POST /targets
 * Creates a target and automatically schedules training if training files exist.
 */
exports.createTarget = async (req, res) => {
    const ownerCtx = requireOwner(req, res);
    if (!ownerCtx) return;

    try {
        const { name, description, referenceAudio, trainingAudio } = req.body || {};
        if (!name || String(name).trim().length < 1) {
            return res.status(400).json({ message: AR.VALIDATION_FAILED });
        }

        const refIds = await assertFilesOwned(referenceAudio, ownerCtx, res);
        if (refIds === null) return;

        const trainIds = await assertFilesOwned(trainingAudio, ownerCtx, res);
        if (trainIds === null) return;

        const doc = await Target.create({
            name: String(name).trim(),
            description: String(description || "").trim(),
            owner: ownerCtx.username || String(ownerCtx.oid || ""),
            referenceAudio: refIds,
            trainingAudio: trainIds,
            status: "NOT_SCHEDULED",
            modelPath: "",
            configPath: "",
        });

        logger.info(`🆕 [${ownerCtx.username || ownerCtx.oid}] Created target "${doc.name}"`);

        // Auto-schedule after creation when there are training files
        const scheduled = await scheduleTrainingById(ownerCtx, doc._id);
        if (scheduled.target) {
            return res.status(201).json({ message: AR.SCHEDULED, target: scheduled.target });
        }

        // If not schedulable, just return the created one
        return res.status(201).json({ message: AR.CREATED, target: doc });
    } catch (err) {
        logger.error(`❌ createTarget: ${err.message}`);
        return handleMongoError(err, res, AR.CREATE_FAILED);
    }
};

/**
 * GET /targets?name=
 * Returns caller's targets (optional name filter)
 */
exports.getAllTargets = async (req, res) => {
    const ownerCtx = requireOwner(req, res);
    if (!ownerCtx) return;

    try {
        const { name } = req.query || {};
        const q = { owner: ownerCtx.username || String(ownerCtx.oid || "") };

        if (typeof name === "string" && name.trim()) {
            q.name = { $regex: name.trim(), $options: "i" };
        }

        const items = await Target.find(q)
            .select("-__v")
            .populate({ path: "referenceAudio", select: "filename filepath mimetype" })
            .populate({ path: "trainingAudio", select: "filename filepath mimetype" })
            .lean();

        return res.status(200).json({ targets: items });
    } catch (err) {
        return res.status(500).json({ message: AR.FETCH_FAILED_ALL });
    }
};

/**
 * GET /targets/:id
 */
exports.getTarget = async (req, res) => {
    const ownerCtx = requireOwner(req, res);
    if (!ownerCtx) return;

    try {
        const item = await Target.findOne({
            _id: req.params.id,
            owner: ownerCtx.username || String(ownerCtx.oid || ""),
        })
            .select("-__v")
            .populate({ path: "referenceAudio", select: "filename filepath mimetype" })
            .populate({ path: "trainingAudio", select: "filename filepath mimetype" })
            .lean();

        if (!item) return res.status(404).json({ message: AR.NOT_FOUND });
        return res.status(200).json(item);
    } catch (err) {
        return res.status(500).json({ message: AR.FETCH_FAILED_ONE });
    }
};

/**
 * PUT /targets/:id
 * Body: { name?, description?, referenceAudio?, trainingAudio?, status?, modelPath? }
 * ✅ Removes queued job if relevant fields change
 */

exports.updateTarget = async (req, res) => {
    const ownerCtx = requireOwner(req, res);
    if (!ownerCtx) return;

    try {
        // 1) Prevent stale work: remove any queued job first
        const removedFromQueue = await rabbit.removeOneById(
            TARGET_TRAIN_QUEUE,
            req.params.id,
            { limit: 1000 }
        );
        if (removedFromQueue) {
            logger.info(`🧹 Removed queued job before update for target ${req.params.id}`);
        }

        // 2) Build updates with ownership checks on file ids
        const updates = {};
        const { name, description, referenceAudio, trainingAudio } = req.body || {};

        if (name !== undefined) updates.name = String(name).trim();
        if (description !== undefined) updates.description = String(description).trim();

        if (referenceAudio !== undefined) {
            const refIds = await assertFilesOwned(referenceAudio, ownerCtx, res);
            if (refIds === null) return;
            updates.referenceAudio = refIds;
        }
        if (trainingAudio !== undefined) {
            const trainIds = await assertFilesOwned(trainingAudio, ownerCtx, res);
            if (trainIds === null) return;
            updates.trainingAudio = trainIds;
        }

        // 3) Force reset of status/outputs on any update
        updates.status = "NOT_SCHEDULED";
        updates.modelPath = "";
        updates.configPath = "";

        // 4) Apply update
        const updated = await Target.findOneAndUpdate(
            { _id: req.params.id, owner: ownerCtx.username },
            updates,
            { new: true, runValidators: true, context: "query" }
        )
            .populate({ path: "referenceAudio", select: "filename filepath mimetype" })
            .populate({ path: "trainingAudio", select: "filename filepath mimetype" });

        if (!updated) return res.status(404).json({ message: AR.NOT_FOUND });

        logger.info(`✏️ Updated target "${updated.name}" (${updated._id}); status reset -> NOT_SCHEDULED. Re-scheduling...`);

        // 5) Re-schedule (enqueue) with latest data
        const { target, error, message, enqueued, dedup, missing } =
            await scheduleTrainingById(ownerCtx, updated._id);

        // If scheduling failed (e.g., missing files), still return the update,
        // but include details so the UI can inform the user.
        if (error) {
            logger.warn(`🟨 Re-schedule failed for target ${updated._id}: ${message || error}`);
            return res.status(200).json({
                message: AR.UPDATED,
                removedFromQueue,
                target: updated,
                scheduling: { error, message, missing: missing || [] }
            });
        }

        // Success: scheduled (or deduped)
        return res.status(200).json({
            message: dedup ? "Already queued for training" : AR.SCHEDULED,
            removedFromQueue,
            target,
            queue: TARGET_TRAIN_QUEUE,
            enqueued: !!enqueued,
            dedup: !!dedup,
        });
    } catch (err) {
        logger.error(`❌ updateTarget: ${err.message}`);
        return handleMongoError(err, res, AR.UPDATE_FAILED);
    }
};


/**
 * DELETE /targets/:id
 * ✅ Removes queued job before deleting target
 */
exports.deleteTarget = async (req, res) => {
    const ownerCtx = requireOwner(req, res);
    if (!ownerCtx) return;

    try {
        // Remove any queued job first
        const removed = await rabbit.removeOneById(TARGET_TRAIN_QUEUE, req.params.id, { limit: 1000 });

        const deleted = await Target.findOneAndDelete({
            _id: req.params.id,
            owner: ownerCtx.username,
        }).lean();

        if (!deleted) return res.status(404).json({ message: AR.NOT_FOUND });

        logger.info(`🗑️ Deleted target ${deleted._id} — QueueRemoved=${removed}`);

        return res.status(200).json({
            message: AR.DELETED,
            removedFromQueue: removed
        });
    } catch (err) {
        logger.error(`❌ deleteTarget: ${err.message}`);
        return res.status(500).json({ message: AR.DELETE_FAILED });
    }
};
