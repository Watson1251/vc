'use strict';

const path = require('path');
const fs = require('fs');
const SoundEffectType = require('../models/sound-effect-type.model');
const SoundEffect = require('../models/sound-effect.model');
const FileUpload = require('../models/file-upload.model');
const UserSfx = require('../models/user-sfx.model');
const logger = require('/logger/logger');
const HybridFileSecurity = require('/secure');

const security = new HybridFileSecurity();

// 🔖 bump if you change defaults
const DEFAULT_SFX_PACK_VERSION = 1;

// 💽 original assets location
const APP_ASSETS_DIR = process.env.APP_SFX_ASSETS_DIR || '/backend/assets/sfx';

// 📁 per-user media root
const MEDIA_ROOT = (process.env.MEDIA_ROOT || '/db/media').replace(/\/+$/, '');

// ───────────────── Types (per user) ─────────────────
const DEFAULT_TYPES = [
    { name: 'ماء' },
    { name: 'طبيعة' },
    { name: 'ضوضاء بيضاء' },
    { name: 'منزلي/أجهزة' },
];

// ──────────────── Files (per user) ─────────────────
const DEFAULT_FILES = [
    { filename: 'beach-waves.mp3', label: 'أمواج الشاطئ', typeName: 'ماء', start: null, end: null },
    { filename: 'waves.mp3', label: 'أمواج البحر', typeName: 'ماء', start: null, end: null },
    { filename: 'waterfall.mp3', label: 'شلال ماء', typeName: 'ماء', start: null, end: null },
    { filename: 'rain.mp3', label: 'مطر', typeName: 'ماء', start: null, end: null },
    { filename: 'rain-thunder.mp3', label: 'مطر مع رعد', typeName: 'ماء', start: null, end: null },

    { filename: 'evening-ambience.mp3', label: 'أجواء مسائية', typeName: 'طبيعة', start: null, end: null },
    { filename: 'outdoor-ambience.mp3', label: 'أجواء خارجية', typeName: 'طبيعة', start: null, end: null },
    { filename: 'wind.mp3', label: 'رياح', typeName: 'طبيعة', start: null, end: null },
    { filename: 'fire-crackles.mp3', label: 'موقد نار', typeName: 'طبيعة', start: null, end: null },

    { filename: 'white-noise-soft.mp3', label: 'ضوضاء بيضاء (خفيفة)', typeName: 'ضوضاء بيضاء', start: null, end: null },
    { filename: 'white-noise-heavy.mp3', label: 'ضوضاء بيضاء (قوية)', typeName: 'ضوضاء بيضاء', start: null, end: null },

    { filename: 'fan-soft.mp3', label: 'مروحة (خفيف)', typeName: 'منزلي/أجهزة', start: null, end: null },
    { filename: 'dryer.mp3', label: 'نشافة ملابس', typeName: 'منزلي/أجهزة', start: null, end: null },
    { filename: 'blender.mp3', label: 'خلاط', typeName: 'منزلي/أجهزة', start: null, end: null },
    { filename: 'typing.mp3', label: 'الكتابة على لوحة المفاتيح', typeName: 'منزلي/أجهزة', start: null, end: null },
];

// ─────────────── helpers ───────────────

function perUserDestPlain(username, filename) {
    return path.join(MEDIA_ROOT, username, 'sfx', filename);
}

function perUserDestEncrypted(username, filename) {
    return path.join(MEDIA_ROOT, username, 'sfx', `${filename}.enc`);
}

async function ensureDirFor(filePath) {
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
}

function guessMime(filename) {
    const ext = path.extname(filename).toLowerCase();
    if (ext === '.mp3') return 'audio/mpeg';
    if (ext === '.wav') return 'audio/wav';
    if (ext === '.flac') return 'audio/flac';
    return 'application/octet-stream';
}

/**
 * Build owner fields for FileUpload tied to this user.
 * Assumes your schema has `owner: ObjectId` (preferred) and/or other variants.
 */
function buildFileOwnerFields(user) {
    const p = FileUpload.schema.paths;

    // Prefer ObjectId owner if present
    if (p.owner && user._id && p.owner.instance === 'ObjectId') {
        return { owner: user._id };
    }

    // Fallbacks if your schema uses other fields
    if (p.userId && typeof user.userId === 'string') {
        return { userId: user.userId };
    }
    if (p.username && typeof user.username === 'string') {
        return { username: user.username };
    }

    // Last resort: nothing (should not happen if schemas line up)
    return {};
}

/**
 * Copy asset → encrypt → create FileUpload for this user.
 */
async function createFileUploadForUser(user, srcFilename) {
    const src = path.join(APP_ASSETS_DIR, srcFilename);
    if (!fs.existsSync(src)) {
        throw new Error(`Default SFX asset not found: ${src}`);
    }

    const username = user.userId || user.username || String(user._id);
    const dstPlain = perUserDestPlain(username, srcFilename);
    const dstEnc = perUserDestEncrypted(username, srcFilename);

    await ensureDirFor(dstPlain);

    if (!fs.existsSync(dstEnc)) {
        if (!fs.existsSync(dstPlain)) {
            await fs.promises.copyFile(src, dstPlain);
        }

        try {
            const encPath = security.encryptFile(dstPlain, dstEnc);

            // remove plaintext
            try {
                if (fs.existsSync(dstPlain)) {
                    fs.unlinkSync(dstPlain);
                    logger.info(`🗑️ Removed plaintext copy after encrypt: ${dstPlain}`);
                }
            } catch (e) {
                logger.warn(`⚠️ Failed to delete plaintext ${dstPlain}: ${e.message}`);
            }

            if (encPath !== dstEnc) {
                await fs.promises.rename(encPath, dstEnc).catch(() => { });
            }
        } catch (e) {
            try {
                if (fs.existsSync(dstPlain)) fs.unlinkSync(dstPlain);
            } catch { /* ignore */ }
            throw e;
        }
    } else if (fs.existsSync(dstPlain)) {
        // cleanup stray plaintext
        try {
            fs.unlinkSync(dstPlain);
            logger.info(`🧹 Removed stray plaintext: ${dstPlain}`);
        } catch (e) {
            logger.warn(`⚠️ Could not remove stray plaintext ${dstPlain}: ${e.message}`);
        }
    }

    const baseDoc = {
        filename: path.basename(srcFilename),
        filepath: dstEnc,
        mimetype: guessMime(srcFilename),
        enhancedPath: null,
    };

    const ownerFields = buildFileOwnerFields(user);
    const doc = await FileUpload.create({ ...baseDoc, ...ownerFields });
    return Array.isArray(doc) ? doc[0] : doc;
}

/**
 * Ensure we have a backing UserSfx document to own seeded data.
 * - No dependency on User collection.
 */
async function resolveSfxOwner(user) {
    if (!user) return null;

    const lookupId =
        user.userId ||
        user.username ||
        user.email ||
        (typeof user === 'string' ? user : null);

    if (!lookupId) {
        throw new Error('Cannot resolve SFX owner: missing userId/username/email');
    }

    // Try existing
    let sfxUser =
        (await UserSfx.findOne({ userId: lookupId })) ||
        (await UserSfx.findOne({ username: lookupId }));

    if (sfxUser) return sfxUser;

    // Create minimal SFX owner record
    sfxUser = await UserSfx.create({
        userId: lookupId,
        username: user.username || lookupId,
        name: user.name || null,
        isLdap: !!user.isLdap,
    });

    logger.info(`👤 Created UserSfx owner: ${lookupId} (${sfxUser._id})`);
    return sfxUser;
}

// ─────────────── main entry ───────────────

exports.seedSfxDefaultsOnce = async function seedSfxDefaultsOnce(rawUser) {
    if (!rawUser) {
        logger.warn('seedSfxDefaultsOnce called without user.');
        return { seeded: false, reason: 'no-user' };
    }

    // Always resolve to a backing UserSfx document with a real _id
    const user = await resolveSfxOwner(rawUser);
    const ownerId = user._id;
    const username = user.userId || user.username || String(ownerId);

    // Already seeded?
    if (user.firstTimeSfx || user.sfxSeededAt) {
        return { seeded: false, reason: 'already-seeded' };
    }

    // Acquire per-user lock
    const claimed = await UserSfx.findOneAndUpdate(
        {
            _id: ownerId,
            sfxSeededAt: null,
            firstTimeSfx: { $ne: true },
            $or: [
                { sfxSeedingLock: { $exists: false } },
                { sfxSeedingLock: false },
            ],
        },
        { $set: { sfxSeedingLock: true } },
        { new: true }
    );

    if (!claimed) {
        const fresh = await UserSfx.findById(ownerId).lean();
        if (fresh?.firstTimeSfx || fresh?.sfxSeededAt) {
            return { seeded: false, reason: 'already-seeded' };
        }
        logger.info(`⏩ Seed already in progress for user ${username} (${ownerId})`);
        return { seeded: false, reason: 'in-progress' };
    }

    try {
        // 1) Upsert categories for this owner
        const typeMap = new Map();
        for (const t of DEFAULT_TYPES) {
            const typeDoc = await SoundEffectType.findOneAndUpdate(
                { owner: ownerId, soundEffectType: t.name },
                { $setOnInsert: { owner: ownerId, soundEffectType: t.name } },
                {
                    upsert: true,
                    new: true,
                    collation: { locale: 'ar', strength: 1 },
                }
            );
            typeMap.set(t.name, typeDoc);
        }

        // 2) Seed files + sound effects
        for (const f of DEFAULT_FILES) {
            const typeDoc = typeMap.get(f.typeName);
            if (!typeDoc) {
                throw new Error(
                    `Type not found while seeding ${f.filename}: ${f.typeName}`
                );
            }

            const fu = await createFileUploadForUser(user, f.filename);

            await SoundEffect.create({
                owner: ownerId,
                name: f.label || path.parse(f.filename).name,
                fileId: fu._id,
                soundEffectTypeId: typeDoc._id,
                start: typeof f.start === 'number' ? f.start : null,
                end: typeof f.end === 'number' ? f.end : null,
            });
        }

        // 3) Mark as seeded & clear lock
        await UserSfx.updateOne(
            { _id: ownerId },
            {
                $set: {
                    sfxSeededAt: new Date(),
                    sfxSeedVersion: DEFAULT_SFX_PACK_VERSION,
                    firstTimeSfx: true,
                },
                $unset: { sfxSeedingLock: '' },
            }
        );

        logger.info(`🎁 Seeded default SFX (encrypted) for user ${username} (${ownerId})`);
        return { seeded: true };
    } catch (e) {
        // clear lock so we can retry later
        await UserSfx.updateOne(
            { _id: ownerId },
            { $unset: { sfxSeedingLock: '' } }
        );
        logger.warn(
            `⚠️ SFX seed failed for user ${username} (${ownerId}): ${e.message}`
        );
        return { seeded: false, error: e.message };
    }
};
