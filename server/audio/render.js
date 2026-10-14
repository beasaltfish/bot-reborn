// The robot's own sounds, as PCM the body can play. On the phone these were
// WebAudio oscillators and decoded MP3s; a body now has exactly one ability,
// "play this PCM", so the brain renders them (server/body split spec §4).

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SHAPES, EARCONS, durationOf } from '../../web/audio/earcon.js';
import { SOUNDS } from '../../web/audio/sfx.js';
import { toInt16 } from '../../web/audio/pcm.js';
import { RATE } from '../../web/protocol.js';
import { parseWav, resample } from './pcm.js';

export const SOUNDS_DIR = fileURLToPath(new URL('../sounds/', import.meta.url));

/** earcon.js's 8 ms ramps and 0.25 gain, so the two renderings sound alike. */
const FADE = Math.round(0.008 * RATE);
const GAIN = 0.25;

/** @param {import('../../web/audio/earcon.js').EarconName} name */
export function renderEarcon(name) {
  const out = new Float32Array(Math.round((durationOf(name) * RATE) / 1000));
  let i = 0;
  let phase = 0;
  for (const tone of SHAPES[name]) {
    const n = Math.round((tone.ms * RATE) / 1000);
    for (let k = 0; k < n && i < out.length; k++, i++) {
      // The frequency ramp is linear like linearRampToValueAtTime; the phase
      // is accumulated so the sweep has no clicks.
      phase += (2 * Math.PI * (tone.f + ((tone.to - tone.f) * k) / n)) / RATE;
      out[i] = GAIN * Math.min(1, k / FADE, (n - k) / FADE) * Math.sin(phase);
    }
  }
  return toInt16(out);
}

export function renderEarcons() {
  return /** @type {Record<import('../../web/audio/earcon.js').EarconName, Int16Array>} */ (
    Object.fromEntries(EARCONS.map((name) => [name, renderEarcon(name)])));
}

/**
 * A missing file is a sound that plays as silence, as sfx.js does on the web.
 * @param {string} [dir]
 * @returns {Map<import('../../web/audio/sfx.js').SoundName, Int16Array>}
 */
export function loadSfx(dir = SOUNDS_DIR) {
  const out = new Map();
  for (const name of SOUNDS) {
    const path = join(dir, `${name}.wav`);
    if (!existsSync(path)) continue;
    const { rate, samples } = parseWav(new Uint8Array(readFileSync(path)));
    out.set(name, toInt16(resample(samples, rate, RATE)));
  }
  return out;
}
