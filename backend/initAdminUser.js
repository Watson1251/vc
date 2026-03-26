const bcrypt = require("bcryptjs");
const User = require("./models/user.model");
const Role = require("./models/role.model");
const logger = require("/logger/logger");
const { ALL: ALL_PERMISSIONS } = require("./permissions");

const createDefaultAdmin = async () => {
    if (process.env.AUTH_TYPE !== "db") return;

    const DEFAULT_ADMIN_USERNAME = "admin";
    const DEFAULT_ADMIN_PASSWORD = process.env.DEFAULT_ADMIN_PASSWORD || "admin123";

    logger.info("🔐 Checking admin role and presence of admin users...");

    // Ensure admin role exists with ALL permission hashes
    const allPermissionHashes = ALL_PERMISSIONS.map(p => p.hash);

    const adminRole = await Role.findOneAndUpdate(
        { isAdmin: true },
        { $setOnInsert: { name: "admin", isAdmin: true }, $set: { permissionHashes: allPermissionHashes } },
        { upsert: true, new: true }
    );

    // Any user with this role?
    const adminUsers = await User.find({ roleIds: adminRole._id }).lean();
    if (adminUsers.length === 0) {
        const hashedPassword = await bcrypt.hash(DEFAULT_ADMIN_PASSWORD, 10);
        await User.create({
            userId: "admin",
            username: DEFAULT_ADMIN_USERNAME,
            password: hashedPassword,
            name: "System Administrator",
            roleIds: [adminRole._id],
        });
        logger.info(`✅ Default admin user created (username: ${DEFAULT_ADMIN_USERNAME})`);
    } else {
        logger.info("✅ At least one admin user already exists.");
    }
};

module.exports = { createDefaultAdmin };
