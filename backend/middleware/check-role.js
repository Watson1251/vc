// middleware/check-role.js
const User = require("../models/user.model");
const Role = require("../models/role.model");
const { BY_KEY } = require("../permissions");

// Normalize a list like ["USERS_READ", "<sha256>", "ROLES_MANAGE"]
// to a Set of hashes.
const toHashSet = (perms = []) => {
    const set = new Set();
    for (const p of perms) {
        const maybe = BY_KEY[p]?.hash; // permission key -> hash
        set.add(maybe || p);           // if not a key, assume already a hash
    }
    return set;
};

module.exports = (requiredPermissions = []) => {
    const requiredHashes = toHashSet(requiredPermissions);

    return async (req, res, next) => {
        try {
            const userId = req.userId || req.userData?.userId;
            if (!userId) return res.status(401).json({ message: "غير مصرح لك." });

            const user = await User.findOne({ userId: req.userId }, "-password").lean();
            if (!user) return res.status(401).json({ message: "المستخدم غير موجود." });

            // Load roles
            const roles = await Role.find({ _id: { $in: user.roleIds || [] } }).lean();

            // Admin bypass
            if (roles.some(r => r.isAdmin)) return next();

            // Aggregate all permission hashes from assigned roles
            const have = new Set(roles.flatMap(r => r.permissionHashes || []));

            // Must include *all* required permissions (AND semantics)
            const ok = Array.from(requiredHashes).every(h => have.has(h));
            if (!ok) return res.status(403).json({ message: "صلاحيات غير كافية." });

            return next();
        } catch (e) {
            return res.status(500).json({ message: "خطأ في التحقق من الصلاحيات." });
        }
    };
};
