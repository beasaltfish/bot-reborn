// A module is a body the repository ships: the plugin manifest plus what a
// person needs to actually use it — example actions, and the wiring that makes
// the pins true. The fields are judged by `core/plugin-manifest.js`, one
// contract for a module and a body a person saved; this module adds only what
// is a module's own: the id may not take a template's name.

import { TEMPLATES } from './bodies.js';
import { manifestProblem } from './plugin-manifest.js';

/**
 * Escapes a template name so a regex built from `TEMPLATES` cannot misfire.
 * @param {string} text
 * @returns {string}
 */
function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * A module id names a directory and reaches `config.body.template`. The shape
 * is the plugin id's, plus the one clause a module adds: a template's name is
 * not a module's to take, or a module directory would change what an existing
 * character means. The exclusion is built from `TEMPLATES`, so a sixth template
 * is refused without editing this line.
 */
export const MODULE_ID = new RegExp(
  `^(?!(?:${Object.keys(TEMPLATES).map(escapeRegExp).join('|')})$)[a-z][a-z0-9_-]*$`,
);

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

  // Everything else is the plugin contract: one reading for a module the
  // repository ships and a body a person saved, so the two can never disagree
  // about what a valid body is.
  return manifestProblem(manifest);
}
