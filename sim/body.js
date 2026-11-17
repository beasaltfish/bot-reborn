// The bench as a body: whatever the wiring did to the two audio paths is
// applied to real microphone and speaker audio, and the brain is none the
// wiser — it sees an ordinary phone-style body on /body.
//
// shapeUplink / shapeDownlink are pure and tested; the live microphone,
// speaker and link live in sim/firmware/audio-link.js and the board runtime.

/** @typedef {import('./power.js').Outcome} Outcome */

/** @param {Int16Array} out */
function fillNoise(out) {
  // Full scale on purpose: a floating or mis-clocked bus is not a gentle hiss.
  for (let i = 0; i < out.length; i++) out[i] = Math.floor(Math.random() * 65536) - 32768;
  return out;
}

/**
 * What the brain hears from the microphone, given how it is wired.
 * @param {Int16Array} pcm
 * @param {import('./power.js').Path} mic
 * @returns {Int16Array}
 */
export function shapeUplink(pcm, mic) {
  if (mic === 'ok') return pcm;
  if (mic === 'silent') return new Int16Array(pcm.length);
  return fillNoise(new Int16Array(pcm.length));
}

/**
 * What comes out of the speaker; null means nothing is played at all.
 * @param {ArrayBuffer} bytes 16-bit little-endian mono
 * @param {import('./power.js').Path | 'quiet'} amp
 * @returns {ArrayBuffer | null}
 */
export function shapeDownlink(bytes, amp) {
  if (amp === 'ok') return bytes;
  if (amp === 'silent') return null;
  // An odd trailing byte cannot be a sample; Int16Array would throw on it.
  const n = bytes.byteLength >> 1;
  const out = new Int16Array(n);
  if (amp === 'noise') return /** @type {ArrayBuffer} */ (fillNoise(out).buffer);
  const view = new DataView(bytes);
  // Little-endian explicitly, as PcmPlayer reads it, whatever this CPU is.
  for (let i = 0; i < n; i++) out[i] = view.getInt16(i * 2, true) >> 1;
  return /** @type {ArrayBuffer} */ (out.buffer);
}

/** The speaker's own AudioContext: created/resumed from a real gesture, closed on power off. */
/** @param {() => AudioContext} [create] */
export function createBodyAudio(create) {
  /** @type {AudioContext | null} */
  let ctx = null;
  const make = create ?? (() => new (/** @type {any} */ (globalThis).AudioContext)());
  return {
    async resume() {
      if (!ctx) ctx = make();
      const context = /** @type {AudioContext} */ (ctx);
      if (context.state === 'suspended') await context.resume?.();
      return context;
    },
    get context() { return ctx; },
    close() {
      ctx?.close?.();
      ctx = null;
    },
  };
}

/**
 * What the status line says when a layer of the brain failed, in the words of
 * someone standing at the bench: what to check, not what the provider said.
 * @param {{ part: string, status: number | null, kind: string }} msg
 * @returns {string}
 */
export function faultText(msg) {
  const part = msg.part.toUpperCase();
  if (msg.kind === 'http' && (msg.status === 401 || msg.status === 403)) {
    return `${part} key rejected (${msg.status}) — check it on the admin page`;
  }
  if (msg.kind === 'http' && msg.status === 429) {
    return `${part} is out of quota or rate-limited (429) — check it on the admin page`;
  }
  if (msg.kind === 'timeout' || msg.kind === 'network') {
    return `${part} could not be reached — check its address on the admin page`;
  }
  if (msg.kind === 'http') return `${part} failed (HTTP ${msg.status})`;
  return `${part} failed`;
}

/**
 * Whether a brain state leaves a shown fault on the status line. The brain
 * speaks its own apology right after a fault (SPEAKING), so only the user
 * starting to talk again (CAPTURING) means a new turn has begun.
 * @param {string} state
 * @returns {boolean}
 */
export function keepsFault(state) {
  return state !== 'CAPTURING';
}

/**
 * Where the admin page opens on this character.
 * @param {string} id
 * @returns {string}
 */
export function adminLink(id) {
  return `/#character=${encodeURIComponent(id)}`;
}
