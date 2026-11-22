// A module is a body the repository ships: the plugin manifest plus what a
// person needs to actually use it — example actions, and the wiring that makes
// the pins true. This module is the one place that data is believed or refused,
// so the catalogue, the installer and the tests all mean the same thing by
// "valid".
//
// Two rules shape the code. First, a module is a plugin and nothing more: its
// `resources` and `commands` are held to the loader's rules, and its example
// actions are judged by `bodyProblem` on the very body the loader would build —
// a module may not be the one place a body slips past the rules the templates
// keep. Second, a phrase, never a throw: the caller prefixes it with the
// directory it read and puts it in a log line.
//
// The wiring check is deliberately narrow. `esp:GPIO<n>` is the one end that
// names a permission: the pin the module says it uses has to be a gpio resource
// the module declared, or the LED never lights and nobody knows why. Every other
// end (`led:A`, `r:1`, `esp:GND`) is the simulator's to resolve, not this
// module's to guess at.

import { commandProblem } from './io-program.js';
import { TEMPLATES, bodyProblem } from './bodies.js';

/**
 * A module id names a directory and reaches `config.body.template`. The shape
 * is the plugin id's, plus the one clause a module adds: a template's name is
 * not a module's to take, or a module directory would change what an existing
 * character means. The exclusion is built from `TEMPLATES`, so a sixth template
 * is refused without editing this line.
 */
export const MODULE_ID = new RegExp(
  `^(?!(${Object.keys(TEMPLATES).join('|')})$)[a-z][a-z0-9_-]*$`,
);

/** A command name is how an action calls it: no spaces, no caps. */
const COMMAND_NAME = /^[a-z][a-z0-9_]*$/;

/** The two directions a gpio pin may have. */
const DIRECTIONS = new Set(['input', 'output']);

/** The one wiring end this checker reads: the board's own pin. */
const ESP_PIN = /^esp:GPIO(\d+)$/;

/**
 * @typedef {{ en: string, zh: string }} Text
 * @typedef {{ id: string, part: string }} WiredPart
 * @typedef {{ a: string, b: string, why?: string }} Wire
 * @typedef {{ parts?: WiredPart[], links: Wire[] }} Wiring
 * @typedef {{
 *   id: string,
 *   label: Text,
 *   parts: string[],
 *   resources: import('./io-program.js').Resource[],
 *   commands: import('./io-program.js').Command[],
 *   examples?: import('./bodies.js').Action[],
 *   wiring?: Wiring,
 *   note?: Text,
 * }} ModuleManifest
 */

/** @param {unknown} value @returns {value is Record<string, any>} */
function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** @param {unknown} value @returns {boolean} */
function isText(value) {
  return typeof value === 'string' && value.trim() !== '';
}

/**
 * The resource table is the module's whole permission slip, and the rule is the
 * plugin loader's, word for word: only a gpio with a number, a direction, and —
 * for an output — a `safe` the bridge can restore. A second, looser reading here
 * would let a module install and then fail to run.
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
    if (resource.direction === 'output' && resource.safe !== 0 && resource.safe !== 1) {
      return `output "${resource.name}" needs a safe of 0 or 1`;
    }
  }
  return null;
}

/**
 * Every command is checked against the table above by `commandProblem`, so the
 * module catalogue and the plugin loader agree on what "the pin is declared"
 * means. The name is checked here because it is what an action will call.
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
    const problem = commandProblem(
      /** @type {any} */ (command),
      /** @type {any} */ (resources),
    );
    if (problem) return `command ${command.name}: ${problem}`;
  }
  return null;
}

/**
 * The body a module manifest describes, built exactly as the plugin loader
 * builds one: the voice-only template, its own id, label, parts, commands and
 * resources, and no actions of its own. `examples` are not installed on the
 * body — they are copied into a character, and only when a person says so.
 * @param {any} manifest
 * @returns {import('./bodies.js').Body}
 */
function bodyFrom(manifest) {
  return {
    ...structuredClone(TEMPLATES.none),
    id: manifest.id,
    label: { en: manifest.label.en, zh: manifest.label.zh },
    parts: [...manifest.parts],
    commands: structuredClone(manifest.commands),
    resources: structuredClone(manifest.resources),
  };
}

/**
 * Every `esp:GPIO<n>` a link names has to be a gpio the manifest declared. The
 * other end of a link is a part pin, and resolving it is the simulator's work;
 * a `esp:GND` or `esp:3V3` names no permission and is left alone.
 * @param {unknown} wiring
 * @param {unknown} resources
 * @returns {string | null}
 */
function wiringProblem(wiring, resources) {
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
      if (!pin) continue;
      if (!declared.has(Number(pin[1]))) {
        return `wiring.links[${i}].${end} is ${point}, which is not declared by a gpio resource`;
      }
    }
  }
  return null;
}

/**
 * One phrase saying what is wrong with a module manifest, or null. Takes any
 * manifest, not a `ModuleManifest`: it is handed the data just read from disk,
 * before its shape can be trusted, and it never throws on it.
 * @param {any} manifest
 * @returns {string | null}
 */
export function moduleProblem(manifest) {
  if (!isObject(manifest)) return 'a module manifest is not an object';

  const { id } = manifest;
  // The id is checked before its sentence, so a non-string is a refusal and not
  // a throw. `MODULE_ID` already excludes template names for callers holding
  // only the pattern; saying it here is what gives the log a useful phrase.
  if (Object.hasOwn(TEMPLATES, id)) {
    return `${id} is a built-in body, and a module may not take its name`;
  }
  if (!isText(id) || !MODULE_ID.test(id)) return `"${String(id)}" is not a module id`;

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
  // are the module's own suggestion of what a person can say.
  if (manifest.examples !== undefined && !Array.isArray(manifest.examples)) {
    return 'examples must be a list of actions';
  }
  const examples = manifest.examples ?? [];
  const badExample = bodyProblem({ ...bodyFrom(manifest), actions: examples });
  if (badExample) return `examples: ${badExample}`;

  return wiringProblem(manifest.wiring, manifest.resources);
}
