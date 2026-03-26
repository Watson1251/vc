// controllers/auth.controller.js

const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const passport = require("passport");
const LdapStrategy = require("passport-ldapauth");
const User = require("../models/user.model");
const Role = require("../models/role.model");
const logger = require("/logger/logger");
const { decryptPassword } = require("../rsa");
const { seedSfxDefaultsOnce } = require("../seeds/seed-sfx-defaults");

// -------------------- AR MESSAGES --------------------
const AR = {
    INVALID_CREDENTIALS: "اسم المستخدم أو كلمة المرور غير صحيحة.",
    AUTH_FAILED: "فشل في عملية المصادقة.",
    USER_NOT_FOUND: "المستخدم غير موجود.",
    PROFILE_LOAD_FAILED: "فشل في تحميل الملف الشخصي.",
    INVALID_TOKEN_FORMAT: "تنسيق الرمز غير صالح.",
    TOKEN_STILL_VALID: "الرمز لا يزال ضمن فترة الصلاحية الأولية.",
    TOKEN_REFRESH_FAILED: "فشل في تحديث الرمز.",
};

// -------------------- ENV CONFIG --------------------
const AUTH_TYPE = (process.env.AUTH_TYPE || "db").toLowerCase(); // 'ldap' or 'db'

const JWT_KEY = process.env.JWT_KEY;
const JWT_EXPIRES_INITIAL = process.env.JWT_EXPIRES_INITIAL || "24h";
const JWT_EXPIRES_REFRESH = process.env.JWT_EXPIRES_REFRESH || "24h";


// admin admin123
// LDAP via environment (from Docker)
const LDAP_URL = process.env.LDAP_URL;
const LDAP_BIND_DN = process.env.LDAP_BIND_DN;
const LDAP_BIND_PASSWORD = process.env.LDAP_BIND_PASSWORD;
const LDAP_SEARCH_BASE = process.env.LDAP_SEARCH_BASE;
const LDAP_SEARCH_FILTER =
    process.env.LDAP_SEARCH_FILTER || "(sAMAccountName={{username}})";
const LDAP_REJECT_UNAUTHORIZED =
    (process.env.LDAP_REJECT_UNAUTHORIZED || "false").toLowerCase() === "true";

let LDAP_ENABLED = false;

// -------------------- JWT HELPERS --------------------
const generateToken = (payload, expiresIn) => {
    if (!JWT_KEY) {
        logger.error("❌ JWT_KEY is missing in environment.");
        throw new Error("JWT misconfigured");
    }
    return jwt.sign(payload, JWT_KEY, { expiresIn });
};

const parseJwtExpiry = (exp) => {
    if (typeof exp === "number") return exp;
    const match = /^(\d+)([smhd])$/.exec(exp);
    if (!match) return 900;
    const value = parseInt(match[1], 10);
    const unit = match[2];
    switch (unit) {
        case "s": return value;
        case "m": return value * 60;
        case "h": return value * 3600;
        case "d": return value * 86400;
        default: return 900;
    }
};

// -------------------- LDAP STRATEGY SETUP --------------------
if (AUTH_TYPE === "ldap") {
    const missing = [];
    if (!LDAP_URL) missing.push("LDAP_URL");
    if (!LDAP_BIND_DN) missing.push("LDAP_BIND_DN");
    if (!LDAP_BIND_PASSWORD) missing.push("LDAP_BIND_PASSWORD");
    if (!LDAP_SEARCH_BASE) missing.push("LDAP_SEARCH_BASE");

    if (missing.length) {
        logger.error(
            `❌ AUTH_TYPE=ldap but missing LDAP environment variables: ${missing.join(
                ", "
            )}. Falling back to DB auth.`
        );
    } else {
        const ldapOptions = {
            server: {
                url: LDAP_URL,
                bindDN: LDAP_BIND_DN,
                bindCredentials: LDAP_BIND_PASSWORD,
                searchBase: LDAP_SEARCH_BASE,
                searchFilter: LDAP_SEARCH_FILTER,
                tlsOptions: {
                    rejectUnauthorized: LDAP_REJECT_UNAUTHORIZED,
                },
            },
            handleErrorsAsFailures: true,
        };

        passport.use("ldapauth", new LdapStrategy(ldapOptions));
        LDAP_ENABLED = true;
        logger.info("✅ LDAP authentication strategy initialized from environment.");
    }
} else {
    logger.info("ℹ️ Using DB-based authentication (AUTH_TYPE=db).");
}

const ldapAuthenticate = (req) =>
    new Promise((resolve, reject) => {
        if (!LDAP_ENABLED) {
            return reject(new Error("LDAP is not configured."));
        }

        passport.authenticate("ldapauth", { session: false }, (err, user, info) => {
            if (err || !user) {
                logger.warn(
                    `LDAP auth failed: ${info?.message || err?.message || "Unknown error"}`
                );
                return reject(new Error("Invalid LDAP credentials."));
            }
            resolve(user);
        })(req);
    });

// -------------------- CONTROLLERS --------------------

/**
 * POST /auth/login
 * Modes:
 *  - AUTH_TYPE=ldap: authenticate via LDAP; no User writes, but seed defaults per LDAP user.
 *  - AUTH_TYPE=db (default): authenticate against users stored in DB + seed defaults.
 */
exports.userLogin = async (req, res) => {
    try {
        const { username, encrypted } = req.body;

        if (!username || !encrypted) {
            return res.status(400).json({ message: AR.INVALID_CREDENTIALS });
        }

        const password = decryptPassword(encrypted);

        // -------------------- LDAP MODE --------------------
        if (AUTH_TYPE === "ldap" && LDAP_ENABLED) {
            let ldapUser;

            if (process.env.USE_MOCK_AD === "true") {
                logger.warn("⚠️ Using mock LDAP user (USE_MOCK_AD=true).");
                ldapUser = {
                    sAMAccountName: "devuser",
                    userPrincipalName: "devuser@example.com",
                    displayName: "Dev User",
                    memberOf: [
                        "CN=AppAdmins,OU=Groups,DC=example,DC=com",
                        "CN=AppViewers,OU=Groups,DC=example,DC=com",
                    ],
                };
            } else {
                // passport-ldapauth expects username/password on req.body
                req.body.username = username;
                req.body.password = password;
                ldapUser = await ldapAuthenticate(req);
            }

            const userId =
                ldapUser.sAMAccountName ||
                ldapUser.uid ||
                ldapUser.cn ||
                ldapUser.name;
            const email =
                ldapUser.userPrincipalName || ldapUser.mail || userId;
            const name = ldapUser.displayName || userId;

            const adGroups = ldapUser.memberOf || [];

            // Map AD groups -> Role documents (if configured)
            const roles = await Role.find({
                adGroups: { $in: adGroups },
            }).lean();

            const roleNames = roles.map((r) => r.name);
            const permissionHashes = Array.from(
                new Set(roles.flatMap((r) => r.permissionHashes || []))
            );
            logger.info("inside ==========================")

            // Seed SFX defaults for this LDAP user (no DB user record required).
            // seedSfxDefaultsOnce should be able to handle this minimal shape.
            seedSfxDefaultsOnce({
                userId,
                username: email,
                name,
                roles: roleNames,
                isLdap: true,
            }).catch((e) =>
                logger.warn(`⚠️ seedSfxDefaultsOnce (LDAP): ${e.message}`)
            );

            const token = generateToken(
                {
                    userId,
                    username: email,
                    name,
                    roles: roleNames,
                    permissionHashes,
                },
                JWT_EXPIRES_REFRESH
            );

            logger.info(
                `✅ LDAP login: ${userId} with roles: [${roleNames.join(", ")}]`
            );

            return res.status(200).json({
                token,
                expiresIn: parseJwtExpiry(JWT_EXPIRES_REFRESH),
                name,
                roles: roleNames,
                permissionHashes,
            });
        }

        // If AUTH_TYPE=ldap but LDAP not configured: fail loudly
        if (AUTH_TYPE === "ldap" && !LDAP_ENABLED) {
            logger.error(
                "❌ AUTH_TYPE=ldap set but LDAP is not properly configured. Check environment."
            );
            return res.status(500).json({ message: AR.AUTH_FAILED });
        }

        // -------------------- DB MODE (DEFAULT) --------------------
        const user = await User.findOne({ username }).populate("roleIds");
        if (!user || !user.password) {
            logger.warn(`❌ DB login failed for username: ${username} (user not found)`);
            return res.status(401).json({ message: AR.INVALID_CREDENTIALS });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            logger.warn(`❌ DB login failed for username: ${username} (wrong password)`);
            return res.status(401).json({ message: AR.INVALID_CREDENTIALS });
        }

        // Seed defaults for DB-backed users
        seedSfxDefaultsOnce(user).catch((e) =>
            logger.warn(`⚠️ seedSfxDefaultsOnce (DB): ${e.message}`)
        );

        const roles = user.roleIds || [];
        const roleNames = roles.map((r) => r.name);

        const token = generateToken(
            {
                userId: user.userId,
                username: user.username,
                name: user.name,
                roles: roleNames,
            },
            JWT_EXPIRES_INITIAL
        );

        logger.info(
            `✅ DB login: ${user.userId} with roles: [${roleNames.join(", ")}]`
        );

        return res.status(200).json({
            token,
            expiresIn: parseJwtExpiry(JWT_EXPIRES_INITIAL),
            name: user.name,
            roles: roleNames,
        });
    } catch (err) {
        logger.error(`❌ Authentication error: ${err.message}`);
        return res.status(500).json({ message: AR.AUTH_FAILED });
    }
};

/**
 * GET /auth/me
 *
 * - LDAP mode: read from JWT (via middleware); do NOT hit User collection.
 * - DB mode: read from DB as before.
 */
exports.getProfile = async (req, res) => {
    try {
        const jwtData = req.userData || {};
        const currentAuthType = AUTH_TYPE;

        // ---------- LDAP MODE ----------
        if (currentAuthType === "ldap") {
            const {
                userId,
                username,
                name,
                roles = [],
                permissionHashes = [],
            } = jwtData;

            if (!userId) {
                return res.status(401).json({ message: AR.USER_NOT_FOUND });
            }

            const isAdmin =
                roles.includes("admin") ||
                roles.includes("superadmin");

            return res.status(200).json({
                user: {
                    userId,
                    username,
                    name,
                    roles,
                },
                isAdmin,
                permissionHashes,
            });
        }

        // ---------- DB MODE (DEFAULT) ----------
        const user = await User.findOne(
            { userId: req.userId },
            "-password"
        ).lean();
        if (!user) {
            return res.status(401).json({ message: AR.USER_NOT_FOUND });
        }

        const roles = await Role.find({
            _id: { $in: user.roleIds || [] },
        }).lean();

        const isAdmin = roles.some((r) => r.isAdmin);
        const permissionHashes = Array.from(
            new Set(roles.flatMap((r) => r.permissionHashes || []))
        );

        return res.status(200).json({
            user: { ...user, roles },
            isAdmin,
            permissionHashes,
        });
    } catch (e) {
        logger.error(`❌ getProfile error: ${e.message}`);
        return res
            .status(500)
            .json({ message: AR.PROFILE_LOAD_FAILED });
    }
};

/**
 * GET /auth/refresh
 *
 * - LDAP mode: refresh purely from existing JWT payload (no DB).
 * - DB mode: verify user still exists in DB.
 */
exports.refreshToken = async (req, res) => {
    try {
        const authHeader =
            req.headers.authorization || "";
        const token = authHeader.startsWith("Bearer ")
            ? authHeader.slice(7)
            : null;

        if (!token) {
            return res.status(400).json({
                message: AR.INVALID_TOKEN_FORMAT,
            });
        }

        const decoded = jwt.verify(token, JWT_KEY);
        if (!decoded || !decoded.iat) {
            return res.status(400).json({
                message: AR.INVALID_TOKEN_FORMAT,
            });
        }

        const now = Math.floor(Date.now() / 1000);
        const elapsed = now - decoded.iat;
        const minAge = parseJwtExpiry(
            JWT_EXPIRES_INITIAL || "1h"
        );

        if (elapsed < minAge) {
            return res.status(403).json({
                message: AR.TOKEN_STILL_VALID,
            });
        }

        // ---------- LDAP MODE ----------
        if (AUTH_TYPE === "ldap") {
            const {
                userId,
                username,
                name,
                roles = [],
                permissionHashes = [],
            } = decoded;

            if (!userId) {
                return res.status(401).json({
                    message: AR.USER_NOT_FOUND,
                });
            }

            const newToken = generateToken(
                {
                    userId,
                    username,
                    name,
                    roles,
                    permissionHashes,
                },
                JWT_EXPIRES_REFRESH
            );

            return res.status(200).json({
                token: newToken,
                expiresIn:
                    parseJwtExpiry(
                        JWT_EXPIRES_REFRESH
                    ),
            });
        }

        // ---------- DB MODE (DEFAULT) ----------
        const user = await User.findOne({
            userId: decoded.userId,
        });
        if (!user) {
            return res.status(401).json({
                message: AR.USER_NOT_FOUND,
            });
        }

        const newToken = generateToken(
            {
                userId: user.userId,
                username: user.username,
                name: user.name,
            },
            JWT_EXPIRES_REFRESH
        );

        return res.status(200).json({
            token: newToken,
            expiresIn:
                parseJwtExpiry(
                    JWT_EXPIRES_REFRESH
                ),
        });
    } catch (err) {
        logger.error(
            `❌ refreshToken error: ${err.message}`
        );
        return res.status(500).json({
            message: AR.TOKEN_REFRESH_FAILED,
        });
    }
};
