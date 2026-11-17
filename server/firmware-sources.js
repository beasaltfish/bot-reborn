// The mirrored body firmware sources, read-only. Only files in
// firmware/main with a C/H extension are served; this is local-admin material,
// not a general file browser.
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

export const FIRMWARE_SOURCE_DIR = fileURLToPath(new URL('../firmware/main/', import.meta.url));

/** @param {string} [dir] @returns {string[]} */
export function listFirmwareSources(dir = FIRMWARE_SOURCE_DIR) {
  return readdirSync(dir)
    .filter((name) => /\.(c|h)$/.test(name) && !name.includes('/') && !name.includes('\\'))
    .sort();
}

/** @param {string} file @param {string} [dir] @returns {string} */
export function readFirmwareSource(file, dir = FIRMWARE_SOURCE_DIR) {
  if (typeof file !== 'string' || file === '' || file.includes('/') || file.includes('\\') || file.includes('..') || !/\.(c|h)$/.test(file)) {
    throw new Error('invalid firmware source name');
  }
  try {
    return readFileSync(join(dir, file), 'utf8');
  } catch {
    throw new Error(`firmware source not found: ${file}`);
  }
}
