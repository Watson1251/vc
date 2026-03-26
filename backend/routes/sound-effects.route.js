const express = require("express");
const router = express.Router();

const checkAuth = require("../middleware/check-auth");
const checkPermission = require("../middleware/check-permission");
const controller = require("../controllers/sound-effect.controller");

// SoundEffects CRUD
router.get("/", checkAuth, controller.getAllSoundEffects);
router.get("/:id", checkAuth, controller.getSoundEffect);
router.post("/", checkAuth, controller.createSoundEffect);
router.put("/:id", checkAuth, controller.updateSoundEffect);
router.delete("/:id", checkAuth, controller.deleteSoundEffect);

module.exports = router;
