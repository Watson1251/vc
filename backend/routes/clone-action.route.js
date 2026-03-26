const express = require("express");
const router = express.Router();

const checkAuth = require("../middleware/check-auth");
const controller = require("../controllers/clone-action.controller");


router.post("/:id/clone", checkAuth, controller.cloneNow);
router.post("/:id/cancel", checkAuth, controller.cancelClone);

// CloneActions CRUD
router.get("/", checkAuth, controller.getAll);
router.get("/:id", checkAuth, controller.getOne);
router.post("/", checkAuth, controller.create);
router.put("/:id", checkAuth, controller.update);
router.delete("/:id", checkAuth, controller.remove);

module.exports = router;
