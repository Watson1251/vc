// consumers/clone-status-consumer.js
const rabbit = require("/rabbitmq/rabbitmq");
const logger = require("/logger/logger");

const CloneAction = require("../models/clone-action.model");
const FileUpload = require("../models/file-upload.model"); // ✅ new


// live getter (do NOT capture at import time)
const { getIO } = require("../socketHub");

const QUEUE = process.env.CLONE_STATUS_QUEUE || "clone_status_queue";
const CLONED_AR_FILENAME = "الصوت_المستنسخ.wav"; // ✅ “cloned_voice.wav” in Arabic

/**
 * Emit to:
 *  - Room per clone action: "clone:<id>"
 *  - Room per owner:        "owner:<owner>"
 */
function broadcast(docOrLean, payload) {
    const io = getIO();
    if (!io) {
        logger.warn("⚠️ [clone-status] io not available; skipping socket emit.");
        return;
    }
    const id = String(docOrLean._id || docOrLean.id || payload.actionId || payload.id);
    io.to(`clone:${id}`).emit("clone:status", payload);

    const owner = docOrLean.owner;
    if (owner) io.to(`owner:${owner}`).emit("clone:status", payload);
}

/**
 * Map VC engine statuses to app statuses.
 * VC emits: STARTED | PROGRESS | SUCCESS | FAILED | CANCELLED
 * Phases:   RECEIVED | PREP | INFER | FINALIZE
 *
 * App uses: NOT_SCHEDULED | SCHEDULED | RUNNING | DONE | FAILED | CANCELLED
 */
function mapNextState(vcStatus, phase) {
    if (vcStatus === "SUCCESS") return "DONE";
    if (vcStatus === "FAILED") return "FAILED";
    if (vcStatus === "CANCELLED") return "CANCELLED";

    // Anything moving (STARTED/PROGRESS) is RUNNING
    if (vcStatus === "STARTED" || vcStatus === "PROGRESS") return "RUNNING";

    return null; // unknown → no change
}



/**
 * Ensure a FileUpload doc exists for the produced cloned file.
 * - Uses (userId=owner, filepath=engine's encrypted out path) as identity.
 * - filename is Arabic "صوت_مستنسخ.wav"; mimetype "audio/wav".
 * Returns the FileUpload doc.
 */
async function ensureClonedFileUpload(owner, filepath) {
    if (!owner || !filepath) throw new Error("owner/filepath required");
    // de-dupe by (owner + filepath)
    let fu = await FileUpload.findOne({ userId: owner, filepath }).lean();
    if (fu) return fu;
    fu = await FileUpload.create({
        filename: CLONED_AR_FILENAME,
        filepath,              // encrypted .wav.enc on disk — that’s OK
        enhancedPath: null,
        mimetype: "audio/wav", // logical type of the media
        userId: owner,
    });
    // re-read lean to keep shape consistent with others
    return await FileUpload.findById(fu._id).lean();
}


module.exports = async function startCloneStatusConsumer() {
    await rabbit.connect();

    await rabbit.consume(
        QUEUE,
        async (msg /* parsed JSON from mq */, rawMsg) => {
            const {
                actionId,            // cloneAction id
                status: vcStatus,    // STARTED|PROGRESS|SUCCESS|FAILED|CANCELLED
                phase,               // RECEIVED|PREP|INFER|FINALIZE
                message,             // error or info
                outputPath,          // encrypted output path (optional from engine)
                ts,                  // epoch seconds
                // plus any other extras sent by the engine
                ...rest
            } = msg || {};

            if (!actionId) {
                logger.warn("⚠️ [clone-status] message without actionId ignored.");
                return;
            }

            // Fetch minimal fields needed for comparison + broadcast
            const ca = await CloneAction.findById(actionId)
                .select("_id status owner outputPath")
                .lean();

            if (!ca) {
                logger.warn(`⚠️ [clone-status] clone action not found: ${actionId}`);
                return;
            }

            // Decide next state
            const nextState = mapNextState(vcStatus, phase);
            if (!nextState) {
                // Still broadcast progress even if we don't update DB
                broadcast(ca, {
                    id: actionId,
                    actionId,
                    status: ca.status,           // keep current DB status
                    vcStatus,                    // raw VC status for the UI if needed
                    phase,
                    ts,
                    msg: message || "",
                    ...rest,
                });
                return;
            }

            // Prepare DB patch

            const patch = { status: nextState };
            let outputRefId = null; // ✅ will carry FileUpload _id (string) when SUCCESS

            if (vcStatus === "SUCCESS" && typeof outputPath === "string") {
                try {
                    // create/reuse FileUpload for the produced clone
                    const fu = await ensureClonedFileUpload(ca.owner, outputPath);
                    outputRefId = String(fu._id);
                    patch.outputPath = outputRefId; // ✅ link by FileUpload id instead of raw path
                    patch.errorMsg = "";
                } catch (e) {
                    // If FileUpload creation fails, log and fall back to keeping the path (optional)
                    logger.warn(`⚠️ [clone-status] failed to create FileUpload: ${e?.message || e}`);
                    patch.outputPath = outputPath; // fallback (keeps old behavior)
                    patch.errorMsg = "";
                }
            } else if (vcStatus === "FAILED") {
                patch.errorMsg = message || "unknown error";
                // keep existing outputPath unless you want to blank it:
                // patch.outputPath = "";
            } else if (vcStatus === "CANCELLED") {
                // You can either keep last outputPath or clear it; choose your policy:
                // patch.outputPath = "";
                patch.errorMsg = "";
            }

            // Skip DB write if no effective change (to reduce churn).
            // We re-fetch current for comparison (ca is lean).
            const same =
                ca.status === patch.status &&
                (patch.outputPath === undefined || String(ca.outputPath || "") === String(patch.outputPath || ""));

            const payloadBase = {
                id: actionId,
                actionId,
                status: patch.status,
                vcStatus,   // raw VC status (optional - handy for debugging)
                phase,
                ts,
                msg: message || "",
                // ✅ emit the FileUpload id if we have it; else whatever is persisted / old value
                outputPath:
                    (outputRefId ? outputRefId
                        : (patch.outputPath !== undefined ? patch.outputPath : (ca.outputPath || ""))),
                ...rest,
            };

            if (same) {
                // No DB change → still broadcast live event
                broadcast(ca, payloadBase);
                return;
            }

            // Persist & broadcast the updated document
            const updated = await CloneAction.findByIdAndUpdate(
                actionId,
                { $set: patch },
                { new: true }
            ).select("_id status owner outputPath");

            if (!updated) {
                // Very unlikely race (deleted between read & write)
                logger.warn(`⚠️ [clone-status] action disappeared on update: ${actionId}`);
                return;
            }

            broadcast(updated, {
                ...payloadBase,
                status: updated.status,
                outputPath: updated.outputPath || "",
            });
        },
        { requeueOnError: false }
    );

    logger.info(`🐇 clone-status-consumer started on "${QUEUE}"`);
};
