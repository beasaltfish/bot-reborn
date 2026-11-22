// A command is a bounded program of IO primitives — six of them, closed. A
// plugin writes one as data; the brain checks it once at load and expands it on
// every call; the simulator expands it the same way. The bridge never sees the
// program, only single ops, so this module is the one place command semantics
// live. It is deliberately independent of `core/actions.js`: that module checks
// actions over verbs, this one checks commands over IO ops.
//
// Two pure questions: `commandProblem` says why a command cannot run at all, as
// a phrase for the loader's log; `expandCommand` turns one call's arguments
// into the ops the caller sends, or refuses with the same phrase. Expansion is
// not execution — nothing is sent here — so a refusal returns no ops at all: a
// command that writes two pins must never half-run.
//
// The vocabulary is small on purpose. Every op names its target resource by the
// resource's `name`; the seal is that the name must be declared, and only a
// write may carry a value on hardware. A `pwm` may carry one linear `map`, and
// that is the only place a unit is allowed to exist.

/** @typedef {{ name: string, args?: object, run: OpStep[], returns?: true, timeoutMs: number }} Command */
/** @typedef {{ op: string, args: Record<string, unknown> }} OpStep */
/** @typedef {{ op: string, args: Record<string, unknown>, safe?: number, timeoutMs?: number }} Op */

/**
 * A resource as a plugin declares it. `name` is the only field every kind
 * shares; the rest says where the resource lives on the board. `safe` exists
 * only on outputs — it is the value the bridge restores on disconnect, so an
 * input has none and writing an input is refused.
 * @typedef {{
 *   kind?: string,
 *   name: string,
 *   gpio?: number,
 *   pin?: number,
 *   channel?: number,
 *   direction?: string,
 *   safe?: number,
 * }} Resource
 */

/** The closed set. No plugin can add a seventh; the bridge implements these six. */
export const IO_OPS = /** @type {const} */ ([
  'pin.write', 'pin.read', 'pwm', 'i2c.read', 'i2c.write', 'adc.read',
]);

/** Ops that put a value on hardware, and so must be revocable with a `safe`. */
const WRITES = new Set(['pin.write', 'pwm', 'i2c.write']);

/** The bound on how long one command may hold the body. */
const TIMEOUT_MS = { min: 1, max: 5000 };

/**
 * Where a resource sits on the board, as the number an op's `pin` becomes.
 * GPIO is the shape v1 writes; `pin` and `channel` are the same fact in the
 * other resource kinds' words. A resource that declares none of them keeps its
 * name — there is no number to invent, and a made-up address is worse than a
 * visible one.
 * @param {Resource} resource
 * @returns {number | string}
 */
function addressOf(resource) {
  for (const key of /** @type {const} */ (['gpio', 'pin', 'channel'])) {
    const value = resource[key];
    if (typeof value === 'number') return value;
  }
  return resource.name;
}

/**
 * @param {Resource[]} resources
 * @param {unknown} name
 * @returns {Resource | undefined}
 */
function resourceNamed(resources, name) {
  if (typeof name !== 'string') return undefined;
  return resources.find((resource) => resource.name === name);
}

/**
 * A linear map is two input points and two output points: `from: [a, b]`,
 * `to: [c, d]`. Anything else — a table, a third point, a string — is a
 * calculation this layer will not guess at.
 * @param {unknown} map
 * @returns {boolean}
 */
function isLinearMap(map) {
  if (typeof map !== 'object' || map === null) return false;
  const { from, to } = /** @type {{ from?: unknown, to?: unknown }} */ (map);
  if (!Array.isArray(from) || from.length !== 2) return false;
  if (!Array.isArray(to) || to.length !== 2) return false;
  return [...from, ...to].every((n) => typeof n === 'number' && Number.isFinite(n));
}

/**
 * The phrase for the first thing in `command.run` that cannot run, or null when
 * the whole program is runnable. A phrase, not a sentence: the loader prefixes
 * it with the plugin and command it names.
 * @param {Command} command
 * @param {Resource[]} resources
 * @returns {string | null}
 */
export function commandProblem(command, resources) {
  const { timeoutMs } = command;
  if (!Number.isInteger(timeoutMs) || timeoutMs < TIMEOUT_MS.min || timeoutMs > TIMEOUT_MS.max) {
    return `timeoutMs must be ${TIMEOUT_MS.min}..${TIMEOUT_MS.max}`;
  }

  const run = Array.isArray(command.run) ? command.run : [];
  const declared = Array.isArray(resources) ? resources : [];
  for (const step of run) {
    const op = step?.op;
    if (!IO_OPS.includes(/** @type {any} */ (op))) {
      return `op "${op}" is not one of the IO ops`;
    }

    const args = step.args ?? {};
    const resource = resourceNamed(declared, args.pin);
    if (!resource) return `pin "${String(args.pin)}" is not declared`;
    if (WRITES.has(op) && !Number.isFinite(resource.safe)) {
      return `output "${resource.name}" has no safe value`;
    }
    if (op === 'pwm' && args.map !== undefined && !isLinearMap(args.map)) {
      return 'map is linear only: from and to must both have two numbers';
    }
  }
  return null;
}

/**
 * `$name` stands for the whole value of that argument — never a fragment of one.
 * Substitution reaches into arrays and plain objects because an op's argument
 * may be one (`i2c.write`'s bytes), and a `$` the caller cannot resolve is
 * refused rather than sent as `undefined`.
 * @param {unknown} value
 * @param {Record<string, unknown>} given
 * @returns {{ value: unknown, missing?: string }}
 */
function substitute(value, given) {
  if (typeof value === 'string' && value.startsWith('$')) {
    const name = value.slice(1);
    if (!Object.hasOwn(given, name)) return { value, missing: name };
    return { value: given[name] };
  }
  if (Array.isArray(value)) {
    const out = [];
    for (const item of value) {
      const done = substitute(item, given);
      if (done.missing) return done;
      out.push(done.value);
    }
    return { value: out };
  }
  if (typeof value === 'object' && value !== null) {
    /** @type {Record<string, unknown>} */
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      const done = substitute(item, given);
      if (done.missing) return done;
      out[key] = done.value;
    }
    return { value: out };
  }
  return { value };
}

/**
 * One `map` point, linear only. A span of zero — `from: [90, 90]` — is still a
 * legitimately declared map; every input lands on the span's start, so the
 * result is `to[0]` with no division by zero.
 * @param {number} value
 * @param {{ from: number[], to: number[] }} map
 * @returns {number}
 */
function applyMap(value, { from, to }) {
  if (from[1] === from[0]) return to[0];
  const span = (value - from[0]) / (from[1] - from[0]);
  return Math.round(to[0] + span * (to[1] - to[0]));
}

/**
 * Expand one command for one call.
 *
 * Whole ops only: on any refusal `ops` is empty and `drop` is the phrase. A
 * write op gets the resource's `safe` and the command's `timeoutMs`; a read op
 * gets neither, because there is nothing to restore and nothing to time out.
 * `pwm`'s `map` becomes `us` and its `value`/`map` arguments are consumed.
 * @param {Command} command
 * @param {Record<string, unknown>} given
 * @param {Resource[]} [resources]
 * @returns {{ ops: Op[], drop?: string }}
 */
export function expandCommand(command, given, resources = []) {
  const problem = commandProblem(command, resources);
  if (problem) return { ops: [], drop: problem };

  /** @type {Op[]} */
  const ops = [];
  for (const step of command.run) {
    const { op } = step;
    const { value: args, missing } = substitute(step.args ?? {}, given ?? {});
    if (missing) return { ops: [], drop: `argument "${missing}" is missing` };

    /** @type {Record<string, unknown>} */
    const resolved = /** @type {Record<string, unknown>} */ (args);
    const resource = /** @type {Resource} */ (resourceNamed(resources, resolved.pin));
    resolved.pin = addressOf(resource);

    if (op === 'pwm' && resolved.map !== undefined) {
      const { map, value, ...rest } = resolved;
      ops.push({
        op,
        args: { ...rest, us: applyMap(Number(value), /** @type {{ from: number[], to: number[] }} */ (map)) },
        safe: resource.safe,
        timeoutMs: command.timeoutMs,
      });
      continue;
    }

    if (WRITES.has(op)) {
      ops.push({ op, args: resolved, safe: resource.safe, timeoutMs: command.timeoutMs });
      continue;
    }

    ops.push({ op, args: resolved });
  }
  return { ops };
}
