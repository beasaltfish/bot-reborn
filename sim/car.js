// The toy robot as rules rather than pixels: what the four motor levels are,
// what its inputs see on the bench, and how the body moves. Pure — no three.js
// and no DOM — so every rule here is testable in node and the scene only draws
// what this module decides.
//
// The levels mirror firmware/components/body_logic/motion.c. Both sides run the
// same cases (firmware/test/motor-cases.json), so the simulator cannot teach a
// wiring the board would not actually do.

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
