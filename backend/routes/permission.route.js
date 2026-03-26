// routes/permissions.js
const router = require("express").Router();
const controller = require("../controllers/permission.controller");

router.get("/", controller.listPermissions);
router.post("/resolve", controller.resolveHashes);
module.exports = router;
