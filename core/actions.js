// Actions are data: a name the model may call, the arguments it accepts, and a
// short program of verbs that runs when it is called. This module is the two
// questions that data raises before anything moves — "is this action
// well-formed?" and "what does it actually run, given these arguments?".
//
// It is deliberately not a validator for model output: the caller checks the
// model's arguments against `action.args`, then hands them to `expand`, which
// refuses a step the verb's own schema does not fit. A refusal is data, not a
// sentence — `Drop` names the value and what it was expected to be — so the
// caller can say it in the model's own words. A drop with no reason cannot be
// debugged either way.
//
// The schema subset here is the whole of what an action may say. A keyword
// outside it is refused by name rather than ignored: silently skipping
// `pattern` would make an action that looks stricter than it is.

import { VERBS, VERB_NAMES } from './verbs.js';

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
 * One refused value, as data. `where` is `args` for anything taken from the
 * call's arguments, and `steps[N]` for element N of the array a step walks —
 * `value` is then that element as the author wrote it, and `expect` is said in
 * the item schema's words (`duration_ms`), not the verb's (`ms`), because the
 * element is the thing the author can see. `expect` is a phrase, not a
 * sentence: `move: step rejected — <json>; <expect>` is the caller's to build.
 * The one exception to "phrase" is the unknown-verb refusal, where the
 * offending line says `unknown verb "<v>"; one of the verbs: …` and the other
 * lines say `not run — step N uses an unknown verb`, naming the guilty line.
 * @typedef {{
 *   where: 'args' | `steps[${number}]`,
 *   value: unknown,
 *   expect: string,
 * }} Drop
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

  const malformed = action.args ? schemaProblem(action.args, 'arguments') : null;
  if (malformed) return `${name} ${malformed}`;

  const properties = action.args?.properties ?? {};
  const declared = new Set(Object.keys(properties));

  for (const [i, step] of run.entries()) {
    const at = `step ${i + 1} of ${name}`;
    const verb = VERB_TABLE[step.verb];
    if (!verb) return `${at} uses unknown verb "${step.verb}"`;
    if (!opts.has(step.verb)) return `this body does not have the verb ${step.verb}, which ${at} needs`;

    if (step.each !== undefined) {
      if (!declared.has(step.each)) return `${at} walks ${step.each}, which is not one of its arguments`;
      if (properties[step.each]?.type !== 'array') return `${at} walks ${step.each}, which is not an array argument`;
    }

    const used = refs(step.args);
    for (const ref of used) {
      if (ref.startsWith('$each.')) {
        if (step.each === undefined) return `${at} uses ${ref} outside a step that walks an array`;
        // A field the walked argument does not declare can never be filled, so
        // every element would be dropped at call time for a typo the author
        // could have been told about here.
        const field = ref.slice('$each.'.length);
        // Only refuse a field when the item schema is a record of fields this
        // checker can read and does not declare it — `anyOf` is a declared
        // shape too, so a field from any branch fills fine.
        const fields = itemFields(properties[step.each]?.items);
        if (fields && !fields.has(field)) {
          return `${at} uses ${ref}, but the elements of ${step.each} have no "${field}"`;
        }
      } else if (!declared.has(ref.slice(1))) {
        return `${at} refers to ${ref}, but ${ref.slice(1)} is not one of its arguments`;
      }
    }

    const fixed = fixedValueProblem(step, opts);
    if (fixed) return fixed;

    // A step that names no argument is the same value on every call, so the
    // verb's own schema can judge it now: `drive: 'sideways'` becomes a refusal
    // an author can read, instead of a step that vanishes at every call.
    const literal = step.args ?? {};
    if (used.length === 0 && !fits(literal, verb.args)) {
      return `${at} gives ${step.verb} ${JSON.stringify(literal)}; ${expectationOf(verb.args)}`;
    }
  }
  return null;
}

/**
 * Fill `$name` from the call's arguments and `$each.field` from the current
 * element, then keep only the steps that fit their verb. Whole values only: a
 * string that starts with `$` is a reference, and nothing else about it is
 * interpreted.
 *
 * An element that does not fit is one `Drop` and the rest still run, which is
 * what `move.steps` does today. A program naming a verb that does not exist is
 * not partly runnable at all, so it expands to nothing.
 * @param {Action} action
 * @param {Record<string, unknown>} args
 * @returns {{ steps: Step[], dropped: Drop[], hadDrive: boolean }}
 */
export function expand(action, args) {
  const name = action.name || 'this action';
  const run = Array.isArray(action.run) ? action.run : [];

  const badAt = run.findIndex((step) => !VERB_TABLE[step.verb]);
  if (badAt >= 0) {
    const guilty = run[badAt];
    const unknown = `unknown verb "${guilty.verb}"; one of the verbs: ${VERB_NAMES.join(', ')}`;
    // The whole action is refused, but only one line is at fault. Every other
    // line says what stopped it and which line did — `pose` is a legal verb, so
    // a reason listing the verbs would be false for the innocent lines.
    const stopped = `not run — step ${badAt + 1} uses an unknown verb`;
    return {
      steps: [],
      // One Drop per line of the program, so the count still tells the caller
      // how much was lost — the whole action, not just the one bad line.
      dropped: run.map((step, i) => ({ where: at(i), value: step, expect: i === badAt ? unknown : stopped })),
      hadDrive: false,
    };
  }

  /** @type {Step[]} */
  const steps = [];
  /** @type {Drop[]} */
  const dropped = [];

  for (const [i, step] of run.entries()) {
    const verb = VERB_TABLE[step.verb];
    if (!verb) {
      // The scan above already answered this. If it ever stops, fail loudly: a
      // step that vanishes with no reason is the one bug this module refuses.
      throw new Error(`${name}: step ${i + 1} names the unknown verb "${step.verb}"`);
    }

    if (step.each === undefined) {
      const filled = fill(step.args ?? {}, args, null);
      if (!fits(filled, verb.args)) {
        dropped.push({ where: 'args', value: filled, expect: expectationOf(verb.args) });
        continue;
      }
      steps.push({ verb: step.verb, args: asRecord(filled) });
      continue;
    }

    const list = args[step.each];
    if (!Array.isArray(list)) {
      dropped.push({ where: 'args', value: list, expect: `an array for ${step.each}` });
      continue;
    }

    // Over-length is truncated, not refused — the caller has already run, and a
    // program that could not start would be a worse answer than a shorter one.
    const max = action.args?.properties?.[step.each]?.maxItems;
    const elements = typeof max === 'number' ? list.slice(0, max) : list;
    // The element is judged by the verb's schema but described by the action's
    // item schema, so a reason about `duration_ms` keeps the field the author
    // wrote even though the verb calls it `ms`.
    const itemSchema = action.args?.properties?.[step.each]?.items;

    for (const [j, element] of elements.entries()) {
      const filled = fill(step.args ?? {}, args, element);
      if (fits(filled, verb.args)) steps.push({ verb: step.verb, args: asRecord(filled) });
      else dropped.push({ where: at(j), value: element, expect: expectationOf(itemSchema ?? verb.args) });
    }
  }

  return { steps, dropped, hadDrive: steps.some((step) => step.verb === 'drive') };
}

/**
 * The first thing this checker cannot read in a schema, as the rest of a
 * sentence: a word outside the subset, or a node that is not a schema at all.
 * Both are refused by name — a checker that crashed, or quietly skipped, on a
 * hand-edited admin JSON would report an action as sound when it is not.
 * @param {unknown} node
 * @param {string} path how the node is written in the action, e.g. `arguments.properties.a`
 * @returns {string | null}
 */
function schemaProblem(node, path) {
  if (!isRecord(node)) return `has ${path}, which is not a schema`;

  for (const key of Object.keys(node)) {
    if (!SCHEMA_WORDS.has(key)) {
      return `uses "${key}" in its arguments, and this checker does not read that word`;
    }
  }

  const schema = /** @type {JsonSchemaSubset} */ (node);

  // Values under `properties` are schemas; their keys are argument names and
  // may be anything. `items` and `anyOf` are schemas too, so they are walked.
  if (schema.properties !== undefined) {
    if (!isRecord(schema.properties)) return `has ${path}.properties, which is not a schema map`;
    for (const [arg, sub] of Object.entries(schema.properties)) {
      const bad = schemaProblem(sub, `${path}.properties.${arg}`);
      if (bad) return bad;
    }
  }
  if (schema.anyOf !== undefined) {
    if (!Array.isArray(schema.anyOf)) return `has ${path}.anyOf, which is not a list of schemas`;
    for (const [i, sub] of schema.anyOf.entries()) {
      const bad = schemaProblem(sub, `${path}.anyOf[${i}]`);
      if (bad) return bad;
    }
  }
  if (schema.items !== undefined) {
    const bad = schemaProblem(schema.items, `${path}.items`);
    if (bad) return bad;
  }
  return null;
}

/**
 * The field names an element of a walked argument may have, or `null` when the
 * item schema is not a record of fields this checker can read. `null` means
 * "cannot tell", not "no fields": a `$each.field` is then not refused, because
 * a field the checker cannot see is not proof of a typo. An `anyOf` item is one
 * of the subset's shapes, so a field any branch declares is declared.
 * @param {unknown} schema
 * @returns {Set<string> | null}
 */
function itemFields(schema) {
  if (!isRecord(schema)) return null;
  /** @type {Set<string>} */
  const fields = new Set();
  if (isRecord(schema.properties)) {
    for (const key of Object.keys(schema.properties)) fields.add(key);
  }
  if (Array.isArray(schema.anyOf)) {
    for (const branch of schema.anyOf) {
      if (!isRecord(branch) || !isRecord(branch.properties)) continue;
      for (const key of Object.keys(branch.properties)) fields.add(key);
    }
  }
  return fields.size > 0 ? fields : null;
}

/**
 * What a value would have to be to fit `schema`, in the words of the schema
 * itself: `drive must be one of forward/backward, steer one of left/right/
 * straight, duration_ms an integer >= 300`. An object is described field by
 * field, because that is what an author who got one field wrong needs to read;
 * anything else is one bare clause.
 * @param {unknown} schema
 * @returns {string}
 */
export function expectationOf(schema) {
  if (isRecord(schema) && schema.type === 'object' && isRecord(schema.properties)) {
    const parts = Object.entries(schema.properties).map(([key, sub], i) => (
      // "drive must be one of …, steer one of …": said once, then elided.
      i === 0 ? `${key} must be ${clauseOf(sub)}` : `${key} ${clauseOf(sub)}`
    ));
    if (parts.length > 0) return parts.join(', ');
  }
  return `must be ${clauseOf(schema)}`;
}

/**
 * The predicate half of an expectation — what the value itself has to be.
 * @param {unknown} schema
 * @returns {string}
 */
function clauseOf(schema) {
  if (!isRecord(schema)) return 'a value this checker cannot describe';

  if (Array.isArray(schema.enum)) return `one of ${schema.enum.map(shown).join('/')}`;
  if (schema.const !== undefined) return `the word ${JSON.stringify(schema.const)}`;
  if (Array.isArray(schema.anyOf)) {
    const branches = schema.anyOf.map((branch) => clauseOf(branch));
    return branches.length > 0 ? branches.join(' or ') : 'an allowed value';
  }

  switch (schema.type) {
    case 'object': return 'an object';
    case 'array': return 'an array';
    case 'string': return 'a string';
    case 'boolean': return 'a boolean';
    case 'number': return 'a number';
    case 'integer': {
      const low = typeof schema.minimum === 'number' ? ` >= ${schema.minimum}` : '';
      const high = typeof schema.maximum === 'number' ? ` <= ${schema.maximum}` : '';
      return `an integer${low}${high}`;
    }
    default: return 'a value this checker cannot describe';
  }
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function shown(value) {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

/**
 * `steps[N]`, typed as the literal so a `Drop` accepts it.
 * @param {number} index
 * @returns {`steps[${number}]`}
 */
function at(index) {
  return `steps[${index}]`;
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
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
