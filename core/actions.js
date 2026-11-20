// Actions are data: a name the model may call, the arguments it accepts, and a
// short program of verbs that runs when it is called. This module is the two
// questions that data raises before anything moves — "is this action
// well-formed?" and "what does it actually run, given these arguments?".
//
// It is deliberately not a validator for model output: the caller checks the
// model's arguments against `action.args`, then hands them to `expand`, which
// refuses a step the verb's own schema does not fit. One sentence per refusal,
// because a drop with no reason cannot be debugged.
//
// The schema subset here is the whole of what an action may say. A keyword
// outside it is refused by name rather than ignored: silently skipping
// `pattern` would make an action that looks stricter than it is.

import { VERBS } from './verbs.js';

/** @typedef {import('./verbs.js').JsonSchemaSubset} JsonSchemaSubset */
/** @typedef {import('./verbs.js').Verb} Verb */

/**
 * One line of an action's program: a verb, the arguments to give it, and — when
 * this step runs once per element of an array argument — the name of that
 * argument. Inside an `each` step an element's field is written `$each.field`;
 * there is no second variable.
 * @typedef {{
 *   verb: string,
 *   args?: Record<string, unknown>,
 *   each?: string,
 * }} RunStep
 */

/**
 * @typedef {{
 *   name: string,
 *   args?: JsonSchemaSubset,
 *   run: RunStep[],
 * }} Action
 */

/**
 * @typedef {{
 *   verb: string,
 *   args: Record<string, unknown>,
 * }} Step
 */

/**
 * @typedef {{
 *   poses: string[],
 *   clips: string[],
 *   has: (verb: string) => boolean,
 * }} ProblemOpts
 */

/**
 * Every word this checker reads. `object`/`required`/`properties`,
 * `array`/`items`/`maxItems`, `integer` with bounds, `string` with `enum`,
 * `boolean`, `const`, and `anyOf`. Kept as one list so the refusal below cannot
 * drift from the checker.
 */
const SCHEMA_WORDS = new Set([
  'type', 'properties', 'required', 'enum', 'const', 'anyOf', 'items',
  'maxItems', 'minimum', 'maximum',
]);

/**
 * The verb table, seen as a lookup that may miss: `VERBS` is typed as a total
 * record of the five names, and a program may name a sixth.
 * @type {Record<string, Verb | undefined>}
 */
const VERB_TABLE = VERBS;

/**
 * One sentence saying what is wrong with an action, or `null` if nothing is.
 * @param {Action} action
 * @param {ProblemOpts} opts
 * @returns {string | null}
 */
export function actionProblem(action, opts) {
  const name = action.name || 'this action';
  const run = Array.isArray(action.run) ? action.run : [];
  if (run.length === 0) return `${name} has no steps to run`;

  const word = action.args ? unsupportedWord(action.args) : null;
  if (word) {
    return `${name} uses "${word}" in its arguments, and this checker does not read that word`;
  }

  const properties = action.args?.properties ?? {};
  const declared = new Set(Object.keys(properties));

  for (const [i, step] of run.entries()) {
    const at = `step ${i + 1} of ${name}`;
    if (!VERB_TABLE[step.verb]) return `${at} uses unknown verb "${step.verb}"`;
    if (!opts.has(step.verb)) return `this body does not have the verb ${step.verb}, which ${at} needs`;

    if (step.each !== undefined) {
      if (!declared.has(step.each)) return `${at} walks ${step.each}, which is not one of its arguments`;
      if (properties[step.each]?.type !== 'array') return `${at} walks ${step.each}, which is not an array argument`;
    }

    for (const ref of refs(step.args)) {
      if (ref.startsWith('$each.')) {
        if (step.each === undefined) return `${at} uses ${ref} outside a step that walks an array`;
      } else if (!declared.has(ref.slice(1))) {
        return `${at} refers to ${ref}, but ${ref.slice(1)} is not one of its arguments`;
      }
    }

    const fixed = fixedValueProblem(step, opts);
    if (fixed) return fixed;
  }
  return null;
}

/**
 * Fill `$name` from the call's arguments and `$each.field` from the current
 * element, then keep only the steps that fit their verb. Whole values only: a
 * string that starts with `$` is a reference, and nothing else about it is
 * interpreted.
 *
 * An element that does not fit is one `dropped` and the rest still run, which
 * is what `move.steps` does today. A program naming a verb that does not exist
 * is not partly runnable at all, so it expands to nothing.
 * @param {Action} action
 * @param {Record<string, unknown>} args
 * @returns {{ steps: Step[], dropped: string[], hadDrive: boolean }}
 */
export function expand(action, args) {
  const name = action.name || 'this action';
  const run = Array.isArray(action.run) ? action.run : [];

  const badAt = run.findIndex((step) => !VERB_TABLE[step.verb]);
  if (badAt >= 0) {
    const bad = run[badAt].verb;
    return {
      steps: [],
      // One reason per line of the program, so the count still tells the caller
      // how much was lost — the whole action, not just the one bad line.
      dropped: run.map((_, i) => (i === badAt
        ? `${name}: step ${i + 1} uses unknown verb "${bad}" — the whole action is dropped`
        : `${name}: step ${i + 1} not run — step ${badAt + 1} uses unknown verb "${bad}"`)),
      hadDrive: false,
    };
  }

  /** @type {Step[]} */
  const steps = [];
  /** @type {string[]} */
  const dropped = [];

  for (const [i, step] of run.entries()) {
    const verb = VERB_TABLE[step.verb];
    if (!verb) continue; // the scan above already answered this; keeps types honest

    if (step.each === undefined) {
      const filled = fill(step.args ?? {}, args, null);
      if (fits(filled, verb.args)) steps.push({ verb: step.verb, args: asRecord(filled) });
      else dropped.push(`${name}: step ${i + 1} rejected — ${JSON.stringify(filled)} does not fit ${step.verb}`);
      continue;
    }

    const list = args[step.each];
    if (!Array.isArray(list)) {
      dropped.push(`${name}: step ${i + 1} walks ${step.each}, which is not an array — got ${JSON.stringify(list)}`);
      continue;
    }

    // Over-length is truncated, not refused — the caller has already run, and a
    // program that could not start would be a worse answer than a shorter one.
    const max = action.args?.properties?.[step.each]?.maxItems;
    const elements = typeof max === 'number' ? list.slice(0, max) : list;

    for (const [j, element] of elements.entries()) {
      const filled = fill(step.args ?? {}, args, element);
      if (fits(filled, verb.args)) steps.push({ verb: step.verb, args: asRecord(filled) });
      // The element is printed as the author wrote it, so a reason about
      // `duration_ms` is findable even though the verb calls it `ms`.
      else dropped.push(`${name}: ${step.each}[${j}] rejected — ${JSON.stringify(element)} does not fit ${step.verb}`);
    }
  }

  return { steps, dropped, hadDrive: steps.some((step) => step.verb === 'drive') };
}

/**
 * The first schema word this checker does not read, walking into `properties`,
 * `items` and `anyOf`. Values under `properties` are schemas; their keys are
 * argument names and may be anything.
 * @param {JsonSchemaSubset} schema
 * @returns {string | null}
 */
function unsupportedWord(schema) {
  for (const key of Object.keys(schema)) {
    if (!SCHEMA_WORDS.has(key)) return key;
  }
  for (const sub of Object.values(schema.properties ?? {})) {
    const word = unsupportedWord(sub);
    if (word) return word;
  }
  for (const sub of schema.anyOf ?? []) {
    const word = unsupportedWord(sub);
    if (word) return word;
  }
  if (schema.items) return unsupportedWord(schema.items);
  return null;
}

/**
 * Whether a filled value fits a verb's schema. `anyOf` tries each branch —
 * `ms` is why: an integer from 1 up, or the literal `hold`, and no upper bound.
 * @param {unknown} value
 * @param {JsonSchemaSubset} schema
 * @returns {boolean}
 */
function fits(value, schema) {
  if (schema.anyOf) return schema.anyOf.some((branch) => fits(value, branch));
  if (schema.const !== undefined) return value === schema.const;
  if (schema.enum) return schema.enum.includes(/** @type {string | number} */ (value));

  switch (schema.type) {
    case 'object': {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
      const obj = /** @type {Record<string, unknown>} */ (value);
      for (const key of schema.required ?? []) if (!(key in obj)) return false;
      for (const [key, sub] of Object.entries(schema.properties ?? {})) {
        if (key in obj && !fits(obj[key], sub)) return false;
      }
      return true;
    }
    case 'array': {
      if (!Array.isArray(value)) return false;
      const items = schema.items;
      return items ? value.every((item) => fits(item, items)) : true;
    }
    case 'integer': {
      if (!Number.isInteger(value)) return false;
      const n = /** @type {number} */ (value);
      return (schema.minimum === undefined || n >= schema.minimum)
        && (schema.maximum === undefined || n <= schema.maximum);
    }
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'string':
      return typeof value === 'string';
    case 'boolean':
      return typeof value === 'boolean';
    default:
      // No type and no const/enum/anyOf: nothing is known to be allowed.
      return false;
  }
}

/**
 * Whole-value substitution. A string starting with `$` is a reference; objects
 * and arrays are copied so the caller's arguments are never mutated.
 * @param {unknown} value
 * @param {Record<string, unknown>} args
 * @param {unknown} element
 * @returns {unknown}
 */
function fill(value, args, element) {
  if (typeof value === 'string' && value.startsWith('$')) {
    if (value.startsWith('$each.')) {
      if (!element || typeof element !== 'object') return undefined;
      return /** @type {Record<string, unknown>} */ (element)[value.slice('$each.'.length)];
    }
    return args[value.slice(1)];
  }
  if (Array.isArray(value)) return value.map((item) => fill(item, args, element));
  if (value && typeof value === 'object') {
    /** @type {Record<string, unknown>} */
    const out = {};
    for (const [key, item] of Object.entries(value)) out[key] = fill(item, args, element);
    return out;
  }
  return value;
}

/**
 * Every `$` reference in a value, in the order written.
 * @param {unknown} value
 * @param {string[]} [out]
 * @returns {string[]}
 */
function refs(value, out = []) {
  if (typeof value === 'string' && value.startsWith('$')) out.push(value);
  else if (Array.isArray(value)) for (const item of value) refs(item, out);
  else if (value && typeof value === 'object') for (const item of Object.values(value)) refs(item, out);
  return out;
}

/**
 * A `pose` or a `clip` written as a literal (not `$arg`) has to be one the body
 * knows about. These two are checked here because their sets are not in the
 * verb schema — the body supplies them.
 * @param {RunStep} step
 * @param {ProblemOpts} opts
 * @returns {string | null}
 */
function fixedValueProblem(step, opts) {
  const pose = step.verb === 'pose' ? step.args?.pose : undefined;
  if (typeof pose === 'string' && !pose.startsWith('$') && !opts.poses.includes(pose)) {
    return `pose ${pose} is not one of ${some(opts.poses)}`;
  }
  const clip = step.verb === 'voice' ? step.args?.clip : undefined;
  if (typeof clip === 'string' && !clip.startsWith('$') && !opts.clips.includes(clip)) {
    return `clip ${clip} is not one of ${some(opts.clips)}`;
  }
  return null;
}

/**
 * @param {string[]} names
 * @returns {string}
 */
function some(names) {
  return names.length > 0 ? names.join(', ') : 'the ones this body has';
}

/**
 * @param {unknown} value
 * @returns {Record<string, unknown>}
 */
function asRecord(value) {
  return /** @type {Record<string, unknown>} */ (value);
}
