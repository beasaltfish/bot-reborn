// Characters: one per body, each a complete, independent config (server/body
// split spec §1.1). A phone robot and an ESP32 robot are two different
// characters with their own voice, keys and memory — not two bodies of one.
//
// A character's token is both its password and its name on the wire: a body
// says hello with it, and the brain answers as whoever it belongs to.

import { randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { defaultConfig, loadConfig, layerReady } from '../web/config.js';

export const HOME = process.env.BOT_REBORN_HOME ?? join(homedir(), '.bot-reborn');
export const CHARACTERS_DIR = join(HOME, 'characters');

/** @typedef {{ id: string, name: string, token: string, config: any, path: string }} Character */

const TOKEN = /^[0-9a-f]{32}$/;

/** A file name as well as a display name, so nothing that walks a path. */
function checkName(/** @type {string} */ name) {
  if (!name.trim() || name.length > 40 || /[/\\]/.test(name) || name.startsWith('.')) {
    throw new Error(`character name must be 1–40 characters, without / or \\, not starting with "." — got ${JSON.stringify(name)}`);
  }
}

/**
 * @param {string} name
 * @param {string} [dir]
 * @returns {Character}
 */
export function createCharacter(name, dir = CHARACTERS_DIR) {
  checkName(name);
  const path = join(dir, `${name}.json`);
  if (existsSync(path)) throw new Error(`a character called ${name} already exists: ${path}`);
  /** @type {Character} */
  const c = { id: name, name, token: randomBytes(16).toString('hex'), config: defaultConfig(), path };
  saveCharacter(c);
  return c;
}

/**
 * Re-read on every call: editing a file takes effect at the next hello,
 * without restarting the brain. A file that will not load is reported, not
 * thrown — one bad character must not keep the others from connecting.
 * @param {string} [dir]
 * @returns {{ characters: Character[], problems: string[] }}
 */
export function listCharacters(dir = CHARACTERS_DIR) {
  if (!existsSync(dir)) return { characters: [], problems: [] };
  /** @type {Character[]} */ const characters = [];
  /** @type {string[]} */ const problems = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
    const path = join(dir, file);
    try {
      const raw = JSON.parse(readFileSync(path, 'utf8'));
      if (typeof raw.token !== 'string' || !TOKEN.test(raw.token)) throw new Error('no valid token');
      const id = file.slice(0, -'.json'.length);
      // loadConfig fills every field the file leaves out, as it does for the
      // phone's localStorage: an older file still loads after a new setting.
      const config = loadConfig({ getItem: () => JSON.stringify(raw.config ?? {}), setItem() {} });
      characters.push({ id, name: typeof raw.name === 'string' ? raw.name : id, token: raw.token, config, path });
    } catch (err) {
      problems.push(`${path}: ${/** @type {Error} */ (err).message}`);
    }
  }
  return { characters, problems };
}

/**
 * Every character is compared, every time, in constant time: how long a
 * wrong guess takes must not say how close it was, or whose it nearly was.
 * @param {Character[]} characters
 * @param {unknown} token
 */
export function findByToken(characters, token) {
  if (typeof token !== 'string' || !TOKEN.test(token)) return null;
  const given = Buffer.from(token, 'hex');
  /** @type {Character | null} */ let hit = null;
  for (const c of characters) {
    if (timingSafeEqual(given, Buffer.from(c.token, 'hex')) && !hit) hit = c;
  }
  return hit;
}

/** It holds API keys: readable by this user only. @param {Character} c */
export function saveCharacter(c) {
  mkdirSync(join(c.path, '..'), { recursive: true, mode: 0o700 });
  writeFileSync(c.path, JSON.stringify({ name: c.name, token: c.token, config: c.config }, null, 2) + '\n', { mode: 0o600 });
  // writeFileSync's mode only applies when it creates the file.
  chmodSync(c.path, 0o600);
}

/**
 * Change part of a character's config on disk, and nothing else. A robot
 * holds the file as it was at hello; writing that snapshot back would undo
 * whatever was edited by hand while it was online — a replaced token
 * included. So the file is read again and only the caller's fields change.
 * @param {string} path
 * @param {(config: any) => void} change
 */
export function updateConfig(path, change) {
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  raw.config = raw.config ?? {};
  change(raw.config);
  writeFileSync(path, JSON.stringify(raw, null, 2) + '\n', { mode: 0o600 });
  chmodSync(path, 0o600);
}

/** The three layers a robot cannot run without. The reflex is optional. */
export function ready(/** @type {any} */ config) {
  return layerReady(config.stt) && layerReady(config.llm) && layerReady(config.tts);
}
