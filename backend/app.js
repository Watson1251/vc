const path = require("path");
const express = require("express");
const bodyParser = require("body-parser");
const mongoose = require("mongoose");
const cors = require("cors");
const logger = require("/logger/logger");
const rabbitmq = require("/rabbitmq/rabbitmq");

require('dotenv').config();

// 🧩 Route Modules
const socketRoutes = require("./routes/debug-socket");
const authRoutes = require("./routes/auth.route");
const userRoutes = require("./routes/user.route");
const roleRoutes = require("./routes/role.route");
const permissionRoutes = require("./routes/permission.route");
const fileUploadRoutes = require("./routes/file-upload.route");

const soundEffectsRoutes = require("./routes/sound-effects.route");
const soundEffectTypesRoutes = require("./routes/sound-effect-types.route");

const targetRoutes = require("./routes/targets.route");
const cloneActionRoutes = require("./routes/clone-action.route");

const app = express();

// 🌍 CORS Setup
const corsOptions = {
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Origin', 'X-Requested-With', 'Content-Type', 'Accept', 'Authorization'],
  credentials: false,
};

app.use(cors(corsOptions));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));

// 📦 Routes
app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/roles", roleRoutes);
app.use("/api/permissions", permissionRoutes);
app.use("/api/file-upload", fileUploadRoutes);

app.use("/api/sound-effects", soundEffectsRoutes);
app.use("/api/sound-effect-types", soundEffectTypesRoutes);

app.use("/api/targets", targetRoutes);
app.use("/api/clone-actions", cloneActionRoutes);

// 🌐 MongoDB Connection
const mongoUrl = process.env.MONGODB_URL || "mongodb://localhost:27017/vc_db";

const connectToMongoWithRetry = async (retries = 5, delay = 3000) => {
  while (retries > 0) {
    try {
      logger.info("📡 Attempting MongoDB connection...");
      await mongoose.connect(mongoUrl, {
        useNewUrlParser: true,
        useUnifiedTopology: true,
        serverSelectionTimeoutMS: 5000,
      });
      logger.info(`✅ Connected to MongoDB at: ${mongoUrl}`);
      return;
    } catch (err) {
      retries--;
      logger.error(`❌ MongoDB connection failed. Retries left: ${retries}`);
      if (retries === 0) {
        logger.error("🚫 Could not connect to MongoDB. Exiting...");
        throw err;
      }
      await new Promise((res) => setTimeout(res, delay));
    }
  }
};

// 🐇 RabbitMQ Connection
const connectToRabbitMQWithRetry = async (retries = 5, delay = 3000) => {
  while (retries > 0) {
    try {
      logger.info("📡 Attempting RabbitMQ connection...");
      await rabbitmq.connect();
      logger.info("✅ Connected to RabbitMQ");
      return;
    } catch (err) {
      retries--;
      logger.error(`❌ RabbitMQ connection failed. Retries left: ${retries}`);
      if (retries === 0) {
        logger.error("🚫 Could not connect to RabbitMQ. Exiting...");
        throw err;
      }
      await new Promise((res) => setTimeout(res, delay));
    }
  }
};

module.exports = { app, connectToMongoWithRetry, connectToRabbitMQWithRetry };
