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
// resource's `name`; the name must be declared, and only a gpio pin is
// addressable — the i2c/adc resource contract is not settled, so those are
// refused rather than guessed at. Writes go to outputs and carry the resource's
// `safe`; reads come from inputs and carry neither. A `pwm` may carry one
// linear `map`, and that is the only place a unit is allowed to exist.

/** @typedef {{ name: string, args?: object, run: OpStep[], returns?: true, timeoutMs: number }} Command */
/** @typedef {{ op: string, args: Record<string, unknown> }} OpStep */
/** @typedef {{ op: string, args: Record<string, unknown>, safe?: number, timeoutMs?: number }} Op */

/**
 * A resource as a plugin declares it. `name` is the only field every kind
 * shares; the rest says where the resource lives on the board. `safe` exists
 * only on outputs — it is the value the bridge restores on disconnect, so an
 * input has none and writing an input is refused. Only `kind: 'gpio'` with a
 * numeric `gpio` field is runnable today.
 * @typedef {{
 *   kind?: string,
 *   name: string,
 *   gpio?: number,
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

/** Ops that read a value back. Only the last step of a `returns` command may. */
const READS = new Set(['pin.read', 'i2c.read', 'adc.read']);

/** The bound on how long one command may hold the body. */
const TIMEOUT_MS = { min: 1, max: 5000 };

/**
 * The shape of the data itself, before any of it is believed. A command that is
 * not an object, a `run` that is not an array, a step or `args` that is not an
 * object, or a `resources` table that is not an array is refused here — the
 * walkers below may then trust those shapes and never throw.
 * @param {unknown} command
 * @param {unknown} resources
 * @returns {string | null}
 */
function structureProblem(command, resources) {
  if (typeof command !== 'object' || command === null || Array.isArray(command)) {
    return 'command must be an object';
  }
  const run = /** @type {Record<string, unknown>} */ (command).run;
  if (!Array.isArray(run)) return 'run must be an array of steps';
  if (!Array.isArray(resources)) return 'resources must be an array';
  for (const step of run) {
    if (typeof step !== 'object' || step === null || Array.isArray(step)) {
      return 'run must be an array of steps';
    }
    const { args } = /** @type {Record<string, unknown>} */ (step);
    if (args !== undefined && (typeof args !== 'object' || args === null || Array.isArray(args))) {
      return 'step args must be an object';
    }
  }
  return null;
}

/**
 * @param {Resource[]} resources
 * @param {unknown} name
 * @returns {Resource | undefined}
 */
function resourceNamed(resources, name) {
  if (typeof name !== 'string') return undefined;
  return resources.find((resource) => (
    typeof resource === 'object' && resource !== null && resource.name === name
  ));
}

/**
 * Where a step points, checked once. Writes need a gpio output with a numeric
 * pin and a `safe`; reads need a gpio input. Any other kind, or a gpio without
 * a number, is refused: a name quietly passed to the bridge is not an address.
 * @param {OpStep} step
 * @param {Resource[]} resources
 * @param {boolean} write
 * @returns {{ resource: Resource } | { problem: string }}
 */
function targetOf(step, resources, write) {
  const args = step.args ?? {};
  const resource = resourceNamed(resources, args.pin);
  if (!resource) return { problem: `pin "${String(args.pin)}" is not declared` };
  if (resource.kind !== 'gpio' || !Number.isInteger(resource.gpio)) {
    return { problem: `resource "${resource.name}" is not a gpio pin` };
  }
  if (write) {
    if (resource.direction === 'input') {
      return { problem: `input "${resource.name}" cannot be written` };
    }
    if (resource.direction !== 'output') {
      return { problem: `resource "${resource.name}" is not a gpio output` };
    }
    if (!Number.isFinite(resource.safe)) {
      return { problem: `output "${resource.name}" has no safe value` };
    }
  } else if (resource.direction !== 'input') {
    return { problem: `resource "${resource.name}" is not a gpio input` };
  }
  return { resource };
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
 * Every static thing a step cannot get wrong, plus its resolved target. Shared
 * by both entry points so `expandCommand` never looks up a different resource
 * than the one `commandProblem` approved.
 * @param {OpStep} step
 * @param {Resource[]} resources
 * @returns {{ resource: Resource } | { problem: string }}
 */
function checkStep(step, resources) {
  const { op } = step;
  if (!IO_OPS.includes(/** @type {any} */ (op))) {
    return { problem: `op "${op}" is not one of the IO ops` };
  }
  // i2c and adc resources have no settled shape in this part, so no step may
  // use them — and a gpio pin must not stand in for one. Part B defines them.
  if (op === 'i2c.read' || op === 'i2c.write' || op === 'adc.read') {
    return { problem: 'i2c/adc resources are not defined yet' };
  }

  const args = step.args ?? {};
  const target = targetOf(step, resources, WRITES.has(op));
  if ('problem' in target) return target;

  if (op !== 'pwm' && args.map !== undefined) return { problem: 'map is only for pwm' };
  if (op === 'pwm') {
    const value = args.value;
    if (value === undefined) return { problem: 'pwm needs a value' };
    const runtimeArg = typeof value === 'string' && value.startsWith('$') && value.length > 1;
    if (typeof value === 'number' ? !Number.isFinite(value) : !runtimeArg) {
      return { problem: 'pwm value must be a finite number' };
    }
    if (args.map !== undefined && !isLinearMap(args.map)) {
      return { problem: 'map is linear only: from and to must both have two numbers' };
    }
  }
  return target;
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
  const malformed = structureProblem(command, resources);
  if (malformed) return malformed;

  const { timeoutMs } = command;
  if (!Number.isInteger(timeoutMs) || timeoutMs < TIMEOUT_MS.min || timeoutMs > TIMEOUT_MS.max) {
    return `timeoutMs must be ${TIMEOUT_MS.min}..${TIMEOUT_MS.max}`;
  }

  for (const step of command.run) {
    const checked = checkStep(step, resources);
    if ('problem' in checked) return checked.problem;
  }

  // `returns` is a promise about the result: exactly one read, and it is what
  // the command ends on. Two reads would have to choose which value comes
  // back; a read before the end would be run for nothing. And the reverse: a
  // read nobody receives is a value silently dropped, so a command that ends
  // in one must say `returns`.
  const last = command.run[command.run.length - 1];
  const reads = command.run.filter((step) => READS.has(step.op)).length;
  if (command.returns === true) {
    if (reads !== 1 || !READS.has(last?.op)) {
      return 'returns needs exactly one read at the end';
    }
  } else if (last && READS.has(last.op)) {
    return 'a trailing read needs returns';
  }
  return null;
}

/**
 * `$name` stands for the whole value of that argument — never a fragment of one.
 * Substitution reaches into arrays and plain objects because an op's argument
 * may be one (`i2c.write`'s bytes), and a `$` the caller cannot resolve is
 * refused rather than sent as `undefined`. Copies use `Object.fromEntries` so a
 * `__proto__` key from plugin data is an own field, not a prototype change.
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
    const pairs = [];
    for (const [key, item] of Object.entries(value)) {
      const done = substitute(item, given);
      if (done.missing) return done;
      pairs.push([key, done.value]);
    }
    return { value: Object.fromEntries(pairs) };
  }
  return { value };
}

/**
 * Substitute the step's data slots, leaving `pin` alone: the pin is a static
 * reference checked against the resource table, not a value the caller supplies.
 * A `$arg` that names the pin is therefore refused by validation, not resolved
 * into a different target at expansion time.
 * @param {Record<string, unknown>} args
 * @param {Record<string, unknown>} given
 * @returns {{ value: Record<string, unknown>, missing?: string }}
 */
function dataArgs(args, given) {
  const pairs = [];
  for (const [key, item] of Object.entries(args)) {
    if (key === 'pin') continue;
    const done = substitute(item, given);
    if (done.missing) return { value: {}, missing: done.missing };
    pairs.push([key, done.value]);
  }
  return { value: Object.fromEntries(pairs) };
}

/**
 * One `map` point, linear only. A step without a map is the raw value: the
 * spec allows a linear `map` but never requires one, and with no map there is
 * no unit to convert, so the number already *is* the pulse width. A span of
 * zero — `from: [90, 90]` — is still a legitimately declared map; every input
 * lands on the span's start, so the result is `to[0]` with no division by zero.
 * @param {number} value
 * @param {{ from: number[], to: number[] } | undefined} map
 * @returns {number}
 */
function applyMap(value, map) {
  if (!map) return value;
  const { from, to } = map;
  if (from[1] === from[0]) return to[0];
  const span = (value - from[0]) / (from[1] - from[0]);
  return Math.round(to[0] + span * (to[1] - to[0]));
}

/**
 * Expand one command for one call.
 *
 * `resources` is required: the same declared table that `commandProblem` checks
 * is what makes a name an address and what carries `safe` onto a write. It is
 * not optional, because an omitted table would silently turn every command into
 * "pin not declared" (or, worse, be papered over).
 *
 * Whole ops only: on any refusal `ops` is empty and `drop` is the phrase. A
 * write op gets the resource's `safe` and the command's `timeoutMs`; a read op
 * gets neither, because there is nothing to restore and nothing to time out.
 * `pwm`'s `map` becomes `us` and its `value`/`map` arguments are consumed; with
 * no map the value already is `us`. A non-finite input or output is a refusal,
 * never `NaN` on the wire.
 * @param {Command} command
 * @param {Record<string, unknown>} given
 * @param {Resource[]} resources
 * @returns {{ ops: Op[], drop?: string }}
 */
export function expandCommand(command, given, resources) {
  const problem = commandProblem(command, resources);
  if (problem) return { ops: [], drop: problem };

  const values = given ?? {};
  /** @type {Op[]} */
  const ops = [];
  for (const step of command.run) {
    const { op } = step;
    const checked = checkStep(step, resources);
    if ('problem' in checked) return { ops: [], drop: checked.problem };
    const { resource } = checked;

    const { value: data, missing } = dataArgs(step.args ?? {}, values);
    if (missing) return { ops: [], drop: `argument "${missing}" is missing` };

    if (op === 'pwm') {
      const { map, value, ...rest } = data;
      const input = Number(value);
      if (!Number.isFinite(input)) {
        return { ops: [], drop: 'pwm value must be a finite number' };
      }
      const us = applyMap(input, /** @type {{ from: number[], to: number[] } | undefined} */ (map));
      if (!Number.isFinite(us)) {
        return { ops: [], drop: 'pwm result is not a finite number' };
      }
      ops.push({
        op,
        args: Object.fromEntries([['pin', resource.gpio], ...Object.entries(rest), ['us', us]]),
        safe: resource.safe,
        timeoutMs: command.timeoutMs,
      });
      continue;
    }

    const args = Object.fromEntries([['pin', resource.gpio], ...Object.entries(data)]);
    if (WRITES.has(op)) {
      ops.push({ op, args, safe: resource.safe, timeoutMs: command.timeoutMs });
      continue;
    }
    ops.push({ op, args });
  }
  return { ops };
}
