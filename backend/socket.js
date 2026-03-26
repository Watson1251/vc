const jwt = require("jsonwebtoken");
const { setIO } = require("./socketHub");
const logger = require("/logger/logger");

module.exports = (server) => {
    const io = require("socket.io")(server, {
        path: "/ws",
        cors: { origin: "*", methods: ["GET", "POST"] },
        perMessageDeflate: { threshold: 1024 },
    });

    logger.info("🧩 Socket.IO initialized at path /ws");

    io.use((socket, next) => {
        try {
            const token = socket.handshake.query?.token;
            if (!token) return next(new Error("No token provided"));
            const decoded = jwt.verify(token, process.env.JWT_KEY);
            if (!decoded?.userId) return next(new Error("Authentication error"));
            socket.user = decoded;
            return next();
        } catch (err) {
            logger.error(`🔒 Socket auth error: ${err.message}`);
            return next(new Error("Authentication error"));
        }
    });

    io.on("connection", (socket) => {
        const userId = socket.user?.userId;
        if (!userId) { socket.disconnect(true); return; }

        // ✅ Auto-subscribe server-side to the owner room (no client race)
        const ownerNs = `owner:${userId}`;
        socket.join(ownerNs);

        // Optional: tell the client who it is (lets the client also subscribeOwner)
        socket.emit("hello", { owner: userId });

        // ---- Generic rooms for your Angular client ----
        socket.on("subscribe:room", ({ ns } = {}) => {
            if (typeof ns === "string" && ns.trim()) socket.join(ns.trim());
        });
        socket.on("unsubscribe:room", ({ ns } = {}) => {
            if (typeof ns === "string" && ns.trim()) socket.leave(ns.trim());
        });
    });

    setIO(io);
    return io;
};
