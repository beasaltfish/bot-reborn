// config.js already takes its storage as an argument; on the brain server
// that storage is one human-readable JSON file. Until the config page exists
// (part 2) this file is also how a person fills in their keys.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export const DEFAULT_CONFIG_PATH = process.env.BOT_REBORN_CONFIG
  ?? join(homedir(), '.bot-reborn', 'config.json');

/**
 * The key is ignored: there is one config, and the file IS it, so a person
 * editing it by hand sees exactly the object the app reads.
 * @param {string} path
 */
export function fileStorage(path) {
  return {
    /** @param {string} _key */
    getItem(_key) { return existsSync(path) ? readFileSync(path, 'utf8') : null; },
    /** @param {string} _key @param {string} value */
    setItem(_key, value) {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, JSON.stringify(JSON.parse(value), null, 2) + '\n');
    },
  };
}
