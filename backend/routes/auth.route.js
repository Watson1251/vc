// routes/auth.js
const express = require("express");
const AuthController = require("../controllers/auth.controller");
const checkAuth = require("../middleware/check-auth");

const router = express.Router();

// POST /auth/login
router.post("/login", AuthController.userLogin);

// GET /auth/me
router.get("/me", checkAuth, AuthController.getProfile);

// GET /auth/refresh
router.get("/refresh", checkAuth, AuthController.refreshToken);

module.exports = router;
