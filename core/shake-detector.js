// When has a wand been shaken? Fed a level (0 to 1) and a clock, it says true
// once, on the sample where a shake has finished: shaken for a while, then
// still. The same rule is in firmware/components/body_logic/shake.c, and both
// are held to firmware/test/shake-cases.json, so change them together.

export const SHAKE = {
  /** A level at or above this is movement. */
  MOVING: 0.15,
  /** Movement this long (first to last moving sample) makes a shake. */
  ARM_MS: 500,
  /** Before a shake is armed, a pause this long starts over: a tap is not a shake. */
  GAP_MS: 150,
  /** Still this long after an armed shake ends it. */
  STILL_MS: 800,
  /** A hand that never stops ends the shake anyway after this long. */
  CAP_MS: 6000,
};

export function createShakeDetector() {
  /** @type {'idle' | 'moving' | 'spent'} */
  let state = 'idle';
  let start = 0;
  let last = 0;

  return {
    /**
     * @param {number} level 0 to 1
     * @param {number} nowMs
     * @returns {boolean} true on the sample where the shake is over
     */
    feed(level, nowMs) {
      const moving = level >= SHAKE.MOVING;
      if (state === 'spent') {
        // One still reading is the end of the shake that fired.
        if (!moving) state = 'idle';
        return false;
      }
      if (state === 'idle') {
        if (moving) { state = 'moving'; start = nowMs; last = nowMs; }
        return false;
      }
      if (moving) {
        last = nowMs;
        if (nowMs - start >= SHAKE.CAP_MS) { state = 'spent'; return true; }
        return false;
      }
      const armed = last - start >= SHAKE.ARM_MS;
      const gap = nowMs - last;
      if (!armed && gap >= SHAKE.GAP_MS) { state = 'idle'; return false; }
      if (armed && gap >= SHAKE.STILL_MS) { state = 'idle'; return true; }
      return false;
    },
  };
}
