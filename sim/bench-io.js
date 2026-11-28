// The bench's end of `cmd`: one IO primitive in, one raw answer out (body
// plugins design §8). Pure-ish on purpose: the pin map is a plain object and
// the only things that touch the workbench are the two callbacks, so the
// mapping from an op to a level can be tested without a DOM.
//
// Every write remembers the pin and the `safe` that came with it. Disconnect
// restores all of them — a body that goes away must not leave a pin driven.
// `pwm`, `i2c.*` and `adc.read` are in the closed vocabulary but have no
// simulator model yet; they answer `unavailable` instead of guessing, because a
// spoken `ok:true` for a pulse nothing sees is a lie.

/** @typedef {{ op: string, args?: Record<string, unknown>, safe?: number, timeoutMs?: number }} IoOp */

/**
 * @typedef {{
 *   pins?: Record<string, number>,
 *   writePin?: (pin: number, level: 0 | 1) => void,
 *   readPin?: (pin: number) => unknown,
 *   sampleDevice?: (device: string) => unknown,
 *   measureDevice?: (device: string) => void,
 *   writeDevice?: (device: string, payload: Record<string, unknown>) => void,
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

  /**
   * A write without a `safe` cannot be undone on disconnect, so it is refused
   * before the pin moves at all (design §6: every write carries one). A `safe`
   * that is not 0 or 1 is refused too, not rounded to a level: `2` used to drive
   * the pin to 1 on disconnect. The loader and `commandProblem` refuse it
   * first; this is the last line, for an op sent by hand.
   * @param {number} pin @param {0 | 1} level @param {number | undefined} safe
   */
  function remember(pin, level, safe) {
    if (typeof safe !== 'number' || !Number.isFinite(safe)) {
      throw new Error('bad-args: a write needs a safe value');
    }
    if (safe !== 0 && safe !== 1) throw new Error('bad-args: safe must be 0 or 1');
    if (!written.has(pin)) written.set(pin, /** @type {0 | 1} */ (safe));
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
      case 'device.sample': {
        const device = op.args?.device;
        if (typeof device !== 'string' || device === '') {
          throw new Error('bad-args: device must be a name');
        }
        if (!hooks.sampleDevice) throw new Error('unavailable: no device model on this bench');
        return hooks.sampleDevice(device);
      }
      case 'device.measure': {
        const device = op.args?.device;
        if (typeof device !== 'string' || device === '') {
          throw new Error('bad-args: device must be a name');
        }
        if (!hooks.measureDevice) throw new Error('unavailable: no device model on this bench');
        hooks.measureDevice(device);
        return null;
      }
      case 'device.write': {
        const device = op.args?.device;
        if (typeof device !== 'string' || device === '') {
          throw new Error('bad-args: device must be a name');
        }
        if (!hooks.writeDevice) throw new Error('unavailable: no device model on this bench');
        const { device: _device, ...payload } = op.args ?? {};
        hooks.writeDevice(device, /** @type {Record<string, unknown>} */ (payload));
        return null;
      }
      default:
        throw new Error(`unavailable: op "${String(op?.op)}" is not on this bench`);
    }
  }

  /** @param {number} pin @returns {0 | 1} */
  function level(pin) { return levels.get(pin) === 1 ? 1 : 0; }

  async function disconnect() {
    for (const [pin, safe] of written) writePin(pin, safe);
    written.clear();
  }

  return Object.assign(run, { run, level, disconnect });
}
