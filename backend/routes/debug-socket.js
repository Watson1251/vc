// routes/debug-socket.js
const router = require("express").Router();
const { getIO } = require("../socketHub");
const checkAuth = require("../middleware/check-auth");
const logger = require("/logger/logger");

router.get("/ping", checkAuth, (req, res) => {
    try {
        const io = getIO();
        if (!io) {
            logger.warn("⚠️  /debug/ping: Socket.IO instance is not initialized.");
            return res.status(503).json({ ok: false, error: "Socket not ready" });
        }

        const userId = req.userId;
        const payload = { serial: "TEST", status: "PING", at: new Date().toISOString() };

        logger.info(`🔔 /debug/ping → emitting to user:${userId}`, { payload });
        io.to(`user:${userId}`).emit("device:setup-status", payload);

        return res.json({ ok: true, sent: payload, room: `user:${userId}` });
    } catch (err) {
        logger.error(`❌ /debug/ping failed: ${err.message}`);
        return res.status(500).json({ ok: false, error: "Internal error" });
    }
});

module.exports = router;
