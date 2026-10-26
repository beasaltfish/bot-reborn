// Renders the dog's animations to the frames the brain streams (pet screen
// spec §7): 320×240 JPEGs in server/pet/frames/<anim>/, a manifest saying how
// fast each plays, and a GIF per animation in tools/pet/preview/ so the look
// can be judged on a computer before anything is wired to the screen.
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

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const FRAMES = join(ROOT, 'server', 'pet', 'frames');
const PREVIEW = join(HERE, 'preview');

/** Quality is a bandwidth choice, not a taste one: see the budget below. */
const QUALITY = 78;
/** A frame the ESP32 cannot decode in time is a dropped frame, so keep them small. */
const MAX_BYTES = 25 * 1024;

const manifest = { width: W, height: H, anims: /** @type {Record<string, object>} */ ({}) };

rmSync(FRAMES, { recursive: true, force: true });
mkdirSync(PREVIEW, { recursive: true });

for (const [name, anim] of Object.entries(ANIMS)) {
  const dir = join(FRAMES, name);
  mkdirSync(dir, { recursive: true });
  let biggest = 0;
  for (const [i, params] of anim.frames.entries()) {
    const file = join(dir, `${String(i).padStart(3, '0')}.jpg`);
    // Flatten onto the background: JPEG has no alpha and sharp would otherwise
    // render transparent pixels black.
    const jpeg = await sharp(Buffer.from(drawDog(params)))
      .flatten({ background: '#cfe6d8' })
      .jpeg({ quality: QUALITY, chromaSubsampling: '4:2:0' })
      .toBuffer();
    biggest = Math.max(biggest, jpeg.length);
    writeFileSync(file, jpeg);
  }
  manifest.anims[name] = { fps: anim.fps, loop: anim.loop, frames: anim.frames.length };

  const gif = join(PREVIEW, `${name}.gif`);
  // A palette per animation: flat colours quantise badly with the default one.
  execFileSync('ffmpeg', [
    '-y', '-loglevel', 'error',
    '-framerate', String(anim.fps),
    '-i', join(dir, '%03d.jpg'),
    '-vf', 'scale=640:480:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse',
    '-loop', anim.loop ? '0' : '-1',
    gif,
  ]);
  const kb = Math.round(biggest / 1024);
  if (biggest > MAX_BYTES) {
    console.error(`${name}: biggest frame is ${kb} KB, over the ${MAX_BYTES / 1024} KB budget — lower QUALITY`);
    process.exitCode = 1;
  }
  console.log(`${name}: ${anim.frames.length} frames @ ${anim.fps} fps, biggest ${kb} KB → ${gif}`);
}

writeFileSync(join(FRAMES, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`manifest: ${join(FRAMES, 'manifest.json')}`);
