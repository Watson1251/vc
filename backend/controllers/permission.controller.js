// controllers/permission.controller.js
const { ALL, BY_HASH } = require("../permissions");

exports.listPermissions = (_req, res) => {
    // Return full catalog: key, label, value, hash
    res.status(200).json({ permissions: ALL });
};

exports.resolveHashes = (req, res) => {
    const { hashes = [] } = req.body;
    const resolved = hashes.map(h => BY_HASH[h]).filter(Boolean);
    res.status(200).json({ resolved });
};
