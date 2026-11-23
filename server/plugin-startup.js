// The one boot step for plugin bodies: read `~/.bot-reborn/bodies/`, hand what
// it found to `core/bodies.js`, and report each refused plugin on its own line.
//
// It lives apart from `main.js` because that file starts a brain and cannot be
// imported by a test. A plugin is somebody's local file, so a bad one is a line
// in the log and never a reason to stop: the templates are all still there.

import { join } from 'node:path';
import { HOME } from './characters.js';
import { registerPlugins } from '../core/bodies.js';
import { loadPlugins } from './plugin-bodies.js';

/**
 * Where an install writes and where the boot step reads. One constant, because
 * a module installed at runtime is only usable if the loader that rebuilt the
 * registry read the same directory.
 */
export const BODIES_DIR = join(HOME, 'bodies');

/**
 * Load the installed plugins and replace the registry with them. No plugin
 * directory reads as no plugins — most installs have none.
 * @param {{ dir?: string, log?: (line: string) => void }} [opts]
 * @returns {Record<string, import('../core/bodies.js').Body>} what was loaded
 */
export function loadBodyPlugins({ dir = BODIES_DIR, log = console.error } = {}) {
  const { bodies, problems } = loadPlugins(dir);
  registerPlugins(bodies);
  for (const problem of problems) log(problem);
  return bodies;
}
