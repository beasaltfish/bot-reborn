// The robot's sound effects: recorded, not synthesised. Reflex spec §5.
//
// Not earcons. An earcon (earcon.js) reports the system's state in pure tones
// the VAD cannot mistake for speech; these are the creature's own voice, and
// they have formants. That is why the session plays them behind the same
// listening gate as an earcon — without it the robot hears its own bark.
//
// Four, and the list is the one both the reflex ladder and the LLM's
// play_sound tool draw from. Adding a sound is one row here plus its file.

export const SOUNDS = /** @type {const} */ (['bark', 'yip', 'whimper', 'growl']);

/** @typedef {typeof SOUNDS[number]} SoundName */

/**
 * @param {BaseAudioContext} ctx
 * @param {{ fetch?: typeof fetch, base?: string }} [opts]
 * @returns {{ load(): Promise<void>, play(name: SoundName): number }}
 */
export function createSfx(ctx, opts = {}) {
  const fetchImpl = opts.fetch ?? globalThis.fetch.bind(globalThis);
  const base = opts.base ?? 'sounds/';
  /** @type {Map<SoundName, AudioBuffer>} */
  const buffers = new Map();

  return {
    // Every failure is swallowed on purpose: a missing sound costs one silent
    // reaction, while a throw here would stop the microphone from opening.
    async load() {
      await Promise.all(SOUNDS.map(async (name) => {
        try {
          const response = await fetchImpl(`${base}${name}.mp3`);
          if (!response.ok) return;
          buffers.set(name, await ctx.decodeAudioData(await response.arrayBuffer()));
        } catch { /* stays unloaded; play() answers 0 */ }
      }));
    },
    play(name) {
      const buffer = buffers.get(name);
      if (!buffer) return 0;
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(ctx.destination);
      src.start();
      return Math.round(buffer.duration * 1000);
    },
  };
}
