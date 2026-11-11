// The toy robot as rules rather than pixels: what the four motor levels are,
// what its inputs see on the bench, and how the body moves. Pure — no three.js
// and no DOM — so every rule here is testable in node and the scene only draws
// what this module decides.
//
// The levels mirror firmware/components/body_logic/motion.c. Both sides run the
// same cases (firmware/test/motor-cases.json), so the simulator cannot teach a
// wiring the board would not actually do.

import { nets } from './netlist.js';
import { PARTS, BOARD_OUTLINE, boardToTable } from './parts.js';
import { partFootprint } from './snap.js';
import { BIN } from './layout.js';

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

// --- How the body moves -------------------------------------------------------

/**
 * The body's numbers. `radius` is the half-diagonal of a 100 × 80 mm body, so a
 * circle round the centre covers it whatever way it faces; using the origin
 * instead would let the drawn body slide half a car length into the bench.
 */
const MM = 1 / 2.54;

export const CAR = {
  // Half-diagonal and half-extents of the body, from the part's own size: one
  // place to resize the toy, and the circle, the mesh and the footprint move
  // together.
  radius: (Math.hypot(PARTS.toy.size.w, PARTS.toy.size.d) / 2) * MM,
  half: { x: (PARTS.toy.size.w / 2) * MM, z: (PARTS.toy.size.d / 2) * MM },
  speed: 0.10,
  turn: 0.09,
  leash: 196.9,
};

/** @typedef {{ x: number, z: number }} Pt */
/** @typedef {{ x0: number, x1: number, z0: number, z1: number }} Rect */
/** @typedef {{ x: number, z: number, heading: number }} Pose */
/** @typedef {{ bounds: Rect, obstacles: Rect[], leash: { points: Pt[], radius: number, slack: number } | null }} Ground */

/**
 * Where the body's middle is: the origin is the `U3A` pad at its rear-left
 * corner, so the centre sits half a body ahead of it, turned with the heading.
 * @param {Pose} pose @returns {Pt}
 */
export function centreOf(pose) {
  const rad = (pose.heading * Math.PI) / 180;
  return {
    x: pose.x + CAR.half.x * Math.cos(rad) - CAR.half.z * Math.sin(rad),
    z: pose.z + CAR.half.x * Math.sin(rad) + CAR.half.z * Math.cos(rad),
  };
}

/**
 * What a toy is doing at `now`: the last order while it lasts, then low pins.
 * This is the firmware's `motion_now` rule — a `move` ends by itself — so a
 * body that stops hearing renewals coasts to a stop with nobody telling it.
 * @param {{ wheels: string, steer: string } | null} order
 * @param {number} until when the order runs out, on the caller's clock
 * @param {number} now
 * @returns {{ wheels: string, steer: string }}
 */
export function actionAt(order, until, now) {
  return order && now < until ? order : { wheels: 'coast', steer: 'centred' };
}

/**
 * Everything solid the toy can bump into: every board's outline, every part's
 * footprint except the toy itself, and the bin.
 * @param {import('./bench.js').Bench} b
 * @param {string} exceptId
 * @returns {Rect[]}
 */
export function obstacles(b, exceptId) {
  /** @type {Rect[]} */
  const rects = [];
  for (const bd of b.boards) {
    const a = boardToTable(bd, BOARD_OUTLINE.x0, BOARD_OUTLINE.y0);
    const c = boardToTable(bd, BOARD_OUTLINE.x1, BOARD_OUTLINE.y1);
    rects.push({ x0: Math.min(a.x, c.x), x1: Math.max(a.x, c.x), z0: Math.min(a.z, c.z), z1: Math.max(a.z, c.z) });
  }
  for (const p of b.placed) {
    if (p.id === exceptId) continue;
    const fp = partFootprint(PARTS[p.part], p.heading ?? p.rot);
    const cx = p.at.x + fp.dx;
    const cz = p.at.z + fp.dz;
    rects.push({ x0: cx - fp.w / 2, x1: cx + fp.w / 2, z0: cz - fp.d / 2, z1: cz + fp.d / 2 });
  }
  rects.push({ x0: BIN.x - BIN.size / 2, x1: BIN.x + BIN.size / 2, z0: BIN.z - BIN.size / 2, z1: BIN.z + BIN.size / 2 });
  return rects;
}

/**
 * Why a pose is not allowed, or null when it is.
 * @param {Pose} pose @param {Ground} ground @returns {'edge' | 'taut' | 'hit' | null}
 */
function reasonAt(pose, ground) {
  const c = centreOf(pose);
  const r = CAR.radius;
  const { bounds } = ground;
  if (c.x - r < bounds.x0 || c.x + r > bounds.x1 || c.z - r < bounds.z0 || c.z + r > bounds.z1) return 'edge';
  const leash = ground.leash;
  if (leash && leash.points.some((p) => Math.hypot(pose.x - p.x, pose.z - p.z) + leash.slack > leash.radius)) return 'taut';
  for (const rect of ground.obstacles) {
    const nx = Math.max(rect.x0, Math.min(c.x, rect.x1));
    const nz = Math.max(rect.z0, Math.min(c.z, rect.z1));
    if (Math.hypot(c.x - nx, c.z - nz) < r) return 'hit';
  }
  return null;
}

/**
 * Whether the body would be in something at this pose.
 * @param {Pose} pose @param {Ground} ground
 */
export function overlaps(pose, ground) {
  return reasonAt(pose, ground) !== null;
}

/**
 * One slice of driving. `forward` goes along the heading, `backward` the other
 * way; the steering coil is either fully over or centred, and only turns the
 * body while it is driving. A step that would end in something is cut back to
 * the last fraction that does not, so the body comes to rest touching it.
 * @param {Pose} pose
 * @param {{ wheels: string, steer: string }} action
 * @param {number} dt ms
 * @param {Ground} ground
 * @returns {{ pose: Pose, blocked: null | 'hit' | 'edge' | 'taut' | 'stuck' }}
 */
export function stepCar(pose, action, dt, ground) {
  if (reasonAt(pose, ground) !== null) return { pose: { ...pose }, blocked: 'stuck' };
  const moving = action.wheels === 'forward' || action.wheels === 'backward';
  if (!moving) return { pose: { ...pose }, blocked: null };

  /** @param {number} fraction of the step */
  const at = (fraction) => {
    const heading = pose.heading
      + (action.steer === 'left' ? -CAR.turn : action.steer === 'right' ? CAR.turn : 0) * dt * fraction;
    const distance = CAR.speed * dt * fraction * (action.wheels === 'forward' ? 1 : -1);
    const rad = (heading * Math.PI) / 180;
    return { x: pose.x + distance * Math.cos(rad), z: pose.z + distance * Math.sin(rad), heading };
  };

  const end = at(1);
  // One slice can be a whole second, which is 10 cm: sample the way there in
  // two-unit steps, or a 20 mm board would be jumped clean over.
  const samples = Math.max(1, Math.ceil(Math.hypot(end.x - pose.x, end.z - pose.z) / 2));
  let good = 0;
  for (let i = 1; i <= samples; i++) {
    const f = i / samples;
    const why = reasonAt(at(f), ground);
    if (why === null) {
      good = f;
      continue;
    }
    // Bisect inside the sample that hit: the body rests touching, never inside.
    let lo = good;
    let hi = f;
    for (let k = 0; k < 12; k++) {
      const mid = (lo + hi) / 2;
      if (reasonAt(at(mid), ground) === null) lo = mid; else hi = mid;
    }
    return { pose: at(lo), blocked: why };
  }
  return { pose: end, blocked: null };
}
