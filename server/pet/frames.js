// The pet's animations as the brain sees them: a manifest plus JPEGs on disk
// (pet screen spec §7). Loaded once at startup and shared by every robot, the
// way server/sounds is — the frames are the same dog for every character.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * One animation, rendered for every size the screen table mentions. `count` is
 * the number of frames the animator walks through; `bySize` holds the same
 * frame at the same index for each panel (multi-screen spec §4).
 * @typedef {{ fps: number, loop: boolean, count: number, bySize: Map<string, Buffer[]> }} PetAnim
 * @typedef {Map<string, PetAnim>} PetFrames
 * A screen asks for its own size; a size with no frames is undefined, and the
 * screen stays blank rather than the robot falling over.
 * @typedef {(size: string) => Buffer | undefined} FramePick
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
// The default logger is the console, not a no-op: server/main.js loads the
// frames without one, and the line that says "run npm run pet:render" is the
// only thing that turns a blank screen into a fix.
export function loadPetFrames(dir, log = console.log) {
  /** @type {PetFrames} */ const frames = new Map();
  /** @type {any} */
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
  } catch {
    log(`pet: no frames in ${dir} — the screen will stay blank`);
    return frames;
  }

  // A manifest without `sizes` predates the screen table: its frames sit one
  // directory up and every read below would miss. One line, not one per anim.
  const sizes = manifest?.sizes;
  if (!Array.isArray(sizes) || sizes.length === 0) {
    log('pet: frames are from before screen sizes — run npm run pet:render');
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
    /** @type {Map<string, Buffer[]>} */ const bySize = new Map();
    let complete = true;
    for (const size of sizes) {
      /** @type {Buffer[]} */ const jpegs = [];
      for (let i = 0; i < count; i++) {
        try {
          jpegs.push(readFileSync(join(dir, String(size), framePath(name, i))));
        } catch {
          // Half an animation would stutter every time it played; leaving it out
          // means the animator ignores that pose and logs it once.
          log(`pet: ${name} is missing ${join(String(size), framePath(name, i))} — the animation is left out`);
          complete = false;
          break;
        }
      }
      if (!complete) break;
      bySize.set(String(size), jpegs);
    }
    // One size short means the animation cannot play on every screen at the
    // same moment, so none of them gets it.
    if (complete) frames.set(name, { fps, loop: a.loop === true, count, bySize });
  }
  return frames;
}
