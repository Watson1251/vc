// permissions.js
const crypto = require('crypto');

const define = (key, label, value) => ({
    key,                 // stable programmatic key (DO NOT change once released)
    label,               // human label (safe to tweak later)
    value,               // human-readable value (safe to tweak later)
    hash: crypto.createHash('sha256').update(key).digest('hex'), // stable by key
});

// ---------- USERS (CRUD) ----------
const USERS_READ = define('USERS_READ', 'عرض المستخدمين', 'users:read');
const USERS_CREATE = define('USERS_CREATE', 'إضافة مستخدم', 'users:create');
const USERS_UPDATE = define('USERS_UPDATE', 'تحديث مستخدم', 'users:update');
const USERS_DELETE = define('USERS_DELETE', 'حذف مستخدم', 'users:delete');

// ---------- ROLES (CRUD) ----------
const ROLES_READ = define('ROLES_READ', 'عرض الأدوار', 'roles:read');
const ROLES_CREATE = define('ROLES_CREATE', 'إضافة دور', 'roles:create');
const ROLES_UPDATE = define('ROLES_UPDATE', 'تحديث دور', 'roles:update');
const ROLES_DELETE = define('ROLES_DELETE', 'حذف دور', 'roles:delete');


// ---------- SOUND EFFECT TYPES (CRUD) ----------
const SOUND_EFFECT_TYPES_READ = define('SOUND_EFFECT_TYPES_READ', 'عرض أنواع المؤثرات الصوتية', 'sound-effect-types:read');
const SOUND_EFFECT_TYPES_CREATE = define('SOUND_EFFECT_TYPES_CREATE', 'إضافة نوع', 'sound-effect-types:create');
const SOUND_EFFECT_TYPES_UPDATE = define('SOUND_EFFECT_TYPES_UPDATE', 'تحديث نوع', 'sound-effect-types:update');
const SOUND_EFFECT_TYPES_DELETE = define('SOUND_EFFECT_TYPES_DELETE', 'حذف نوع', 'sound-effect-types:delete');

// ---------- SOUND EFFECTS (CRUD) ----------
const SOUND_EFFECTS_READ = define('SOUND_EFFECTS_READ', 'عرض المؤثرات الصوتية', 'sound-effects:read');
const SOUND_EFFECTS_CREATE = define('SOUND_EFFECTS_CREATE', 'إضافة مؤثر صوتي', 'sound-effects:create');
const SOUND_EFFECTS_UPDATE = define('SOUND_EFFECTS_UPDATE', 'تحديث مؤثر صوتي', 'sound-effects:update');
const SOUND_EFFECTS_DELETE = define('SOUND_EFFECTS_DELETE', 'حذف مؤثر صوتي', 'sound-effects:delete');


// ---------- TARGETS (CRUD) ----------
const TARGETS_READ = define('TARGETS_READ', 'عرض الأهداف', 'targets:read');
const TARGETS_CREATE = define('TARGETS_CREATE', 'إضافة هدف', 'targets:create');
const TARGETS_UPDATE = define('TARGETS_UPDATE', 'تحديث هدف', 'targets:update');
const TARGETS_DELETE = define('TARGETS_DELETE', 'حذف هدف', 'targets:delete');

// ---------- CLONE ACTIONS (CRUD) ----------
const CLONE_ACTIONS_READ = define('CLONE_ACTIONS_READ', 'عرض الإجراءات', 'clone-actions:read');
const CLONE_ACTIONS_CREATE = define('CLONE_ACTIONS_CREATE', 'إضافة إجراء', 'clone-actions:create');
const CLONE_ACTIONS_UPDATE = define('CLONE_ACTIONS_UPDATE', 'تحديث إجراء', 'clone-actions:update');
const CLONE_ACTIONS_DELETE = define('CLONE_ACTIONS_DELETE', 'حذف إجراء', 'clone-actions:delete');


// If you still need files later, re-add them here (kept out for clarity).
// const FILES_UPLOAD = define('FILES_UPLOAD', 'Upload Files', 'files:upload');
// const FILES_VIEW   = define('FILES_VIEW',   'View Files',   'files:view');

// Export as a tidy catalog
const permissions = {
    USERS_READ, USERS_CREATE, USERS_UPDATE, USERS_DELETE,
    ROLES_READ, ROLES_CREATE, ROLES_UPDATE, ROLES_DELETE,

    // New:
    SOUND_EFFECT_TYPES_READ, SOUND_EFFECT_TYPES_CREATE, SOUND_EFFECT_TYPES_UPDATE, SOUND_EFFECT_TYPES_DELETE,
    SOUND_EFFECTS_READ, SOUND_EFFECTS_CREATE, SOUND_EFFECTS_UPDATE, SOUND_EFFECTS_DELETE,

    TARGETS_READ, TARGETS_CREATE, TARGETS_UPDATE, TARGETS_DELETE,
    CLONE_ACTIONS_READ, CLONE_ACTIONS_CREATE, CLONE_ACTIONS_UPDATE, CLONE_ACTIONS_DELETE,
};

const ALL = Object.values(permissions);
const BY_KEY = permissions;                                // e.g. BY_KEY.USERS_READ
const BY_HASH = Object.fromEntries(ALL.map(p => [p.hash, p])); // e.g. BY_HASH[sha256(key)]

module.exports = { ALL, BY_KEY, BY_HASH };
