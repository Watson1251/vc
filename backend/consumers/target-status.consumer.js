const rabbit = require("/rabbitmq/rabbitmq");
const logger = require("/logger/logger");
const Target = require("../models/target.model");
const { getIO } = require("../socketHub");

const QUEUE = process.env.TARGET_STATUS_QUEUE || "target_status_queue";

function mapFriendlyError(msg) {
    if (!msg) return "";
    const s = String(msg);
    if (/no\s+chunks\s+passed\s+similarity\s+filtering/i.test(s)) {
        return "لا توجد مواد تدريب كافية تطابق صوت المادة المرجعية";
    }
    return s;
}

// 🔁 minimal retry to avoid init races when io is not yet set
async function emitWithRetry(ns, event, payload, tries = 8, delayMs = 250) {
    for (let i = 0; i < tries; i++) {
        const io = getIO();
        if (io) {
            io.to(ns).emit(event, payload);
            return true;
        }
        await new Promise(r => setTimeout(r, delayMs));
    }
    logger.warn(`⚠️ [status-consumer] io unavailable after retries; dropped ${event} to ${ns}`);
    return false;
}

async function broadcast(targetDocOrLean, payload) {
    const id = String(targetDocOrLean._id || targetDocOrLean.id || payload.id);
    const owner = targetDocOrLean.owner;

    // Always emit to the target room
    await emitWithRetry(`target:${id}`, "target:status", payload);

    // And to the owner room (server auto-subscribes the user)
    if (owner) {
        await emitWithRetry(`owner:${owner}`, "target:status", payload);
    }
}

module.exports = async function startStatusConsumer() {
    await rabbit.connect();

    await rabbit.consume(
        QUEUE,
        async (msg) => {
            const {
                status, phase, message, targetId, runName,
                modelPath, configPath, epoch, step, loss, ts,
            } = msg || {};

            const t = await Target.findById(targetId)
                .select("_id status modelPath configPath owner")
                .lean();

            if (!t) { logger.warn(`⚠️ target not found: ${targetId}`); return; }

            let next = null;
            if (status === "PROGRESS" && (phase === "LAUNCH" || phase === "TRAIN" || phase === "PREPROCESS")) {
                next = { status: "STARTED_TRAINING", modelPath: "-", configPath: "-" };
            } else if (status === "SUCCESS") {
                next = { status: "DONE", modelPath: modelPath || t.modelPath || "", configPath: configPath || t.configPath || "" };
            } else if (status === "FAILED") {
                next = { status: "FAILED", modelPath: "", configPath: configPath || t.configPath || "" };
            } else if (status === "CANCELLED") {
                next = { status: "NOT_SCHEDULED", modelPath: "", configPath: "" };
            }
            if (!next) return;

            const friendlyMsg = mapFriendlyError(message);

            const same =
                t.status === next.status &&
                String(t.modelPath || "") === String(next.modelPath || "") &&
                String(t.configPath || "") === String(next.configPath || "");

            const payload = {
                id: targetId,
                ...next,
                epoch, step, loss, ts, runName,
                msg: friendlyMsg,
            };

            if (same) {
                await broadcast(t, payload);
                return;
            }

            const updated = await Target.findByIdAndUpdate(targetId, { $set: next }, { new: true })
                .select("_id status modelPath configPath owner");

            await broadcast(updated, {
                id: String(updated._id),
                status: updated.status,
                modelPath: updated.modelPath || "",
                configPath: updated.configPath || "",
                epoch, step, loss, ts, runName,
                msg: friendlyMsg,
            });
        },
        { requeueOnError: false }
    );

    logger.info(`🐇 status-consumer started on "${QUEUE}"`);
};
