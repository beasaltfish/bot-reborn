// `npm start` builds the admin page when it has to, so nobody needs to know
// there is a build step (admin spec §2). "Has to" means: never built, or some
// source is newer than the build — the page's own, or the web/ modules it
// imports (provider list, checks).

import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ADMIN_DIR = fileURLToPath(new URL('../admin/', import.meta.url));
const WEB_DIR = fileURLToPath(new URL('../web/', import.meta.url));
/** Never sources of the page, and big enough to be worth not walking. */
const SKIP = new Set(['dist', 'node_modules', 'models', 'fixtures', 'sounds']);

/** @param {string} dir @returns {number} */
function newest(dir) {
  let max = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const path = join(dir, entry.name);
    max = Math.max(max, entry.isDirectory() ? newest(path) : statSync(path).mtimeMs);
  }
  return max;
}

/** @param {{ adminDir?: string, webDir?: string }} [opts] */
export function needsBuild(opts = {}) {
  const adminDir = opts.adminDir ?? ADMIN_DIR;
  const index = join(adminDir, 'dist', 'index.html');
  if (!existsSync(index)) return true;
  const built = statSync(index).mtimeMs;
  return newest(adminDir) > built || newest(opts.webDir ?? WEB_DIR) > built;
}

export function buildAdmin() {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const r = spawnSync(npm, ['run', 'admin:build'], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error('building the admin page failed (npm run admin:build)');
}

/**
 * Build if stale, and never let a failed build stop the brain: bodies do not
 * need the admin page, and the page's 503 already says how to build it.
 * @param {{ needsBuild?: () => boolean, buildAdmin?: () => void, log?: (line: string) => void }} [deps]
 * @returns {boolean} whether the page is up to date
 */
export function prepareAdmin(deps = {}) {
  const stale = deps.needsBuild ?? needsBuild;
  const build = deps.buildAdmin ?? buildAdmin;
  const log = deps.log ?? console.error;
  if (!stale()) return true;
  try {
    build();
    return true;
  } catch (err) {
    log(`The admin page could not be built (${/** @type {Error} */ (err).message}). The brain starts anyway; run npm run admin:build to retry.`);
    return false;
  }
}
