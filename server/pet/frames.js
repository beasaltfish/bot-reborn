// The pet's animations as the brain sees them: a manifest plus JPEGs on disk
// (pet screen spec §7). Loaded once at startup and shared by every robot, the
// way server/sounds is — the frames are the same dog for every character.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * @typedef {{ fps: number, loop: boolean, frames: Buffer[] }} Animation
 * @typedef {Map<string, Animation>} PetFrames
 */

/** @param {string} name @param {number} i */
const framePath = (name, i) => join(name, `${String(i).padStart(3, '0')}.jpg`);

/**
 * A missing directory is not an error: a character set to `pet` with no frames
 * still connects and still barks, it just has nothing to show. One log line
 * says which directory was empty and the robot carries on (spec §4.4).
 * @param {string} dir
 * @param {(line: string) => void} [log]
 * @returns {PetFrames}
 */
export function loadPetFrames(dir, log = () => {}) {
  /** @type {PetFrames} */ const frames = new Map();
  /** @type {any} */
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
  } catch {
    log(`pet: no frames in ${dir} — the screen will stay blank`);
    return frames;
  }

  for (const [name, anim] of Object.entries(manifest?.anims ?? {})) {
    const a = /** @type {any} */ (anim);
    const count = Number(a?.frames);
    const fps = Number(a?.fps);
    if (!Number.isInteger(count) || count < 1 || !(fps > 0)) {
      log(`pet: ${name} has no usable fps/frames in the manifest`);
      continue;
    }
    /** @type {Buffer[]} */ const jpegs = [];
    for (let i = 0; i < count; i++) {
      try {
        jpegs.push(readFileSync(join(dir, framePath(name, i))));
      } catch {
        // Half an animation would stutter every time it played; leaving it out
        // means the animator ignores that pose and logs it once.
        log(`pet: ${name} is missing ${framePath(name, i)} — the animation is left out`);
        jpegs.length = 0;
        break;
      }
    }
    if (jpegs.length === count) frames.set(name, { fps, loop: a.loop === true, frames: jpegs });
  }
  return frames;
}
