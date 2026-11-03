// `npm run firmware:pack`: copy the firmware idf.py just built into
// firmware/release/, where the brain serves it to the admin page's board
// setup (so a user flashes without installing ESP-IDF). The release files are
// committed; run this after a firmware change that should ship.

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));

/**
 * @param {string} buildDir  firmware/build as idf.py leaves it
 * @param {string} outDir    where the manifest and the images go, flat
 */
export function pack(buildDir, outDir) {
  const args = JSON.parse(readFileSync(join(buildDir, 'flasher_args.json'), 'utf8'));
  const files = Object.entries(/** @type {Record<string, string>} */ (args.flash_files))
    .map(([offset, path]) => ({ offset: Number(offset), from: join(buildDir, path), path: basename(path) }))
    .sort((a, b) => a.offset - b.offset);
  // All of them or none: a half-packed release would flash a board that cannot boot.
  for (const f of files) if (!existsSync(f.from)) throw new Error(`firmware image missing: ${f.from} (run idf.py build)`);
  mkdirSync(outDir, { recursive: true });
  for (const f of files) copyFileSync(f.from, join(outDir, f.path));
  writeFileSync(join(outDir, 'manifest.json'), JSON.stringify({
    chip: args.extra_esptool_args.chip,
    flashMode: args.flash_settings.flash_mode,
    flashFreq: args.flash_settings.flash_freq,
    flashSize: args.flash_settings.flash_size,
    files: files.map(({ offset, path }) => ({ offset, path })),
  }, null, 2) + '\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  pack(join(ROOT, 'firmware', 'build'), join(ROOT, 'firmware', 'release'));
  console.log('packed firmware/release/');
}
