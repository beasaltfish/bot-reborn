// The bench's end of `cmd`: one IO primitive in, one raw answer out (body
// plugins design §8). Pure-ish on purpose: the pin map is a plain object and
// the only things that touch the workbench are the three callbacks, so the
// mapping from an op to a level can be tested without a DOM.
//
// Every write remembers the pin and the `safe` that came with it. Disconnect
// restores all of them — a body that goes away must not leave a pin driven.
// `i2c.*` and `adc.read` are in the closed vocabulary but have no simulator
// model yet; they answer `unavailable` instead of guessing.

/** @typedef {{ op: string, args?: Record<string, unknown>, safe?: number, timeoutMs?: number }} IoOp */

/**
 * @typedef {{
 *   pins?: Record<string, number>,
 *   writePin?: (pin: number, level: 0 | 1) => void,
 *   readPin?: (pin: number) => unknown,
 *   pwm?: (pin: number, us: number) => void,
 * }} BenchIoHooks
 */

/** @param {number} value @param {string} what */
function integerArg(value, what) {
  if (!Number.isInteger(value) || /** @type {number} */ (value) < 0) {
    throw new Error(`bad-args: ${what} must be a non-negative integer`);
  }
  return /** @type {number} */ (value);
}

/**
 * @param {BenchIoHooks} [hooks] `pins` is the pure form: a pin level map in and
 *   out. A live bench passes the callbacks instead.
 * @returns {((op: IoOp) => Promise<unknown>) & {
 *   run(op: IoOp): Promise<unknown>,
 *   level(pin: number): 0 | 1,
 *   duty(pin: number): number,
 *   disconnect(): Promise<void>,
 * }}
 */
export function createBenchIo(hooks = {}) {
  const pins = hooks.pins ?? {};
  /** The level this adapter last put on a pin. */
  /** @type {Map<number, 0 | 1>} */
  const levels = new Map();
  for (const [key, value] of Object.entries(pins)) {
    if (Number.isInteger(Number(key))) levels.set(Number(key), Number(value) ? 1 : 0);
  }
  /** The pulse width of the last `pwm`, per pin; 0 means no pulse. */
  /** @type {Map<number, number>} */
  const duties = new Map();
  /** Every pin a write touched, with the value it must return to. */
  /** @type {Map<number, 0 | 1>} */
  const written = new Map();

  /** @param {number} pin @param {0 | 1} level */
  function writePin(pin, level) {
    levels.set(pin, level);
    if (hooks.writePin) hooks.writePin(pin, level);
    else pins[pin] = level;
  }

  /** @param {number} pin @returns {unknown} */
  function readPin(pin) {
    if (hooks.readPin) return hooks.readPin(pin);
    return levels.get(pin) ?? pins[pin] ?? 0;
  }

  /** @param {unknown} raw @returns {0 | 1} */
  function bit(raw) {
    return raw === 1 || raw === true || String(raw).toUpperCase() === 'HIGH' ? 1 : 0;
  }

  /** @param {number} pin @param {0 | 1} level @param {number | undefined} safe */
  function remember(pin, level, safe) {
    if (!written.has(pin)) written.set(pin, safe ? 1 : 0);
    writePin(pin, level);
  }

  /** @param {IoOp} op */
  async function run(op) {
    switch (op?.op) {
      case 'pin.write': {
        const args = op.args ?? {};
        const pin = integerArg(Number(args.pin), 'pin');
        const level = args.level;
        if (level !== 0 && level !== 1) throw new Error('bad-args: level must be 0 or 1');
        remember(pin, level, op.safe);
        return level;
      }
      case 'pin.read': {
        const pin = integerArg(Number(op.args?.pin), 'pin');
        return bit(readPin(pin));
      }
      case 'pwm': {
        const args = op.args ?? {};
        const pin = integerArg(Number(args.pin), 'pin');
        const us = Number(args.us);
        if (!Number.isFinite(us) || us < 0) throw new Error('bad-args: us must be a pulse width');
        duties.set(pin, us);
        if (hooks.pwm) {
          if (!written.has(pin)) written.set(pin, op.safe ? 1 : 0);
          levels.set(pin, us > 0 ? 1 : 0);
          hooks.pwm(pin, us);
        } else {
          remember(pin, us > 0 ? 1 : 0, op.safe);
        }
        return us;
      }
      default:
        throw new Error(`unavailable: op "${String(op?.op)}" is not on this bench`);
    }
  }

  /** @param {number} pin @returns {0 | 1} */
  function level(pin) { return levels.get(pin) === 1 ? 1 : 0; }

  /** @param {number} pin @returns {number} */
  function duty(pin) { return duties.get(pin) ?? 0; }

  async function disconnect() {
    for (const [pin, safe] of written) writePin(pin, safe);
    written.clear();
    duties.clear();
  }

  return Object.assign(run, { run, level, duty, disconnect });
}
