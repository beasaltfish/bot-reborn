// The bench's wand, as the firmware sees its sensor: the meter reports a level
// whenever the hand moves it, and a steady tick reads the latest one into the
// shake detector. The meter stops reporting after its last 0, and a level that
// stays 0 is stillness, so the detector keeps its clock without help. The
// meter takes ~0.5 s to fall back to nothing, so in the simulator "still" is
// about 0.4 s later than the hand stopped.

/**
 * @param {{
 *   detector: { feed(level: number, nowMs: number): boolean },
 *   send: () => void,
 *   now: () => number,
 * }} o
 */
export function createWandFeed({ detector, send, now }) {
  let latest = 0;
  return {
    /** @param {number} level */
    level(level) { latest = level; },
    /** Read the latest level into the detector; send when a shake has finished. */
    tick() { if (detector.feed(latest, now())) send(); },
  };
}
