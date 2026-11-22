// The schema subset a body's data is written in — an action's arguments, a
// command's arguments — and the one checker that judges a value against it.
//
// It lives in its own module because two checkers need it: `core/actions.js`
// judges an action's call, and `core/io-program.js` judges a command's call
// after `$arg` substitution. `io-program.js` cannot import `actions.js` (that
// one imports it), and a second copy of the checker is how a value ends up
// accepted in one place and refused in the other — which is exactly the bug
// that made a substituted command argument skip its own bounds.
//
// Nothing here knows about verbs or IO ops: a schema and a value go in, an
// answer or a phrase comes out.

/** @typedef {import('./verbs.js').JsonSchemaSubset} JsonSchemaSubset */

/**
 * Whether a filled value fits a schema of the subset actions and commands are
 * written in.
 *
 * A schema that says nothing (`undefined`, a non-object, or no `type` at all)
 * is "cannot tell", not "no": the caller still applies its verb. A type outside
 * the subset is refused — nothing is known to be allowed. `anyOf` tries each
 * branch, top-level included; `ms` is why (an integer from 1 up, or `hold`).
 * The branch is one constraint, not the whole schema: a root `required`
 * written beside the union still has to hold, as it did in the validator this
 * replaced.
 * @param {unknown} value
 * @param {JsonSchemaSubset | undefined} schema
 * @returns {boolean}
 */
export function fitsSchema(value, schema) {
  if (!schema || typeof schema !== 'object') return true;
  if (Array.isArray(schema.anyOf) && !schema.anyOf.some((branch) => fitsSchema(value, branch))) {
    return false;
  }
  if (schema.const !== undefined) return value === schema.const;
  if (Array.isArray(schema.enum)) return schema.enum.includes(/** @type {string | number} */ (value));

  switch (schema.type) {
    case undefined:
      // A schema that names fields is an object schema without the word — a
      // root is often written that way — and its `required` must hold beside
      // whichever branch the value chose. A schema with no constraints at all
      // is still "cannot tell".
      return schema.required === undefined && schema.properties === undefined
        ? true
        : fitsObject(value, schema);
    case 'object':
      return fitsObject(value, schema);
    case 'array': {
      if (!Array.isArray(value)) return false;
      const items = schema.items;
      return items ? value.every((item) => fitsSchema(item, items)) : true;
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
      return false;
  }
}

/**
 * The object half of `fitsSchema`: a record, its `required` keys, and whatever
 * properties it carries. Shared by `type: 'object'` and by a schema that names
 * fields without naming its type.
 * @param {unknown} value
 * @param {JsonSchemaSubset} schema
 * @returns {boolean}
 */
function fitsObject(value, schema) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const obj = /** @type {Record<string, unknown>} */ (value);
  // The shape is refused by `schemaProblem` when a person writes it, but this
  // half must not throw on a file that skipped that check: `for…of true` was
  // every turn failing with a TypeError instead of a refusal.
  const required = Array.isArray(schema.required) ? schema.required : [];
  for (const key of required) if (!(key in obj)) return false;
  const properties = schema.properties && typeof schema.properties === 'object' && !Array.isArray(schema.properties)
    ? schema.properties
    : {};
  for (const [key, sub] of Object.entries(properties)) {
    if (key in obj && !fitsSchema(obj[key], sub)) return false;
  }
  return true;
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
 * @param {unknown} value
 * @returns {value is Record<string, any>}
 */
function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
