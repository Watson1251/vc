const express = require("express");
const router = express.Router();

const checkAuth = require("../middleware/check-auth");
const checkPermission = require("../middleware/check-permission"); // uses permission KEYs
const controller = require("../controllers/user.controller");

// Users CRUD
router.get("/", checkAuth, controller.getAllUsers);
router.get("/:id", checkAuth, controller.getUser);
router.post("/", checkAuth, controller.createUser);
router.put("/:id", checkAuth, controller.updateUser);
router.delete("/:id", checkAuth, controller.deleteUser);

module.exports = router;
