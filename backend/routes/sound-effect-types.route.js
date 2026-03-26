const express = require("express");
const router = express.Router();

const checkAuth = require("../middleware/check-auth");
const checkPermission = require("../middleware/check-permission");
const controller = require("../controllers/sound-effect-type.controller");

// SoundEffectTypes CRUD
router.get("/", checkAuth, controller.getAllSoundEffectTypes);
router.get("/:id", checkAuth, controller.getSoundEffectType);
router.post("/", checkAuth, controller.createSoundEffectType);
router.put("/:id", checkAuth, controller.updateSoundEffectType);
router.delete("/:id", checkAuth, controller.deleteSoundEffectType);

module.exports = router;
