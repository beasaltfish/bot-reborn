// The module catalogue is what the repository ships, as opposed to what a
// person installs: `modules/<id>/module.json`, one directory per module, and a
// manifest that `core/module-manifest.js` has already agreed is valid.
//
// Two jobs, and they share one rule: the id is a name, never a path. The
// catalogue reads one level deep and keys by that name; the installer looks the
// name up in the catalogue it was handed and only then joins it to the bodies
// directory, so a request cannot walk out of either. Nothing here throws: a bad
// manifest is a `module <dir>: <phrase>` line, and a broken install is an
// `error` the caller can show.

import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TEMPLATES, registerPlugins } from '../core/bodies.js';
import { moduleProblem } from '../core/module-manifest.js';
import { loadPlugins } from './plugin-bodies.js';

/** The repo root, resolved the way the rest of `server/` resolves shared files. */
const ROOT = fileURLToPath(new URL('../', import.meta.url));

/** The one file a module must have. */
const MODULE_FILE = 'module.json';

/**
 * @typedef {import('../core/module-manifest.js').ModuleManifest} ModuleManifest
 * @typedef {import('../core/bodies.js').Action} Action
 * @typedef {{ modules: Record<string, ModuleManifest>, problems: string[] }} Catalogue
 */

/**
 * Every module under `dir`, and a line for every one that was refused.
 *
 * Only one level deep: a subdirectory is a module if it has a `module.json`,
 * and anything else in `dir` is somebody's stray file, not an error. The result
 * is keyed and ordered by the module's own id, because that is what the
 * installer and a character's config name.
 * @param {string} [dir]
 * @returns {Catalogue}
 */
export function loadModules(dir = join(ROOT, 'modules')) {
  /** @type {Record<string, ModuleManifest>} */
  const modules = {};
  /** @type {string[]} */
  const problems = [];

  /** @type {import('node:fs').Dirent[]} */
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (error) {
    const code = /** @type {NodeJS.ErrnoException} */ (error).code;
    // A checkout without modules is an empty catalogue, not a problem.
    if (code === 'ENOENT' || code === 'ENOTDIR') return { modules, problems };
    return { modules, problems: [`module ${dir}: cannot read the module directory`] };
  }

  // Sorted so the log reads the same on every start, whatever the filesystem
  // hands back.
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const directory = entry.name;
    let raw;
    try {
      raw = readFileSync(join(dir, directory, MODULE_FILE), 'utf8');
    } catch (error) {
      const code = /** @type {NodeJS.ErrnoException} */ (error).code;
      // A directory with no module.json is not a module; skip it in silence.
      if (code === 'ENOENT') continue;
      problems.push(`module ${directory}: cannot read ${MODULE_FILE}`);
      continue;
    }

    let manifest;
    try {
      manifest = JSON.parse(raw);
    } catch {
      problems.push(`module ${directory}: ${MODULE_FILE} is not JSON`);
      continue;
    }

    const problem = moduleProblem(manifest);
    if (problem) {
      problems.push(`module ${directory}: ${problem}`);
      continue;
    }
    if (Object.hasOwn(modules, manifest.id)) {
      problems.push(`module ${directory}: ${manifest.id} is already loaded`);
      continue;
    }
    modules[manifest.id] = manifest;
  }

  // The directory name is only where the file was; the catalogue is by id.
  const ordered = Object.fromEntries(
    Object.entries(modules).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );
  return { modules: ordered, problems };
}

/**
 * The five fields a module shares with a plugin. Examples, wiring and the note
 * are what the module says to a person, not what the body runs.
 * @param {ModuleManifest} manifest
 * @returns {Record<string, unknown>}
 */
function pluginFields(manifest) {
  return {
    id: manifest.id,
    label: { en: manifest.label.en, zh: manifest.label.zh },
    parts: [...manifest.parts],
    resources: structuredClone(manifest.resources),
    commands: structuredClone(manifest.commands),
  };
}

/**
 * Install one module: write its body and register it without a restart.
 *
 * The id is looked up in the catalogue, never path-joined from the request, so
 * an unknown or template id is a refusal and not a directory name. The file is
 * written first and read back through the same loader a plugin install goes
 * through; if that loader refuses it, the directory this call created is
 * removed and the loader's own phrase is returned.
 * @param {string} id
 * @param {{
 *   modules: Record<string, ModuleManifest>,
 *   bodiesDir: string,
 *   log?: (line: string) => void,
 * }} options
 * @returns {{ body: import('../core/bodies.js').Body, examples: Action[] } | { error: string }}
 */
export function installModule(id, { modules, bodiesDir, log = console.error }) {
  if (typeof id !== 'string'
    || Object.hasOwn(TEMPLATES, id)
    || !Object.hasOwn(modules, id)) {
    return { error: `${String(id)} is not a module` };
  }
  const manifest = modules[id];
  const dir = join(bodiesDir, id);

  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'body.json'), `${JSON.stringify(pluginFields(manifest), null, 2)}\n`);
  } catch {
    rmSync(dir, { recursive: true, force: true });
    return { error: `cannot write the ${id} module` };
  }

  const { bodies, problems } = loadPlugins(bodiesDir);
  registerPlugins(bodies);

  if (!Object.hasOwn(bodies, id)) {
    // Refused after all. Remove what this call wrote and reload, so the
    // registry is what remains on disk rather than a half-installed set.
    rmSync(dir, { recursive: true, force: true });
    registerPlugins(loadPlugins(bodiesDir).bodies);
    const refusal = problems.find((problem) => problem.startsWith(`plugin ${id}:`));
    return { error: refusal ?? `${id} was refused by the plugin loader` };
  }

  // Other plugins may also have been refused on the reload; the caller's log is
  // where a line about them belongs. This module's refusal was handled above.
  for (const problem of problems) {
    if (!problem.startsWith(`plugin ${id}:`)) log(problem);
  }

  return { body: bodies[id], examples: structuredClone(manifest.examples ?? []) };
}
