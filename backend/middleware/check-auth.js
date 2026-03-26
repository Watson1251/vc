// middleware/check-auth.js
const jwt = require("jsonwebtoken");
const UserSfx = require("../models/user-sfx.model");

module.exports = async (req, res, next) => {
  try {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ")
      ? header.slice(7)
      : (req.cookies?.token || null);

    if (!token) return res.status(401).json({ message: "لم يتم تقديم رمز الدخول." });

    const decoded = jwt.verify(token, process.env.JWT_KEY);
    if (!decoded?.userId) return res.status(401).json({ message: "الرمز غير صالح." });

    // Resolve (or create) an SFX owner record for endpoints that require ownerId.
    const lookupId = decoded.userId || decoded.username;
    if (!lookupId) return res.status(401).json({ message: "حساب المستخدم غير موجود." });

    let sfxUser = await UserSfx.findOne({ userId: lookupId })
      .select("_id userId username name")
      .lean();

    if (!sfxUser) {
      const created = await UserSfx.create({
        userId: lookupId,
        username: decoded.username || lookupId,
        name: decoded.name || null,
        isLdap: true,
      });
      sfxUser = created.toObject();
    }

    req.userData = decoded;       // keep your existing payload
    req.userId = decoded.userId;
    req.ownerId = sfxUser?._id || null;      // used by SFX endpoints
    req.userSfx = sfxUser;                   // optional convenience

    return next();
  } catch (error) {
    if (process.env.NODE_ENV === "development") {
      console.error("JWT verification error:", error.message);
    }
    return res.status(401).json({ message: "أنت غير مصرح لك بالوصول!" });
  }
};
