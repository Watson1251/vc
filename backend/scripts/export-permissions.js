// scripts/export-permissions.js
// Run from the backend root: node scripts/export-permissions.js ../frontend/src/app/security/permission-hashes.ts

const fs = require('fs');
const path = require('path');
const { BY_KEY } = require('../permissions'); // your permissions.js

const outPath = process.argv[2];
if (!outPath) {
    console.error('Usage: node scripts/export-permissions.js <output-ts-path>');
    process.exit(1);
}

const entries = Object.entries(BY_KEY).map(([k, v]) => [k, v.hash]);

// Option 1: Dev-friendly (export named constants per key)
// NOTE: This ships key names in your bundle (hashes remain opaque).
const lines = [];
lines.push('// AUTO-GENERATED. DO NOT EDIT BY HAND.');
lines.push('// Generated from backend/permissions.js');
lines.push('');
for (const [k, h] of entries) {
    lines.push(`export const H_${k} = '${h}';`);
}
lines.push('');
lines.push('export const PERMISSION_HASHES = {');
for (const [k] of entries) {
    lines.push(`  ${k}: H_${k},`);
}
lines.push('} as const;');
lines.push('');
lines.push('export type PermissionKey = keyof typeof PERMISSION_HASHES;');

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, lines.join('\n') + '\n', 'utf8');

console.log(`Wrote ${outPath}`);
