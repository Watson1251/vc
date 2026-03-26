const express = require("express");
const router = express.Router();

const checkAuth = require("../middleware/check-auth");
const checkPermission = require("../middleware/check-permission"); // uses permission KEYs
const controller = require("../controllers/role.controller");

// Roles CRUD
router.get("/", checkAuth, controller.getAllRoles);
router.get("/:id", checkAuth, controller.getRole);
router.post("/", checkAuth, controller.createRole);
router.put("/:id", checkAuth, controller.updateRole);
router.delete("/:id", checkAuth, controller.deleteRole);

module.exports = router;
