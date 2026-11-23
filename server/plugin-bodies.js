// Plugin bodies come from disk: one directory per plugin under
// `~/.bot-reborn/bodies/`, and a `body.json` inside it. The manifest is data —
// a label, the parts it expects on the bench, the pins it may touch, and the
// commands it offers — and this module is where that data is believed or
// refused. A refused plugin never reaches `core/bodies.js`, so the rest of the
// program only ever sees bodies that passed.
//
// Nothing here can make the brain start: a typo in somebody's plugin is a line
// in the log, not a crash. That is why every step is wrapped and why a missing
// plugin directory reads the same as an empty one — most installs have none.

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { TEMPLATES, bodyProblem } from '../core/bodies.js';
import { bodyFrom, manifestProblem } from '../core/plugin-manifest.js';

// The manifest rules live in `core/plugin-manifest.js` because a module is a
// plugin too. Re-exported here so the loader stays the one import a caller
// needs when it is reading, judging or writing a plugin manifest.
export {
  bodyFrom,
  commandsProblem,
  manifestProblem,
  resourcesProblem,
} from '../core/plugin-manifest.js';

/** The one file a plugin must have. `preview.svg` and anything else are extra. */
const BODY_FILE = 'body.json';

/**
 * Parse and validate one manifest. The returned body is also put through
 * `bodyProblem`, so a plugin cannot be the one place a body slips past the
 * rules the templates keep.
 * @param {string} raw
 * @returns {{ body: import('../core/bodies.js').Body } | { problem: string }}
 */
function readPlugin(raw) {
  let manifest;
  try {
    manifest = JSON.parse(raw);
  } catch {
    return { problem: `${BODY_FILE} is not JSON` };
  }
  const problem = manifestProblem(manifest);
  if (problem) return { problem };
  const body = bodyFrom(manifest);
  const refused = bodyProblem(body);
  return refused ? { problem: refused } : { body };
}

/**
 * Every plugin under `dir`, and a line for every one that was refused.
 *
 * Only one level deep: a subdirectory is a plugin if it has a `body.json`, and
 * anything else in `dir` is somebody's stray file, not an error. A duplicate id
 * or a plugin that would shadow a template is refused rather than allowed to
 * change what an existing body means.
 * @param {string} dir
 * @returns {{ bodies: Record<string, import('../core/bodies.js').Body>, problems: string[] }}
 */
export function loadPlugins(dir) {
  /** @type {Record<string, import('../core/bodies.js').Body>} */
  const bodies = {};
  /** @type {string[]} */
  const problems = [];

  /** @type {import('node:fs').Dirent[]} */
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (error) {
    const code = /** @type {NodeJS.ErrnoException} */ (error).code;
    // No plugin directory is the normal case, not a problem to report.
    if (code === 'ENOENT' || code === 'ENOTDIR') return { bodies, problems };
    return { bodies, problems: [`plugin ${dir}: cannot read the plugin directory`] };
  }

  // Sorted so the log reads the same on every boot, whatever the filesystem
  // hands back.
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const directory = entry.name;
    let raw;
    try {
      raw = readFileSync(join(dir, directory, BODY_FILE), 'utf8');
    } catch (error) {
      const code = /** @type {NodeJS.ErrnoException} */ (error).code;
      // A directory with no body.json is not a plugin; skip it in silence.
      if (code === 'ENOENT') continue;
      problems.push(`plugin ${directory}: cannot read ${BODY_FILE}`);
      continue;
    }

    const read = readPlugin(raw);
    if ('problem' in read) {
      problems.push(`plugin ${directory}: ${read.problem}`);
      continue;
    }
    if (Object.hasOwn(TEMPLATES, read.body.id)) {
      problems.push(`plugin ${directory}: ${read.body.id} is a built-in body, and a plugin may not take its name`);
      continue;
    }
    if (Object.hasOwn(bodies, read.body.id)) {
      problems.push(`plugin ${directory}: ${read.body.id} is already loaded`);
      continue;
    }
    bodies[read.body.id] = read.body;
  }

  return { bodies, problems };
}
