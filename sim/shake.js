// How hard the wand is being shaken, as one number from 0 to 1. The simulator
// has no physics: the hand's speed on screen stands in for the accelerometer,
// and the number is only ever drawn as a meter (wand spec §6). Pure: the
// caller passes the clock in.

/**
 * `full` is the pointer speed, in px/ms, that reads as 1; `fall` is how long,
 * in ms, the level takes to drop from 1 to 0 once the hand stops.
 * The level holds the fastest recent movement and then falls in a straight
 * line, which is smooth enough that a jittery hand does not flicker the meter.
 * @param {{ full?: number, fall?: number }} [opts]
 */
export function createShake({ full = 2, fall = 500 } = {}) {
  let held = 0;
  let at = 0;
  /** @type {number | null} */
  let last = null;

  /** @param {number} now */
  const fallen = (now) => Math.max(0, held - Math.max(0, now - at) / fall);

  return {
    /**
     * The pointer moved `distPx` since the previous call, at time `now` (ms).
     * @param {number} distPx @param {number} now
     */
    move(distPx, now) {
      const dt = Math.max(1, last === null ? 1 : now - last);
      last = now;
      held = Math.max(fallen(now), Math.min(1, distPx / dt / full));
      at = now;
    },
    /** @param {number} now @returns {number} */
    level(now) {
      return fallen(now);
    },
  };
}
