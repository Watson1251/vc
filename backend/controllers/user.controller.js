// controllers/user.controller.js
const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");
const User = require("../models/user.model");
const Role = require("../models/role.model");
const logger = require("/logger/logger");

const AR = {
    ROLES_NOT_FOUND: "تم تحديد أدوار غير موجودة.",
    USER_CREATED: "تم إنشاء المستخدم بنجاح.",
    USER_CREATE_FAILED: "فشل في إنشاء المستخدم.",
    USERS_FETCH_FAILED: "فشل في جلب المستخدمين.",
    USER_NOT_FOUND: "المستخدم غير موجود.",
    USER_FETCH_FAILED: "فشل في جلب بيانات المستخدم.",
    USER_UPDATED: "تم تحديث المستخدم بنجاح.",
    USER_UPDATE_FAILED: "فشل في تحديث المستخدم.",
    LAST_ADMIN_DELETE_BLOCK: "لا يمكن حذف آخر مستخدم يملك صلاحيات المدير.",
    USER_DELETED: "تم حذف المستخدم بنجاح.",
    USER_DELETE_FAILED: "فشل في حذف المستخدم.",
};


// small helper to validate objectId arrays exist in a collection
async function assertAllExist(Model, ids) {
    if (!Array.isArray(ids) || ids.length === 0) return;
    const validIds = ids.filter((id) => mongoose.isValidObjectId(id));
    if (validIds.length !== ids.length) throw new Error("INVALID_IDS");
    const count = await Model.countDocuments({ _id: { $in: validIds } });
    if (count !== validIds.length) throw new Error("MISSING");
}

exports.createUser = async (req, res) => {
    try {
        const { password, roleIds = [], ...rest } = req.body;
        const hashedPassword = password ? await bcrypt.hash(password, 10) : null;

        // Validate roles if provided
        if (roleIds.length) {
            await assertAllExist(Role, roleIds).catch(() => {
                return res.status(400).json({ message: AR.ROLES_NOT_FOUND });
            });
        }

        const user = await User.create({
            ...rest,
            password: hashedPassword,
            roleIds,
            userId: rest.username,
        });

        logger.info(`🆕 Created user ${user.username}`);

        const hydrated = await User.findById(user._id, "-password")
            .populate("roles");

        return res.status(201).json({ message: AR.USER_CREATED, user: hydrated });
    } catch (err) {
        logger.error(`❌ Error creating user: ${err.message}`);
        return res.status(500).json({ message: AR.USER_CREATE_FAILED });
    }
};

exports.getAllUsers = async (_req, res) => {
    try {
        const users = await User.find({}, "-password")
            .populate("roles");
        return res.status(200).json({ users });
    } catch {
        return res.status(500).json({ message: AR.USERS_FETCH_FAILED });
    }
};

exports.getUser = async (req, res) => {
    try {
        const user = await User.findById(req.params.id, "-password")
            .populate("roles");
        if (!user) return res.status(404).json({ message: AR.USER_NOT_FOUND });
        return res.status(200).json(user);
    } catch {
        return res.status(500).json({ message: AR.USER_FETCH_FAILED });
    }
};

exports.updateUser = async (req, res) => {
    try {
        const { password, roleIds, ...updates } = req.body;

        if (password) updates.password = await bcrypt.hash(password, 10);

        if (Array.isArray(roleIds)) {
            await assertAllExist(Role, roleIds).catch(() =>
                res.status(400).json({ message: AR.ROLES_NOT_FOUND })
            );
            if (res.headersSent) return; // early exit if we already responded
            updates.roleIds = roleIds;
        }

        const user = await User.findByIdAndUpdate(req.params.id, updates, {
            new: true,
            select: "-password",
        })
            .populate("roles");

        if (!user) return res.status(404).json({ message: AR.USER_NOT_FOUND });
        return res.status(200).json({ message: AR.USER_UPDATED, user });
    } catch {
        return res.status(500).json({ message: AR.USER_UPDATE_FAILED });
    }
};

exports.deleteUser = async (req, res) => {
    try {
        const user = await User.findById(req.params.id).populate("roles");
        if (!user) return res.status(404).json({ message: AR.USER_NOT_FOUND });

        // Block deleting the last admin user
        const hasAdminRole = (user.roles || []).some((r) => r.isAdmin);
        if (hasAdminRole) {
            const otherAdminUser = await User.exists({
                _id: { $ne: user._id },
                roleIds: { $in: (user.roles || []).map((r) => r._id) },
            });
            if (!otherAdminUser)
                return res.status(400).json({ message: AR.LAST_ADMIN_DELETE_BLOCK });
        }

        await User.deleteOne({ _id: user._id });
        return res.status(200).json({ message: AR.USER_DELETED });
    } catch {
        return res.status(500).json({ message: AR.USER_DELETE_FAILED });
    }
};
