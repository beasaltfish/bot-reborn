// How loud a stretch of samples is, and whether that is loud enough to act on.
//
// This lives on the product side rather than in the bench because session.js
// needs it: the VAD cutting a segment is not by itself evidence that anybody
// spoke. With echoCancellation on and the room silent, Chrome's residual
// suppressor lets occasional low-level bursts through, and silero reads their
// spectral shape as speech. Measured on 2026-09-17, one phone, one room:
//
//   real speech      −20 … −25 dBFS
//   spurious bursts  −44 … −96 dBFS   (13 of them, across two runs)
//
// Nineteen dB of daylight. Level is the axis that separates them; duration is
// not — the same runs put 「回来」at 0.4 s and a burst at 0.4 s, and another
// burst at 10.6 s.

/** @param {Float32Array} f32 @returns {number} linear RMS, 1 = full scale */
export function rms(f32) {
  let sum = 0;
  for (let i = 0; i < f32.length; i++) sum += f32[i] * f32[i];
  return Math.sqrt(sum / f32.length);
}

/**
 * dbOf(0) is −120, not −Infinity. A silent window is the NORMAL case here, and
 * −Infinity propagates through every later subtraction until the whole row
 * reads NaN.
 *
 * @param {number} amplitude linear, 1 = full scale
 * @returns {number} dBFS
 */
export function dbOf(amplitude) {
  return amplitude > 0 ? 20 * Math.log10(amplitude) : -120;
}

/**
 * `>=`, so a reading that lands exactly on the floor passes: the floor is the
 * level you decided was worth acting on, and a reading at it is that level.
 *
 * @param {number} amplitude linear RMS
 * @param {number} floorDb dBFS
 */
export function aboveFloor(amplitude, floorDb) {
  return dbOf(amplitude) >= floorDb;
}
