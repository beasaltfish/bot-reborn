// The toy robot as rules rather than pixels: what the four motor levels are,
// what its inputs see on the bench, and how the body moves. Pure — no three.js
// and no DOM — so every rule here is testable in node and the scene only draws
// what this module decides.
//
// The levels mirror firmware/components/body_logic/motion.c. Both sides run the
// same cases (firmware/test/motor-cases.json), so the simulator cannot teach a
// wiring the board would not actually do.

import { nets } from './netlist.js';

/** @typedef {'forward' | 'backward'} Drive */
/** @typedef {'left' | 'right' | 'straight'} Steer */
/** @typedef {{ driveSwapped?: boolean, steerSwapped?: boolean }} Calibration */

/**
 * One pair: which of its two pins is high, if either (motion.c's `pair`).
 * @param {boolean} first @param {boolean} second @param {boolean} swapped
 * @returns {[boolean, boolean]}
 */
const pair = (first, second, swapped) => (swapped ? [second, first] : [first, second]);

/**
 * The four levels the firmware writes, in `motion.c`'s order: drive A, drive B,
 * steer A, steer B — GPIO 4, 5, 6, 7 on the board.
 * @param {string} drive @param {string} steer @param {Calibration} [calib]
 * @returns {[boolean, boolean, boolean, boolean]}
 */
export function motorLevels(drive, steer, calib = {}) {
  if (drive !== 'forward' && drive !== 'backward') throw new RangeError(`unknown drive "${drive}"`);
  if (steer !== 'left' && steer !== 'right' && steer !== 'straight') throw new RangeError(`unknown steer "${steer}"`);
  return [
    ...pair(drive === 'forward', drive === 'backward', !!calib.driveSwapped),
    ...pair(steer === 'left', steer === 'right', !!calib.steerSwapped),
  ];
}

// --- What the toy's inputs see -------------------------------------------------

/** The toy's four driver inputs, in the driver's order. */
export const TOY_INPUTS = /** @type {const} */ (['U3A', 'U3B', 'U5A', 'U5B']);
/** @typedef {typeof TOY_INPUTS[number]} InputName */

/** GPIO 4, 5, 6, 7: the pins `motorLevels` sets, in the same order. */
export const MOTOR_GPIOS = /** @type {const} */ (['esp:GPIO4', 'esp:GPIO5', 'esp:GPIO6', 'esp:GPIO7']);

/**
 * What one input pad is attached to. `gpio` lists every GPIO on the pad's net:
 * a pad on two of them sees whichever level they agree on, and nothing when
 * they disagree.
 * @typedef {{ kind: 'gpio', pins: string[] } | { kind: 'rail', level: 'high' | 'low' } | { kind: 'none' }} Src
 */

/** The rails that are always one level, whatever the firmware is doing. */
const RAILS = /** @type {const} */ ({ high: ['esp:3V3', 'esp:5V'], low: ['esp:GND'] });

/**
 * How the toy is wired: what each input pad reaches, and whether the two
 * boards share a ground. `linked` is false when not one wire leaves the toy,
 * which is a toy lying on the table, not a circuit (so power-on leaves it be).
 * @param {import('./bench.js').Bench} b
 * @param {string} toyId
 * @returns {{ linked: boolean, ground: 'ok' | 'floating' | 'raised', inputs: Record<InputName, Src> }}
 */
export function toyWiring(b, toyId) {
  const n = nets(b);
  /** @param {string} point @returns {Src} */
  const srcOf = (point) => {
    if (RAILS.high.some((r) => n.same(point, r))) return { kind: 'rail', level: 'high' };
    if (RAILS.low.some((r) => n.same(point, r))) return { kind: 'rail', level: 'low' };
    const pins = MOTOR_GPIOS.filter((g) => n.same(point, g));
    return pins.length ? { kind: 'gpio', pins } : { kind: 'none' };
  };

  const gnd = `${toyId}:GND`;
  /** @type {'ok' | 'floating' | 'raised'} */
  const ground = n.same(gnd, 'esp:GND') ? 'ok'
    : RAILS.high.some((r) => n.same(gnd, r)) ? 'raised' : 'floating';

  /** @type {Record<string, Src>} */
  const inputs = {};
  for (const name of TOY_INPUTS) inputs[name] = srcOf(`${toyId}:${name}`);

  const linked = b.wires.some((w) => w.a.startsWith(`${toyId}:`) || w.b.startsWith(`${toyId}:`));
  return { linked, ground, inputs: /** @type {Record<InputName, Src>} */ (inputs) };
}

/** @typedef {ReturnType<typeof toyWiring>} Wiring */
/** @typedef {{ wheels: 'forward' | 'backward' | 'coast' | 'short' | 'dead',
 *              steer: 'left' | 'right' | 'centred' | 'short' | 'dead',
 *              contended: InputName[] }} ToyAction */

/**
 * What the toy does, given the wiring and the four levels the firmware is
 * writing right now. A toy without a shared ground is dead: its own battery
 * gives its drivers a ground the ESP32's levels are not measured against.
 * @param {Wiring} wiring
 * @param {[boolean, boolean, boolean, boolean] | boolean[]} levels
 * @returns {ToyAction}
 */
export function toyAction(wiring, levels) {
  /** @type {InputName[]} */
  const contended = [];
  if (wiring.ground !== 'ok') return { wheels: 'dead', steer: 'dead', contended };

  /**
   * The level one pad sees. Two GPIOs that disagree leave the pad low: that is
   * what the driver sees when two pins fight, and the fault is reported apart.
   * @param {Src} src
   */
  const levelOf = (src) => {
    if (src.kind === 'rail') return src.level === 'high';
    if (src.kind === 'none') return false;
    const seen = new Set(src.pins.map((p) => !!levels[MOTOR_GPIOS.indexOf(/** @type {any} */ (p))]));
    if (seen.size > 1) return false;
    return [...seen][0];
  };

  /** @param {InputName} name */
  const input = (name) => {
    const src = wiring.inputs[name];
    if (src.kind === 'gpio') {
      const seen = new Set(src.pins.map((p) => !!levels[MOTOR_GPIOS.indexOf(/** @type {any} */ (p))]));
      if (seen.size > 1) contended.push(name);
    }
    return levelOf(src);
  };

  /** One pair: both high is a short, one high is that direction, neither coasts. */
  const a = input('U3A');
  const b = input('U3B');
  const s = input('U5A');
  const t = input('U5B');

  return {
    wheels: a && b ? 'short' : a ? 'forward' : b ? 'backward' : 'coast',
    steer: s && t ? 'short' : s ? 'left' : t ? 'right' : 'centred',
    contended,
  };
}
