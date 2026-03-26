const fs = require("fs");
const os = require("os");
const http = require("http");
const https = require("https");
const debug = require("debug")("node-angular");
const path = require("path");

const { createDefaultAdmin } = require("./initAdminUser");

const logger = require("/logger/logger");
const { app, connectToMongoWithRetry, connectToRabbitMQWithRetry } = require("./app");


// Normalize port
const normalizePort = val => {
  const port = parseInt(val, 10);
  if (isNaN(port)) return val;
  if (port >= 0) return port;
  return false;
};

const getInternalIp = () => {
  const interfaces = os.networkInterfaces();
  for (const name in interfaces) {
    for (const iface of interfaces[name]) {
      if (iface.family === "IPv4" && !iface.internal) return iface.address;
    }
  }
  return "127.0.0.1";
};

const port = normalizePort(process.env.PORT || "3000");
app.set("port", port);


let server;
let protocol;

if (process.env.NODE_ENV === "production") {
  const certDir = "/certs";
  const httpsOptions = {
    key: fs.readFileSync(path.join(certDir, "key.pem")),
    cert: fs.readFileSync(path.join(certDir, "cert.pem")),
  };
  server = https.createServer(httpsOptions, app);
  // protocol = "https";
  protocol = "http";
} else {
  server = http.createServer(app);
  protocol = "http";
}

// 🔌 Attach Socket.IO
const initSocketIO = require("./socket");
const io = initSocketIO(server);
app.set("socketio", io);

// Error and listening handlers
const onError = (error) => {
  if (error.syscall !== "listen") throw error;

  const bind = typeof port === "string" ? `Pipe ${port}` : `Port ${port}`;
  switch (error.code) {
    case "EACCES":
      logger.error(`${bind} requires elevated privileges`);
      process.exit(1);
    case "EADDRINUSE":
      logger.error(`${bind} is already in use`);
      process.exit(1);
    default:
      logger.error(`Unexpected error on startup: ${error.message}`);
      throw error;
  }
};

const onListening = () => {
  const addr = server.address();
  const bind = typeof addr === "string" ? `Pipe ${addr}` : `Port ${port}`;
  debug("Listening on " + bind);
  logger.info(`📡 Server is live at ${protocol}://${getInternalIp()}:${port}`);
};

server.on("error", onError);
server.on("listening", onListening);

// 🔁 Consumers
const startConsumers = async () => {
  logger.info("🧪 Starting message consumers...");
  await require("./consumers/target-status.consumer")();
  await require("./consumers/clone-status.consumer")();
  logger.info("✅ All consumers started");
};

const startServer = async () => {
  try {
    logger.info("🚀 Starting backend services...");

    await connectToMongoWithRetry();
    await connectToRabbitMQWithRetry();

    await startConsumers();

    await createDefaultAdmin();

    server.listen(port, "0.0.0.0");
  } catch (err) {
    logger.error("🚫 Server failed to start:");
    console.error(err);
    process.exit(1);
  }
};

startServer();


// ---- Graceful shutdown ----
async function shutdown(signal = "SIGTERM") {
  try {
    logger.warn(`🛑 Received ${signal}. Shutting down gracefully...`);

    server.close(() => {
      logger.info("✅ HTTP server closed.");
      process.exit(0);
    });

    // Force-exit if close hangs
    setTimeout(() => process.exit(0), 10_000).unref();
  } catch {
    process.exit(1);
  }
}


process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));