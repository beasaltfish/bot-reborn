// The rules a plugin manifest is held to, in one place. Two loaders read this
// data — `server/plugin-bodies.js` for a plugin somebody dropped in, and
// `core/module-manifest.js` for a module the repository ships — and a second,
// looser reading in either would let a body install and then fail to run.
//
// Everything here takes data just read from disk, before its shape can be
// trusted, and answers with a phrase or null. Nothing throws.

import { commandProblem } from './io-program.js';
import { TEMPLATES, bodyProblem } from './bodies.js';

/** A plugin id names a directory and reaches `config.body.template`. */
export const ID = /^[a-z][a-z0-9_-]*$/;

/** The one wiring end this checker reads: the board's own pin. */
const ESP_PIN = /^esp:GPIO(\d+)$/;

/** A command name is how an action calls it: no spaces, no caps. */
const COMMAND_NAME = /^[a-z][a-z0-9_]*$/;

/** The two directions a gpio pin may have. */
const DIRECTIONS = new Set(['input', 'output']);

/** @param {unknown} value @returns {value is Record<string, any>} */
function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** @param {unknown} value @returns {boolean} */
function isText(value) {
  return typeof value === 'string' && value.trim() !== '';
}

/**
 * The resource table is the plugin's whole permission slip: a command may only
 * name a resource declared here. Part A settles only `gpio`, so any other kind
 * is refused by name (`resource "x" is not a gpio pin`) rather than guessed at.
 * @param {unknown} resources
 * @returns {string | null}
 */
export function resourcesProblem(resources) {
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
    // The value the pin returns to on disconnect is a level, not a number near
    // one: the bridge can only restore 0 or 1, so anything else is refused here
    // rather than by the command that happens to name this pin.
    if (resource.direction === 'output' && resource.safe !== 0 && resource.safe !== 1) {
      return `output "${resource.name}" needs a safe of 0 or 1`;
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
export function commandsProblem(commands, resources) {
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
 * Every `esp:GPIO<n>` a link names has to be a gpio the manifest declared. The
 * other end of a link is a part pin, and resolving it is the simulator's work;
 * a `esp:GND` or `esp:3V3` names no permission and is left alone.
 *
 * It lives here, not in `core/module-manifest.js`, because a plugin a person
 * saved and a module the repository ships are held to the same rule.
 * @param {unknown} wiring
 * @param {unknown} resources
 * @returns {string | null}
 */
export function wiringProblem(wiring, resources) {
  if (wiring === undefined) return null;
  if (!isObject(wiring)) return 'wiring must be an object';
  if (!Array.isArray(wiring.links)) return 'wiring.links must be a list of links';

  /** @type {Set<number>} */
  const declared = new Set(
    (Array.isArray(resources) ? resources : [])
      .filter((resource) => isObject(resource)
        && resource.kind === 'gpio'
        && Number.isInteger(resource.gpio))
      .map((resource) => /** @type {number} */ (resource.gpio)),
  );

  for (const [i, link] of wiring.links.entries()) {
    if (!isObject(link)) return `wiring.links[${i}] is not a link`;
    for (const end of /** @type {const} */ (['a', 'b'])) {
      const point = link[end];
      if (typeof point !== 'string') return `wiring.links[${i}].${end} is not a point`;
      const pin = ESP_PIN.exec(point);
      if (!pin) {
        // `esp:GPIO5x` almost passes for a board pin; left alone it would be
        // resolved by the simulator as a part name and fail there, far from the
        // typo. Anything else (`esp:GND`, `led:A`) is not ours to judge.
        if (point.startsWith('esp:GPIO')) {
          return `wiring.links[${i}].${end} is ${point}, which is not an esp:GPIO<n> pin`;
        }
        continue;
      }
      if (!declared.has(Number(pin[1]))) {
        return `wiring.links[${i}].${end} is ${point}, which is not declared by a gpio resource`;
      }
    }
  }
  return null;
}

/**
 * The manifest's own claims, before the body is built. Each phrase is one line
 * and names the field, because the caller prefixes it with the directory.
 * @param {any} manifest
 * @returns {string | null}
 */
export function manifestProblem(manifest) {
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
  const badCommands = commandsProblem(manifest.commands, manifest.resources);
  if (badCommands) return badCommands;

  // An example is an action the character may end up owning, so it is judged by
  // the same checker as a hand-written one, on the body this manifest builds.
  // The prefix says where the fault is: `commands` are checked above, and these
  // are the manifest's own suggestion of what a person can say.
  if (manifest.examples !== undefined && !Array.isArray(manifest.examples)) {
    return 'examples must be a list of actions';
  }
  const badExample = bodyProblem({ ...bodyFrom(manifest), actions: manifest.examples ?? [] });
  if (badExample) return `examples: ${badExample}`;

  return wiringProblem(manifest.wiring, manifest.resources);
}

/**
 * The body a manifest describes, built on the voice-only template: a plugin
 * adds commands, not abilities, so it hears and speaks exactly like the bare
 * board it is flashed onto. `resources` is the table a command's `pin` name
 * resolves against, so it travels with the commands; `parts` is kept for the
 * simulator, which seats the devices; the manifest carries no firmware of its
 * own.
 * @param {any} manifest
 * @returns {import('./bodies.js').Body}
 */
export function bodyFrom(manifest) {
  return {
    ...structuredClone(TEMPLATES.none),
    id: manifest.id,
    label: { en: manifest.label.en, zh: manifest.label.zh },
    parts: [...manifest.parts],
    commands: structuredClone(manifest.commands),
    resources: structuredClone(manifest.resources),
    // What a person reads and what the bench draws travel with the body: a body
    // the page cannot see the wiring of is a body with no project.
    ...(manifest.wiring ? { wiring: structuredClone(manifest.wiring) } : {}),
    ...(manifest.note ? { note: { ...manifest.note } } : {}),
  };
}
