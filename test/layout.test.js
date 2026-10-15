import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

// Three runtimes and what each may reach (phone-body plan, Task 1). core/ is
// what the brain and a body share, so it reaches nothing else; the brain's
// code does not belong on a phone, and a phone's does not belong in the brain.

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SPEC = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|new URL\(\s*)(['"])(\.\.?\/[^'"\n]*)\1/g;

/** @param {string} dir repo-relative @returns {string[]} */
function sources(dir) {
  /** @type {string[]} */ const out = [];
  for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const rel = posix.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'models' && e.name !== 'node_modules') out.push(...sources(rel)); }
    else if (e.name.endsWith('.js')) out.push(rel);
  }
  return out;
}

/** @param {string} file @returns {string[]} repo-relative targets */
function targets(file) {
  const src = readFileSync(join(ROOT, file), 'utf8');
  // A directory (trailing /) is a place files are served or read from — the
  // brain serves phone/ to the network — not code being imported.
  return [...src.matchAll(SPEC)].filter((m) => !m[2].endsWith('/'))
    .map((m) => posix.normalize(posix.join(posix.dirname(file), m[2])));
}

/** @param {string} dir @param {string[]} banned */
function reaches(dir, banned) {
  return sources(dir).flatMap((f) => targets(f)
    .filter((t) => banned.some((b) => t.startsWith(b)))
    .map((t) => `${f} → ${t}`));
}

test('core/ reaches only core/', () => {
  assert.deepEqual(reaches('core', ['phone/', 'server/', 'admin/', 'web/']), []);
});

test('the brain does not reach the phone, and the phone does not reach the brain', () => {
  assert.deepEqual(reaches('server', ['phone/', 'web/']), []);
  assert.deepEqual(reaches('phone', ['server/', 'web/']), []);
});
