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

import {
  existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TEMPLATES, registerPlugins } from '../core/bodies.js';
import { MODULE_ID, moduleProblem } from '../core/module-manifest.js';
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
 * Run a cleanup step and forget its failure. The point of the caller is to
 * return an error; a locked or vanished file must not turn that into a throw.
 * @param {() => void} step
 * @returns {void}
 */
function quietly(step) {
  try {
    step();
  } catch {
    // The disk is somebody else's; the caller already has the real error.
  }
}

/**
 * Replace `file` with `data` in one step a reader can only see whole. The
 * temporary name is a sibling so the rename stays on one filesystem.
 * @param {string} file
 * @param {string | Buffer} data
 * @returns {void}
 */
function writeAtomically(file, data) {
  const temporary = `${file}.tmp`;
  writeFileSync(temporary, data);
  renameSync(temporary, file);
}

/**
 * Install one module: write its body and register it without a restart.
 *
 * The id is looked up in the catalogue, never path-joined from the request, so
 * an unknown or template id is a refusal and not a directory name. The body is
 * written to a temporary file and renamed over the target, so a failed write
 * leaves an already-installed body byte-identical; the loader is then asked
 * about that same directory, and its own phrase is returned if it refuses.
 *
 * Nothing here throws. Every removal is best-effort, because an install that
 * cannot clean up a temporary file should still answer with the error that
 * caused the cleanup.
 * @param {string} id
 * @param {{
 *   modules: Record<string, ModuleManifest>,
 *   bodiesDir: string,
 *   log?: (line: string) => void,
 * }} options
 * @returns {{ body: import('../core/bodies.js').Body, examples: Action[] } | { error: string }}
 */
export function installModule(id, { modules, bodiesDir, log = console.error }) {
  // The catalogue is the caller's map, so its keys are re-checked as names: a
  // hand-built map must not smuggle a path or a template into a directory.
  if (typeof id !== 'string'
    || !MODULE_ID.test(id)
    || Object.hasOwn(TEMPLATES, id)
    || !Object.hasOwn(modules, id)
    || modules[id]?.id !== id) {
    return { error: `${String(id)} is not a module` };
  }
  const manifest = modules[id];
  const dir = join(bodiesDir, id);
  const file = join(dir, 'body.json');
  const temporary = `${file}.tmp`;

  // Read the old body before touching anything: it is what a refusal puts back.
  // A body that is there but cannot be read is not a first install: writing over
  // it would destroy the bytes a refusal has to restore.
  /** @type {Buffer | null} */
  let previous = null;
  if (existsSync(file)) {
    try {
      previous = readFileSync(file);
    } catch {
      return { error: `cannot read the existing ${id} body` };
    }
  }
  const created = !existsSync(dir);

  try {
    mkdirSync(dir, { recursive: true });
    writeAtomically(file, `${JSON.stringify(pluginFields(manifest), null, 2)}\n`);
  } catch {
    quietly(() => unlinkSync(temporary));
    // Removing the directory is only this call's business if this call made it.
    if (created) quietly(() => rmSync(dir, { recursive: true, force: true }));
    return { error: `cannot write the ${id} module` };
  }

  const { bodies, problems } = loadPlugins(bodiesDir);
  registerPlugins(bodies);

  // The loader prefixes a refusal with the directory it read, which is the id.
  // `hasOwn(bodies, id)` is not enough: another directory may already claim the
  // id, and that refusal is still ours to undo.
  const refusal = problems.find((problem) => problem.startsWith(`plugin ${id}:`))
    ?? (Object.hasOwn(bodies, id) ? null : `${id} was refused by the plugin loader`);

  if (refusal) {
    // Put the disk back the way it was found: the old bytes, or no directory.
    if (previous !== null) {
      quietly(() => writeAtomically(file, previous));
    } else {
      quietly(() => unlinkSync(file));
      quietly(() => unlinkSync(temporary));
      if (created) quietly(() => rmSync(dir, { recursive: true, force: true }));
    }
    registerPlugins(loadPlugins(bodiesDir).bodies);
    return { error: refusal };
  }

  // Other plugins may also have been refused on the reload; the caller's log is
  // where a line about them belongs. This module's refusal was handled above.
  for (const problem of problems) {
    if (!problem.startsWith(`plugin ${id}:`)) log(problem);
  }

  return { body: bodies[id], examples: structuredClone(manifest.examples ?? []) };
}
