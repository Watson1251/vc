const Role = require("../models/role.model");
const User = require("../models/user.model");
const { ALL: ALL_PERMISSIONS } = require("../permissions");
const logger = require("/logger/logger");

const validHashes = new Set(ALL_PERMISSIONS.map(p => p.hash));

const AR = {
    INVALID_HASHES: "قِيَم صلاحيات غير صالحة.",
    ROLE_CREATED: "تم إنشاء الدور بنجاح.",
    ROLE_CREATE_FAILED: "فشل في إنشاء الدور.",
    ROLES_FETCH_FAILED: "فشل في جلب الأدوار.",
    ROLE_NOT_FOUND: "الدور غير موجود.",
    ROLE_FETCH_FAILED: "فشل في جلب بيانات الدور.",
    ROLE_UPDATED: "تم تحديث الدور بنجاح.",
    ROLE_UPDATE_FAILED: "فشل في تحديث الدور.",
    ROLE_IN_USE: "لا يمكن حذف دور مُسند إلى مستخدمين.",
    LAST_ADMIN_ROLE: "لا يمكن حذف آخر دور يملك صلاحيات المدير.",
    ROLE_DELETED: "تم حذف الدور بنجاح.",
    ROLE_DELETE_FAILED: "فشل في حذف الدور.",
};

exports.createRole = async (req, res) => {
    try {
        const { name, adGroups = [], isAdmin = false, permissionHashes = [] } = req.body;

        const invalid = (permissionHashes || []).filter(h => !validHashes.has(h));
        if (invalid.length) return res.status(400).json({ message: AR.INVALID_HASHES, invalid });

        const doc = new Role({ name, adGroups, isAdmin, permissionHashes });
        await doc.save();

        logger.info(`🆕 Created role ${name}`);
        return res.status(201).json({ message: AR.ROLE_CREATED, role: doc });
    } catch (err) {
        logger.error(`❌ Error creating role: ${err.message}`);
        return res.status(500).json({ message: AR.ROLE_CREATE_FAILED });
    }
};

exports.getAllRoles = async (_req, res) => {
    try {
        const roles = await Role.find({});
        return res.status(200).json({ roles });
    } catch {
        return res.status(500).json({ message: AR.ROLES_FETCH_FAILED });
    }
};

exports.getRole = async (req, res) => {
    try {
        const role = await Role.findById(req.params.id);
        if (!role) return res.status(404).json({ message: AR.ROLE_NOT_FOUND });
        return res.status(200).json(role);
    } catch {
        return res.status(500).json({ message: AR.ROLE_FETCH_FAILED });
    }
};

exports.updateRole = async (req, res) => {
    try {
        const { permissionHashes, isAdmin, ...rest } = req.body;

        if (permissionHashes) {
            const invalid = permissionHashes.filter(h => !validHashes.has(h));
            if (invalid.length) return res.status(400).json({ message: AR.INVALID_HASHES, invalid });
        }

        // If toggling isAdmin to true, force full permissions
        const updates = { ...rest };
        if (typeof isAdmin === "boolean") updates.isAdmin = isAdmin;
        if (updates.isAdmin === true) {
            updates.permissionHashes = ALL_PERMISSIONS.map(p => p.hash);
        } else if (permissionHashes) {
            updates.permissionHashes = permissionHashes;
        }

        const role = await Role.findByIdAndUpdate(req.params.id, updates, { new: true });
        if (!role) return res.status(404).json({ message: AR.ROLE_NOT_FOUND });

        return res.status(200).json({ message: AR.ROLE_UPDATED, role });
    } catch (err) {
        return res.status(500).json({ message: AR.ROLE_UPDATE_FAILED });
    }
};

exports.deleteRole = async (req, res) => {
    try {
        const role = await Role.findById(req.params.id);
        if (!role) return res.status(404).json({ message: AR.ROLE_NOT_FOUND });

        // Block deleting a role in use
        const inUse = await User.exists({ roleIds: role._id });
        if (inUse) return res.status(400).json({ message: AR.ROLE_IN_USE });

        // Block deleting the sole admin role
        if (role.isAdmin) {
            const otherAdmin = await Role.exists({ _id: { $ne: role._id }, isAdmin: true });
            if (!otherAdmin) return res.status(400).json({ message: AR.LAST_ADMIN_ROLE });
        }

        await Role.findByIdAndDelete(role._id);
        return res.status(200).json({ message: AR.ROLE_DELETED });
    } catch {
        return res.status(500).json({ message: AR.ROLE_DELETE_FAILED });
    }
};
