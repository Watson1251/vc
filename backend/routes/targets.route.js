const express = require("express");
const router = express.Router();

const checkAuth = require("../middleware/check-auth");
const controller = require("../controllers/target.controller");


// Schedule / Re-schedule target training
router.post("/:id/train", checkAuth, controller.trainTarget);

// Cancel scheduled training (remove from queue + set NOT_SCHEDULED)
router.post("/:id/cancel", checkAuth, controller.cancelTraining);

// Targets CRUD
router.get("/", checkAuth, controller.getAllTargets);
router.get("/:id", checkAuth, controller.getTarget);
router.post("/", checkAuth, controller.createTarget);
router.put("/:id", checkAuth, controller.updateTarget);
router.delete("/:id", checkAuth, controller.deleteTarget);

module.exports = router;
