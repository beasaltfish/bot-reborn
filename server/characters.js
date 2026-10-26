// Characters: one per body, each a complete, independent config (server/body
// split spec §1.1). A phone robot and an ESP32 robot are two different
// characters with their own voice, keys and memory — not two bodies of one.
//
// A character's token is both its password and its name on the wire: a body
// says hello with it, and the brain answers as whoever it belongs to.

import { randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, chmodSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { defaultConfig, loadConfig, layerReady } from '../core/config.js';
import { startingPreset, voicesFor } from '../core/provider-presets.js';
import { checkEndpoints, endpointsFrom, storedEndpoints, withEndpointIds } from './endpoints.js';
import { checkSavedReflexes, storedSavedReflexes } from './saved-reflexes.js';

export const HOME = process.env.BOT_REBORN_HOME ?? join(homedir(), '.bot-reborn');
export const CHARACTERS_DIR = join(HOME, 'characters');

/**
 * `endpoints` are the provider entries and their keys (see endpoints.js). They
 * sit beside `config`, not in it, so the body never has to read them; so do
 * `savedReflexes`, the admin's own reflex presets (see saved-reflexes.js).
 * @typedef {{ id: string, name: string, token: string, config: any, endpoints: import('./endpoints.js').Endpoint[],
 *             savedReflexes?: import('./saved-reflexes.js').SavedReflex[], path: string }} Character
 */

const TOKEN = /^[0-9a-f]{32}$/;

/** A file name as well as a display name, so nothing that walks a path. */
export function checkName(/** @type {string} */ name) {
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
  if (nameTaken(name, dir)) throw new Error(`a character called ${name} already exists`);
  // The name is free but its file may not be: a character renamed away from
  // it keeps its file (and id). Pick the next free one rather than refuse a
  // name nobody can see in use.
  let id = name;
  for (let n = 2; existsSync(join(dir, `${id}.json`)); n++) id = `${name.slice(0, 37)}-${n}`;
  const path = join(dir, `${id}.json`);
  const config = startingConfig();
  /** @type {Character} */
  const c = { id, name, token: randomBytes(16).toString('hex'), config, endpoints: startingEndpoints(config), path };
  saveCharacter(c);
  return c;
}

/**
 * defaultConfig() with every layer on its first listed provider. An empty
 * baseURL reads as "Other" on the admin page, which opens on a Base URL and a
 * model to type; a provider already picked leaves only the key. The key stays
 * empty, so the character still says "missing keys" until it has one.
 */
function startingConfig() {
  const config = defaultConfig();
  for (const layer of /** @type {const} */ (['stt', 'llm', 'tts', 'reflex'])) {
    // The dropdown's first, unless provider-presets.js says otherwise.
    const first = startingPreset(layer);
    if (!first) continue;
    const model = first.models[0] ?? '';
    Object.assign(config[layer], { baseURL: first.baseURL, model });
    if (layer === 'tts') config.tts.voice = voicesFor(first, model)[0] ?? '';
  }
  return config;
}

/**
 * Each layer's first provider is an entry with no key yet, and the layer points
 * at it, so the admin page can say "missing key" against a provider it knows.
 * @param {any} config @returns {import('./endpoints.js').Endpoint[]}
 */
function startingEndpoints(config) {
  /** @type {import('./endpoints.js').Endpoint[]} */ const out = [];
  for (const layer of /** @type {const} */ (['stt', 'llm', 'tts', 'reflex'])) {
    // The dropdown's first, unless provider-presets.js says otherwise.
    const first = startingPreset(layer);
    if (!first) continue;
    config[layer].endpointId = first.id;
    if (!out.some((e) => e.id === first.id)) out.push({ id: first.id, name: first.label, baseURL: first.baseURL, apiKey: '' });
  }
  return out;
}

/**
 * Display names are unique ignoring case: macOS file names ignore it, and
 * nobody can tell two robots called Max and max apart in a list.
 * @param {string} name @param {string} dir @param {string} [except] the path of the character being renamed
 */
function nameTaken(name, dir, except) {
  const lower = name.toLowerCase();
  return listCharacters(dir).characters.some((c) => c.path !== except && c.name.toLowerCase() === lower);
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
  /** token → the file that has it first */
  /** @type {Map<string, string>} */ const seen = new Map();
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
    const path = join(dir, file);
    try {
      const raw = JSON.parse(readFileSync(path, 'utf8'));
      if (typeof raw.token !== 'string' || !TOKEN.test(raw.token)) throw new Error('no valid token');
      // A copied file shares its original's token, and the body holding it
      // would always be let in as whichever file sorts first.
      const first = seen.get(raw.token);
      if (first) throw new Error(`same token as ${first} — give it its own (npm run add-character makes one)`);
      seen.set(raw.token, path);
      const id = file.slice(0, -'.json'.length);
      // loadConfig fills every field the file leaves out, as it does for the
      // phone's localStorage: an older file still loads after a new setting.
      const config = loadConfig({ getItem: () => JSON.stringify(raw.config ?? {}), setItem() {} });
      // A file written before endpoints existed has its keys in a table; its
      // entries are worked out from that until the next write keeps them.
      const endpoints = Array.isArray(raw.endpoints) ? storedEndpoints(raw.endpoints) : endpointsFrom(config, keysFrom(raw.keys));
      characters.push({
        id, name: typeof raw.name === 'string' ? raw.name : id, token: raw.token, config: withEndpointIds(config, endpoints), endpoints,
        savedReflexes: storedSavedReflexes(raw.savedReflexes), path,
      });
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
  const raw = {
    name: c.name, token: c.token, config: c.config,
    ...(c.endpoints?.length ? { endpoints: c.endpoints } : {}),
    ...(c.savedReflexes?.length ? { savedReflexes: c.savedReflexes } : {}),
  };
  writeFileSync(c.path, JSON.stringify(raw, null, 2) + '\n', { mode: 0o600 });
  // writeFileSync's mode only applies when it creates the file.
  chmodSync(c.path, 0o600);
}

/** The key table as stored: string to string, and nothing else. @param {unknown} v */
export function keysFrom(v) {
  const out = /** @type {Record<string, string>} */ ({});
  if (!isPlain(v)) return out;
  for (const [addr, key] of Object.entries(/** @type {Record<string, unknown>} */ (v))) {
    if (typeof key === 'string' && !BLOCKED.has(addr)) out[addr] = key;
  }
  return out;
}

/** Prototype keys are dropped: a PATCH body is JSON from a browser. */
const BLOCKED = new Set(['__proto__', 'constructor', 'prototype']);
const isPlain = (/** @type {unknown} */ v) => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Objects merge key by key; anything else — arrays, strings, null — replaces.
 * Returns a new object and leaves `base` alone.
 * @param {any} base @param {unknown} patch @returns {any}
 */
export function deepMerge(base, patch) {
  if (!isPlain(patch)) return base;
  const out = { ...base };
  for (const [k, v] of Object.entries(/** @type {Record<string, unknown>} */ (patch))) {
    if (BLOCKED.has(k)) continue;
    out[k] = isPlain(v) && isPlain(out[k]) ? deepMerge(out[k], v) : v;
  }
  return out;
}

/**
 * Read the file, change it, write it back — never from a snapshot taken
 * earlier. A robot holds the file as it was at hello and the admin page edits
 * it at the same time; each writes only what it changed.
 * @param {string} path @param {(raw: any) => void} change
 */
function updateFile(path, change) {
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  raw.config = raw.config ?? {};
  change(raw);
  writeFileSync(path, JSON.stringify(raw, null, 2) + '\n', { mode: 0o600 });
  chmodSync(path, 0o600);
}

/**
 * Change part of a character's config on disk, and nothing else (see
 * updateFile). A replaced token stays replaced.
 * @param {string} path @param {(config: any) => void} change
 */
export function updateConfig(path, change) {
  updateFile(path, (raw) => change(raw.config));
}

/**
 * The admin page's edit. The name is only the display name: the file, and so
 * the id, stay put, and a body online under this character stays online.
 * @param {string} path
 * @param {{ name?: unknown, config?: unknown, endpoints?: unknown, savedReflexes?: unknown }} patch
 */
export function patchCharacter(path, patch) {
  const endpoints = patch.endpoints === undefined ? undefined : checkEndpoints(patch.endpoints);
  const savedReflexes = patch.savedReflexes === undefined ? undefined : checkSavedReflexes(patch.savedReflexes);
  if (patch.name !== undefined) {
    if (typeof patch.name !== 'string') throw new Error('name must be a string');
    checkName(patch.name);
    if (nameTaken(patch.name, dirname(path), path)) throw new Error(`a character called ${patch.name} already exists`);
  }
  if (patch.config !== undefined && !isPlain(patch.config)) throw new Error('config must be an object');
  updateFile(path, (raw) => {
    // The first write of an old file turns its key table into entries, from
    // the config as it was, before this write changes anything.
    if (!Array.isArray(raw.endpoints)) raw.endpoints = endpointsFrom(raw.config, keysFrom(raw.keys));
    delete raw.keys;
    if (patch.name !== undefined) raw.name = patch.name;
    if (patch.config !== undefined) raw.config = deepMerge(raw.config, patch.config);
    if (endpoints !== undefined) raw.endpoints = endpoints;
    if (savedReflexes !== undefined) raw.savedReflexes = savedReflexes;
  });
}

/** @param {string} path @returns {string} the new token */
export function regenerateToken(path) {
  const token = randomBytes(16).toString('hex');
  updateFile(path, (raw) => { raw.token = token; });
  return token;
}

/** @param {string} path */
export function deleteCharacter(path) { unlinkSync(path); }

/**
 * By file name. An id is a name that passed checkName when it was created, so
 * anything that would not pass now cannot be one — and must not reach join().
 * @param {string} id @param {string} [dir]
 * @returns {Character | null}
 */
export function characterById(id, dir = CHARACTERS_DIR) {
  try { checkName(id); } catch { return null; }
  return listCharacters(dir).characters.find((c) => c.id === id) ?? null;
}

/** The three layers a robot cannot run without. The reflex is optional. */
export function ready(/** @type {any} */ config) {
  return layerReady(config.stt) && layerReady(config.llm) && layerReady(config.tts);
}
