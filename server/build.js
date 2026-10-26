// `npm start` builds the pages when it has to, so nobody needs to know there
// is a build step (admin spec §2). "Has to" means: never built, or some
// source is newer than the build — a page's own, the core/ modules they
// import, or the build config.
//
// A failed build stops the brain. It used to start anyway, since bodies did
// not need the admin page; now the phone runs the built pages too, and an old
// dist/ would hand it a core/ the brain no longer speaks.

import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
export const SOURCE_DIRS = ['admin', 'sim', 'phone', 'core'];
/** Never sources of the pages, and big enough to be worth not walking. */
const SKIP = new Set(['dist', 'node_modules', 'models', 'fixtures', 'sounds']);

/** @param {string} dir @returns {number} */
function newest(dir) {
  if (!existsSync(dir)) return 0;
  let max = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const path = join(dir, entry.name);
    max = Math.max(max, entry.isDirectory() ? newest(path) : statSync(path).mtimeMs);
  }
  return max;
}

/** @param {{ root?: string }} [opts] */
export function needsBuild(opts = {}) {
  const root = opts.root ?? ROOT;
  // Every page is one build; the admin page stands for all of them.
  const index = join(root, 'dist', 'admin', 'index.html');
  if (!existsSync(index)) return true;
  const built = statSync(index).mtimeMs;
  const config = join(root, 'vite.config.js');
  if (existsSync(config) && statSync(config).mtimeMs > built) return true;
  return SOURCE_DIRS.some((d) => newest(join(root, d)) > built);
}

export function build() {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const r = spawnSync(npm, ['run', 'build'], { stdio: 'inherit', cwd: ROOT });
  if (r.status !== 0) throw new Error('building the pages failed (npm run build)');
}

/**
 * Build if stale. Throws when the build fails: the caller stops the brain.
 * @param {{ needsBuild?: () => boolean, build?: () => void, log?: (line: string) => void }} [deps]
 */
export function prepareBuild(deps = {}) {
  if (!(deps.needsBuild ?? needsBuild)()) return;
  (deps.log ?? console.log)('Building the pages…');
  (deps.build ?? build)();
}
