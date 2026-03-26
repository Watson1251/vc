const multer = require("multer");
const path = require("path");
const fs = require("fs");
const logger = require("/logger/logger");

const DEFAULT_UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, "../../db/media");
const DEFAULT_MAX_FILE_SIZE_MB = 100000;

// Helpers
function normalizeMime(mt = "") {
  // e.g. audio/x-wav -> audio/wav, video/x-matroska -> video/matroska (keep common alias handling)
  return mt.replace("/x-", "/");
}
function isMimeAccepted(mt, map) {
  if (map === "any") return true;
  if (!mt) return false;
  if (map[mt]) return true;
  const norm = normalizeMime(mt);
  if (map[norm]) return true;
  return false;
}
function isExtAccepted(filename = "", map) {
  if (map === "any") return true;
  const ext = path.extname(filename || "").slice(1).toLowerCase();
  if (!ext) return false;
  const allowedExts = new Set(Object.values(map).map(e => String(e).toLowerCase()));
  return allowedExts.has(ext);
}

module.exports = function dynamicUpload(req, res, next) {
  const maxFileSizeMB = req._uploadOptions?.maxFileSizeMB || DEFAULT_MAX_FILE_SIZE_MB;

  // Resolve mimeTypeMap
  let mimeTypeMap = req._uploadOptions?.mimeTypeMap || "any";
  if (!req._uploadOptions?.mimeTypeMap) {
    try {
      const parsed = JSON.parse(req.body.mimeTypeMap || req.query.mimeTypeMap || "{}");
      if (Object.keys(parsed).length > 0) mimeTypeMap = parsed;
    } catch {
      mimeTypeMap = "any";
    }
  }

  // Resolve subdirectory
  const subDir = req._uploadOptions?.uploadSubdir || req.body.uploadSubdir || req.query.uploadSubdir || "";
  const finalUploadDir = path.join(DEFAULT_UPLOAD_DIR, subDir);

  // Ensure destination folder exists
  fs.mkdirSync(finalUploadDir, { recursive: true });
  logger.info(`[upload-middleware] 📂 Ensured upload directory exists: ${finalUploadDir}`);

  const storage = multer.diskStorage({
    destination: (req, file, cb) => {
      const accepted = isMimeAccepted(file.mimetype, mimeTypeMap) || isExtAccepted(file.originalname, mimeTypeMap);
      if (accepted) {
        logger.info(`[upload-middleware] ✅ Accepting: ${file.originalname} (${file.mimetype}) -> ${finalUploadDir}`);
        cb(null, finalUploadDir);
      } else {
        logger.warn(`[upload-middleware] ❌ File failed filter: ${file.originalname} (${file.mimetype})`);
        cb(new Error("Invalid mime type"), null);
      }
    },
    filename: (req, file, cb) => {
      // choose extension: prefer map by mimetype (normalized); else use original ext; else 'bin'
      let ext = "bin";
      if (mimeTypeMap !== "any") {
        const norm = normalizeMime(file.mimetype);
        if (mimeTypeMap[file.mimetype]) ext = mimeTypeMap[file.mimetype];
        else if (mimeTypeMap[norm]) ext = mimeTypeMap[norm];
        else {
          const originalExt = path.extname(file.originalname || "").slice(1);
          if (originalExt && isExtAccepted(file.originalname, mimeTypeMap)) ext = originalExt.toLowerCase();
        }
      } else {
        const originalExt = path.extname(file.originalname || "").slice(1);
        if (originalExt) ext = originalExt.toLowerCase();
      }

      const uniqueName = `${Date.now()}-${Math.floor(Math.random() * 1e6)}.${ext}`;
      logger.info(`[upload-middleware] 📝 Saving file="${file.originalname}" as "${uniqueName}"`);
      cb(null, uniqueName);
    }
  });

  const fileFilter = (req, file, cb) => {
    const accepted = isMimeAccepted(file.mimetype, mimeTypeMap) || isExtAccepted(file.originalname, mimeTypeMap);
    if (!accepted) {
      logger.warn(`[upload-middleware] ❌ File failed filter: ${file.originalname} (${file.mimetype})`);
      return cb(new Error("Unsupported file type"), false);
    }
    cb(null, true);
  };

  const limits = { fileSize: maxFileSizeMB * 1024 * 1024 };
  const upload = multer({ storage, fileFilter, limits }).any();

  upload(req, res, (err) => {
    if (err) {
      logger.error(`[upload-middleware] ❌ Upload error: ${err.message}`);
      return res.status(400).json({ error: err.message });
    }
    logger.info(`[upload-middleware] ✅ Completed upload. Files=${(req.files || []).map(f => f.filename).join(", ") || "none"}`);
    next();
  });
};
