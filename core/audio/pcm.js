// Float32 [-1, 1] from WebAudio, Int16 for the STT provider (spec §8.1).

/** @param {Float32Array} f32 @returns {Int16Array} */
export function toInt16(f32) {
  const out = new Int16Array(f32.length);
  for (let i = 0; i < f32.length; i++) {
    // The clamp is not decoration: without it a sample above full scale
    // overflows Int16 and reappears with the opposite sign.
    out[i] = Math.max(-1, Math.min(1, f32[i])) * 32767;
  }
  return out;
}

/** @param {Float32Array[]} frames @returns {Float32Array} */
export function joinFrames(frames) {
  const total = frames.reduce((n, f) => n + f.length, 0);
  const out = new Float32Array(total);
  let off = 0;
  for (const f of frames) { out.set(f, off); off += f.length; }
  return out;
}
