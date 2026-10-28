// Renders the dog's animations to the frames the brain streams (pet screen
// spec §7, multi-screen spec §4): one set of JPEGs per resolution the screen
// table mentions, in server/pet/frames/<w>x<h>/<anim>/, a manifest saying what
// exists and how fast it plays, and GIFs in tools/pet/preview/ so the look can
// be judged on a computer before anything is wired to the screen.
//
//   npm run pet:render
//
// The JPEGs are committed: the brain loads them at startup, like server/sounds,
// and a machine with no sharp and no ffmpeg can still run the robot.

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { ANIMS } from './anims.js';
import { drawDog, W, H } from './dog.js';
import { frameSizes, sizeKey, DEFAULT_SIZE } from '../../core/screens.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const FRAMES = join(ROOT, 'server', 'pet', 'frames');
const PREVIEW = join(HERE, 'preview');

/** Quality is a bandwidth choice, not a taste one: see the budget below. */
const QUALITY = 78;
/**
 * A frame the ESP32 cannot decode in time is a dropped frame, so keep them
 * small. Pixels cost bytes, so the budget grows with the frame's area: a
 * 240×240 frame may be 18 KB, a 160×128 one 8 KB.
 */
const MAX_BYTES_AT_320x240 = 25 * 1024;

const SIZES = frameSizes();
/** @type {{ sizes: string[], anims: Record<string, { fps: number, loop: boolean, frames: number }> }} */
const manifest = { sizes: SIZES.map(sizeKey), anims: {} };

rmSync(FRAMES, { recursive: true, force: true });
mkdirSync(PREVIEW, { recursive: true });

for (const size of SIZES) {
  const key = sizeKey(size);
  const maxBytes = Math.round((MAX_BYTES_AT_320x240 * (size.w * size.h)) / (W * H));
  for (const [name, anim] of Object.entries(ANIMS)) {
    const dir = join(FRAMES, key, name);
    mkdirSync(dir, { recursive: true });
    let biggest = 0;
    for (const [i, params] of anim.frames.entries()) {
      const file = join(dir, `${String(i).padStart(3, '0')}.jpg`);
      // Flatten onto the background: JPEG has no alpha and sharp would
      // otherwise render transparent pixels black.
      const jpeg = await sharp(Buffer.from(drawDog(params, size)))
        .flatten({ background: '#cfe6d8' })
        .jpeg({ quality: QUALITY, chromaSubsampling: '4:2:0' })
        .toBuffer();
      biggest = Math.max(biggest, jpeg.length);
      writeFileSync(file, jpeg);
    }
    manifest.anims[name] = { fps: anim.fps, loop: anim.loop, frames: anim.frames.length };

    const kb = Math.round(biggest / 1024);
    if (biggest > maxBytes) {
      console.error(`${key} ${name}: biggest frame is ${kb} KB, over the ${Math.round(maxBytes / 1024)} KB budget — lower QUALITY`);
      process.exitCode = 1;
    }
    console.log(`${key} ${name}: ${anim.frames.length} frames @ ${anim.fps} fps, biggest ${kb} KB`);
  }
}

/**
 * One animated preview, twice the panel's size so it is legible on a desktop.
 * Preview files are for people; the brain never reads them.
 * @param {{ w: number, h: number, round: boolean }} size
 * @param {string} name @param {string} file
 */
function preview(size, name, file) {
  const dir = join(FRAMES, sizeKey(size), name);
  const anim = ANIMS[name];
  // A palette per animation: flat colours quantise badly with the default one.
  execFileSync('ffmpeg', [
    '-y', '-loglevel', 'error',
    '-framerate', String(anim.fps),
    '-i', join(dir, '%03d.jpg'),
    '-vf', `scale=${size.w * 2}:${size.h * 2}:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse`,
    '-loop', anim.loop ? '0' : '-1',
    join(PREVIEW, file),
  ]);
  console.log(`preview: ${join(PREVIEW, file)}`);
}

for (const size of SIZES) {
  const key = sizeKey(size);
  // 320×240 keeps its old preview names, so anything linking to idle.gif still
  // works, and every size gets an idle preview of its own to compare against.
  if (key === DEFAULT_SIZE) for (const name of Object.keys(ANIMS)) preview(size, name, `${name}.gif`);
  preview(size, 'idle', `${key}-idle.gif`);
}

writeFileSync(join(FRAMES, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`manifest: ${join(FRAMES, 'manifest.json')}`);
