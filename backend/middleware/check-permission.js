// middleware/check-permission.js
const User = require("../models/user.model");
const Role = require("../models/role.model");
const { BY_KEY } = require("../permissions");

/**
 * Enforce a single permission by KEY (e.g., "USERS_READ").
 * Usage: router.get("/", checkPermission("USERS_READ"), handler)
 */
module.exports = (requiredKey) => {
    const requiredHash = BY_KEY[requiredKey]?.hash;
    if (!requiredHash) throw new Error(`Invalid permission key: ${requiredKey}`);

    return async (req, res, next) => {
        try {
            const userId = req.userId || req.userData?.userId; // set by your auth middleware
            if (!userId) return res.status(401).json({ message: "غير مصرح لك." });

            const user = await User.findOne({ userId }, "-password").lean();
            if (!user) return res.status(401).json({ message: "هذا المستخدم غير موجود." });

            const roles = await Role.find({ _id: { $in: user.roleIds || [] } }).lean();

            // Admin bypass
            if (roles.some((r) => r.isAdmin)) return next();

            const hashes = new Set(roles.flatMap((r) => r.permissionHashes || []));
            if (hashes.has(requiredHash)) return next();

            return res.status(403).json({ message: "تم رفض الإذن." });
        } catch (e) {
            return res.status(500).json({ message: "خطأ في التحقق من الصلاحيات." });
        }
    };
};
