// controllers/auth.controller.js
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const passport = require("passport");
const LdapStrategy = require("passport-ldapauth");
const User = require("../models/user.model");
const Role = require("../models/role.model");
const logger = require("/logger/logger");
const { decryptPassword } = require("../rsa");
// const { seedSfxDefaultsOnce } = require("../seeds/seed-sfx-defaults");

const AR = {
    INVALID_CREDENTIALS: "اسم المستخدم أو كلمة المرور غير صحيحة.",
    AUTH_FAILED: "فشل في عملية المصادقة.",
    USER_NOT_FOUND: "المستخدم غير موجود.",
    PROFILE_LOAD_FAILED: "فشل في تحميل الملف الشخصي.",
    INVALID_TOKEN_FORMAT: "تنسيق الرمز غير صالح.",
    TOKEN_STILL_VALID: "الرمز لا يزال ضمن فترة الصلاحية الأولية.",
    TOKEN_REFRESH_FAILED: "فشل في تحديث الرمز.",
};

const AUTH_TYPE = process.env.AUTH_TYPE;
const JWT_KEY = process.env.JWT_KEY;
const JWT_EXPIRES_INITIAL = process.env.JWT_EXPIRES_INITIAL || "24h";  // e.g. "24h"
const JWT_EXPIRES_REFRESH = process.env.JWT_EXPIRES_REFRESH || "24h";  // e.g. "24h"

// Setup LDAP strategy only if needed
if (AUTH_TYPE === "ldap") {
    const ldapOptions = {
        server: {
            url: "ldap://ad.intercon.co.om",                                // Your AD server's IP 
            bindDN: "Administrator@ad.intercon.co.om",                      // Service account credentials
            bindCredentials: "P@ssw0rd3",
            searchBase: "dc=ad, dc=intercon, dc=co, dc=om",
            searchFilter: "(sAMAccountName={{username}})",
            tlsOptions: {
                rejectUnauthorized: false
            }
        },
    };
    passport.use(new LdapStrategy(ldapOptions));
}

const ldapAuthenticate = (req) =>
    new Promise((resolve, reject) => {
        passport.authenticate("ldapauth", { session: false }, (err, user, info) => {
            if (err || !user) {
                logger.warn(`LDAP auth failed: ${info?.message || err?.message}`);
                return reject(new Error("Invalid LDAP credentials."));
            }
            resolve(user);
        })(req);
    });

const generateToken = ({ userId, username }, expiresIn) =>
    jwt.sign({ userId, username }, JWT_KEY, { expiresIn });

/**
 * POST /auth/login
 */

exports.userLogin = async (req, res) => {
    try {
        const { username, encrypted } = req.body;
        const password = decryptPassword(encrypted);
        req.body.passport = passport;

        if (AUTH_TYPE === "ldap") {
            let ldapUser;

            if (process.env.USE_MOCK_AD === "true") {
                logger.warn("⚠️ Using mock LDAP user (simulation mode)");

                ldapUser = {
                    sAMAccountName: "devuser",
                    userPrincipalName: "devuser@example.com",
                    displayName: "Dev User",
                    memberOf: [
                        "CN=AppAdmins,OU=Groups,DC=example,DC=com",
                        "CN=AppViewers,OU=Groups,DC=example,DC=com"
                    ],
                };
            } else {
                ldapUser = await ldapAuthenticate(req);
            }

            const adGroups = ldapUser.memberOf || [];

            const userId = ldapUser.sAMAccountName || ldapUser.name;
            const email = ldapUser.userPrincipalName || ldapUser.mail || username;
            const name = ldapUser.displayName || userId;

            // 🔁 Match AD groups to roles
            // const roles = await Role.find({ adGroups: { $in: adGroups } });
            // const roleIds = roles.map((r) => r._id);

            // // 🧩 Create or update user in DB
            // const user = await User.findOneAndUpdate(
            //     { userId },
            //     {
            //         userId,
            //         username: email,
            //         name,
            //         roleIds,
            //     },
            //     { upsert: true, new: true }
            // );

            const token = generateToken(
                {
                    userId: userId,
                    username: email
                },
                86400
            );

            // logger.info(`✅ LDAP login: ${userId} with roles: [${roles.map(r => r.name).join(", ")}]`);

            return res.status(200).json({
                token,
                expiresIn: 86400,
                name: name,
                // roles: roles.map(r => r.name),
            });
        }

        // 🔐 DB authentication
        const user = await User.findOne({ username }).populate("roleIds");
        if (!user || !user.password || !(await bcrypt.compare(password, user.password))) {
            logger.warn(`❌ DB login failed for username: ${username}`);
            return res.status(401).json({ message: "Invalid credentials." });
        }

        // 👇 Fire-and-forget (don’t block login)
        // seedSfxDefaultsOnce(user).catch(e => logger.warn(`⚠️ seedSfxDefaultsOnce: ${e.message}`));

        const token = generateToken({
            userId: user.userId,
            username: user.username,
        }, 86400);

        logger.info(`✅ DB login: ${user.userId} with roles: [${user.roleIds.map(r => r.name).join(", ")}]`);

        return res.status(200).json({
            token,
            expiresIn: 86400,
            name: user.name,
            roles: user.roleIds.map(r => r.name),
        });

    } catch (err) {
        logger.error(`❌ Authentication error: ${err.message}`);
        return res.status(500).json({ message: "Authentication failed." });
    }
};


const parseJwtExpiry = (exp) => {
    if (typeof exp === "number") return exp;
    const match = /^(\d+)([smhd])$/.exec(exp);
    if (!match) return 900;
    const value = parseInt(match[1], 10);
    const unit = match[2];
    switch (unit) {
        case "s":
            return value;
        case "m":
            return value * 60;
        case "h":
            return value * 3600;
        case "d":
            return value * 86400;
        default:
            return 900;
    }
};

/**
 * GET /auth/me
 */
exports.getProfile = async (req, res) => {
    try {
        const user = await User.findOne({ userId: req.userId }, "-password").lean();
        if (!user) return res.status(401).json({ message: AR.USER_NOT_FOUND });

        const roles = await Role.find({ _id: { $in: user.roleIds || [] } }).lean();
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
        return res.status(500).json({ message: AR.PROFILE_LOAD_FAILED });
    }
};

/**
 * GET /auth/refresh
 */
exports.refreshToken = async (req, res) => {
    try {
        const decoded = jwt.decode(req.headers.authorization?.split(" ")[1]);
        if (!decoded || !decoded.iat) {
            return res.status(400).json({ message: AR.INVALID_TOKEN_FORMAT });
        }

        const now = Math.floor(Date.now() / 1000); // in seconds
        const elapsed = now - decoded.iat;

        const minAge = parseJwtExpiry(process.env.JWT_EXPIRES_INITIAL || "1h"); // e.g., 3600

        if (elapsed < minAge) {
            return res.status(403).json({ message: AR.TOKEN_STILL_VALID });
        }

        const user = await User.findOne({ userId: req.userId });
        if (!user) return res.status(401).json({ message: AR.USER_NOT_FOUND });

        const token = generateToken(
            { userId: user.userId, username: user.username },
            JWT_EXPIRES_REFRESH
        );

        return res.status(200).json({
            token,
            expiresIn: parseJwtExpiry(JWT_EXPIRES_REFRESH),
        });
    } catch (err) {
        return res.status(500).json({ message: AR.TOKEN_REFRESH_FAILED });
    }
};
