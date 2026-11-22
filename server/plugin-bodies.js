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
import { commandProblem } from '../core/io-program.js';
import { TEMPLATES, bodyProblem } from '../core/bodies.js';

/** The one file a plugin must have. `preview.svg` and anything else are extra. */
const BODY_FILE = 'body.json';

/** A plugin id names a directory and reaches `config.body.template`. */
const ID = /^[a-z][a-z0-9_-]*$/;

/** A command name is how an action calls it: no spaces, no caps. */
const COMMAND_NAME = /^[a-z][a-z0-9_]*$/;

/** The two directions a gpio pin may have. */
const DIRECTIONS = new Set(['input', 'output']);

/** @param {unknown} value @returns {boolean} */
function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** @param {unknown} value @returns {boolean} */
function isText(value) {
  return typeof value === 'string' && value.trim() !== '';
}

/**
 * The resource table is the plugin's whole permission slip: a command may only
 * name a resource declared here. Part A settles only `gpio`, so anything else
 * is refused with the same phrase the IO program uses rather than guessed at.
 * @param {unknown} resources
 * @returns {string | null}
 */
function resourcesProblem(resources) {
  if (!Array.isArray(resources)) return 'resources must be an array';
  /** @type {Set<string>} */
  const names = new Set();
  for (const resource of resources) {
    if (!isObject(resource)) return 'resources must be a list of resources';
    if (!isText(resource.name)) return 'a resource has no name';
    if (names.has(resource.name)) return `two resources are called ${resource.name}`;
    names.add(resource.name);
    if (resource.kind !== 'gpio') return `resource "${resource.name}" is not a gpio pin`;
    if (!Number.isInteger(resource.gpio)) return `resource "${resource.name}" has no gpio number`;
    if (!DIRECTIONS.has(resource.direction)) {
      return `resource "${resource.name}" is not an input or an output`;
    }
    if (resource.direction === 'output' && !Number.isFinite(resource.safe)) {
      return `output "${resource.name}" has no safe value`;
    }
  }
  return null;
}

/**
 * Every command is checked against the table above by `commandProblem`, so the
 * loader and the runtime agree on what "the pin is declared" means. The name is
 * the loader's own business: it is what an action will call the command by.
 * @param {unknown} commands
 * @param {unknown} resources
 * @returns {string | null}
 */
function commandsProblem(commands, resources) {
  if (!Array.isArray(commands)) return 'commands must be an array';
  /** @type {Set<string>} */
  const names = new Set();
  for (const command of commands) {
    if (!isObject(command)) return 'commands must be a list of commands';
    if (!isText(command.name) || !COMMAND_NAME.test(command.name)) {
      return `command "${String(command.name)}" is not a command name`;
    }
    if (names.has(command.name)) return `two commands are called ${command.name}`;
    names.add(command.name);
    const problem = commandProblem(/** @type {any} */ (command), /** @type {any} */ (resources));
    if (problem) return `command ${command.name}: ${problem}`;
  }
  return null;
}

/**
 * The manifest's own claims, before the body is built. Each phrase is one line
 * and names the field, because the caller prefixes it with the directory.
 * @param {any} manifest
 * @returns {string | null}
 */
function manifestProblem(manifest) {
  if (!isObject(manifest)) return 'body.json is not an object';
  const { id } = manifest;
  if (!isText(id) || !ID.test(id)) return `"${String(id)}" is not a plugin id`;

  const { label } = manifest;
  if (!isObject(label) || !isText(label.en) || !isText(label.zh)) {
    return 'label needs an en and a zh name';
  }

  const { parts } = manifest;
  if (!Array.isArray(parts) || parts.length === 0 || parts.some((part) => !isText(part))) {
    return 'parts must be a list of part names';
  }

  const badResources = resourcesProblem(manifest.resources);
  if (badResources) return badResources;
  return commandsProblem(manifest.commands, manifest.resources);
}

/**
 * The body a manifest describes, built on the voice-only template: a plugin
 * adds commands, not abilities, so it hears and speaks exactly like the bare
 * board it is flashed onto. `parts` is kept for the simulator, which seats the
 * devices; the manifest carries no firmware of its own.
 * @param {any} manifest
 * @returns {import('../core/bodies.js').Body}
 */
function bodyFrom(manifest) {
  return {
    ...structuredClone(TEMPLATES.none),
    id: manifest.id,
    label: { en: manifest.label.en, zh: manifest.label.zh },
    parts: [...manifest.parts],
    commands: structuredClone(manifest.commands),
  };
}

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
